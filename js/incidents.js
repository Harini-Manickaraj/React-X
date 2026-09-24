/* ================================================================
   incidents.js  —  REACT-X
   Incidents page: list, filters, new incident modal (with OCR
   image upload), inline mark-complete, export (CSV/JSON/TXT).
   ================================================================ */
const Incidents = (() => {

  let _selectedImage = null; // base64 preview for new incident

  /* ── Public: refresh the incidents page ─────────────────────── */
  function refresh() {
    applyFilters();
  }

  /* ── Filter + render ─────────────────────────────────────────── */
  function applyFilters() {
    const search   = (document.getElementById('incidentSearch')?.value || '').toLowerCase();
    const severity = document.getElementById('incidentSeverityFilter')?.value || '';
    const status   = document.getElementById('incidentStatusFilter')?.value || '';

    let list = Store.getAll().filter(i => i.status !== 'Resolved'); // history page handles resolved

    if (search)   list = list.filter(i =>
      i.title.toLowerCase().includes(search) ||
      (i.service || '').toLowerCase().includes(search) ||
      (i.description || '').toLowerCase().includes(search)
    );
    if (severity) list = list.filter(i => i.severity === severity);
    if (status)   list = list.filter(i => i.status   === status);

    _renderList(list);
  }

  function _renderList(incidents) {
    const container = document.getElementById('incidentList');
    if (!container) return;

    if (incidents.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎉</div>
          <h4>No incidents found</h4>
          <p>Try adjusting the filters, or create a new incident.</p>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="section-card">${incidents.map(_incidentRow).join('')}</div>`;
  }

  function _incidentRow(inc) {
    const ago = Store.relativeTime(inc.created_at);
    return `
      <div class="incident-item" id="inc-row-${inc.id}">
        <div class="inc-left">
          <div class="inc-title">${_esc(inc.title)}</div>
          <div class="inc-meta">
            ${Store.severityBadge(inc.severity)}
            ${Store.statusBadge(inc.status)}
            <span class="sep">·</span>
            <span>${_esc(inc.type || '—')}</span>
            <span class="sep">·</span>
            <span>${_esc(inc.service || '—')}</span>
            <span class="sep">·</span>
            <span>${_esc(inc.environment || '—')}</span>
            <span class="sep">·</span>
            <span title="${_esc(inc.created_at)}">${ago}</span>
          </div>
        </div>
        <div class="inc-actions">
          <button class="btn btn-ghost btn-sm"
            onclick="Investigation.open('${inc.id}')">
            Investigate
          </button>
          <button class="btn btn-primary btn-sm"
            onclick="Incidents.openMarkComplete('${inc.id}')">
            Mark Complete
          </button>
        </div>
      </div>`;
  }

  /* ── New Incident Modal ──────────────────────────────────────── */
  function openNewIncidentModal(prefill = {}) {
    // Reset form
    const form = document.getElementById('newIncidentForm');
    if (form) form.reset();
    _selectedImage = null;
    _resetImagePreview();
    _clearNewErrors();

    // Apply OCR prefill if provided
    if (prefill.title)       document.getElementById('incTitle').value       = prefill.title;
    if (prefill.description) document.getElementById('incDescription').value = prefill.description;
    if (prefill.severity)    document.getElementById('incSeverity').value    = prefill.severity;

    // Bind submit (once)
    const btn = document.getElementById('createIncidentBtn');
    if (btn && !btn._bound) {
      btn._bound = true;
      form.addEventListener('submit', _handleCreate);
    }

    // Bind image upload zone
    _bindImageUpload();

    App.openModal('modal-new-incident');
  }

  async function _handleCreate(e) {
    e.preventDefault();
    _clearNewErrors();

    const title       = document.getElementById('incTitle').value.trim();
    const severity    = document.getElementById('incSeverity').value;
    const type        = document.getElementById('incType').value;
    const service     = document.getElementById('incService').value.trim();
    const environment = document.getElementById('incEnvironment').value;
    const description = document.getElementById('incDescription').value.trim();

    let valid = true;
    if (!title)    { document.getElementById('incTitleError').textContent = 'Title is required.';           valid = false; }
    if (!severity) { document.getElementById('incSeverityError').textContent = 'Select a severity level.'; valid = false; }
    if (!description) { document.getElementById('incDescriptionError').textContent = 'Description is required.'; valid = false; }
    if (!valid) return;

    const btn = document.getElementById('createIncidentBtn');
    btn.disabled = true; btn.textContent = 'Creating…';

    const res = await API.createIncident({ title, severity, type, service, environment, description });

    btn.disabled = false; btn.textContent = 'Create Incident';

    if (!res.ok) { App.toast('Failed to create incident.', 'error'); return; }

    App.closeModal('modal-new-incident');
    App.toast('Incident created.', 'success');

    // Refresh whichever page is active
    if (document.getElementById('page-incidents')?.classList.contains('active')) refresh();
    Dashboard.refresh();
  }

  /* ── Image upload in modal ───────────────────────────────────── */
  function _bindImageUpload() {
    const zone   = document.getElementById('imgUploadZone');
    const fileIn = document.getElementById('incImageFile');
    if (!zone || !fileIn) return;

    // Remove old listeners by cloning
    const newZone = zone.cloneNode(true);
    zone.parentNode.replaceChild(newZone, zone);
    const newFileIn = document.getElementById('incImageFile');

    newZone.addEventListener('click', e => {
      if (!e.target.classList.contains('img-browse-link')) newFileIn.click();
    });
    newZone.addEventListener('dragover', e => { e.preventDefault(); newZone.style.borderColor = 'var(--accent)'; });
    newZone.addEventListener('dragleave', () => { newZone.style.borderColor = ''; });
    newZone.addEventListener('drop', e => {
      e.preventDefault(); newZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file) _previewImage(file);
    });
    newFileIn.addEventListener('change', e => {
      if (e.target.files[0]) _previewImage(e.target.files[0]);
    });
  }

  function _previewImage(file) {
    if (file.size > 5 * 1024 * 1024) { App.toast('Image must be under 5 MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      _selectedImage = ev.target.result;
      const preview = document.getElementById('imgPreview');
      const wrap    = document.getElementById('imgPreviewWrap');
      const ph      = document.getElementById('imgPlaceholder');
      const meta    = document.getElementById('imgPreviewMeta');
      if (preview) preview.src = _selectedImage;
      if (wrap)    wrap.style.display = 'block';
      if (ph)      ph.style.display   = 'none';
      if (meta)    meta.textContent   = `${file.name} — ${(file.size / 1024).toFixed(0)} KB`;
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    _selectedImage = null;
    _resetImagePreview();
  }

  function _resetImagePreview() {
    const wrap = document.getElementById('imgPreviewWrap');
    const ph   = document.getElementById('imgPlaceholder');
    const prev = document.getElementById('imgPreview');
    if (wrap) wrap.style.display = 'none';
    if (ph)   ph.style.display   = '';
    if (prev) prev.src = '';
  }

  function _clearNewErrors() {
    ['incTitleError','incSeverityError','incDescriptionError'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
  }

  /* ── Mark Complete (inline resolve) ─────────────────────────── */
  function openMarkComplete(id) {
    const inc = Store.getById(id);
    if (!inc) return;

    // Build a simple inline note prompt using a custom small modal approach
    const note = window.prompt(
      `Resolve "${inc.title}"\n\nEnter a short resolution note (optional):`,
      'Resolved by on-call engineer.'
    );
    if (note === null) return; // cancelled

    API.resolveIncident(id, note || 'Resolved.').then(() => {
      App.toast('Incident resolved ✓', 'success');
      refresh();
      Dashboard.refresh();
    });
  }

  /* ── Export ──────────────────────────────────────────────────── */
  function toggleExportMenu() {
    const menu = document.getElementById('incExportMenu');
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }

  // Close export menu when clicking outside
  document.addEventListener('click', e => {
    const dd = document.getElementById('incExportDropdown');
    if (dd && !dd.contains(e.target)) {
      const menu = document.getElementById('incExportMenu');
      if (menu) menu.style.display = 'none';
    }
  });

  function exportAs(format) {
    const search   = (document.getElementById('incidentSearch')?.value || '').toLowerCase();
    const severity = document.getElementById('incidentSeverityFilter')?.value || '';
    const status   = document.getElementById('incidentStatusFilter')?.value || '';

    let list = Store.getAll().filter(i => i.status !== 'Resolved');
    if (search)   list = list.filter(i => i.title.toLowerCase().includes(search));
    if (severity) list = list.filter(i => i.severity === severity);
    if (status)   list = list.filter(i => i.status === status);

    if (list.length === 0) { App.toast('No incidents match current filters.', 'warning'); return; }

    let content, filename, mime;

    if (format === 'csv') {
      const headers = ['id','title','severity','type','service','environment','status','created_at'];
      const rows = list.map(i => headers.map(h => `"${String(i[h] || '').replace(/"/g, '""')}"`).join(','));
      content  = [headers.join(','), ...rows].join('\n');
      filename = 'incidents.csv'; mime = 'text/csv';

    } else if (format === 'json') {
      content  = JSON.stringify(list, null, 2);
      filename = 'incidents.json'; mime = 'application/json';

    } else {
      content  = list.map(i =>
        `[${i.severity}] ${i.title}\n  Service: ${i.service || '—'}  |  Status: ${i.status}  |  Created: ${new Date(i.created_at).toLocaleString()}\n  ${i.description || ''}\n`
      ).join('\n---\n\n');
      filename = 'incidents.txt'; mime = 'text/plain';
    }

    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();

    toggleExportMenu();
    App.toast(`Exported ${list.length} incidents as ${format.toUpperCase()}.`, 'success');
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _esc(str) { return App.esc ? App.esc(str) : String(str || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return {
    refresh, applyFilters,
    openNewIncidentModal, removeImage,
    openMarkComplete,
    toggleExportMenu, exportAs
  };
})();
