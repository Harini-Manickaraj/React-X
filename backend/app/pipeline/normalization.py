"""
Stage 1 — Alert Normalization
Cleans, enriches, and standardises incoming alerts into a canonical format.
"""
from typing import Dict, Any
import re
from datetime import datetime


SEVERITY_KEYWORDS = {
    "Critical": ["critical", "fatal", "down", "outage", "total failure", "p0", "severity 1"],
    "High":     ["error", "exception", "fail", "timeout", "5xx", "503", "crash", "oom", "spike"],
    "Medium":   ["warn", "slow", "degraded", "high", "elevated", "429", "retry", "lag"],
    "Low":      ["info", "notice", "minor", "low", "cold start"],
}

TYPE_KEYWORDS = {
    "Performance": ["cpu", "memory", "latency", "slow", "queue", "throughput", "lag"],
    "Availability": ["down", "unavailable", "503", "crash", "loop", "pod", "restart", "outage"],
    "Security":     ["brute", "attack", "unauthorised", "unauthorized", "intrusion", "credential"],
    "Data":         ["replica", "replication", "stale", "corrupt", "schema", "migration", "data"],
    "Network":      ["timeout", "connection", "dns", "network", "tcp", "http", "api", "gateway"],
}


def detect_severity(text: str) -> str:
    lower = text.lower()
    for sev, kws in SEVERITY_KEYWORDS.items():
        if any(kw in lower for kw in kws):
            return sev
    return "Medium"


def detect_type(text: str, service: str = "") -> str:
    combined = (text + " " + service).lower()
    for t, kws in TYPE_KEYWORDS.items():
        if any(kw in combined for kw in kws):
            return t
    return "Other"


def extract_metric_value(message: str) -> Dict[str, Any]:
    """Pull numeric metric values from message text."""
    metrics = {}
    patterns = [
        (r"(\d+\.?\d*)\s*%",       "percentage"),
        (r"(\d+\.?\d*)\s*ms",      "latency_ms"),
        (r"(\d+\.?\d*)\s*s\b",     "duration_s"),
        (r"p99\s*[=:]\s*(\d+)",    "p99_ms"),
        (r"p95\s*[=:]\s*(\d+)",    "p95_ms"),
        (r"(\d+)\s*/\s*(\d+)",     "ratio"),
    ]
    for pattern, name in patterns:
        m = re.search(pattern, message, re.IGNORECASE)
        if m:
            metrics[name] = m.group(1)
    return metrics


def normalise_alert(raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Input: raw alert dict with fields source, severity, service, message, metric, timestamp
    Output: enriched normalised alert dict
    """
    message = raw.get("message", "")
    service = raw.get("service", "unknown")
    source  = raw.get("source", "unknown")

    detected_severity = raw.get("severity") or detect_severity(message)
    detected_type     = detect_type(message, service)
    extracted_metrics = extract_metric_value(message)

    normalised = {
        "source":     source,
        "severity":   detected_severity,
        "service":    service,
        "type":       detected_type,
        "message":    message.strip(),
        "metric":     raw.get("metric", ""),
        "metrics":    extracted_metrics,
        "environment":raw.get("environment", "Production"),
        "timestamp":  raw.get("timestamp", datetime.utcnow().isoformat()),
        "fingerprint":_fingerprint(message, service),
        "tags":       _extract_tags(message, service),
        "normalised_at": datetime.utcnow().isoformat(),
    }
    return normalised


def _fingerprint(message: str, service: str) -> str:
    """Simple fingerprint for deduplication."""
    import hashlib
    key = re.sub(r'\d+', 'N', message.lower())[:80] + service.lower()
    return hashlib.md5(key.encode()).hexdigest()[:12]


def _extract_tags(message: str, service: str) -> list:
    tags = set()
    if service:
        tags.add(service)
    keywords = ["cpu", "memory", "timeout", "latency", "error", "crash",
                "replica", "deploy", "kafka", "redis", "db", "api"]
    lower = message.lower()
    for kw in keywords:
        if kw in lower:
            tags.add(kw)
    return list(tags)
