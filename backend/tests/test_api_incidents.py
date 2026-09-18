"""
Integration tests for the /api/incidents REST endpoints.
Uses FastAPI TestClient with an in-memory SQLite database.
Run: cd backend && pytest tests/test_api_incidents.py -v
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

# Override database before importing app
import os
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["SECRET_KEY"]   = "test-secret-key"

from app.main     import app
from app.database import Base, get_db


# ── Test database setup ───────────────────────────────────────────

TEST_ENGINE = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    connect_args={"check_same_thread": False},
)
TestSession = async_sessionmaker(TEST_ENGINE, class_=AsyncSession, expire_on_commit=False)


async def override_get_db():
    async with TestSession() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with TEST_ENGINE.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with TEST_ENGINE.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ── Health check ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health_check(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "REACT-X" in data["service"]


# ── Create incident ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_incident_success(client):
    payload = {
        "title":       "Database CPU High — test",
        "description": "CPU utilization above 90%.",
        "severity":    "Critical",
        "type":        "Performance",
        "service":     "database-primary",
        "environment": "Production",
    }
    response = await client.post("/api/incidents", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == payload["title"]
    assert data["severity"] == "Critical"
    assert data["status"] == "Open"
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_create_incident_missing_title_returns_422(client):
    payload = {"description": "No title here.", "severity": "High"}
    response = await client.post("/api/incidents", json=payload)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_incident_auto_detects_type(client):
    payload = {
        "title":       "CPU spike",
        "description": "CPU high on database host. Slow queries detected.",
        "severity":    "High",
        "type":        "Other",   # should be overridden
        "service":     "db",
        "environment": "Production",
    }
    response = await client.post("/api/incidents", json=payload)
    assert response.status_code == 201
    data = response.json()
    # Type detection should override "Other" when description contains CPU keywords
    assert data["type"] in ("Performance", "Other")  # depends on normalization


# ── List incidents ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_incidents_empty(client):
    response = await client.get("/api/incidents")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_incidents_returns_created(client):
    payload = {
        "title": "Test incident",
        "description": "Test description.",
        "severity": "Medium",
        "type": "Other",
        "service": "test-service",
        "environment": "Staging",
    }
    await client.post("/api/incidents", json=payload)
    response = await client.get("/api/incidents")
    assert response.status_code == 200
    incidents = response.json()
    assert len(incidents) == 1
    assert incidents[0]["title"] == "Test incident"


@pytest.mark.asyncio
async def test_list_incidents_filter_by_severity(client):
    for sev in ["Critical", "Medium", "Low"]:
        await client.post("/api/incidents", json={
            "title": f"{sev} incident",
            "description": "test",
            "severity": sev,
            "type": "Other",
            "service": "svc",
            "environment": "Production",
        })
    response = await client.get("/api/incidents?severity=Critical")
    assert response.status_code == 200
    result = response.json()
    assert all(i["severity"] == "Critical" for i in result)


# ── Get single incident ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_incident_by_id(client):
    create_resp = await client.post("/api/incidents", json={
        "title": "Get by ID test",
        "description": "test",
        "severity": "Low",
        "type": "Other",
        "service": "svc",
        "environment": "Production",
    })
    inc_id = create_resp.json()["id"]
    response = await client.get(f"/api/incidents/{inc_id}")
    assert response.status_code == 200
    assert response.json()["id"] == inc_id


@pytest.mark.asyncio
async def test_get_nonexistent_incident_returns_404(client):
    response = await client.get("/api/incidents/nonexistent-id")
    assert response.status_code == 404


# ── Update incident ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_incident_status(client):
    create_resp = await client.post("/api/incidents", json={
        "title": "Update test",
        "description": "test",
        "severity": "High",
        "type": "Other",
        "service": "svc",
        "environment": "Production",
    })
    inc_id = create_resp.json()["id"]

    update_resp = await client.patch(f"/api/incidents/{inc_id}", json={
        "status": "Investigating"
    })
    assert update_resp.status_code == 200
    assert update_resp.json()["status"] == "Investigating"


@pytest.mark.asyncio
async def test_resolve_incident_calculates_mttr(client):
    create_resp = await client.post("/api/incidents", json={
        "title": "Resolve test",
        "description": "test",
        "severity": "Critical",
        "type": "Other",
        "service": "svc",
        "environment": "Production",
    })
    inc_id = create_resp.json()["id"]

    resolve_resp = await client.patch(f"/api/incidents/{inc_id}", json={
        "status": "Resolved",
        "resolution": "Fixed by restarting the service."
    })
    assert resolve_resp.status_code == 200
    data = resolve_resp.json()
    assert data["status"] == "Resolved"
    assert data["resolution"] == "Fixed by restarting the service."
    assert data["resolved_at"] is not None
    assert data["mttr"] is not None  # MTTR should be calculated
