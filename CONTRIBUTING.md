# Contributing to REACT-X

Thank you for your interest in contributing.
This document describes how to set up a development environment and submit changes.

---

## Development Setup

### Frontend

No build step required. Open `index.html` in a browser or use Live Server.

For a productive workflow:
1. Install VS Code with the **Live Server** extension
2. Right-click `index.html` → Open with Live Server
3. Edit any file in `js/` or `css/` — the browser auto-reloads

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate           # Windows
# source venv/bin/activate      # macOS/Linux
pip install -r requirements-minimal.txt   # fast install
uvicorn app.main:app --reload --port 8000
```

Run tests:
```bash
cd backend
pytest -v
```

---

## Code Style

### JavaScript (frontend)
- IIFE module pattern — each page controller exposes a small public API
- No external JS frameworks or bundlers
- Variable names: `camelCase`; private functions and variables prefixed with `_`
- Constants in `UPPER_SNAKE_CASE`
- HTML escape all user-supplied values before inserting into innerHTML (`_esc()`)

### Python (backend)
- PEP 8 style
- Type hints on all function signatures
- Docstrings on all public functions
- Async all the way — no sync DB calls in route handlers
- Each pipeline stage is a pure function taking a dict and returning a dict

---

## Project Structure

| Layer | Where | Rule |
|---|---|---|
| Frontend pages | `js/*.js` | One module per page; `index.html` has the HTML shell |
| CSS | `css/styles.css` | One file; use CSS custom properties for theming |
| Backend routes | `backend/app/routers/*.py` | One file per router prefix |
| Pipeline stages | `backend/app/pipeline/*.py` | One file per stage; stage functions are pure (no DB access) |
| DB access | `backend/app/routers/*.py` and `orchestrator.py` | Stages themselves do not touch the DB |

---

## Tests

Backend tests live in `backend/tests/`. Every new backend module should have a corresponding `test_*.py` file.

```bash
# Run all tests
cd backend && pytest

# Run a specific file
pytest tests/test_pipeline_rca.py -v

# Run with coverage (requires pytest-cov)
pytest --cov=app --cov-report=term-missing
```

---

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes — do not modify existing UI/styling/routes without discussion
4. Ensure all existing tests pass: `pytest -v`
5. Add tests for new functionality
6. Update `CHANGELOG.md` under `[Unreleased]`
7. Open a pull request with a clear description of what changed and why

---

## Reporting Issues

Include:
- Exact steps to reproduce
- Expected vs actual behaviour
- Browser/OS version (for frontend issues)
- Python version + `pip list` output (for backend issues)
- Any console errors (F12 → Console)
