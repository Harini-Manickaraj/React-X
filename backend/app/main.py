"""
REACT-X FastAPI Backend
Autonomous Incident Resolution Engine — REST + WebSocket API
"""
import logging, asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config   import settings
from app.database import init_db
from app.ws_manager import manager
from app.routers  import auth, incidents, pipeline, audit

logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL, "INFO"),
                    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")


# ── Lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀  REACT-X backend starting…")
    await init_db()
    from app.seed import seed_database
    await seed_database()
    # Start live signal background task
    task = asyncio.create_task(_live_signal_loop())
    yield
    task.cancel()
    logger.info("🛑  REACT-X backend shutdown.")


app = FastAPI(
    title="REACT-X API",
    description="Autonomous Incident Resolution Engine — AI pipeline backend",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS — allow the plain file:// frontend ──────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # In production, restrict to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routes ───────────────────────────────────────────────────────
app.include_router(auth.router,      prefix="/api")
app.include_router(incidents.router, prefix="/api")
app.include_router(pipeline.router,  prefix="/api")
app.include_router(audit.router,     prefix="/api")


# ── WebSocket endpoint ───────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo back ping/pong
            if data == "ping":
                await manager.send_personal(websocket, "pong", {})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Health check ─────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "REACT-X API", "version": "2.0.0"}


# ── Live signal simulation ────────────────────────────────────────
_LIVE_INCIDENTS = [
    {"title": "Database CPU High — reporting-db spike",           "severity": "High",   "type": "Performance",  "service": "reporting-db",   "environment": "Production",  "description": "Reporting database CPU spiked to 91% following scheduled report run."},
    {"title": "API Timeout — user-service /profile endpoint",     "severity": "Medium", "type": "Network",      "service": "user-service",   "environment": "Production",  "description": "Profile API requests timing out intermittently. p99 latency 8200 ms."},
    {"title": "Memory Usage High — cache service",                "severity": "Low",    "type": "Performance",  "service": "cache-service",  "environment": "Production",  "description": "In-memory cache service memory at 82% of limit."},
    {"title": "Payment Failure — invalid card BIN list",          "severity": "Medium", "type": "Data",         "service": "payment-api",    "environment": "Production",  "description": "BIN validation rejecting valid cards due to stale lookup table."},
]
_live_idx = 0


async def _live_signal_loop():
    global _live_idx
    await asyncio.sleep(10)   # warm-up
    while True:
        await asyncio.sleep(settings.LIVE_SIGNAL_INTERVAL_SECONDS)
        try:
            if _live_idx >= len(_LIVE_INCIDENTS):
                _live_idx = 0
            data = {**_LIVE_INCIDENTS[_live_idx], "created_by": "System Monitor"}
            _live_idx += 1
            # Create in DB
            from app.database import AsyncSessionLocal
            from app.models import Incident, AuditLog
            async with AsyncSessionLocal() as db:
                inc = Incident(**data)
                db.add(inc)
                log = AuditLog(
                    incident_id=inc.id,
                    action="LIVE_INCIDENT",
                    detail=f"Live signal: {data['title']}",
                    log_type="SYSTEM",
                    tags=["live", "auto"],
                )
                db.add(log)
                await db.commit()
                await db.refresh(inc)
            await manager.broadcast("live:new", {
                "id":       inc.id,
                "title":    inc.title,
                "severity": inc.severity,
                "type":     inc.type,
                "service":  inc.service,
                "status":   "Open",
                "created_at": inc.created_at.isoformat(),
            })
            logger.info(f"📡 Live signal emitted: {data['title']}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Live signal error: {e}")
