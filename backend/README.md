# REACT-X Backend — FastAPI AI Pipeline

Full-stack backend for the REACT-X Autonomous Incident Resolution Engine.

## Stack
- **FastAPI** — async REST + WebSocket API
- **SQLAlchemy + SQLite** (or PostgreSQL) — database
- **XGBoost / sklearn** — ML classification
- **Sentence-BERT** — semantic similarity
- **NetworkX** — service topology / blast radius
- **SHAP** — explainable AI factors
- **APScheduler** — background pipeline tasks
- **FAISS / ChromaDB** — RAG vector store

## Quick Start

### 1. Install Python 3.11+

### 2. Create virtual environment
```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```

### 4. Start the server
```bash
uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`.
Interactive docs: `http://localhost:8000/docs`

### 5. Open the frontend
Open `index.html` in a browser (or serve with Live Server on port 5500).
The frontend auto-detects the backend and connects — if unreachable, it falls back to in-memory mock data seamlessly.

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in (returns JWT) |
| GET  | `/api/auth/me` | Current user |

### Incidents
| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/incidents` | List all incidents |
| POST | `/api/incidents` | Create incident |
| GET  | `/api/incidents/{id}` | Get single incident |
| PATCH| `/api/incidents/{id}` | Update status/resolution |
| GET  | `/api/incidents/{id}/rca` | Get RCA result |

### AI Pipeline
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/pipeline/run` | Run full AI pipeline |
| POST | `/api/pipeline/simulate` | Re-simulate an action |
| POST | `/api/pipeline/approve` | Approve + execute action |
| GET  | `/api/pipeline/actions/{id}` | Get actions for incident |

### Audit & Stats
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | Audit log |
| GET | `/api/audit/stats` | Dashboard stats |

### WebSocket
```
ws://localhost:8000/ws
```
Events emitted: `live:new`, `incident:created`, `incident:updated`, `pipeline:completed`, `action:completed`

## Pipeline Stages

```
Alert Input
    ↓
Normalization (severity detection, type classification, fingerprinting)
    ↓
Correlation (temporal + topological + semantic ensemble)
    ↓
RCA (rule engine + XGBoost + SHAP explanations)
    ↓
Impact Scoring (blast radius via NetworkX, business impact)
    ↓
Remediation Decision (action template selection + confidence)
    ↓
Simulation (predicted before/after metrics, success probability)
    ↓
Policy/Blast-Radius Gate (risk level + confidence threshold check)
    ↓
Execution (command dispatch to infrastructure)
    ↓
Verification (metric recovery check)
    ↓
Auto-Rollback (if verification fails and rollback command exists)
    ↓
Audit & Learning (full audit trail, similar incident indexing)
```

## Demo Credentials
- `admin@company.com` / `admin123`
- `jane@company.com` / `pass123`
- Or sign up with any email + password (min 6 chars)

## Sample Data
The server auto-seeds 13 realistic incidents (7 open, 6 resolved) with full RCA results, remediation plans, and audit logs on first start.
