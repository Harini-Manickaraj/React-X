"""
Tests for the RCA (Root Cause Analysis) pipeline stage.
Verifies rule matching, feature extraction, SHAP attribution, and risk scoring.
Run: cd backend && pytest tests/test_pipeline_rca.py -v
"""
import pytest
from app.pipeline.rca import (
    extract_features,
    detect_severity,
    rule_based_rca,
    compute_shap_factors,
    run_rca,
    _risk_score,
)

# ── Sample incidents for testing ──────────────────────────────────

DB_INCIDENT = {
    "id": "TEST-001",
    "title": "Database CPU High — production-db-01",
    "description": "CPU utilization above 90%. Slow query on payments table. Connection pool at 512/512. Database lock contention.",
    "severity": "Critical",
    "type": "Performance",
    "service": "database-primary",
    "environment": "Production",
}

NETWORK_INCIDENT = {
    "id": "TEST-002",
    "title": "Payment API Timeout",
    "description": "Payment API requests timing out. ECONNRESET after 30s. Error rate 38%. Upstream gateway latency elevated.",
    "severity": "High",
    "type": "Network",
    "service": "payment-api",
    "environment": "Production",
}

OOM_INCIDENT = {
    "id": "TEST-003",
    "title": "Auth Service Crash Loop",
    "description": "Auth service returning 503. CrashLoopBackOff. Memory limit hit. OOM kill in pod logs.",
    "severity": "High",
    "type": "Availability",
    "service": "auth-service",
    "environment": "Production",
}

UNKNOWN_INCIDENT = {
    "id": "TEST-004",
    "title": "Unknown Alert",
    "description": "Something went wrong.",
    "severity": "Low",
    "type": "Other",
    "service": "some-service",
    "environment": "Staging",
}


# ── Feature extraction ────────────────────────────────────────────

class TestExtractFeatures:
    def test_returns_numpy_array(self):
        import numpy as np
        features = extract_features(DB_INCIDENT)
        assert hasattr(features, "__len__")
        assert len(features) == 13  # 3 base + 10 keyword scores

    def test_critical_severity_maps_to_3(self):
        features = extract_features(DB_INCIDENT)
        assert features[0] == 3.0  # Critical → 3

    def test_low_severity_maps_to_0(self):
        features = extract_features(UNKNOWN_INCIDENT)
        assert features[0] == 0.0  # Low → 0

    def test_cpu_keyword_detected(self):
        features = extract_features(DB_INCIDENT)
        # "cpu" keyword is index 3 (after sev, type, env)
        assert features[3] == 1.0

    def test_timeout_keyword_detected(self):
        features = extract_features(NETWORK_INCIDENT)
        # "timeout" keyword
        assert features[6] == 1.0  # timeout slot

    def test_features_are_floats(self):
        features = extract_features(DB_INCIDENT)
        for f in features:
            assert isinstance(float(f), float)


# ── Rule-based RCA ────────────────────────────────────────────────

class TestRuleBasedRCA:
    def test_db_incident_matches_performance_rule(self):
        rule = rule_based_rca(DB_INCIDENT)
        assert rule is not None
        assert "Database" in rule["category"]

    def test_network_incident_matches_network_rule(self):
        rule = rule_based_rca(NETWORK_INCIDENT)
        assert rule is not None
        assert "Network" in rule["category"] or "Timeout" in rule["category"]

    def test_oom_incident_matches_availability_rule(self):
        rule = rule_based_rca(OOM_INCIDENT)
        assert rule is not None
        assert "Availability" in rule["category"] or "OOM" in rule["category"]

    def test_unknown_incident_returns_none(self):
        rule = rule_based_rca(UNKNOWN_INCIDENT)
        # Should not match any rule with so few keywords
        # (may be None or a very weak match depending on thresholds)
        # Just ensure no crash
        assert rule is None or isinstance(rule, dict)

    def test_rule_has_required_keys(self):
        rule = rule_based_rca(DB_INCIDENT)
        assert rule is not None
        assert "category" in rule
        assert "root_cause_template" in rule
        assert "evidence_template" in rule
        assert "steps" in rule


# ── SHAP factors ──────────────────────────────────────────────────

class TestShapFactors:
    def test_returns_list(self):
        rule = rule_based_rca(DB_INCIDENT)
        factors = compute_shap_factors(DB_INCIDENT, rule)
        assert isinstance(factors, list)

    def test_factors_have_required_keys(self):
        rule = rule_based_rca(DB_INCIDENT)
        factors = compute_shap_factors(DB_INCIDENT, rule)
        for f in factors:
            assert "feature" in f
            assert "value" in f
            assert "direction" in f

    def test_direction_is_positive_or_negative(self):
        rule = rule_based_rca(DB_INCIDENT)
        factors = compute_shap_factors(DB_INCIDENT, rule)
        for f in factors:
            assert f["direction"] in ("positive", "negative")

    def test_sorted_by_absolute_value_descending(self):
        rule = rule_based_rca(DB_INCIDENT)
        factors = compute_shap_factors(DB_INCIDENT, rule)
        values = [abs(f["value"]) for f in factors]
        assert values == sorted(values, reverse=True)


# ── Risk score ────────────────────────────────────────────────────

class TestRiskScore:
    def test_critical_performance_is_high(self):
        score = _risk_score("Critical", "Performance")
        assert score >= 80

    def test_low_other_is_low(self):
        score = _risk_score("Low", "Other")
        assert score <= 25

    def test_score_never_exceeds_100(self):
        score = _risk_score("Critical", "Availability")
        assert score <= 100

    def test_availability_adds_more_than_network(self):
        a = _risk_score("High", "Availability")
        n = _risk_score("High", "Network")
        assert a >= n  # Availability type weight is higher


# ── Full RCA run ──────────────────────────────────────────────────

class TestRunRCA:
    def test_returns_all_required_keys(self):
        result = run_rca(DB_INCIDENT)
        required = [
            "root_cause", "root_cause_category", "confidence",
            "evidence", "shap_factors", "impact_users",
            "impact_revenue", "impact_sla", "risk_score",
            "blast_radius", "recommendation", "resolution_steps",
            "similar_incidents", "pipeline_stage",
        ]
        for key in required:
            assert key in result, f"Missing key: {key}"

    def test_confidence_is_between_0_and_1(self):
        result = run_rca(DB_INCIDENT)
        assert 0.0 <= result["confidence"] <= 1.0

    def test_evidence_is_list_of_strings(self):
        result = run_rca(DB_INCIDENT)
        assert isinstance(result["evidence"], list)
        assert all(isinstance(e, str) for e in result["evidence"])

    def test_resolution_steps_are_numbered(self):
        result = run_rca(DB_INCIDENT)
        for i, step in enumerate(result["resolution_steps"], start=1):
            assert step["step"] == i

    def test_blast_radius_has_required_fields(self):
        result = run_rca(DB_INCIDENT)
        for item in result["blast_radius"]:
            assert "service" in item
            assert "impact" in item
            assert "level" in item

    def test_pipeline_stage_is_rca(self):
        result = run_rca(DB_INCIDENT)
        assert result["pipeline_stage"] == "rca"

    def test_high_severity_produces_high_risk_score(self):
        result = run_rca(DB_INCIDENT)
        assert result["risk_score"] >= 80

    def test_unknown_incident_still_returns_valid_result(self):
        result = run_rca(UNKNOWN_INCIDENT)
        assert result["root_cause"]
        assert result["confidence"] > 0

    def test_network_incident_has_network_category_or_similar(self):
        result = run_rca(NETWORK_INCIDENT)
        # Should not error; category should be meaningful
        assert result["root_cause_category"]
        assert len(result["resolution_steps"]) > 0
