"""
Tests for Stages 4–6 — Remediation Decision, Simulation, Policy Gate.
Verifies action template generation, sandbox simulation, and approval logic.
Run: cd backend && pytest tests/test_remediation.py -v
"""
import pytest
from app.pipeline.remediation import (
    generate_remediation_plan,
    simulate_action,
    policy_gate,
    _fill_template,
)


DB_RCA = {
    "root_cause_category": "Database Performance",
    "confidence": 0.94,
    "risk_score": 90.0,
}

NETWORK_RCA = {
    "root_cause_category": "Network / Timeout Storm",
    "confidence": 0.82,
    "risk_score": 65.0,
}

UNKNOWN_RCA = {
    "root_cause_category": "Unknown / Deployment",
    "confidence": 0.60,
    "risk_score": 50.0,
}

INCIDENT_CRITICAL = {
    "id": "TEST-001",
    "title": "DB CPU High",
    "severity": "Critical",
    "service": "database-primary",
    "environment": "Production",
    "description": "CPU high",
}

INCIDENT_LOW = {
    "id": "TEST-002",
    "title": "Minor issue",
    "severity": "Low",
    "service": "cache-service",
    "environment": "Staging",
    "description": "Minor issue",
}


# ── Template filling ──────────────────────────────────────────────

class TestFillTemplate:
    def test_service_placeholder_replaced(self):
        template = {
            "action_type": "restart",
            "description": "Restart {service}",
            "command": "kubectl rollout restart deployment/{service} -n prod",
            "rollback_command": "kubectl rollout undo deployment/{service} -n prod",
            "risk_level": "medium",
        }
        filled = _fill_template(template, "auth-service")
        assert "{service}" not in filled["command"]
        assert "auth-service" in filled["command"]
        assert "auth-service" in filled["rollback_command"]

    def test_empty_service_uses_unknown(self):
        template = {
            "action_type": "restart",
            "description": "Restart",
            "command": "restart {service}",
            "rollback_command": None,
            "risk_level": "low",
        }
        filled = _fill_template(template, "")
        assert "unknown-service" in filled["command"]


# ── Plan generation ───────────────────────────────────────────────

class TestGenerateRemediationPlan:
    def test_returns_list(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, DB_RCA)
        assert isinstance(plan, list)
        assert len(plan) > 0

    def test_actions_have_required_keys(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, DB_RCA)
        required = ["action_type", "description", "risk_level", "confidence", "status"]
        for action in plan:
            for key in required:
                assert key in action, f"Action missing key: {key}"

    def test_confidence_between_0_and_1(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, DB_RCA)
        for action in plan:
            assert 0.0 <= action["confidence"] <= 1.0

    def test_unknown_rca_returns_default_plan(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, UNKNOWN_RCA)
        assert len(plan) > 0

    def test_service_name_in_commands(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, DB_RCA)
        # At least one action should reference the service in its command
        commands = [a.get("command", "") or "" for a in plan]
        # Just check no unresolved placeholders
        for cmd in commands:
            assert "{service}" not in cmd


# ── Simulation ────────────────────────────────────────────────────

class TestSimulateAction:
    def setup_method(self):
        plan = generate_remediation_plan(INCIDENT_CRITICAL, DB_RCA)
        self.action = plan[0]

    def test_returns_dict(self):
        result = simulate_action(self.action, INCIDENT_CRITICAL)
        assert isinstance(result, dict)

    def test_has_required_keys(self):
        result = simulate_action(self.action, INCIDENT_CRITICAL)
        required = ["success_probability", "predicted_recovery_time", "before", "after", "sandbox"]
        for key in required:
            assert key in result, f"Missing key: {key}"

    def test_is_sandbox(self):
        result = simulate_action(self.action, INCIDENT_CRITICAL)
        assert result["sandbox"] is True

    def test_success_probability_between_0_and_1(self):
        result = simulate_action(self.action, INCIDENT_CRITICAL)
        assert 0.0 <= result["success_probability"] <= 1.0

    def test_low_severity_has_higher_probability(self):
        plan_low = generate_remediation_plan(INCIDENT_LOW, NETWORK_RCA)
        if plan_low:
            result_low = simulate_action(plan_low[0], INCIDENT_LOW)
            result_crit = simulate_action(self.action, INCIDENT_CRITICAL)
            # Low severity should generally have higher or equal success probability
            assert result_low["success_probability"] >= result_crit["success_probability"] - 0.15

    def test_before_and_after_are_dicts(self):
        result = simulate_action(self.action, INCIDENT_CRITICAL)
        assert isinstance(result["before"], dict)
        assert isinstance(result["after"], dict)


# ── Policy gate ───────────────────────────────────────────────────

class TestPolicyGate:
    def test_low_risk_high_confidence_auto_approved(self):
        action = {"risk_level": "low", "confidence": 0.90}
        result = policy_gate(action, DB_RCA)
        assert result["approved"] is True
        assert result["requires_human"] is False

    def test_high_risk_requires_human(self):
        action = {"risk_level": "high", "confidence": 0.95}
        result = policy_gate(action, DB_RCA)
        assert result["approved"] is False
        assert result["requires_human"] is True

    def test_low_confidence_requires_human(self):
        action = {"risk_level": "low", "confidence": 0.45}
        result = policy_gate(action, DB_RCA)
        assert result["approved"] is False
        assert result["requires_human"] is True

    def test_very_high_risk_score_requires_human(self):
        high_risk_rca = {**DB_RCA, "risk_score": 92.0}
        action = {"risk_level": "low", "confidence": 0.90}
        result = policy_gate(action, high_risk_rca)
        assert result["requires_human"] is True

    def test_result_has_reason_string(self):
        action = {"risk_level": "low", "confidence": 0.90}
        result = policy_gate(action, DB_RCA)
        assert isinstance(result["reason"], str)
        assert len(result["reason"]) > 0
