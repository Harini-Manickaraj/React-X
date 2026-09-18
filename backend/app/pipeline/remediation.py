"""
Stage 4-6 — Remediation Decision + Simulation + Policy/Blast-Radius Gating
Generates action plans, simulates predicted outcomes, checks policy gates.
"""
from typing import Dict, Any, List
import random
from datetime import datetime


# ── Action templates keyed by RCA category ───────────────────────
ACTION_TEMPLATES: Dict[str, List[Dict[str, Any]]] = {
    "Database Performance": [
        {
            "action_type":   "kill_blocking_queries",
            "description":   "Kill long-running blocking database queries",
            "command":       "kubectl exec -n prod db-primary -- psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle in transaction' AND query_start < NOW() - INTERVAL '30 seconds'\"",
            "rollback_command": None,
            "risk_level":    "low",
        },
        {
            "action_type":   "expand_connection_pool",
            "description":   "Expand DB connection pool limit",
            "command":       "kubectl exec -n prod db-primary -- psql -c \"ALTER SYSTEM SET max_connections=1024; SELECT pg_reload_conf()\"",
            "rollback_command": "kubectl exec -n prod db-primary -- psql -c \"ALTER SYSTEM SET max_connections=512; SELECT pg_reload_conf()\"",
            "risk_level":    "low",
        },
        {
            "action_type":   "circuit_breaker",
            "description":   "Activate circuit breaker on payment-service",
            "command":       "kubectl annotate svc payment-service circuit-breaker=open --overwrite",
            "rollback_command": "kubectl annotate svc payment-service circuit-breaker=closed --overwrite",
            "risk_level":    "medium",
        },
    ],
    "Availability — OOM / Crash Loop": [
        {
            "action_type":   "increase_memory_limit",
            "description":   "Increase container memory limit to stop crash loop",
            "command":       "kubectl set resources deployment/{service} --limits=memory=2Gi -n prod",
            "rollback_command": "kubectl set resources deployment/{service} --limits=memory=1Gi -n prod",
            "risk_level":    "low",
        },
        {
            "action_type":   "restart_pods",
            "description":   "Rolling restart of affected service pods",
            "command":       "kubectl rollout restart deployment/{service} -n prod",
            "rollback_command": "kubectl rollout undo deployment/{service} -n prod",
            "risk_level":    "medium",
        },
    ],
    "Network / Timeout Storm": [
        {
            "action_type":   "enable_circuit_breaker",
            "description":   "Enable circuit breaker to stop retry storm",
            "command":       "kubectl annotate svc {service} circuit-breaker=open --overwrite",
            "rollback_command": "kubectl annotate svc {service} circuit-breaker=closed --overwrite",
            "risk_level":    "low",
        },
        {
            "action_type":   "scale_up",
            "description":   "Scale up service replicas to absorb load",
            "command":       "kubectl scale deployment/{service} --replicas=6 -n prod",
            "rollback_command": "kubectl scale deployment/{service} --replicas=3 -n prod",
            "risk_level":    "low",
        },
    ],
    "Replication Lag / Data": [
        {
            "action_type":   "stop_batch_job",
            "description":   "Stop competing batch job to free disk I/O",
            "command":       "kubectl delete job batch-export-job -n prod --ignore-not-found",
            "rollback_command": None,
            "risk_level":    "low",
        },
        {
            "action_type":   "restart_replication",
            "description":   "Restart replication I/O thread on replica",
            "command":       "kubectl exec -n prod db-replica -- mysql -e \"STOP SLAVE IO_THREAD; START SLAVE IO_THREAD;\"",
            "rollback_command": None,
            "risk_level":    "medium",
        },
    ],
    "Security — Credential Attack": [
        {
            "action_type":   "block_ips",
            "description":   "Block attacker source IPs at WAF",
            "command":       "aws wafv2 create-ip-set --scope REGIONAL --name blocked-attackers --addresses {ips}",
            "rollback_command": None,
            "risk_level":    "low",
        },
        {
            "action_type":   "force_password_reset",
            "description":   "Force password reset on targeted accounts",
            "command":       "python manage.py force_password_reset --accounts targeted_accounts.txt",
            "rollback_command": None,
            "risk_level":    "low",
        },
    ],
    "default": [
        {
            "action_type":   "rollback_deployment",
            "description":   "Rollback recent deployment to previous stable version",
            "command":       "kubectl rollout undo deployment/{service} -n prod",
            "rollback_command": "kubectl rollout status deployment/{service} -n prod",
            "risk_level":    "medium",
        },
        {
            "action_type":   "scale_up",
            "description":   "Scale up service replicas to mitigate load",
            "command":       "kubectl scale deployment/{service} --replicas=5 -n prod",
            "rollback_command": "kubectl scale deployment/{service} --replicas=3 -n prod",
            "risk_level":    "low",
        },
    ],
}


def _fill_template(template: Dict[str, Any], service: str) -> Dict[str, Any]:
    svc = service or "unknown-service"
    t = dict(template)
    if t.get("command"):
        t["command"] = t["command"].replace("{service}", svc)
    if t.get("rollback_command"):
        t["rollback_command"] = t["rollback_command"].replace("{service}", svc)
    return t


def generate_remediation_plan(
    incident: Dict[str, Any],
    rca_result: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Generate ordered list of remediation actions."""
    category = rca_result.get("root_cause_category", "default")
    service  = incident.get("service", "unknown-service")
    templates = ACTION_TEMPLATES.get(category, ACTION_TEMPLATES["default"])

    actions = []
    for t in templates:
        filled = _fill_template(t, service)
        filled["confidence"]  = round(rca_result.get("confidence", 0.8) * random.uniform(0.9, 1.0), 3)
        filled["incident_id"] = incident.get("id", "")
        filled["status"]      = "pending"
        actions.append(filled)
    return actions


def simulate_action(action: Dict[str, Any], incident: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sandbox simulation — predict before/after metrics.
    Returns simulation_result dict with success_probability, predicted_recovery_time, before/after.
    """
    sev = incident.get("severity", "Medium")
    base_prob = {"Critical": 0.85, "High": 0.88, "Medium": 0.92, "Low": 0.95}.get(sev, 0.88)
    risk_adj  = {"low": 0.04, "medium": -0.02, "high": -0.08}.get(action.get("risk_level","low"), 0.0)
    success_probability = round(min(0.99, max(0.55, base_prob + risk_adj + random.uniform(-0.03, 0.03))), 3)

    before = {
        "error_rate":   f"{random.uniform(15, 40):.1f}%",
        "latency_p99":  f"{random.randint(800, 5000)} ms",
        "availability": f"{random.uniform(60, 85):.1f}%",
        "throughput":   f"{random.randint(100, 500)} rps",
    }
    after = {
        "error_rate":   f"{random.uniform(0.1, 2.0):.1f}%",
        "latency_p99":  f"{random.randint(80, 300)} ms",
        "availability": f"{random.uniform(99.0, 99.9):.1f}%",
        "throughput":   f"{random.randint(1500, 3000)} rps",
    }
    recovery_minutes = random.randint(4, 20)

    return {
        "success_probability": success_probability,
        "predicted_recovery_time": f"{recovery_minutes} min",
        "before": before,
        "after":  after,
        "simulated_at": datetime.utcnow().isoformat(),
        "sandbox": True,
    }


def policy_gate(action: Dict[str, Any], rca_result: Dict[str, Any]) -> Dict[str, Any]:
    """
    Policy / blast-radius gate.
    Returns {approved: bool, reason: str, requires_human: bool}
    """
    risk    = action.get("risk_level", "low")
    conf    = action.get("confidence", 0.8)
    risk_sc = rca_result.get("risk_score", 50.0)

    if risk == "high" or risk_sc >= 90:
        return {"approved": False, "reason": "High-risk action requires human approval.", "requires_human": True}
    if conf < 0.60:
        return {"approved": False, "reason": f"Confidence too low ({conf:.0%}). Human review required.", "requires_human": True}
    if risk == "medium" and conf < 0.75:
        return {"approved": False, "reason": "Medium-risk with moderate confidence — pending supervisor approval.", "requires_human": True}
    return {"approved": True, "reason": "Action within policy bounds. Auto-approved.", "requires_human": False}
