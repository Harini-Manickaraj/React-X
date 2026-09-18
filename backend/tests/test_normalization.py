"""
Tests for Stage 1 — Alert Normalization.
Verifies severity detection, type detection, metric extraction, and fingerprinting.
Run: cd backend && pytest tests/test_normalization.py -v
"""
import pytest
from app.pipeline.normalization import (
    detect_severity,
    detect_type,
    extract_metric_value,
    normalise_alert,
    _fingerprint,
    _extract_tags,
)


# ── Severity detection ────────────────────────────────────────────

class TestDetectSeverity:
    def test_critical_keyword(self):
        assert detect_severity("critical failure on database") == "Critical"

    def test_fatal_keyword(self):
        assert detect_severity("fatal error in payment service") == "Critical"

    def test_down_keyword(self):
        assert detect_severity("service is down") == "Critical"

    def test_error_keyword(self):
        assert detect_severity("HTTP 500 error rate spike") == "High"

    def test_timeout_keyword(self):
        assert detect_severity("request timeout after 30s") == "Medium"

    def test_warn_keyword(self):
        assert detect_severity("high CPU warning on replica") == "Medium"

    def test_unknown_defaults_to_medium(self):
        assert detect_severity("something happened") == "Medium"

    def test_case_insensitive(self):
        assert detect_severity("CRITICAL: database down") == "Critical"


# ── Type detection ────────────────────────────────────────────────

class TestDetectType:
    def test_cpu_is_performance(self):
        assert detect_type("CPU at 95%") == "Performance"

    def test_memory_is_performance(self):
        assert detect_type("memory usage high") == "Performance"

    def test_503_is_availability(self):
        assert detect_type("service returning 503") == "Availability"

    def test_crash_is_availability(self):
        assert detect_type("pod crash loop detected") == "Availability"

    def test_timeout_is_network(self):
        assert detect_type("API timeout on gateway") == "Network"

    def test_replication_is_data(self):
        assert detect_type("replication lag on replica") == "Data"

    def test_brute_force_is_security(self):
        assert detect_type("brute force attack detected") == "Security"

    def test_unknown_defaults_to_other(self):
        assert detect_type("some vague message") == "Other"


# ── Metric extraction ─────────────────────────────────────────────

class TestExtractMetricValue:
    def test_extracts_percentage(self):
        result = extract_metric_value("CPU at 95%")
        assert "percentage" in result
        assert result["percentage"] == "95"

    def test_extracts_latency_ms(self):
        result = extract_metric_value("p99 latency: 4800ms")
        assert "latency_ms" in result

    def test_extracts_p99(self):
        result = extract_metric_value("p99=4800")
        assert "p99_ms" in result
        assert result["p99_ms"] == "4800"

    def test_empty_string_returns_empty_dict(self):
        result = extract_metric_value("")
        assert result == {}

    def test_no_metrics_returns_empty_dict(self):
        result = extract_metric_value("service went down")
        assert isinstance(result, dict)


# ── Fingerprint ───────────────────────────────────────────────────

class TestFingerprint:
    def test_returns_string(self):
        fp = _fingerprint("CPU high on db", "database-primary")
        assert isinstance(fp, str)

    def test_length_is_12(self):
        fp = _fingerprint("CPU high on db", "database-primary")
        assert len(fp) == 12

    def test_same_message_same_fingerprint(self):
        fp1 = _fingerprint("CPU high on db 95", "database-primary")
        fp2 = _fingerprint("CPU high on db 99", "database-primary")
        # Numbers are stripped to 'N' before hashing — should match
        assert fp1 == fp2

    def test_different_service_different_fingerprint(self):
        fp1 = _fingerprint("CPU high", "database-primary")
        fp2 = _fingerprint("CPU high", "auth-service")
        assert fp1 != fp2


# ── Tag extraction ────────────────────────────────────────────────

class TestExtractTags:
    def test_service_always_included(self):
        tags = _extract_tags("some alert", "payment-api")
        assert "payment-api" in tags

    def test_cpu_keyword_extracted(self):
        tags = _extract_tags("CPU spike detected", "db")
        assert "cpu" in tags

    def test_timeout_keyword_extracted(self):
        tags = _extract_tags("request timeout error", "api")
        assert "timeout" in tags

    def test_returns_list(self):
        tags = _extract_tags("message", "service")
        assert isinstance(tags, list)


# ── Full normalise_alert ──────────────────────────────────────────

class TestNormaliseAlert:
    def setup_method(self):
        self.raw = {
            "source":  "prometheus",
            "message": "Database CPU at 95%. Slow query on payments table. connection pool exhausted.",
            "service": "database-primary",
            "severity": None,
            "environment": "Production",
        }

    def test_returns_dict(self):
        result = normalise_alert(self.raw)
        assert isinstance(result, dict)

    def test_has_required_keys(self):
        result = normalise_alert(self.raw)
        required = ["source", "severity", "service", "type", "message",
                    "metrics", "fingerprint", "tags", "normalised_at"]
        for key in required:
            assert key in result, f"Missing key: {key}"

    def test_severity_auto_detected(self):
        result = normalise_alert(self.raw)
        # "cpu", "exhausted" → should not be Low
        assert result["severity"] != "Low"

    def test_type_auto_detected(self):
        result = normalise_alert(self.raw)
        # "cpu" + "database" → Performance
        assert result["type"] == "Performance"

    def test_explicit_severity_preserved(self):
        raw = {**self.raw, "severity": "Critical"}
        result = normalise_alert(raw)
        assert result["severity"] == "Critical"

    def test_fingerprint_is_12_chars(self):
        result = normalise_alert(self.raw)
        assert len(result["fingerprint"]) == 12
