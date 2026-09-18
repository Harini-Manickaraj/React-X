from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.schemas import PipelineRunRequest, SimulateRequest, ApproveRequest
from app.pipeline.orchestrator import run_full_pipeline, execute_and_verify
from app.ws_manager import manager
import logging

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
logger = logging.getLogger("pipeline_router")


@router.post("/run")
async def run_pipeline(payload: PipelineRunRequest,
                       background: BackgroundTasks,
                       db: AsyncSession = Depends(get_db)):
    """Trigger the full AI pipeline for an incident (async)."""
    result = await run_full_pipeline(payload.incident_id, db)
    if "error" not in result:
        await manager.broadcast("pipeline:completed", {
            "incident_id": payload.incident_id,
            "stage":       result.get("stage"),
            "confidence":  result.get("confidence"),
            "rca_category":result.get("rca", {}).get("root_cause_category"),
        })
    return result


@router.post("/simulate")
async def simulate(payload: SimulateRequest, db: AsyncSession = Depends(get_db)):
    """Re-run simulation for a specific action."""
    from app.models import PipelineAction, Incident
    from app.pipeline.remediation import simulate_action
    action_row = await db.get(PipelineAction, payload.action_id)
    if not action_row:
        raise HTTPException(404, "Action not found")
    inc_row = await db.get(Incident, action_row.incident_id)
    incident = {"severity": inc_row.severity, "service": inc_row.service}
    action   = {"action_type": action_row.action_type, "risk_level": action_row.risk_level,
                 "confidence": action_row.confidence}
    sim = simulate_action(action, incident)
    action_row.simulation_result = sim
    await db.commit()
    return {"action_id": payload.action_id, "simulation": sim}


@router.post("/approve")
async def approve_and_execute(payload: ApproveRequest, db: AsyncSession = Depends(get_db)):
    """Approve an action and immediately execute + verify."""
    from app.models import PipelineAction
    action_row = await db.get(PipelineAction, payload.action_id)
    if not action_row:
        raise HTTPException(404, "Action not found")
    if action_row.status not in ("pending", "approved"):
        raise HTTPException(400, f"Action status is '{action_row.status}' — cannot approve.")
    action_row.status = "approved"
    await db.flush()
    result = await execute_and_verify(payload.action_id, db, payload.approved_by)
    await manager.broadcast("action:completed", result)
    return result


@router.get("/actions/{incident_id}")
async def get_actions(incident_id: str, db: AsyncSession = Depends(get_db)):
    from app.models import PipelineAction
    from sqlalchemy import select, desc
    stmt = select(PipelineAction).where(PipelineAction.incident_id == incident_id).order_by(desc(PipelineAction.created_at))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "id":               r.id,
            "action_type":      r.action_type,
            "description":      r.description,
            "command":          r.command,
            "status":           r.status,
            "risk_level":       r.risk_level,
            "confidence":       r.confidence,
            "simulation_result":r.simulation_result,
            "execution_result": r.execution_result,
            "executed_by":      r.executed_by,
            "created_at":       r.created_at.isoformat(),
        }
        for r in rows
    ]
