"""Pydantic schemas for request/response validation."""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ── Auth ─────────────────────────────────────────────────────────
class UserRegister(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]


# ── Incident ─────────────────────────────────────────────────────
class IncidentCreate(BaseModel):
    title: str
    description: str
    severity: str = "Medium"
    type: str = "Other"
    service: str = ""
    environment: str = "Production"
    image_data_url: Optional[str] = None

class IncidentUpdate(BaseModel):
    status: Optional[str] = None
    resolution: Optional[str] = None
    severity: Optional[str] = None

class IncidentOut(BaseModel):
    id: str
    title: str
    description: str
    severity: str
    status: str
    type: str
    service: str
    environment: str
    created_by: str
    resolution: Optional[str]
    mttr: Optional[str]
    resolved_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Alert ────────────────────────────────────────────────────────
class AlertCreate(BaseModel):
    source: str = "manual"
    severity: str = "Medium"
    service: str = "unknown"
    message: str
    metric: Optional[str] = None
    incident_id: Optional[str] = None

class AlertOut(BaseModel):
    id: str
    source: str
    severity: str
    service: str
    message: str
    metric: Optional[str]
    incident_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── RCA ─────────────────────────────────────────────────────────
class RCAOut(BaseModel):
    id: str
    incident_id: str
    root_cause: str
    root_cause_category: str
    confidence: float
    evidence: List[str]
    shap_factors: List[Dict[str, Any]]
    impact_users: str
    impact_revenue: str
    impact_sla: str
    risk_score: float
    blast_radius: List[Dict[str, Any]]
    recommendation: Optional[str]
    resolution_steps: List[Dict[str, Any]]
    similar_incidents: List[Dict[str, Any]]
    pipeline_stage: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Pipeline Action ──────────────────────────────────────────────
class ActionOut(BaseModel):
    id: str
    incident_id: str
    action_type: str
    description: str
    command: Optional[str]
    status: str
    risk_level: str
    confidence: float
    simulation_result: Optional[Dict[str, Any]]
    execution_result: Optional[Dict[str, Any]]
    executed_by: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Audit ────────────────────────────────────────────────────────
class AuditOut(BaseModel):
    id: str
    incident_id: Optional[str]
    action: str
    detail: str
    actor: str
    log_type: str
    tags: List[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Pipeline request/response ────────────────────────────────────
class PipelineRunRequest(BaseModel):
    incident_id: str

class PipelineRunResponse(BaseModel):
    incident_id: str
    stage: str
    rca: Optional[Dict[str, Any]]
    actions: List[Dict[str, Any]]
    message: str
    confidence: float
    evidence: List[str]

class SimulateRequest(BaseModel):
    action_id: str

class ApproveRequest(BaseModel):
    action_id: str
    approved_by: str = "User"
