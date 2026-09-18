from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from typing import Optional, List
from datetime import datetime

from app.database import get_db
from app.models import Incident, AuditLog
from app.schemas import IncidentCreate, IncidentUpdate, IncidentOut
from app.pipeline.verification import calculate_mttr
from app.ws_manager import manager

router = APIRouter(prefix="/incidents", tags=["incidents"])


def _inc_to_dict(inc: Incident) -> dict:
    return {
        "id":            inc.id,
        "title":         inc.title,
        "description":   inc.description,
        "severity":      inc.severity,
        "status":        inc.status,
        "type":          inc.type,
        "service":       inc.service,
        "environment":   inc.environment,
        "created_by":    inc.created_by,
        "resolution":    inc.resolution,
        "mttr":          inc.mttr,
        "resolved_at":   inc.resolved_at.isoformat() if inc.resolved_at else None,
        "created_at":    inc.created_at.isoformat(),
        "updated_at":    inc.updated_at.isoformat() if inc.updated_at else inc.created_at.isoformat(),
    }


@router.get("/", response_model=List[dict])
async def list_incidents(
    status:   Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    q:        Optional[str] = Query(None),
    page:     int = Query(1, ge=1),
    limit:    int = Query(50, le=200),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(Incident).order_by(desc(Incident.created_at))
    if status:
        stmt = stmt.where(Incident.status == status)
    if severity:
        stmt = stmt.where(Incident.severity == severity)
    if q:
        stmt = stmt.where(Incident.title.ilike(f"%{q}%"))
    stmt = stmt.offset((page - 1) * limit).limit(limit)
    result = await db.execute(stmt)
    return [_inc_to_dict(i) for i in result.scalars().all()]


@router.post("/", response_model=dict, status_code=201)
async def create_incident(payload: IncidentCreate, created_by: str = "User",
                           db: AsyncSession = Depends(get_db)):
    from app.pipeline.normalization import detect_type
    inc_type = payload.type if payload.type != "Other" else detect_type(payload.description, payload.service)
    inc = Incident(
        title=payload.title.strip(),
        description=payload.description.strip(),
        severity=payload.severity,
        type=inc_type,
        service=payload.service,
        environment=payload.environment,
        created_by=created_by,
        image_data_url=payload.image_data_url,
    )
    db.add(inc)
    audit = AuditLog(
        incident_id=inc.id,
        action="INCIDENT_CREATED",
        detail=f"Incident '{inc.title}' created via API",
        actor=created_by,
        log_type="USER_ACTION",
        tags=[inc.id],
    )
    db.add(audit)
    await db.commit()
    await db.refresh(inc)
    result = _inc_to_dict(inc)
    await manager.broadcast("incident:created", result)
    return result


@router.get("/{incident_id}", response_model=dict)
async def get_incident(incident_id: str, db: AsyncSession = Depends(get_db)):
    inc = await db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return _inc_to_dict(inc)


@router.patch("/{incident_id}", response_model=dict)
async def update_incident(incident_id: str, payload: IncidentUpdate,
                           updated_by: str = "User",
                           db: AsyncSession = Depends(get_db)):
    inc = await db.get(Incident, incident_id)
    if not inc:
        raise HTTPException(404, "Incident not found")

    if payload.status:
        inc.status = payload.status
        if payload.status == "Resolved":
            inc.resolved_at = datetime.utcnow()
            inc.mttr        = calculate_mttr(inc.created_at.isoformat(), inc.resolved_at.isoformat())
    if payload.resolution:
        inc.resolution = payload.resolution
    if payload.severity:
        inc.severity   = payload.severity

    audit = AuditLog(
        incident_id=inc.id,
        action="INCIDENT_UPDATED",
        detail=f"Status → {inc.status}" + (f". Resolution: {inc.resolution}" if inc.resolution else ""),
        actor=updated_by,
        log_type="USER_ACTION",
        tags=[inc.id, "update"],
    )
    db.add(audit)
    await db.commit()
    await db.refresh(inc)
    result = _inc_to_dict(inc)
    await manager.broadcast("incident:updated", result)
    return result


@router.get("/{incident_id}/rca", response_model=dict)
async def get_rca(incident_id: str, db: AsyncSession = Depends(get_db)):
    from app.models import RCAResult
    rca = await db.get(RCAResult, incident_id)
    if not rca:
        raise HTTPException(404, "RCA not yet run for this incident. POST /pipeline/run first.")
    return {
        "incident_id":          rca.incident_id,
        "root_cause":           rca.root_cause,
        "root_cause_category":  rca.root_cause_category,
        "confidence":           rca.confidence,
        "evidence":             rca.evidence,
        "shap_factors":         rca.shap_factors,
        "impact_users":         rca.impact_users,
        "impact_revenue":       rca.impact_revenue,
        "impact_sla":           rca.impact_sla,
        "risk_score":           rca.risk_score,
        "blast_radius":         rca.blast_radius,
        "recommendation":       rca.recommendation,
        "resolution_steps":     rca.resolution_steps,
        "similar_incidents":    rca.similar_incidents,
        "created_at":           rca.created_at.isoformat(),
    }
