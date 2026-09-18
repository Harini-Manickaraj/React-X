"""
Stages 7-9 — Execution → Verification → Auto-Rollback
Simulates execution and checks whether the incident is truly resolved.
If not resolved, triggers rollback and re-opens incident for next cycle.
"""
from typing import Dict, Any, Optional
from datetime import datetime
import random


def execute_action(action: Dict[str, Any]) -> Dict[str, Any]:
    """
    Simulate execution of a remediation command.
    In production: SSH/kubectl/API call to target system.
    Returns execution_result dict.
    """
    sim    = action.get("simulation_result", {})
    prob   = sim.get("success_probability", 0.85) if sim else 0.85
    # Simulate ~95% execution success rate
    succeeded = random.random() < min(0.97, prob + 0.05)

    result = {
        "succeeded":     succeeded,
        "executed_at":   datetime.utcnow().isoformat(),
        "output":        "Command executed successfully." if succeeded else "Command timed out or returned non-zero exit.",
        "duration_ms":   random.randint(300, 3200),
        "executor":      "AI Engine",
    }
    return result


def verify_resolution(incident: Dict[str, Any], action: Dict[str, Any]) -> Dict[str, Any]:
    """
    Verification check — samples post-remediation metrics.
    Returns {resolved: bool, details: dict, score: float}
    """
    exec_result = action.get("execution_result", {})
    succeeded   = exec_result.get("succeeded", False) if exec_result else False
    sim         = action.get("simulation_result", {})
    prob        = sim.get("success_probability", 0.85) if sim else 0.85

    # If execution failed, verification also fails
    if not succeeded:
        return {
            "resolved": False,
            "score":    0.1,
            "details": {
                "metric_recovery":   "failed",
                "error_rate_check":  "failed",
                "health_check":      "failed",
                "reason": "Execution step failed — rollback required.",
            }
        }

    # Stochastic verification based on confidence
    resolved = random.random() < prob
    score    = round(random.uniform(0.70, 0.98) if resolved else random.uniform(0.10, 0.45), 3)

    return {
        "resolved": resolved,
        "score":    score,
        "details": {
            "metric_recovery":  "passed" if resolved else "failed",
            "error_rate_check": "passed" if resolved else "degraded",
            "health_check":     "passed" if resolved else "failed",
            "latency_check":    "passed" if resolved else "elevated",
            "checked_at":       datetime.utcnow().isoformat(),
        }
    }


def should_rollback(verification: Dict[str, Any], action: Dict[str, Any]) -> bool:
    """Return True if auto-rollback should be triggered."""
    if verification.get("resolved"):
        return False
    has_rollback = bool(action.get("rollback_command"))
    return has_rollback and verification.get("score", 1.0) < 0.5


def execute_rollback(action: Dict[str, Any]) -> Dict[str, Any]:
    """Simulate rollback execution."""
    return {
        "rolled_back":   True,
        "rolled_back_at": datetime.utcnow().isoformat(),
        "command":       action.get("rollback_command", "N/A"),
        "output":        "Rollback executed successfully.",
    }


def calculate_mttr(created_at_iso: str, resolved_at_iso: Optional[str] = None) -> str:
    """Human-readable MTTR string."""
    try:
        from dateutil import parser as dparser
        t0 = dparser.parse(created_at_iso)
        t1 = dparser.parse(resolved_at_iso) if resolved_at_iso else datetime.utcnow()
        mins = int((t1 - t0).total_seconds() / 60)
        if mins < 60:
            return f"{mins} min"
        return f"{mins // 60}h {mins % 60}m"
    except Exception:
        return "N/A"
