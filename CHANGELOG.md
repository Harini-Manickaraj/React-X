# Changelog

All notable changes to REACT-X are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] — 2026-09-18  Full-Stack Release

### Added — Backend
- FastAPI backend with async SQLAlchemy and SQLite
- Complete 9-stage AI pipeline: Normalization → Correlation → RCA → Impact Scoring → Remediation → Simulation → Policy Gate → Execution → Verification + Auto-Rollback
- JWT authentication (bcrypt + python-jose)
- WebSocket endpoint (`/ws`) for real-time event broadcasting
- 5 REST API routers: `/api/auth`, `/api/incidents`, `/api/pipeline`, `/api/audit`
- Background live-signal loop — auto-generates incidents every 45 seconds
- Auto-seeding on first start: 13 realistic incidents with full RCA + remediation plans
- SQLAlchemy ORM models: `User`, `Incident`, `Alert`, `RCAResult`, `PipelineAction`, `VerificationCheck`, `AuditLog`
- Pydantic v2 schemas for all request/response validation
- `start.bat` one-click Windows launcher with venv setup
- `requirements.txt` (full ML stack) and `requirements-minimal.txt` (lightweight)

### Added — Frontend integration
- `js/api.js` — backend integration layer with graceful offline fallback
- Auto-detection of backend on page load (2-second timeout health check)
- WebSocket event handling: `live:new`, `incident:created`, `incident:updated`, `pipeline:completed`, `action:completed`
- Backend-backed login that merges with local session data

### Added — Tests
- `backend/tests/test_normalization.py` — 20 unit tests for Stage 1
- `backend/tests/test_pipeline_rca.py` — 22 unit tests for Stage 3 RCA
- `backend/tests/test_remediation.py` — 18 unit tests for Stages 4–6
- `backend/tests/test_api_incidents.py` — 14 integration tests for the incidents API
- `backend/pytest.ini` — pytest configuration with asyncio mode
- `backend/tests/conftest.py` — shared fixtures and event loop setup

### Added — Documentation
- `README.md` — complete 14-section guide with API reference, pipeline diagram, quickstart
- `ARCHITECTURE.md` — technical design decisions, data model, security notes
- `CHANGELOG.md` — this file
- `CONTRIBUTING.md` — contribution guidelines

### Fixed
- `.gitignore` was malformed (contained PowerShell heredoc command instead of patterns)
  — replaced with correct gitignore patterns; `.env` and `*.db` now properly excluded

---

## [1.5.0] — 2026-09-15  Dashboard Improvements

### Added
- CSV dataset upload on dashboard — bulk import incidents from spreadsheet
- Template CSV download for guided import
- Import result panel showing created/skipped/corrected counts
- KPI card drill-down — clicking Open/Critical/Investigating/Resolved shows filtered incident list
- `modal-kpi` modal with per-incident Investigate buttons
- `modal-high-risk` modal listing all Critical/High unresolved incidents

### Changed
- Volume chart changed from bar to line chart for better trend visibility
- Type chart changed from bar to doughnut for better category distribution view
- Dashboard KPI cards now show emoji icons and larger value numbers
- Critical/High incidents highlighted with red left border in recent list

---

## [1.4.0] — 2026-09-12  Live Toggle + Image Upload

### Added
- Live alerts toggle button in top navigation bar
- Clicking toggle pauses/resumes background signal generation and WebSocket events
- Image attachment in New Incident form — drag-and-drop or file picker
- Image preview with filename, size, and remove button
- Attached image displayed in Investigation modal with click-to-expand behaviour
- `imageDataUrl` field stored with incident in `Store.createIncident`

---

## [1.3.0] — 2026-09-10  Export + Mark Complete

### Added
- Export dropdown on Incidents page — CSV, JSON, plain text formats
- Exported files include filter context (search term, severity, status) as metadata
- "Mark Complete" inline flow — button expands resolution textarea directly on the incident row
- Resolution note is required before confirming; empty note shows validation error
- MTTR calculated and displayed after resolution
- Resolved incidents shown with green tick and resolution preview in the list
- Incident list now shows resolved incidents below open ones (sorted Open → Investigating → Resolved)

### Changed
- `_filteredIncidents()` now returns all incidents (not just open), allowing resolved ones to be visible on the Incidents page

---

## [1.2.0] — 2026-09-08  OCR + Auth Improvements

### Added
- OCR screenshot import on dashboard (Tesseract.js via CDN)
- Auto-detects severity from extracted text keywords
- Pre-fills New Incident form with extracted text
- Show/hide password toggle on Login and Sign Up forms
- Sign-up auto-fills name from email address
- Login remembers last used email address
- Auth stored in `localStorage` (persists across sessions)

### Changed
- Demo login now accepts any email + password ≥ 6 chars (creates account automatically)
- Removed strict existing-user check for login to improve demo experience

---

## [1.1.0] — 2026-09-05  Investigation Modal

### Added
- 7-section Investigation modal: Evidence, Root Cause, Impact, Resolution Plan, Risk Score, Actions
- Per-type resolution step playbooks (7 steps × 6 incident types)
- Step checkboxes — click to mark a step done (strikethrough + dim)
- Risk score visual bar with colour-coded label
- SHAP-style feature attribution displayed as sorted factor list
- `_resolutionSteps` object in `investigation.js` with 6 playbook types

### Changed
- `Store.analyse()` now returns structured analysis including `evidence[]`, `shap_factors[]`, `blast_radius[]`
- Investigation `_resolve()` requires a resolution note (validates before proceeding)

---

## [1.0.0] — 2026-09-01  Initial Release

### Added
- Home page with hero, feature cards, 7-step how-it-works, stats strip
- Login and Sign Up pages with field validation
- Dashboard with 4 KPI cards, 3 Chart.js charts, high-risk alert panel, recent incidents list
- Incidents page with search, severity/status filters, and New Incident form
- History page with resolved incidents table and CSV export
- In-memory `Store` (mock-data.js) with 13 seed incidents covering 6 incident types
- Live signal simulation — new incidents appear every 45 seconds
- Toast notifications for all user actions
- Modals for New Incident and Investigation
- Dark theme with CSS custom properties
- Responsive design (mobile-compatible)
