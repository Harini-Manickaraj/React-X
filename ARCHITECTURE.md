# REACT-X — Architecture & Design Decisions

This document describes the technical architecture of REACT-X, the design decisions
made at each layer, and how the components fit together.

---

## System Overview

```
┌───────────────────────────────────────────────────────────────┐
│                        Browser                                │
│                                                               │
│   index.html  ←  css/styles.css  ←  js/*.js                  │
│                                                               │
│   • No build step (ships as static files)                     │
│   • Works offline via in-memory Store                         │
│   • Connects to backend via REST + WebSocket when available   │
└───────────────────────────┬───────────────────────────────────┘
                            │  HTTP/REST  (port 8000)
                            │  WebSocket  (ws://localhost:8000/ws)
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                           │
│                                                               │
│   app/main.py          — entry point, lifespan, CORS          │
│   app/routers/         — auth, incidents, pipeline, audit     │
│   app/pipeline/        — 9-stage AI pipeline                  │
│   app/models.py        — SQLAlchemy ORM tables                │
│   app/schemas.py       — Pydantic v2 request/response models  │
│   app/auth.py          — bcrypt + JWT (HS256)                 │
│   app/ws_manager.py    — WebSocket broadcast                  │
└───────────────────────────┬───────────────────────────────────┘
                            │  SQLAlchemy async (aiosqlite)
                            ▼
┌───────────────────────────────────────────────────────────────┐
│              SQLite Database  (reactx.db)                     │
│                                                               │
│   users · incidents · alerts · rca_results                    │
│   pipeline_actions · verification_checks · audit_logs         │
└───────────────────────────────────────────────────────────────┘
```

---

## Frontend Architecture

### Design choice: Vanilla JS, no framework

REACT-X intentionally uses no frontend framework (no React, Vue, Angular).

**Why:**
- Zero build toolchain — evaluators open `index.html` directly; no `npm install` required
- Demonstrates deep understanding of the DOM and event model without framework abstractions
- Reduces the attack surface for compatibility issues during demos

### Module pattern

Each page is controlled by an IIFE module that exposes a small, explicit public API:

```javascript
const Dashboard = (() => {
  // private state
  let _charts = {};

  // private functions
  function _renderKPIs() { ... }

  // public API
  return { init, refresh, openHighRiskModal, openKpiModal, downloadCsvTemplate };
})();
```

This prevents global namespace pollution while allowing cross-module calls (`Dashboard.refresh()`, `Investigation.open(id)`) without a bundler.

### Data flow

```
User action
    ↓
js/app.js  (routing, auth, live signals)
    ↓
js/api.js  (if backend is online)  OR  js/mock-data.js  (if offline)
    ↓
Page module  (dashboard.js / incidents.js / investigation.js / history.js)
    ↓
DOM update
```

### Offline-first resilience

`api.js` checks backend availability with a 2-second timeout on load.
If offline → all operations route through `Store` (in-memory).
If online → REST calls are made; `Store` is bypassed for mutating operations.
WebSocket events from the backend refresh the UI in real time.

---

## Backend Architecture

### Framework: FastAPI 0.111 with asyncio

**Why FastAPI:**
- Native async/await support for non-blocking DB operations and concurrent WebSocket connections
- Automatic OpenAPI/Swagger generation from Pydantic schemas (visible at `/docs`)
- Lifespan context manager for clean startup/shutdown (database init, background tasks)

### Database: SQLite with SQLAlchemy 2 async

**Why SQLite:**
- Zero configuration — evaluators run `uvicorn` and the DB appears automatically
- `aiosqlite` driver provides genuine async I/O without blocking the event loop
- Easy to reset (`rm reactx.db`) for clean demo runs

**Schema design principles:**
- All primary keys are UUID strings (`str(uuid.uuid4())`) — portable, no auto-increment races
- `updated_at` uses SQLAlchemy `onupdate=func.now()` — always reflects last change
- JSON columns (`evidence`, `shap_factors`, `blast_radius`, `resolution_steps`) store structured AI output without schema migrations
- Relationships use `cascade="all, delete-orphan"` — deleting an incident cleans up all related rows

### AI Pipeline: 9 stages

See [README.md §9](README.md#9-ai-pipeline--how-it-works) for the stage-by-stage diagram.

**Stage design principles:**

| Stage | Module | Key design decision |
|---|---|---|
| 1 — Normalization | `pipeline/normalization.py` | Keyword + regex — no ML required, deterministic, fast |
| 2 — Correlation | `pipeline/correlation.py` | Ensemble of temporal + topological (NetworkX) + semantic scores; threshold=0.40 |
| 3 — RCA | `pipeline/rca.py` | Rule engine primary; XGBoost + SHAP optional via `try/except` |
| 4 — Impact | `pipeline/rca.py` | NetworkX graph traversal for blast radius |
| 5 — Remediation | `pipeline/remediation.py` | Template-based per RCA category; service name filled at runtime |
| 6 — Simulation | `pipeline/remediation.py` | Sandbox: predicts before/after metrics without real execution |
| 7 — Policy Gate | `pipeline/remediation.py` | Risk level × confidence threshold; high-risk requires human approval |
| 8 — Execution | `pipeline/verification.py` | Simulated command dispatch; production would be SSH/kubectl/API |
| 9 — Verification | `pipeline/verification.py` | Metric recovery check; auto-rollback if verification fails |

**Graceful degradation:**
The pipeline always completes, even if heavy ML packages (sentence-transformers, XGBoost, SHAP) are not installed. Every ML call is wrapped in `try/except` with a keyword-based fallback.

### Authentication

- Passwords hashed with `bcrypt` (via `passlib`)
- JWT tokens signed with HS256 (`python-jose`)
- Demo mode: any email + password ≥ 6 chars creates an account
- Token stored in `localStorage` on the frontend; sent as `Authorization: Bearer <token>`

### WebSocket

- `ws_manager.py` maintains a list of active WebSocket connections
- `broadcast(event, data)` delivers JSON messages to all connected clients
- Events: `live:new`, `incident:created`, `incident:updated`, `pipeline:completed`, `action:completed`
- Frontend registers per-event listeners via `API.onWsEvent(event, fn)`
- Reconnects automatically if the connection drops (5-second retry in `api.js`)

### CORS

Currently `allow_origins=["*"]` — appropriate for local development and demo use.
Production deployment should restrict to the actual frontend origin.

---

## Data Model

```
users
  id (PK) · name · email (unique) · hashed_password · is_active

incidents
  id (PK) · title · description · severity · status · type
  service · environment · created_by · image_data_url
  resolution · mttr · resolved_at · created_at · updated_at

alerts
  id (PK) · incident_id (FK) · source · severity · service
  message · metric · raw_payload · normalised · embedding

rca_results
  id (PK) · incident_id (FK, unique) · root_cause · root_cause_category
  confidence · evidence (JSON) · shap_factors (JSON) · impact_users
  impact_revenue · impact_sla · risk_score · blast_radius (JSON)
  recommendation · resolution_steps (JSON) · similar_incidents (JSON)

pipeline_actions
  id (PK) · incident_id (FK) · action_type · description · command
  rollback_command · status · risk_level · confidence
  simulation_result (JSON) · execution_result (JSON) · executed_by
  started_at · completed_at

verification_checks
  id (PK) · incident_id (FK) · action_id (FK) · check_type · result · details (JSON)

audit_logs
  id (PK) · incident_id (FK) · action · detail · actor · log_type · tags (JSON)
```

---

## Key Design Decisions

### 1. Single HTML file frontend

`index.html` contains the entire app shell: home, login, signup, and the 3-page dashboard.
All pages are `<section class="page">` elements hidden with CSS; the active one is shown via `display:block`.
This means the frontend is a single deployable file with no routing complexity.

### 2. Backend-optional architecture

The frontend was built to work entirely without the backend. The `api.js` module adds backend integration as an enhancement layer, not a requirement. This ensures the frontend is always demonstrable regardless of backend setup issues.

### 3. Pinned dependency versions

All packages in `requirements.txt` have exact version pins (e.g., `fastapi==0.111.0`).
This ensures reproducible installs regardless of when the project is evaluated.

### 4. AI pipeline transparency

Every AI decision returns:
- `result` — the primary output (root cause, action plan)
- `confidence` — a float 0–1 representing certainty
- `evidence` — list of supporting signals
- `shap_factors` — feature attributions explaining the classification
- `similar_incidents` — past incidents retrieved by similarity (RAG pattern)

This aligns with REACT-X's commitment to **explainable AI** — the system never makes a decision without showing its reasoning.

### 5. Idempotent seeding

`seed.py` checks `COUNT(incidents) >= 5` before seeding. Safe to restart the server multiple times without duplicate data.

---

## Security Considerations

| Concern | Current state | Production recommendation |
|---|---|---|
| CORS | `allow_origins=["*"]` | Restrict to actual frontend origin |
| JWT secret | `reactx-dev-secret` default | Generate a 256-bit random secret |
| Password storage | bcrypt with cost factor 12 | ✓ Already appropriate |
| SQL injection | SQLAlchemy ORM, parameterised | ✓ Already safe |
| Sensitive files | `.env` and `*.db` in `.gitignore` | ✓ Fixed (was malformed) |
| Rate limiting | None | Add `slowapi` or reverse-proxy limits |

---

## Performance Characteristics

| Operation | Typical latency (dev) |
|---|---|
| `GET /api/incidents` (SQLite) | < 10 ms |
| `POST /pipeline/run` (full pipeline) | 50–200 ms (no heavy ML) |
| `POST /pipeline/run` (with Sentence-BERT) | 1–3 s (model load on first call) |
| WebSocket broadcast | < 1 ms per connected client |
| Health check | < 1 ms |
