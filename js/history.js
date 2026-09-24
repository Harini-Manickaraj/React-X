/* ================================================================
   history.js  —  REACT-X  v4
   History page: resolved incidents table + View button per row.
   View modal shows: incident details, root cause, proposed solution,
   risk level, action taken, auto-resolved vs required approval,
   verification result, final status.
   ================================================================ */
const History = (() => {

  let _subscribed = false;

  /* ── Public ─────────────────────────────────────────────────── */
  function refresh() {
    // Subscribe to Store once so history auto-updates whenever incidents resolve
    if (!_subscribed) {
      _subscribed = true;
      Store.subscribe(() => {
        // Only re-render if the history page is currently visible
        const page = document.getElementById('page-history');
        if (page && page.classList.contains('active')) applyFilters();
      });
    }
    applyFilters();
  }

  function applyFilters() {
    const search   = (document.getElementById('historySearch')?.value   || '').toLowerCase();
    const severity = document.getElementById('historySeverityFilter')?.value || '';

    let list = Store.getResolved();
    if (search)   list = list.filter(i =>
      i.title.toLowerCase().includes(search) ||
      (i.service     || '').toLowerCase().includes(search) ||
      (i.resolution  || '').toLowerCase().includes(search));
    if (severity) list = list.filter(i => i.severity === severity);
    list = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    _renderTable(list);
  }

  /* ── Table render ────────────────────────────────────────────── */
  function _renderTable(incidents) {
    const container = document.getElementById('historyList');
    if (!container) return;

    if (!incidents.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <h4>No resolved incidents yet</h4>
          <p>Resolved incidents will appear here once the pipeline marks them complete.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="section-card" style="overflow-x:auto;">
        <table class="history-table">
          <thead>
            <tr>
              <th>Incident</th>
              <th>Severity</th>
              <th>Type</th>
              <th>Service</th>
              <th>Resolution</th>
              <th>MTTR</th>
              <th>Resolved</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${incidents.map(_tableRow).join('')}</tbody>
        </table>
      </div>`;
  }

  function _tableRow(inc) {
    const mttr     = inc.mttr != null ? `${inc.mttr} min` : '—';
    const resolved = inc.updated_at
      ? new Date(inc.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const note = inc.resolution
      ? _esc(inc.resolution).slice(0, 70) + (inc.resolution.length > 70 ? '…' : '')
      : '—';

    return `
      <tr>
        <td>
          <div style="font-weight:600;font-size:0.85rem;color:var(--text);">${_esc(inc.title)}</div>
          <div style="font-size:0.73rem;color:var(--text-muted);margin-top:0.1rem;">${_esc(inc.environment || 'Production')}</div>
        </td>
        <td>${Store.severityBadge(inc.severity)}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${_esc(inc.type || '—')}</td>
        <td style="font-size:0.8rem;color:var(--text-secondary);">${_esc(inc.service || '—')}</td>
        <td style="font-size:0.78rem;color:var(--text-secondary);max-width:200px;">${note}</td>
        <td><span style="font-weight:700;color:${_mttrColor(inc.mttr)};">${mttr}</span></td>
        <td style="font-size:0.79rem;white-space:nowrap;color:var(--text-secondary);">${resolved}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="History.viewIncident('${inc.id}')">View</button>
        </td>
      </tr>`;
  }

  function _mttrColor(mttr) {
    if (mttr == null) return 'var(--text-muted)';
    if (mttr <= 20)   return 'var(--risk-low)';
    if (mttr <= 60)   return 'var(--risk-medium)';
    return 'var(--risk-high)';
  }

  /* ── View incident modal ─────────────────────────────────────── */
  function viewIncident(id) {
    const inc = Store.getById(id);
    if (!inc) { App.toast('Incident not found.', 'error'); return; }

    document.getElementById('historyViewTitle').textContent =
      `Report — ${inc.title.length > 55 ? inc.title.slice(0, 55) + '…' : inc.title}`;

    const body = document.getElementById('historyViewBody');
    if (!body) return;

    // Get RCA — use cached one if available, otherwise generate from Store
    const rca    = inc._rca || Store.getRCA(id);
    const score  = rca?.risk_score || 40;
    const rLabel = score >= 80 ? 'Critical' : score >= 60 ? 'High' : score >= 34 ? 'Medium' : 'Low';

    // Classify actions
    const actions  = rca?.actions || [];
    const executed = actions.filter(a => a.status === 'completed' || a.status === 'failed');
    const approved = actions.filter(a => a.status === 'completed' && !Config.shouldAutoExecute(a.risk_level));
    const autoExec = actions.filter(a => a.status === 'completed' &&  Config.shouldAutoExecute(a.risk_level));
    const rejected = actions.filter(a => a.status === 'rejected');
    const passed   = executed.filter(a => a.verification_result?.passed);

    // All planned actions (not just executed) to show as "proposed solution"
    const allActions = actions;

    const resolvedMode = approved.length > 0
      ? 'Human Approved'
      : autoExec.length > 0
        ? 'Automatically Resolved'
        : 'Manually Resolved';

    const modeColor = approved.length > 0 ? '#e65100' : autoExec.length > 0 ? 'var(--risk-low)' : 'var(--accent)';
    const modeIcon  = approved.length > 0 ? '👤' : autoExec.length > 0 ? '🤖' : '✋';

    // Risk bar classes — Critical and High are distinct
    const rBarCls = rLabel === 'Critical' ? 'risk-bar-high' : rLabel === 'High' ? 'risk-bar-high' : rLabel === 'Medium' ? 'risk-bar-medium' : 'risk-bar-low';
    const rLblCls = rLabel === 'Critical' ? 'risk-label-critical' : rLabel === 'High' ? 'risk-label-high' : rLabel === 'Medium' ? 'risk-label-medium' : 'risk-label-low';
    const rIcon   = (rLabel === 'Critical' || rLabel === 'High') ? '🔴' : rLabel === 'Medium' ? '🟡' : '🟢';

    body.innerHTML = `
      <!-- 1. Incident Details -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">1</span> 🔍 Incident Details</div>
        <div class="rca-box" style="background:var(--bg-alt);border-color:var(--border);">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.75rem;font-size:0.82rem;">
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">Title</span>${_esc(inc.title)}</div>
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">Severity</span>${Store.severityBadge(inc.severity)}</div>
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">Type</span>${_esc(inc.type || '—')}</div>
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">Service</span>${_esc(inc.service || '—')}</div>
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">Environment</span>${_esc(inc.environment || '—')}</div>
            <div><span style="color:var(--text-muted);font-weight:600;display:block;">MTTR</span>
              <span style="font-weight:700;color:${_mttrColor(inc.mttr)};">${inc.mttr != null ? inc.mttr + ' min' : '—'}</span>
            </div>
          </div>
          ${inc.description ? `<div style="margin-top:0.65rem;font-size:0.82rem;color:var(--text-secondary);
            border-top:1px solid var(--border-light);padding-top:0.5rem;">${_esc(inc.description)}</div>` : ''}
        </div>
      </div>

      <!-- 2. Root Cause -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">2</span> 🧪 Root Cause</div>
        ${rca?.root_cause ? `
          <div class="rca-box">
            <div class="rca-cause">${_esc(rca.root_cause)}</div>
            <div class="rca-confidence">AI Confidence: ${Math.round((rca.confidence || 0) * 100)}%</div>
            <div class="conf-bar"><div class="conf-fill" style="width:${Math.round((rca.confidence || 0) * 100)}%"></div></div>
          </div>
          ${(rca.evidence || []).length ? `
            <div class="evidence-list" style="margin-top:0.6rem;">
              ${rca.evidence.map(ev => `<div class="evidence-item">${_esc(ev)}</div>`).join('')}
            </div>` : ''}
        ` : '<p class="text-muted">No root cause data available.</p>'}
      </div>

      <!-- 3. Proposed Solution (always shown, even for manually resolved) -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">3</span> 📋 Proposed Solution</div>
        ${(rca?.resolution_steps || []).length ? `
          <div class="plan-list">
            ${rca.resolution_steps.map((s, i) =>
              `<div class="plan-item"><span class="plan-num">${i + 1}</span>${_esc(s)}</div>`
            ).join('')}
          </div>` : '<p class="text-muted">No AI solution steps available for this incident.</p>'}
      </div>

      <!-- 4. Risk Level -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">4</span> ⚖️ Risk Level</div>
        <div class="risk-bar-wrap ${rBarCls}">
          <div class="risk-label ${rLblCls}">${rIcon} ${rLabel} Risk
            <span style="font-weight:400;font-size:0.75rem;color:var(--text-muted)"> — Score: ${score}/100</span>
          </div>
          <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${score}%"></div></div>
        </div>
        <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted);">
          Approval status: <strong>
            ${approved.length > 0
              ? `${approved.length} action(s) required and received human approval`
              : autoExec.length > 0
                ? 'All actions were pre-authorised (no human approval needed)'
                : rejected.length > 0
                  ? 'Actions were rejected — resolved manually'
                  : 'Resolved without AI action execution'}
          </strong>
        </div>
      </div>

      <!-- 5. Actions Taken (always show ALL planned actions, mark which were executed) -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">5</span> ⚡ Actions Taken</div>
        ${allActions.length ? `
          <div class="action-list">
            ${allActions.map(act => {
              const wasExec = act.status === 'completed' || act.status === 'failed';
              const wasRej  = act.status === 'rejected';
              const notRun  = !wasExec && !wasRej;
              return `
              <div class="action-card">
                <div class="action-card-head">
                  <div>
                    <div class="action-name">${_esc(act.name)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.1rem;">${_esc(act.description || '')}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                    ${Store.riskBadge(act.risk_level)}
                    ${wasExec && act.verification_result?.passed
                      ? '<span class="status-chip chip-success">✓ Executed &amp; Verified</span>'
                      : wasExec
                        ? '<span class="status-chip chip-failed">✗ Executed, failed</span>'
                        : wasRej
                          ? '<span class="status-chip chip-failed">✗ Rejected</span>'
                          : '<span class="status-chip chip-pending">— Proposed (not run)</span>'}
                  </div>
                </div>
                <div class="action-body">
                  <div class="action-row">
                    <span class="action-key">Command</span>
                    <span class="action-cmd">${_esc(act.command)}</span>
                  </div>
                  ${act.rollback_command ? `
                    <div class="action-row">
                      <span class="action-key">Rollback</span>
                      <span class="action-cmd">${_esc(act.rollback_command)}</span>
                    </div>` : ''}
                  ${act.execution_result ? `
                    <div class="action-row">
                      <span class="action-key">Output</span>
                      <span class="action-val">${_esc(act.execution_result.output)}</span>
                    </div>` : ''}
                  ${act.verification_result ? `
                    <div class="action-row">
                      <span class="action-key">Verification</span>
                      <span class="action-val" style="color:${act.verification_result.passed ? 'var(--risk-low)' : 'var(--risk-high)'};">
                        ${act.verification_result.passed ? '✓' : '✗'} ${_esc(act.verification_result.message)}
                      </span>
                    </div>` : ''}
                  ${notRun ? `
                    <div class="action-row">
                      <span class="action-key">Status</span>
                      <span class="action-val" style="color:var(--text-muted);">Proposed by AI — not executed (incident resolved by other means)</span>
                    </div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
          ${rejected.length ? `
            <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--risk-high);">
              ✗ ${rejected.length} action${rejected.length > 1 ? 's' : ''} rejected:
              ${rejected.map(a => _esc(a.name)).join(', ')}
            </div>` : ''}
        ` : `
          <!-- No RCA actions — show what the resolution plan would have been -->
          <div style="padding:0.75rem;background:var(--bg-alt);border-radius:var(--radius-sm);font-size:0.82rem;color:var(--text-secondary);">
            <div style="font-weight:600;margin-bottom:0.35rem;">No automated actions were executed.</div>
            ${(rca?.resolution_steps || []).length
              ? `<div style="color:var(--text-muted);margin-bottom:0.4rem;">The AI proposed the following steps (not executed):</div>
                 <div class="plan-list">
                   ${rca.resolution_steps.map((s, i) =>
                     `<div class="plan-item"><span class="plan-num">${i + 1}</span>${_esc(s)}</div>`
                   ).join('')}
                 </div>`
              : '<div style="color:var(--text-muted);">No automated steps were available for this incident type.</div>'}
          </div>`}
      </div>

      <!-- 6. Resolution Mode & Approval Status -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">6</span> 🤖 Resolution Mode</div>
        <div style="padding:0.85rem 1rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);
                    background:var(--bg-alt);display:flex;align-items:center;gap:0.75rem;
                    font-size:0.88rem;font-weight:600;">
          <span style="font-size:1.4rem;">${modeIcon}</span>
          <div>
            <div style="color:${modeColor};">${_esc(resolvedMode)}</div>
            <div style="font-size:0.76rem;font-weight:400;color:var(--text-muted);margin-top:0.15rem;">
              ${approved.length > 0
                ? `A team member approved ${approved.length} high-risk action${approved.length > 1 ? 's' : ''} before execution.`
                : autoExec.length > 0
                  ? `${autoExec.length} action${autoExec.length > 1 ? 's' : ''} executed automatically (pre-authorised Low/Medium risk).`
                  : 'No automated actions were executed. Resolved manually using the resolution note below.'}
            </div>
          </div>
        </div>
      </div>

      <!-- 7. Final Result -->
      <div class="inv-section">
        <div class="inv-section-title"><span class="step-num">7</span> ✅ Final Result</div>
        <div class="${passed.length > 0 ? 'auto-execute-box' : 'approval-required-box'}">
          ${passed.length > 0
            ? `✅ Verification passed — ${passed.length} action${passed.length > 1 ? 's' : ''} confirmed successful. Incident resolved in ${inc.mttr || '?'} min.`
            : executed.length > 0
              ? '⚠ Some actions failed verification — resolved via manual follow-up.'
              : `✅ Resolved manually in ${inc.mttr || '?'} min. No automated verification was run.`}
        </div>
        ${inc.resolution ? `
          <div style="margin-top:0.6rem;padding:0.65rem 0.85rem;background:var(--bg-alt);
                      border-radius:var(--radius-sm);font-size:0.82rem;color:var(--text-secondary);">
            <strong>Resolution note:</strong> ${_esc(inc.resolution)}
          </div>` : ''}
      </div>`;

    App.openModal('modal-history-view');
  }

  /* ── Export CSV ──────────────────────────────────────────────── */
  function exportCSV() {
    const search   = (document.getElementById('historySearch')?.value || '').toLowerCase();
    const severity = document.getElementById('historySeverityFilter')?.value || '';
    let list = Store.getResolved();
    if (search)   list = list.filter(i => i.title.toLowerCase().includes(search));
    if (severity) list = list.filter(i => i.severity === severity);
    if (!list.length) { App.toast('No resolved incidents to export.', 'warning'); return; }
    const headers = ['id', 'title', 'severity', 'type', 'service', 'environment', 'mttr_min', 'created_at', 'resolved_at', 'resolution'];
    const rows = list.map(i =>
      [i.id, i.title, i.severity, i.type || '', i.service || '', i.environment || '',
       i.mttr != null ? i.mttr : '', i.created_at, i.updated_at, i.resolution || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: `reactx-history-${new Date().toISOString().slice(0, 10)}.csv`
    });
    a.click();
    App.toast(`Exported ${list.length} resolved incidents.`, 'success');
  }

  function _esc(s) { return App.esc ? App.esc(s) : String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  return { refresh, applyFilters, exportCSV, viewIncident };
})();
