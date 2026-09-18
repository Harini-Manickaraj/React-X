from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import Optional
from app.database import get_db
from app.models import AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/")
async def list_audit(
    incident_id: Optional[str] = Query(None),
    log_type:    Optional[str] = Query(None),
    q:           Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog).order_by(desc(AuditLog.created_at)).limit(limit)
    if incident_id:
        stmt = stmt.where(AuditLog.incident_id == incident_id)
    if log_type:
        stmt = stmt.where(AuditLog.log_type == log_type)
    if q:
        stmt = stmt.where(AuditLog.detail.ilike(f"%{q}%"))
    result = await db.execute(stmt)
    return [
        {
            "id":          r.id,
            "incident_id": r.incident_id,
            "action":      r.action,
            "detail":      r.detail,
            "actor":       r.actor,
            "log_type":    r.log_type,
            "tags":        r.tags,
            "time":        r.created_at.isoformat(),
        }
        for r in result.scalars().all()
    ]


@router.get("/stats")
async def audit_stats(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func, select
    from app.models import Incident, AuditLog
    total_incidents = (await db.execute(select(func.count()).select_from(Incident))).scalar()
    open_count      = (await db.execute(select(func.count()).select_from(Incident).where(Incident.status != "Resolved"))).scalar()
    resolved_count  = (await db.execute(select(func.count()).select_from(Incident).where(Incident.status == "Resolved"))).scalar()
    critical_count  = (await db.execute(select(func.count()).select_from(Incident).where(Incident.severity == "Critical").where(Incident.status != "Resolved"))).scalar()
    return {
        "total_incidents": total_incidents,
        "open":            open_count,
        "resolved":        resolved_count,
        "critical":        critical_count,
    }
