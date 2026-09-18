"""
Seed the database with realistic sample incidents, alerts, RCA results, and audit logs.
Only runs once — skips if incidents already exist.
"""
import logging
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.database import AsyncSessionLocal
from app.models import Incident, Alert, RCAResult, AuditLog, PipelineAction
from app.pipeline.rca import run_rca
from app.pipeline.remediation import generate_remediation_plan, simulate_action
from app.auth import hash_password

logger = logging.getLogger("seed")


def _dt(hours_ago: float = 0) -> datetime:
    return datetime.utcnow() - timedelta(hours=hours_ago)


SEED_INCIDENTS = [
    # ── Active / open ────────────────────────────────────────────
    {
        "title":       "Database CPU High — production-db-01",
        "severity":    "Critical",
        "status":      "Investigating",
        "type":        "Performance",
        "service":     "database-primary",
        "environment": "Production",
        "description": "CPU utilization on production-db-01 has been above 90% for the past 12 minutes. Slow query alerts are firing. The payments table appears to have a lock contention issue. Connection pool at 512/512.",
        "created_by":  "Jane Smith",
        "hours_ago":   0.3,
    },
    {
        "title":       "Payment API Timeout — checkout service",
        "severity":    "Critical",
        "status":      "Open",
        "type":        "Network",
        "service":     "payment-api",
        "environment": "Production",
        "description": "Payment API requests timing out. Error: ECONNRESET after 30 s. Affects all users attempting checkout. Error rate 38%. Started at approximately 14:22 UTC.",
        "created_by":  "Admin",
        "hours_ago":   0.6,
    },
    {
        "title":       "Service Unavailable — auth-service pods crash-looping",
        "severity":    "High",
        "status":      "Open",
        "type":        "Availability",
        "service":     "auth-service",
        "environment": "Production",
        "description": "Auth service returning 503 for all requests. Pods are in CrashLoopBackOff state. Memory limit hit. Users unable to log in. OOM kill observed in pod logs.",
        "created_by":  "Jane Smith",
        "hours_ago":   0.9,
    },
    {
        "title":       "Memory Usage High — order-service",
        "severity":    "High",
        "status":      "Investigating",
        "type":        "Performance",
        "service":     "order-service",
        "environment": "Production",
        "description": "Memory usage on order-service instances has been climbing steadily. Currently at 87% of limit. If not addressed, OOM kill expected within 30 minutes.",
        "created_by":  "Admin",
        "hours_ago":   2.0,
    },
    {
        "title":       "Payment Failure — Stripe webhook 400 errors",
        "severity":    "Medium",
        "status":      "Open",
        "type":        "Data",
        "service":     "billing-service",
        "environment": "Production",
        "description": "Stripe webhook endpoint returning HTTP 400. Payment confirmations not being processed. Affects post-payment order fulfilment. ~200 orders pending confirmation.",
        "created_by":  "Jane Smith",
        "hours_ago":   1.0,
    },
    {
        "title":       "Database Replica Lag — read queries returning stale data",
        "severity":    "Medium",
        "status":      "Investigating",
        "type":        "Data",
        "service":     "database-replica",
        "environment": "Production",
        "description": "Replication lag on the primary read replica has exceeded 4 minutes. Users on product listing and dashboard pages seeing data that is up to 4 minutes old.",
        "created_by":  "Admin",
        "hours_ago":   3.0,
    },
    {
        "title":       "API Rate Limit Errors — third-party maps service",
        "severity":    "Low",
        "status":      "Open",
        "type":        "Network",
        "service":     "location-service",
        "environment": "Production",
        "description": "HTTP 429 errors from maps provider. Location features degraded. Non-critical user-facing impact. Need to review quota usage and implement caching.",
        "created_by":  "Jane Smith",
        "hours_ago":   4.0,
    },
    # ── Resolved (history) ───────────────────────────────────────
    {
        "title":       "Database CPU High — analytics-db spike",
        "severity":    "High",
        "status":      "Resolved",
        "type":        "Performance",
        "service":     "analytics-db",
        "environment": "Production",
        "description": "Analytics database CPU spiked to 98% during batch report generation.",
        "created_by":  "Admin",
        "hours_ago":   25.0,
        "resolution":  "Rescheduled batch job. Added CPU alert at 80% threshold.",
        "mttr":        "34 min",
    },
    {
        "title":       "Service Unavailable — notification-service down",
        "severity":    "Medium",
        "status":      "Resolved",
        "type":        "Availability",
        "service":     "notification-service",
        "environment": "Production",
        "description": "Email and push notification service went down due to a misconfigured environment variable after a deploy.",
        "created_by":  "Jane Smith",
        "hours_ago":   50.0,
        "resolution":  "Rolled back deploy. Corrected environment variable. Redeployed.",
        "mttr":        "18 min",
    },
    {
        "title":       "Payment Failure — expired API key",
        "severity":    "Critical",
        "status":      "Resolved",
        "type":        "Data",
        "service":     "payment-api",
        "environment": "Production",
        "description": "Payment processor API key expired causing all payment attempts to fail for 22 minutes.",
        "created_by":  "Admin",
        "hours_ago":   75.0,
        "resolution":  "Rotated API key. Added 30-day expiry alert to secrets manager.",
        "mttr":        "22 min",
    },
    {
        "title":       "API Timeout — search service cold start",
        "severity":    "Medium",
        "status":      "Resolved",
        "type":        "Network",
        "service":     "search-service",
        "environment": "Production",
        "description": "Search service scaled to zero overnight. Cold start on first morning request caused 45 s timeout for ~800 users.",
        "created_by":  "Jane Smith",
        "hours_ago":   100.0,
        "resolution":  "Enabled minimum instance count of 1. Added warm-up endpoint.",
        "mttr":        "12 min",
    },
    {
        "title":       "Memory Usage High — image processing worker",
        "severity":    "High",
        "status":      "Resolved",
        "type":        "Performance",
        "service":     "media-service",
        "environment": "Production",
        "description": "Image processing workers consuming excessive memory due to a bug in v2.4.1 that failed to release buffers.",
        "created_by":  "Admin",
        "hours_ago":   125.0,
        "resolution":  "Deployed hotfix v2.4.2. Confirmed memory stable below 60%.",
        "mttr":        "55 min",
    },
    {
        "title":       "Service Unavailable — staging deploy went to production",
        "severity":    "Critical",
        "status":      "Resolved",
        "type":        "Availability",
        "service":     "api-gateway",
        "environment": "Production",
        "description": "A CI/CD pipeline misconfiguration deployed a staging build to the production environment, causing immediate downtime.",
        "created_by":  "Admin",
        "hours_ago":   170.0,
        "resolution":  "Immediate rollback. Pipeline environment checks added. Post-mortem complete.",
        "mttr":        "9 min",
    },
]


async def seed_database():
    async with AsyncSessionLocal() as db:
        # Check if already seeded
        count = (await db.execute(select(func.count()).select_from(Incident))).scalar()
        if count and count >= 5:
            logger.info(f"Database already seeded ({count} incidents). Skipping.")
            return

        logger.info("🌱 Seeding database with sample data…")

        # Create demo user
        from app.models import User
        user_count = (await db.execute(select(func.count()).select_from(User))).scalar()
        if not user_count:
            users = [
                User(name="Admin User", email="admin@company.com", hashed_password=hash_password("admin123")),
                User(name="Jane Smith", email="jane@company.com",  hashed_password=hash_password("pass123")),
            ]
            for u in users:
                db.add(u)
            await db.flush()

        # Create incidents + RCA + actions
        for seed in SEED_INCIDENTS:
            inc = Incident(
                title=       seed["title"],
                description= seed["description"],
                severity=    seed["severity"],
                status=      seed["status"],
                type=        seed["type"],
                service=     seed["service"],
                environment= seed["environment"],
                created_by=  seed["created_by"],
                resolution=  seed.get("resolution"),
                mttr=        seed.get("mttr"),
                created_at=  _dt(seed["hours_ago"]),
                updated_at=  _dt(seed["hours_ago"] * 0.5),
            )
            if seed["status"] == "Resolved":
                inc.resolved_at = _dt(seed["hours_ago"] * 0.1)
            db.add(inc)
            await db.flush()

            # Add sample alert
            alert = Alert(
                incident_id=inc.id,
                source="Prometheus",
                severity=seed["severity"],
                service=seed["service"],
                message=seed["description"][:200],
                metric=f"p99={200+hash(seed['title'])%4800}ms",
            )
            db.add(alert)

            # Run RCA
            incident_dict = {
                "id":          inc.id,
                "title":       inc.title,
                "description": inc.description,
                "severity":    inc.severity,
                "type":        inc.type,
                "service":     inc.service,
                "environment": inc.environment,
            }
            rca_data = run_rca(incident_dict)
            rca = RCAResult(incident_id=inc.id, **rca_data)
            db.add(rca)
            await db.flush()

            # Generate remediation actions (for open incidents only)
            if seed["status"] != "Resolved":
                actions = generate_remediation_plan(incident_dict, rca_data)
                for act in actions:
                    sim = simulate_action(act, incident_dict)
                    row = PipelineAction(
                        incident_id=      inc.id,
                        action_type=      act["action_type"],
                        description=      act["description"],
                        command=          act.get("command"),
                        rollback_command= act.get("rollback_command"),
                        status=           "approved",
                        risk_level=       act["risk_level"],
                        confidence=       act["confidence"],
                        simulation_result=sim,
                    )
                    db.add(row)

            # Audit log
            audit = AuditLog(
                incident_id=inc.id,
                action="INCIDENT_SEEDED",
                detail=f"Sample incident '{inc.title}' loaded",
                actor="System",
                log_type="SYSTEM",
                tags=[inc.id, "seed"],
            )
            db.add(audit)

        await db.commit()
        logger.info(f"✅ Seeded {len(SEED_INCIDENTS)} incidents with RCA and remediation plans.")
