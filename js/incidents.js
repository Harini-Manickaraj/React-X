/* ================================================================
   REACT-X — incidents.js
   Incident list with inline Mark Complete text box, OCR, filters
   ================================================================ */

const Incidents = (() => {

  let _initialized = false;
  let _currentImageDataUrl = null;   // holds base64 of attached image

  /* ── Init / Refresh ──────────────────────────────────── */
  function init() {
    _renderList();
    if (!_initialized) {
      _setupForm();
      _setupImageUpload();
      _initialized = true;
    }
  }

  function refresh() {
    const page = document.getElementById('page-incidents');
    if (!page || !page.classList.contains('active')) return;
    _renderList();
  }

  /* ── Render list ─────────────────────────────────────── */
  function _renderList(overrideList) {
    const el = document.getElementById('incidentList');
    if (!el) return;

    const list = overrideList || _filteredIncidents();

    if (list.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
            <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
          </svg>
          <h3>All clear</h3>
          <p>No incidents match your current filters.</p>
        </div>`;
      return;
    }

    el.innerHTML = list.map(inc => _incidentRowHTML(inc)).join('');
  }

  function _incidentRowHTML(inc) {
    const isResolved = inc.status === 'Resolved';
    const resolvedStyle = isResolved ? 'opacity:0.7;' : '';

    return `
    <div class="incident-row${isResolved ? ' incident-resolved' : ''}" style="${resolvedStyle}">
      <!-- Left: title + meta -->
      <div class="inc-left" onclick="${isResolved ? '' : `Investigation.open('${inc.id}')`}"
           style="${isResolved ? '' : 'cursor:pointer'}">
        <div class="inc-title">
          ${isResolved ? '<span class="inc-resolved-tick">✓</span> ' : ''}${_esc(inc.title)}
        </div>
        <div class="inc-meta">
          ${App.severityBadge(inc.severity)}
          ${App.statusBadge(inc.status)}
          ${inc.service ? `<span>${_esc(inc.service)}</span>` : ''}
          <span>${_esc(inc.environment)}</span>
          <span>${_esc(inc.type)}</span>
        </div>
        ${isResolved && inc.resolution ? `
          <div class="inc-resolution-preview">
            <span class="inc-resolution-label">Resolution:</span>
            ${_esc(inc.resolution)}
            ${inc.mttr ? `<span class="inc-mttr">· MTTR: ${inc.mttr}</span>` : ''}
          </div>` : ''}
      </div>

      <!-- Right: time + actions -->
      <div class="inc-right">
        <span class="inc-time">${App.formatTime(isResolved ? inc.resolvedAt : inc.createdAt)}</span>

        ${!isResolved ? `
          <!-- Investigate button -->
          <button class="btn btn-sm btn-ghost"
            onclick="Investigation.open('${inc.id}')">Investigate</button>

          <!-- ── Mark Complete inline panel ── -->
          <div class="mark-complete-wrap" id="mc-wrap-${inc.id}">
            <button class="btn btn-sm btn-success"
              onclick="Incidents.showCompleteBox('${inc.id}')">
              ✓ Mark Complete
            </button>
            <!-- Hidden text box — shown on click -->
            <div class="complete-box" id="mc-box-${inc.id}" style="display:none">
              <textarea
                id="mc-note-${inc.id}"
                class="input complete-textarea"
                rows="2"
                placeholder="What was done to fix this? (required)"></textarea>
              <div class="complete-box-actions">
                <button class="btn btn-sm btn-ghost"
                  onclick="Incidents.hideCompleteBox('${inc.id}')">Cancel</button>
                <button class="btn btn-sm btn-success"
                  onclick="Incidents.submitComplete('${inc.id}')">Confirm Resolved</button>
              </div>
            </div>
          </div>
        ` : `
          <span class="resolved-label">Resolved</span>
        `}
      </div>
    </div>`;
  }

  /* ── Mark Complete flow ───────────────────────────────── */
  function showCompleteBox(id) {
    // Hide all other open boxes first
    document.querySelectorAll('.complete-box').forEach(b => b.style.display = 'none');
    const box = document.getElementById(`mc-box-${id}`);
    if (box) {
      box.style.display = 'block';
      document.getElementById(`mc-note-${id}`)?.focus();
    }
  }

  function hideCompleteBox(id) {
    const box = document.getElementById(`mc-box-${id}`);
    if (box) box.style.display = 'none';
    const note = document.getElementById(`mc-note-${id}`);
    if (note) note.value = '';
  }

  function submitComplete(id) {
    const noteEl = document.getElementById(`mc-note-${id}`);
    const note = noteEl ? noteEl.value.trim() : '';
    if (!note) {
      noteEl?.classList.add('error');
      noteEl?.setAttribute('placeholder', 'Please describe what was done to fix this.');
      App.toast('Enter a resolution note before marking complete.', 'warning');
      return;
    }
    noteEl?.classList.remove('error');

    const inc = Store.updateStatus(id, 'Resolved', note);
    if (!inc) { App.toast('Incident not found.', 'error'); return; }

    App.toast(`✓ ${inc.id} marked complete. MTTR: ${inc.mttr}`, 'success', 4000);
    _renderList();
    Dashboard.refresh();
    History.refresh();
  }

  /* ── Filters ─────────────────────────────────────────── */
  function _filteredIncidents() {
    const q    = (document.getElementById('incidentSearch')?.value   || '').toLowerCase();
    const sev  =  document.getElementById('incidentSeverityFilter')?.value || '';
    const stat =  document.getElementById('incidentStatusFilter')?.value   || '';

    // Show ALL incidents including resolved so user can see their completed ones
    return Store.getAll()
      .sort((a, b) => {
        // Open/Investigating first, then Resolved
        const order = { Open: 0, Investigating: 1, Resolved: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .filter(inc => {
        const matchQ    = !q    || inc.title.toLowerCase().includes(q)
                                || (inc.service||'').toLowerCase().includes(q)
                                || inc.description.toLowerCase().includes(q);
        const matchSev  = !sev  || inc.severity === sev;
        const matchStat = !stat || inc.status === stat;
        return matchQ && matchSev && matchStat;
      });
  }

  function applyFilters() { _renderList(); }

  /* ── Export ──────────────────────────────────────────── */
  function toggleExportMenu() {
    const menu = document.getElementById('incExportMenu');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : 'block';
    // Close when clicking outside
    if (!isOpen) {
      setTimeout(() => {
        document.addEventListener('click', _closeExportOnOutside, { once: true });
      }, 0);
    }
  }

  function _closeExportOnOutside(e) {
    const dropdown = document.getElementById('incExportDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      const menu = document.getElementById('incExportMenu');
      if (menu) menu.style.display = 'none';
    }
  }

  function exportAs(format) {
    // Close menu
    const menu = document.getElementById('incExportMenu');
    if (menu) menu.style.display = 'none';

    const list = _filteredIncidents();
    if (list.length === 0) {
      App.toast('No incidents to export with current filters.', 'warning');
      return;
    }

    const now       = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const filename  = `react-x-incidents_${now}`;
    const q         = (document.getElementById('incidentSearch')?.value || '').trim();
    const sev       = document.getElementById('incidentSeverityFilter')?.value || '';
    const stat      = document.getElementById('incidentStatusFilter')?.value   || '';
    const filterDesc = [
      q    ? `search:"${q}"` : '',
      sev  ? `severity:${sev}`  : '',
      stat ? `status:${stat}`   : ''
    ].filter(Boolean).join(', ') || 'all';

    if (format === 'csv')  _exportCSV(list,  filename, filterDesc);
    if (format === 'json') _exportJSON(list, filename, filterDesc);
    if (format === 'txt')  _exportTXT(list,  filename, filterDesc);
  }

  function _exportCSV(list, filename, filterDesc) {
    const headers = ['ID','Title','Severity','Status','Type','Service','Environment','Created','Updated','Resolved','MTTR','Description','Resolution','Created By'];
    const rows = list.map(i => [
      i.id,
      `"${(i.title||'').replace(/"/g,'""')}"`,
      i.severity,
      i.status,
      i.type,
      i.service || '',
      i.environment,
      _fmtDate(i.createdAt),
      _fmtDate(i.updatedAt),
      i.resolvedAt ? _fmtDate(i.resolvedAt) : '',
      i.mttr || '',
      `"${(i.description||'').replace(/"/g,'""').replace(/\n/g,' ')}"`,
      `"${(i.resolution||'').replace(/"/g,'""')}"`,
      i.createdBy || ''
    ].join(','));

    const meta = `# REACT-X Incident Export\n# Generated: ${new Date().toLocaleString()}\n# Filters: ${filterDesc}\n# Total: ${list.length} records\n\n`;
    _download(meta + headers.join(',') + '\n' + rows.join('\n'), filename + '.csv', 'text/csv');
    App.toast(`Exported ${list.length} incidents as CSV`, 'success');
  }

  function _exportJSON(list, filename, filterDesc) {
    const payload = {
      meta: {
        source:    'REACT-X Incident Management',
        exported:  new Date().toISOString(),
        filters:   filterDesc,
        total:     list.length
      },
      incidents: list.map(i => ({
        id:          i.id,
        title:       i.title,
        severity:    i.severity,
        status:      i.status,
        type:        i.type,
        service:     i.service || null,
        environment: i.environment,
        description: i.description,
        resolution:  i.resolution || null,
        mttr:        i.mttr       || null,
        createdBy:   i.createdBy,
        createdAt:   i.createdAt,
        updatedAt:   i.updatedAt,
        resolvedAt:  i.resolvedAt || null
      }))
    };
    _download(JSON.stringify(payload, null, 2), filename + '.json', 'application/json');
    App.toast(`Exported ${list.length} incidents as JSON`, 'success');
  }

  function _exportTXT(list, filename, filterDesc) {
    const divider = '─'.repeat(72);
    let txt = `REACT-X — Incident Export Report\n`;
    txt    += `Generated : ${new Date().toLocaleString()}\n`;
    txt    += `Filters   : ${filterDesc}\n`;
    txt    += `Total     : ${list.length} record${list.length !== 1 ? 's' : ''}\n`;
    txt    += `${divider}\n\n`;

    list.forEach((i, idx) => {
      txt += `[${idx + 1}] ${i.id}\n`;
      txt += `Title       : ${i.title}\n`;
      txt += `Severity    : ${i.severity}\n`;
      txt += `Status      : ${i.status}\n`;
      txt += `Type        : ${i.type}\n`;
      txt += `Service     : ${i.service || '—'}\n`;
      txt += `Environment : ${i.environment}\n`;
      txt += `Created     : ${_fmtDate(i.createdAt)}  by ${i.createdBy}\n`;
      if (i.resolvedAt) {
        txt += `Resolved    : ${_fmtDate(i.resolvedAt)}\n`;
        txt += `MTTR        : ${i.mttr || '—'}\n`;
      }
      txt += `Description :\n  ${(i.description||'').replace(/\n/g,'\n  ')}\n`;
      if (i.resolution) txt += `Resolution  :\n  ${i.resolution.replace(/\n/g,'\n  ')}\n`;
      txt += `${divider}\n\n`;
    });

    _download(txt, filename + '.txt', 'text/plain');
    App.toast(`Exported ${list.length} incidents as plain text`, 'success');
  }

  function _download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', {
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  }

  /* ── New incident modal ───────────────────────────────── */
  function openNewIncidentModal(e, highlightId) {
    if (e && e.preventDefault) e.preventDefault();
    document.getElementById('newIncidentForm')?.reset();
    _clearFormErrors();
    _resetImage();
    App.openModal('modal-new-incident');

    if (highlightId) {
      const inc = Store.getById(highlightId);
      if (inc) {
        _setField('incTitle',       inc.title);
        _setField('incSeverity',    inc.severity);
        _setField('incType',        inc.type);
        _setField('incService',     inc.service);
        _setField('incEnvironment', inc.environment);
        _setField('incDescription', inc.description);
      }
    }
  }

  /* ── Form submit ─────────────────────────────────────── */
  function _setupForm() {
    document.getElementById('newIncidentForm')?.addEventListener('submit', e => {
      e.preventDefault();
      _clearFormErrors();

      const title       = document.getElementById('incTitle')?.value.trim()       || '';
      const severity    = document.getElementById('incSeverity')?.value           || '';
      const type        = document.getElementById('incType')?.value               || 'Other';
      const service     = document.getElementById('incService')?.value.trim()     || '';
      const environment = document.getElementById('incEnvironment')?.value        || 'Production';
      const description = document.getElementById('incDescription')?.value.trim() || '';

      let valid = true;
      if (!title)       { _setError('incTitleError',       'Title is required.');            valid = false; }
      if (!severity)    { _setError('incSeverityError',    'Select a severity level.');      valid = false; }
      if (!description) { _setError('incDescriptionError', 'Describe the incident.');        valid = false; }
      if (!valid) return;

      const user = App.getUser();
      const inc  = Store.createIncident({
        title, severity, type, service, environment, description,
        createdBy: user ? user.name : 'User'
      });

      App.closeModal('modal-new-incident');
      App.toast(`Incident ${inc.id} created`, 'success');
      App.navigateTo('incidents');
      setTimeout(() => Investigation.open(inc.id), 300);
    });
  }

  /* ── Helpers ─────────────────────────────────────────── */
  function _setField(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
  function _setError(id, m) { const el = document.getElementById(id); if (el) el.textContent = m; }
  function _clearFormErrors() {
    ['incTitleError','incSeverityError','incDescriptionError'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
  }
  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, refresh, applyFilters, openNewIncidentModal, showCompleteBox, hideCompleteBox, submitComplete, toggleExportMenu, exportAs };
})();

window.Incidents = Incidents;
