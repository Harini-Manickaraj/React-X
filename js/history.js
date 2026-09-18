/* ================================================================
   REACT-X — history.js
   Resolved incidents table with search/filter and CSV export
   ================================================================ */

const History = (() => {

  let _initialized = false;

  /* ================================================================
     INIT / REFRESH
     ================================================================ */
  function init() {
    _renderTable();
    if (!_initialized) {
      _initialized = true;
    }
  }

  function refresh() {
    const page = document.getElementById('page-history');
    if (!page || !page.classList.contains('active')) return;
    _renderTable();
  }

  /* ================================================================
     RENDER TABLE
     ================================================================ */
  function _renderTable(data) {
    const el = document.getElementById('historyList');
    if (!el) return;

    const records = data || _filtered();

    if (records.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <p>No resolved incidents found.</p>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Severity</th>
              <th>Service</th>
              <th>Resolved</th>
              <th>MTTR</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(inc => `
              <tr onclick="Investigation.open('${inc.id}')">
                <td class="id-col">${_esc(inc.id)}</td>
                <td class="title-col">${_esc(inc.title)}</td>
                <td>${App.severityBadge(inc.severity)}</td>
                <td class="text-sm text-muted">${_esc(inc.service || '—')}</td>
                <td class="text-sm text-muted">${_formatDate(inc.resolvedAt)}</td>
                <td class="text-sm">${_esc(inc.mttr || '—')}</td>
                <td class="text-sm text-muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(inc.resolution || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function _filtered() {
    const q   = (document.getElementById('historySearch')?.value || '').toLowerCase();
    const sev = document.getElementById('historySeverityFilter')?.value || '';

    return Store.getHistory().filter(inc => {
      const matchQ   = !q   || inc.title.toLowerCase().includes(q) || (inc.service || '').toLowerCase().includes(q) || (inc.resolution || '').toLowerCase().includes(q);
      const matchSev = !sev || inc.severity === sev;
      return matchQ && matchSev;
    });
  }

  function applyFilters() { _renderTable(); }

  /* ================================================================
     CSV EXPORT
     ================================================================ */
  function exportCSV() {
    const records = _filtered();
    if (records.length === 0) { App.toast('Nothing to export.', 'warning'); return; }

    const headers = ['ID','Title','Severity','Service','Environment','Created','Resolved','MTTR','Resolution'];
    const rows = records.map(inc => [
      inc.id,
      `"${(inc.title || '').replace(/"/g,'""')}"`,
      inc.severity,
      inc.service || '',
      inc.environment || '',
      inc.createdAt ? new Date(inc.createdAt).toISOString() : '',
      inc.resolvedAt ? new Date(inc.resolvedAt).toISOString() : '',
      inc.mttr || '',
      `"${(inc.resolution || '').replace(/"/g,'""')}"`
    ].join(','));

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `incidents-history-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    App.toast(`Exported ${records.length} records as CSV`, 'success');
  }

  /* ================================================================
     HELPERS
     ================================================================ */
  function _formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, refresh, applyFilters, exportCSV };
})();

window.History = History;
