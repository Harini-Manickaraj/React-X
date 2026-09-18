"""
Pipeline Orchestrator — ties all stages together.
Full pipeline: Alert Input → Normalization → Correlation → RCA →
               Impact Scoring → Remediation Decision → Simulation →
               Policy Gate → Execution → Verification → Auto-Rollback → Audit
"""
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import logging

from app import models
from app.pipeline.normalization import normalise_alert
from app.pipeline.correlation   import cluster_alerts, get_blast_radius
from app.pipeline.rca            import run_rca
from app.pipeline.remediation    import generate_remediation_plan, simulate_action, policy_gate
from app.pipeline.verification   import execute_action, verify_resolution, should_rollback, execute_rollback, calculate_mttr

logger = logging.getLogger("pipeline")


async def _audit(db: AsyncSession, incident_id: str, action: str, detail: str,
                 actor: str = "AI Engine", log_type: str = "AI_ACTION", tags: list = None):
    log = models.AuditLog(
        incident_id=incident_id,
        action=action,
        detail=detail,
        actor=actor,
        log_type=log_type,
        tags=tags or [],
    )
    db.add(log)
    await db.flush()


async def run_full_pipeline(incident_id: str, db: AsyncSession) -> Dict[str, Any]:
    """
    Run the full AI pipeline for one incident.
    Returns summary of what happened at each stage.
    """
    # ── Load incident ────────────────────────────────────────────
    inc_row = await db.get(models.Incident, incident_id)
    if not inc_row:
        return {"error": "Incident not found", "incident_id": incident_id}

    incident = {
        "id":          inc_row.id,
        "title":       inc_row.title,
        "description": inc_row.description,
        "severity":    inc_row.severity,
        "type":        inc_row.type,
        "service":     inc_row.service,
        "environment": inc_row.environment,
    }

    await _audit(db, incident_id, "PIPELINE_STARTED",
                 f"AI pipeline triggered for {incident_id}", tags=[incident_id])

    # ── Stage 1: Normalization (on description as pseudo-alert) ──
    pseudo_alert = normalise_alert({
        "message":     inc_row.description,
        "service":     inc_row.service,
        "severity":    inc_row.severity,
        "environment": inc_row.environment,
    })
    incident["type"] = pseudo_alert.get("type", incident["type"])

    # ── Stage 3: RCA ──────────────────────────────────────────────
    rca_data = run_rca(incident)

    # Upsert RCA record
    existing_rca = await db.get(models.RCAResult, incident_id)
    if existing_rca:
        for k, v in rca_data.items():
            setattr(existing_rca, k, v)
        existing_rca.incident_id = incident_id
    else:
        rca_row = models.RCAResult(incident_id=incident_id, **rca_data)
        db.add(rca_row)

    await db.flush()
    await _audit(db, incident_id, "RCA_COMPLETED",
                 f"Root cause: {rca_data['root_cause_category']}. Confidence: {rca_data['confidence']:.0%}",
                 tags=[incident_id, "rca"])

    # Update incident status to Investigating
    if inc_row.status == "Open":
        inc_row.status = "Investigating"

    # ── Stage 4-5: Remediation + Simulation ──────────────────────
    actions = generate_remediation_plan(incident, rca_data)
    action_rows = []
    for act in actions:
        # Simulate
        sim_result = simulate_action(act, incident)
        act["simulation_result"] = sim_result

        # Policy gate
        gate = policy_gate(act, rca_data)
        act["status"] = "approved" if gate["approved"] else "pending"

        row = models.PipelineAction(
            incident_id       = incident_id,
            action_type       = act["action_type"],
            description       = act["description"],
            command           = act.get("command"),
            rollback_command  = act.get("rollback_command"),
            status            = act["status"],
            risk_level        = act["risk_level"],
            confidence        = act["confidence"],
            simulation_result = act["simulation_result"],
        )
        db.add(row)
        await db.flush()
        action_rows.append(row)
        await _audit(db, incident_id, "ACTION_GENERATED",
                     f"Action '{act['description']}' — status: {act['status']}",
                     tags=[incident_id, "remediation"])

    await db.commit()

    return {
        "incident_id": incident_id,
        "stage":       "rca_and_remediation",
        "rca":         rca_data,
        "actions":     [{"id": r.id, "description": r.description,
                         "status": r.status, "risk_level": r.risk_level,
                         "confidence": r.confidence} for r in action_rows],
        "message":     f"Pipeline complete. Root cause: {rca_data['root_cause_category']}.",
        "confidence":  rca_data["confidence"],
        "evidence":    rca_data["evidence"],
    }


async def execute_and_verify(action_id: str, db: AsyncSession, approved_by: str = "AI Engine") -> Dict[str, Any]:
    """Execute an approved action, verify, auto-rollback if needed."""
    action_row = await db.get(models.PipelineAction, action_id)
    if not action_row:
        return {"error": "Action not found"}

    inc_row = await db.get(models.Incident, action_row.incident_id)
    incident = {"id": inc_row.id, "severity": inc_row.severity,
                "service": inc_row.service, "status": inc_row.status}

    action_dict = {
        "id":               action_row.id,
        "action_type":      action_row.action_type,
        "description":      action_row.description,
        "command":          action_row.command,
        "rollback_command": action_row.rollback_command,
        "risk_level":       action_row.risk_level,
        "confidence":       action_row.confidence,
        "simulation_result":action_row.simulation_result,
    }

    # Execute
    action_row.status    = "executing"
    action_row.started_at = datetime.utcnow()
    await db.flush()

    exec_result = execute_action(action_dict)
    action_dict["execution_result"] = exec_result
    action_row.execution_result = exec_result

    # Verify
    verification = verify_resolution(incident, action_dict)

    check = models.VerificationCheck(
        incident_id = inc_row.id,
        action_id   = action_row.id,
        check_type  = "metric_recovery",
        result      = "passed" if verification["resolved"] else "failed",
        details     = verification["details"],
    )
    db.add(check)

    rollback_triggered = False
    if verification["resolved"]:
        action_row.status = "completed"
        inc_row.status    = "Resolved"
        inc_row.resolved_at = datetime.utcnow()
        inc_row.resolution  = f"Resolved by: {action_row.description}"
        inc_row.mttr        = calculate_mttr(inc_row.created_at.isoformat(), inc_row.resolved_at.isoformat())
        await _audit(db, inc_row.id, "INCIDENT_RESOLVED",
                     f"Resolved by action {action_row.action_type}. MTTR: {inc_row.mttr}",
                     actor=approved_by, log_type="AI_ACTION",
                     tags=[inc_row.id, "resolved"])
    else:
        if should_rollback(verification, action_dict):
            execute_rollback(action_dict)
            action_row.status = "rolled_back"
            rollback_triggered = True
            await _audit(db, inc_row.id, "AUTO_ROLLBACK",
                         f"Auto-rollback triggered for action {action_row.action_type}",
                         log_type="ROLLBACK", tags=[inc_row.id, "rollback"])
        else:
            action_row.status = "failed"

    action_row.completed_at = datetime.utcnow()
    action_row.executed_by  = approved_by
    await db.commit()

    return {
        "action_id":          action_id,
        "execution_result":   exec_result,
        "verification":       verification,
        "rollback_triggered": rollback_triggered,
        "incident_resolved":  verification["resolved"],
        "incident_status":    inc_row.status,
    }
