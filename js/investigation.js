/* ================================================================
   investigation.js  —  REACT-X  v4
   Full 9-stage pipeline modal.
   KEY FIX: Low-risk actions auto-execute on open, no button needed.
   Medium: auto or approval per Config.requireApprovalMedium.
   High/Critical: hard block with Approve + Reject buttons.
   ================================================================ */
const Investigation = (() => {

  let _currentId  = null;
  let _currentRCA = null;
  let _currentInc = null;
  let _executing  = false;

  /* ── Open ───────────────────────────────────────────────────── */
  async function open(id) {
    _currentId  = id;
    _currentRCA = null;
    _executing  = false;

    const inc = Store.getById(id);
    if (!inc) return;
    _currentInc = inc;

    if (inc.status === 'Open') {
      await API.updateIncident(id, { status: 'Investigating' });
      _currentInc = Store.getById(id);
    }

    const shortTitle = inc.title.length > 55 ? inc.title.slice(0, 55) + '…' : inc.title;
    document.getElementById('investigationTitle').textContent = `Investigation — ${shortTitle}`;

    const body = document.getElementById('investigationBody');
    if (!body) return;
    body.innerHTML = `
      <div style="text-align:center;padding:3rem 1rem;">
        <div class="demo-waiting-spinner" style="margin:0 auto 1rem;"></div>
        <p style="color:var(--text-muted);font-size:0.88rem;">AI pipeline running — analysing incident…</p>
        ${_pipelineBar('investigate')}
      </div>`;

    App.openModal('modal-investigation');

    await _delay(700);
    const res = await API.runPipeline(id);
    _currentRCA = res.data;

    const live = Store.getById(id);
    if (live) { live._rca = _currentRCA; _currentInc = live; }

    _render();

    // Auto-execute all pre-authorised actions immediately after render
    await _autoExecuteEligible();
  }

  /* ── Auto-execute eligible actions on open ─────────────────── */
  async function _autoExecuteEligible() {
    if (!_currentRCA) return;
    const toAutoRun = _currentRCA.actions.filter(act =>
      Config.shouldAutoExecute(act.risk_level) &&
      act.status !== 'completed' &&
      act.status !== 'failed'
    );
    if (!toAutoRun.length) return;

    // Small pause so the user sees the modal before execution starts
    await _delay(600);

    for (const act of toAutoRun) {
      if (_executing) break;
      _executing = true;
      _setFooterRunning(act.id, 'Auto-executing (pre-authorised)…');
      await _delay(1400);
      const result = Store.executeAction(act);
      const idx = _currentRCA.actions.findIndex(a => a.id === act.id);
      if (idx !== -1) _currentRCA.actions[idx] = result;
      const live = Store.getById(_currentId);
      if (live?._rca) live._rca.actions = _currentRCA.actions;
      _executing = false;
      _render(); // re-render to show result

      if (result.verification_result?.passed) {
        App.toast(`✓ Auto-executed: ${act.name} — metrics recovered`, 'success');
      } else if (Config.get('autoRollback') && act.rollback_command) {
        App.toast(`⚠ Auto-rollback triggered for: ${act.name}`, 'warning');
      } else {
        App.toast(`⚠ Auto-execution of ${act.name} — verification failed`, 'warning');
      }

      await _delay(300);
    }

    // Try to auto-resolve if all eligible actions passed
    const wasResolved = Store.tryAutoResolve(_currentId);
    if (wasResolved) {
      _currentInc = Store.getById(_currentId);
      App.toast('✅ Incident auto-resolved — all actions passed verification', 'success');
      _render();
      // Refresh history so it shows up immediately
      if (document.getElementById('page-history')?.classList.contains('active')) History.refresh();
    }

    Dashboard.refresh();
  }

  /* ── Master render ─────────────────────────────────────────── */
  function _render() {
    const body = document.getElementById('investigationBody');
    if (!body || !_currentRCA) return;
    const inc    = _currentInc;
    const rca    = _currentRCA;
    const score  = rca.risk_score || 40;
    const rlabel = _riskLabel(score);

    body.innerHTML = `
      ${_pipelineBar('execute')}
      ${_sec(1, '🔍', 'Detect',              _detectHtml(inc))}
      ${_sec(2, '🔗', 'Evidence',             _evidenceHtml(rca))}
      ${_sec(3, '🧪', 'Root Cause',           _rcaHtml(rca))}
      ${_sec(4, '💥', 'Impact & Blast Radius', _impactHtml(rca))}
      ${_sec(5, '📋', 'Resolution Plan',       _planHtml(rca))}
      ${_sec(6, '⚖️', 'Risk Assessment',       _riskHtml(score, rlabel))}
      ${_sec(7, '⚡', 'AI Actions',            _actionsHtml(rca, inc))}
      ${inc.status === 'Resolved'
        ? _sec(8, '✅', 'Resolution', _resolvedHtml(inc))
        : _resolveFormHtml(inc)}`;

    body.querySelectorAll('[data-approve]').forEach(btn =>
      btn.addEventListener('click', () => _runAction(btn.dataset.approve, true)));
    body.querySelectorAll('[data-reject]').forEach(btn =>
      btn.addEventListener('click', () => _rejectAction(btn.dataset.reject)));

    const resolveBtn = document.getElementById('resolveIncidentBtn');
    if (resolveBtn && !resolveBtn._bound) {
      resolveBtn._bound = true;
      resolveBtn.addEventListener('click', () => _resolveIncident());
    }
  }

  /* ── Pipeline bar ───────────────────────────────────────────── */
  function _pipelineBar(active) {
    const stages = ['Detect','Investigate','Root Cause','Impact','Plan','Risk Check','Execute','Verify','Resolve'];
    const keys   = ['detect','investigate','root_cause','impact','plan','risk','execute','verify','resolve'];
    const ai = keys.indexOf(active);
    return `<div class="pipeline-flow">${stages.map((s, i) => {
      const cls = i < ai ? 'done' : i === ai ? 'active' : 'pending';
      return (i > 0 ? '<span class="pipe-arrow">→</span>' : '') +
             `<span class="pipe-step ${cls}">${cls === 'done' ? '✓ ' : ''}${s}</span>`;
    }).join('')}</div>`;
  }

  function _sec(n, icon, title, content) {
    return `<div class="inv-section">
      <div class="inv-section-title"><span class="step-num">${n}</span> ${icon} ${title}</div>
      ${content}
    </div>`;
  }

  /* ── Section content builders ───────────────────────────────── */
  function _detectHtml(inc) {
    return `<div class="rca-box" style="background:var(--bg-alt);border-color:var(--border);">
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;font-size:0.82rem;">
        <div><span style="color:var(--text-muted);font-weight:600;">Title</span><br/>${e(inc.title)}</div>
        <div><span style="color:var(--text-muted);font-weight:600;">Service</span><br/>${e(inc.service || '—')}</div>
        <div><span style="color:var(--text-muted);font-weight:600;">Severity</span><br/>${Store.severityBadge(inc.severity)}</div>
        <div><span style="color:var(--text-muted);font-weight:600;">Type</span><br/>${e(inc.type || '—')}</div>
        <div><span style="color:var(--text-muted);font-weight:600;">Env</span><br/>${e(inc.environment || '—')}</div>
        <div><span style="color:var(--text-muted);font-weight:600;">Detected</span><br/>${Store.relativeTime(inc.created_at)}</div>
      </div>
      ${inc.description ? `<div style="margin-top:0.65rem;font-size:0.82rem;color:var(--text-secondary);
        border-top:1px solid var(--border-light);padding-top:0.5rem;">${e(inc.description)}</div>` : ''}
    </div>`;
  }

  function _evidenceHtml(rca) {
    if (!rca.evidence?.length) return '<p class="text-muted">No evidence collected.</p>';
    return `<div class="evidence-list">${rca.evidence.map(ev =>
      `<div class="evidence-item">${e(ev)}</div>`).join('')}</div>`;
  }

  function _rcaHtml(rca) {
    const pct  = Math.round((rca.confidence || 0) * 100);
    const shap = (rca.shap_factors || []).slice(0, 4).map(f => `
      <div class="shap-item">
        <div class="shap-label"><span>${e(f.feature)}</span><span>${Math.round(f.value * 100)}%</span></div>
        <div class="shap-bar"><div class="shap-fill" style="width:${Math.round(f.value * 100)}%"></div></div>
      </div>`).join('');
    return `<div class="rca-box">
        <div class="rca-cause">${e(rca.root_cause)}</div>
        <div class="rca-confidence">AI Confidence: ${pct}%</div>
        <div class="conf-bar"><div class="conf-fill" style="width:${pct}%"></div></div>
      </div>
      ${shap ? `<div class="shap-list" style="margin-top:0.75rem;">${shap}</div>` : ''}`;
  }

  function _impactHtml(rca) {
    const blast = rca.blast_radius || [];
    if (!blast.length) return '<p class="text-muted">No impact data.</p>';
    const c = { critical: 'var(--risk-high)', high: '#e65100', medium: 'var(--risk-medium)', low: 'var(--risk-low)' };
    return `<div class="impact-grid">${blast.map(b => `
      <div class="impact-item">
        <div class="impact-service">${e(b.service)}</div>
        <div class="impact-level" style="color:${c[b.level] || '#666'}">
          ${b.level[0].toUpperCase() + b.level.slice(1)} — ${b.impact}% impact
        </div>
      </div>`).join('')}</div>`;
  }

  function _planHtml(rca) {
    const steps = rca.resolution_steps || [];
    if (!steps.length) return '<p class="text-muted">No plan generated.</p>';
    return `<div class="plan-list">${steps.map((s, i) =>
      `<div class="plan-item"><span class="plan-num">${i + 1}</span>${e(s)}</div>`).join('')}</div>`;
  }

  function _riskHtml(score, label) {
    const isCrit = label === 'Critical';
    const isHigh = label === 'High';
    const barCls = (isCrit || isHigh) ? 'risk-bar-high' : label === 'Medium' ? 'risk-bar-medium' : 'risk-bar-low';
    const lblCls = isCrit ? 'risk-label-critical' : isHigh ? 'risk-label-high' : label === 'Medium' ? 'risk-label-medium' : 'risk-label-low';
    const icon   = (isCrit || isHigh) ? '🔴' : label === 'Medium' ? '🟡' : '🟢';
    return `<div class="risk-bar-wrap ${barCls}">
      <div class="risk-label ${lblCls}">${icon} ${label} Risk
        <span style="font-weight:400;font-size:0.75rem;color:var(--text-muted)"> — Score: ${score}/100</span>
      </div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${score}%"></div></div>
    </div>`;
  }

  /* ── Actions section ────────────────────────────────────────── */
  function _actionsHtml(rca, inc) {
    const actions = rca.actions || [];
    if (!actions.length) return '<p class="text-muted">No AI actions available.</p>';
    return `<div class="action-list">${actions.map(act => _actionCard(act)).join('')}</div>`;
  }

  function _actionCard(act) {
    const autoOk    = Config.shouldAutoExecute(act.risk_level);
    const isDone    = act.status === 'completed';
    const isFailed  = act.status === 'failed';
    const isRunning = act.status === 'running';
    const isWaiting = act.status === 'awaiting_approval';
    const isRejected= act.status === 'rejected';
    const conf      = Math.round((act.confidence || 0.8) * 100);

    let chip = '';
    if (isDone)      chip = `<span class="status-chip chip-success">✓ Executed</span>`;
    else if (isFailed)  chip = `<span class="status-chip chip-failed">✗ Failed</span>`;
    else if (isRunning) chip = `<span class="status-chip chip-running">⟳ Running…</span>`;
    else if (isWaiting) chip = `<span class="status-chip chip-awaiting">⚠ Awaiting Approval</span>`;
    else if (isRejected)chip = `<span class="status-chip chip-failed">✗ Rejected</span>`;
    else if (autoOk)    chip = `<span class="status-chip chip-running">⟳ Queued for auto-exec</span>`;

    let results = '';
    if (act.execution_result) {
      results += `<div class="action-row"><span class="action-key">Output</span>
        <span class="action-val">${e(act.execution_result.output)}</span></div>`;
    }
    if (act.verification_result) {
      const ok = act.verification_result.passed;
      results += `<div class="action-row"><span class="action-key">Verify</span>
        <span class="action-val" style="color:${ok ? 'var(--risk-low)' : 'var(--risk-high)'}">
          ${ok ? '✓' : '✗'} ${e(act.verification_result.message)}</span></div>`;
    }

    let footer = '';
    if (isDone && act.verification_result?.passed) {
      footer = `<div class="auto-execute-box">✅ Auto-executed successfully — metrics recovered.</div>`;
    } else if (isDone && !act.verification_result?.passed) {
      footer = `<div class="approval-required-box">⚠ Executed but verification failed.${Config.get('autoRollback') && act.rollback_command ? ' Auto-rollback triggered.' : ''}</div>`;
    } else if (isFailed) {
      footer = `<div class="approval-required-box">✗ Execution failed.${Config.get('autoRollback') && act.rollback_command ? ' Auto-rollback triggered.' : ' Manual intervention needed.'}</div>`;
    } else if (isRejected) {
      footer = `<div style="color:var(--risk-high);font-size:0.82rem;font-weight:600;">✗ This action was rejected.</div>`;
    } else if (isRunning) {
      footer = `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text-muted);">
        <span class="spinner"></span> Executing…</div>`;
    } else if (autoOk) {
      /* Low/Medium-auto: shown as auto-queued, button to trigger manually if they want */
      footer = `<div class="auto-execute-box">
        🤖 ${act.risk_level} risk — will auto-execute (pre-authorised by policy)
      </div>`;
    } else {
      /* High/Critical: hard approval gate */
      footer = `
        <div class="approval-required-box">
          ⚠ <strong>Human Approval Required</strong> —
          <strong>${act.risk_level} risk</strong> action blocked until a team member approves.
        </div>
        <div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" data-approve="${act.id}">✓ Approve &amp; Execute</button>
          <button class="btn btn-danger  btn-sm" data-reject="${act.id}">✗ Reject</button>
        </div>`;
    }

    return `<div class="action-card" id="action-card-${act.id}">
      <div class="action-card-head">
        <div>
          <div class="action-name">${e(act.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.1rem;">${e(act.description)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
          ${Store.riskBadge(act.risk_level)}${chip}
        </div>
      </div>
      <div class="action-body">
        <div class="action-row"><span class="action-key">Command</span>
          <span class="action-cmd">${e(act.command)}</span></div>
        <div class="action-row"><span class="action-key">Confidence</span>
          <span class="action-val">${conf}%</span></div>
        ${act.rollback_command ? `<div class="action-row"><span class="action-key">Rollback</span>
          <span class="action-cmd">${e(act.rollback_command)}</span></div>` : ''}
        ${results}
      </div>
      <div class="action-footer" id="action-footer-${act.id}">${footer}</div>
    </div>`;
  }

  /* ── Execute action (called by Approve button) ──────────────── */
  async function _runAction(actionId, requiresApproval) {
    if (_executing) { App.toast('Another action is already running.', 'warning'); return; }
    _executing = true;
    const action = _currentRCA.actions.find(a => a.id === actionId);
    if (!action) { _executing = false; return; }

    _setFooterRunning(actionId, requiresApproval ? 'Approved — executing…' : 'Executing…');
    if (requiresApproval) await API.approveAction(actionId, _currentId);
    await _delay(1600);

    const result = Store.executeAction(action);
    const idx = _currentRCA.actions.findIndex(a => a.id === actionId);
    if (idx !== -1) _currentRCA.actions[idx] = result;
    const live = Store.getById(_currentId);
    if (live?._rca) live._rca.actions = _currentRCA.actions;

    _executing = false;
    _render();

    if (result.verification_result?.passed) {
      App.toast('✓ Action approved and executed — metrics recovered!', 'success');
      // Try to auto-resolve if all remaining actions are now done
      const wasResolved = Store.tryAutoResolve(_currentId);
      if (wasResolved) {
        _currentInc = Store.getById(_currentId);
        App.toast('✅ Incident fully resolved — all actions verified', 'success');
        _render();
        if (document.getElementById('page-history')?.classList.contains('active')) History.refresh();
      }
    } else if (Config.get('autoRollback') && action.rollback_command) {
      App.toast('⚠ Verification failed — auto-rollback triggered.', 'warning');
    } else {
      App.toast('⚠ Executed but verification failed.', 'warning');
    }
    Dashboard.refresh();
  }

  function _rejectAction(actionId) {
    const idx = _currentRCA.actions.findIndex(a => a.id === actionId);
    if (idx !== -1) _currentRCA.actions[idx].status = 'rejected';

    // Build alternative steps from the resolution plan
    const altSteps = (_currentRCA.resolution_steps || []).slice(0, 3);
    const altHtml = altSteps.length
      ? `<div style="margin-top:0.6rem;">
          <div style="font-size:0.78rem;font-weight:700;color:var(--text-secondary);margin-bottom:0.35rem;">
            Alternative steps:
          </div>
          ${altSteps.map((s, i) => `
            <div style="display:flex;gap:0.5rem;font-size:0.78rem;color:var(--text-secondary);
                        padding:0.3rem 0;border-bottom:1px solid var(--border-light);">
              <span style="background:var(--text-muted);color:#fff;min-width:18px;height:18px;
                           border-radius:50%;font-size:0.68rem;display:flex;align-items:center;
                           justify-content:center;flex-shrink:0;">${i + 1}</span>
              ${e(s)}
            </div>`).join('')}
        </div>` : '';

    const footer = document.getElementById('action-footer-' + actionId);
    if (footer) footer.innerHTML = `
      <div style="color:var(--risk-high);font-size:0.82rem;font-weight:600;margin-bottom:0.25rem;">
        ✗ Action rejected — will not be executed.
      </div>
      <div style="font-size:0.79rem;color:var(--text-muted);">
        The incident is escalated. Follow the manual steps below or assign to a senior engineer.
      </div>
      ${altHtml}`;

    App.toast('Action rejected. See alternative steps in the action card.', 'warning');
  }

  function _setFooterRunning(actionId, msg) {
    const f = document.getElementById('action-footer-' + actionId);
    if (f) f.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;color:var(--text-muted);">
      <span class="spinner"></span> ${e(msg)}</div>`;
    // Also mark the action status so chip updates
    const act = _currentRCA?.actions?.find(a => a.id === actionId);
    if (act) act.status = 'running';
  }

  /* ── Resolve incident ───────────────────────────────────────── */
  function _resolveFormHtml(inc) {
    if (inc.status === 'Resolved') return '';
    return `<div class="inv-section" style="margin-top:1.5rem;padding-top:1.25rem;border-top:1.5px solid var(--border);">
      <div class="inv-section-title"><span class="step-num">8</span> ✅ Resolve Incident</div>
      <div class="field" style="margin-bottom:0.75rem;">
        <label for="resolutionNote">Resolution note</label>
        <textarea id="resolutionNote" class="input" rows="3"
          placeholder="Describe what fixed the issue and any follow-up actions…"></textarea>
      </div>
      <button class="btn btn-primary" id="resolveIncidentBtn">✓ Mark as Resolved</button>
    </div>`;
  }

  function _resolvedHtml(inc) {
    return `<div class="auto-execute-box">
      ✅ Resolved ${Store.relativeTime(inc.updated_at)} — MTTR: <strong>${inc.mttr || '—'} min</strong>
    </div>
    ${inc.resolution ? `<div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-secondary);">${e(inc.resolution)}</div>` : ''}`;
  }

  async function _resolveIncident() {
    const note = document.getElementById('resolutionNote')?.value.trim() || 'Resolved.';
    const btn  = document.getElementById('resolveIncidentBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Resolving…'; }
    await API.resolveIncident(_currentId, note);
    App.closeModal('modal-investigation');
    App.toast('Incident resolved ✓', 'success');
    Dashboard.refresh();
    if (document.getElementById('page-incidents')?.classList.contains('active')) Incidents.refresh();
    if (document.getElementById('page-history')?.classList.contains('active'))   History.refresh();
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _riskLabel(s) { return s >= 80 ? 'Critical' : s >= 60 ? 'High' : s >= 34 ? 'Medium' : 'Low'; }
  function _delay(ms)    { return new Promise(r => setTimeout(r, ms)); }
  function e(s)          { return App.esc ? App.esc(s) : String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  return { open };
})();
