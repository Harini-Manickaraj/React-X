"""
SQLAlchemy ORM models for REACT-X backend.
Covers: Users, Incidents, Alerts, PipelineActions, AuditLog,
        RCAResult, RemediationPlan, VerificationCheck.
"""
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime,
    Text, ForeignKey, JSON, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
import uuid, enum


def _uuid():
    return str(uuid.uuid4())


# ── Enums ────────────────────────────────────────────────────────
class SeverityEnum(str, enum.Enum):
    critical = "Critical"
    high     = "High"
    medium   = "Medium"
    low      = "Low"

class StatusEnum(str, enum.Enum):
    open         = "Open"
    investigating= "Investigating"
    resolved     = "Resolved"

class ActionStatusEnum(str, enum.Enum):
    pending    = "pending"
    simulating = "simulating"
    approved   = "approved"
    executing  = "executing"
    completed  = "completed"
    failed     = "failed"
    rolled_back= "rolled_back"


# ── User ─────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"
    id            = Column(String, primary_key=True, default=_uuid)
    name          = Column(String, nullable=False)
    email         = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())


# ── Alert ─────────────────────────────────────────────────────────
class Alert(Base):
    __tablename__ = "alerts"
    id            = Column(String, primary_key=True, default=_uuid)
    incident_id   = Column(String, ForeignKey("incidents.id"), nullable=True, index=True)
    source        = Column(String, default="system")          # prometheus, datadog, manual…
    severity      = Column(String, default="Medium")
    service       = Column(String, default="unknown")
    message       = Column(Text, nullable=False)
    metric        = Column(String, nullable=True)
    raw_payload   = Column(JSON, nullable=True)
    normalised    = Column(JSON, nullable=True)               # after normalization step
    embedding     = Column(Text, nullable=True)               # JSON-serialised vector (truncated)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())

    incident = relationship("Incident", back_populates="alerts")


# ── Incident ──────────────────────────────────────────────────────
class Incident(Base):
    __tablename__ = "incidents"
    id            = Column(String, primary_key=True, default=_uuid)
    title         = Column(String, nullable=False)
    description   = Column(Text, nullable=False)
    severity      = Column(String, default="Medium")
    status        = Column(String, default="Open")
    type          = Column(String, default="Other")
    service       = Column(String, default="")
    environment   = Column(String, default="Production")
    created_by    = Column(String, default="system")
    image_data_url= Column(Text, nullable=True)
    resolution    = Column(Text, nullable=True)
    mttr          = Column(String, nullable=True)
    resolved_at   = Column(DateTime(timezone=True), nullable=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    alerts        = relationship("Alert", back_populates="incident", cascade="all, delete-orphan")
    rca           = relationship("RCAResult", back_populates="incident", uselist=False, cascade="all, delete-orphan")
    actions       = relationship("PipelineAction", back_populates="incident", cascade="all, delete-orphan")
    audit_logs    = relationship("AuditLog", back_populates="incident", cascade="all, delete-orphan")


# ── RCA Result ────────────────────────────────────────────────────
class RCAResult(Base):
    __tablename__ = "rca_results"
    id                 = Column(String, primary_key=True, default=_uuid)
    incident_id        = Column(String, ForeignKey("incidents.id"), unique=True, index=True)
    root_cause         = Column(Text, nullable=False)
    root_cause_category= Column(String, default="Unknown")
    confidence         = Column(Float, default=0.0)
    evidence           = Column(JSON, default=list)           # list of strings
    shap_factors       = Column(JSON, default=list)           # [{feature, value, direction}]
    impact_users       = Column(String, default="Unknown")
    impact_revenue     = Column(String, default="Unknown")
    impact_sla         = Column(String, default="Unknown")
    risk_score         = Column(Float, default=50.0)
    blast_radius       = Column(JSON, default=list)           # [{service, impact_pct, level}]
    recommendation     = Column(Text, nullable=True)
    resolution_steps   = Column(JSON, default=list)           # [{step, description}]
    similar_incidents  = Column(JSON, default=list)           # [{id, similarity, title}]
    pipeline_stage     = Column(String, default="rca")
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    incident = relationship("Incident", back_populates="rca")


# ── Pipeline Action ───────────────────────────────────────────────
class PipelineAction(Base):
    __tablename__ = "pipeline_actions"
    id              = Column(String, primary_key=True, default=_uuid)
    incident_id     = Column(String, ForeignKey("incidents.id"), index=True)
    action_type     = Column(String, nullable=False)          # remediate, rollback, scale, restart…
    description     = Column(Text, nullable=False)
    command         = Column(Text, nullable=True)
    status          = Column(String, default="pending")
    risk_level      = Column(String, default="low")
    confidence      = Column(Float, default=0.0)
    simulation_result= Column(JSON, nullable=True)            # predicted before/after metrics
    execution_result = Column(JSON, nullable=True)
    rollback_command = Column(Text, nullable=True)
    executed_by      = Column(String, default="AI Engine")
    started_at       = Column(DateTime(timezone=True), nullable=True)
    completed_at     = Column(DateTime(timezone=True), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    incident = relationship("Incident", back_populates="actions")


# ── Verification Check ────────────────────────────────────────────
class VerificationCheck(Base):
    __tablename__ = "verification_checks"
    id           = Column(String, primary_key=True, default=_uuid)
    incident_id  = Column(String, ForeignKey("incidents.id"), index=True)
    action_id    = Column(String, ForeignKey("pipeline_actions.id"), nullable=True)
    check_type   = Column(String, default="metric_recovery")
    result       = Column(String, default="pending")          # passed, failed, pending
    details      = Column(JSON, default=dict)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


# ── Audit Log ─────────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id          = Column(String, primary_key=True, default=_uuid)
    incident_id = Column(String, ForeignKey("incidents.id"), nullable=True, index=True)
    action      = Column(String, nullable=False)
    detail      = Column(Text, nullable=False)
    actor       = Column(String, default="AI Engine")
    log_type    = Column(String, default="AI_ACTION")         # AI_ACTION, USER_ACTION, SYSTEM, ROLLBACK
    tags        = Column(JSON, default=list)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    incident = relationship("Incident", back_populates="audit_logs")
