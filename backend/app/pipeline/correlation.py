"""
Stage 2 — Ensemble Correlation
Groups related alerts into incident clusters using:
 - Temporal proximity
 - Service topology (NetworkX)
 - Semantic similarity (Sentence-BERT via lightweight cosine fallback)
"""
from typing import List, Dict, Any, Optional
import numpy as np
import networkx as nx
from datetime import datetime, timedelta
import math, re


# ── Service dependency graph ──────────────────────────────────────
SERVICE_GRAPH = nx.DiGraph()
EDGES = [
    ("cdn-edge",          "api-gateway"),
    ("api-gateway",       "auth-service"),
    ("api-gateway",       "order-service"),
    ("api-gateway",       "user-service"),
    ("auth-service",      "user-service"),
    ("auth-service",      "redis-cluster"),
    ("order-service",     "payment-service"),
    ("order-service",     "inventory-service"),
    ("order-service",     "notification-service"),
    ("payment-service",   "database-primary"),
    ("payment-service",   "fraud-service"),
    ("payment-service",   "notification-service"),
    ("user-service",      "database-primary"),
    ("user-service",      "cache-layer"),
    ("inventory-service", "database-replica"),
    ("fraud-service",     "database-replica"),
    ("fraud-service",     "ml-inference"),
    ("notification-service", "message-queue"),
    ("database-replica",  "database-primary"),
    ("cache-layer",       "redis-cluster"),
]
SERVICE_GRAPH.add_edges_from(EDGES)


def _topological_distance(svc_a: str, svc_b: str) -> float:
    """Returns 0.0 (same) to 1.0 (unrelated) based on graph distance."""
    if svc_a == svc_b:
        return 0.0
    try:
        d = nx.shortest_path_length(SERVICE_GRAPH.to_undirected(), svc_a, svc_b)
        return min(1.0, d / 5.0)
    except nx.NetworkXNoPath:
        return 1.0
    except nx.NodeNotFound:
        return 0.8


def _temporal_score(t1: str, t2: str, window_minutes: int = 10) -> float:
    """1.0 if same timestamp, 0.0 if outside window."""
    try:
        dt1 = datetime.fromisoformat(t1.replace("Z",""))
        dt2 = datetime.fromisoformat(t2.replace("Z",""))
        diff = abs((dt1 - dt2).total_seconds()) / 60
        if diff >= window_minutes:
            return 0.0
        return 1.0 - (diff / window_minutes)
    except Exception:
        return 0.5


def _keyword_similarity(msg_a: str, msg_b: str) -> float:
    """Jaccard similarity on word sets as fallback for sentence-transformers."""
    def tokenise(text):
        return set(re.sub(r'[^\w]', ' ', text.lower()).split())
    a, b = tokenise(msg_a), tokenise(msg_b)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _semantic_score(msg_a: str, msg_b: str) -> float:
    """Sentence-BERT if available, else keyword Jaccard."""
    try:
        from sentence_transformers import SentenceTransformer, util
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        embs = _model.encode([msg_a, msg_b], convert_to_tensor=True)
        return float(util.cos_sim(embs[0], embs[1]))
    except Exception:
        return _keyword_similarity(msg_a, msg_b)


def correlation_score(alert_a: Dict[str, Any], alert_b: Dict[str, Any]) -> float:
    """Ensemble correlation score [0,1] between two normalised alerts."""
    t_score = _temporal_score(
        alert_a.get("timestamp", ""),
        alert_b.get("timestamp", "")
    )
    topo_sim = 1.0 - _topological_distance(
        alert_a.get("service", ""),
        alert_b.get("service", "")
    )
    sem_score = _semantic_score(
        alert_a.get("message", ""),
        alert_b.get("message", "")
    )
    # Weighted ensemble
    score = 0.35 * t_score + 0.35 * topo_sim + 0.30 * sem_score
    return round(score, 4)


def cluster_alerts(alerts: List[Dict[str, Any]], threshold: float = 0.40) -> List[List[int]]:
    """
    Groups alert indices into clusters where any pair scores >= threshold.
    Returns list of clusters (each cluster = list of alert indices).
    """
    n = len(alerts)
    if n == 0:
        return []
    if n == 1:
        return [[0]]

    adjacency = np.zeros((n, n))
    for i in range(n):
        for j in range(i+1, n):
            s = correlation_score(alerts[i], alerts[j])
            adjacency[i][j] = s
            adjacency[j][i] = s

    # Simple union-find clustering
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    for i in range(n):
        for j in range(i+1, n):
            if adjacency[i][j] >= threshold:
                union(i, j)

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        root = find(i)
        groups.setdefault(root, []).append(i)

    return list(groups.values())


def get_blast_radius(service: str, max_depth: int = 3) -> List[Dict[str, Any]]:
    """Return services downstream of `service` with estimated impact."""
    if service not in SERVICE_GRAPH:
        return []
    result = []
    try:
        descendants = nx.descendants(SERVICE_GRAPH, service)
        for svc in descendants:
            try:
                dist = nx.shortest_path_length(SERVICE_GRAPH, service, svc)
            except Exception:
                dist = max_depth
            if dist > max_depth:
                continue
            impact_pct = max(10, 100 - (dist * 25))
            level = "critical" if dist == 1 else "high" if dist == 2 else "medium"
            result.append({"service": svc, "impact": impact_pct, "level": level})
    except Exception:
        pass
    return sorted(result, key=lambda x: -x["impact"])
