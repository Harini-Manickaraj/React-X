/* ================================================================
   agent.js  —  REACT-X
   AI Agent Execution Viewer modal.
   Shows a step-by-step animated log of the autonomous resolution
   pipeline — Detect → Investigate → RCA → Plan → Risk → Execute
   → Verify → Resolve — with live status updates.
   ================================================================ */
const AgentViewer = (() => {

  let _timer   = null;
  let _stepIdx = 0;
  let _steps   = [];

  /* ── Open the agent viewer for an incident ──────────────────── */
  function open(incidentId) {
    const inc = Store.getById(incidentId);
    if (!inc) return;

    // Build steps from the incident + its RCA (if already run)
    _steps   = _buildSteps(inc);
    _stepIdx = 0;

    const header = document.getElementById('agentModalHeader');
    const title  = document.getElementById('agentModalTitle');
    const body   = document.getElementById('agentModalBody');
    if (!body) return;

    if (header) header.style.borderLeft = '4px solid var(--accent)';
    if (title)  title.textContent = `AI Agent — ${inc.title.length > 50 ? inc.title.slice(0,50)+'…' : inc.title}`;

    body.innerHTML = `
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">
          Autonomous resolution pipeline running for <strong>${_esc(inc.service || 'service')}</strong>
          &nbsp;·&nbsp; ${Store.severityBadge(inc.severity)}
        </div>
        <div class="agent-step-list" id="agentStepList"></div>
      </div>
      <div id="agentSummary" style="display:none;"></div>`;

    App.openModal('modal-agent');
    _runSteps();
  }

  /* ── Build step definitions ─────────────────────────────────── */
  function _buildSteps(inc) {
    const rca  = inc._rca || Store.getRCA(inc.id);
    const svc  = inc.service || 'app';
    const actions = (rca?.actions || []).slice(0, 2); // show up to 2 actions

    const steps = [
      {
        icon: '🔍', title: 'Alert Detected',
        detail: `New ${inc.severity} incident received: "${inc.title.slice(0,60)}"`,
        delay: 600
      },
      {
        icon: '📡', title: 'Normalising Signal',
        detail: `Classified as ${inc.type} · Service: ${svc} · Environment: ${inc.environment || 'Production'}`,
        delay: 500
      },
      {
        icon: '🔗', title: 'Correlating Alerts',
        detail: `Topology + temporal scoring complete. Incident cluster formed.`,
        delay: 700
      },
      {
        icon: '🧪', title: 'Running Root Cause Analysis',
        detail: rca ? `Root cause identified (${Math.round((rca.confidence||0.85)*100)}% confidence): ${rca.root_cause?.slice(0,80)}…` : 'Analysing evidence…',
        delay: 1100
      },
      {
        icon: '💥', title: 'Mapping Blast Radius',
        detail: rca?.blast_radius?.length
          ? `${rca.blast_radius.length} downstream services affected. Highest impact: ${rca.blast_radius[0]?.service} (${rca.blast_radius[0]?.impact}%).`
          : 'Mapping downstream dependencies…',
        delay: 700
      },
      {
        icon: '📋', title: 'Generating Resolution Plan',
        detail: rca?.resolution_steps?.length
          ? `${rca.resolution_steps.length}-step remediation plan ready.`
          : 'Selecting remediation actions…',
        delay: 600
      },
      {
        icon: '⚖️', title: 'Risk Assessment',
        detail: rca
          ? `Risk score: ${rca.risk_score}/100. ${actions.filter(a=>a.risk_level==='Low').length} pre-authorised, ${actions.filter(a=>a.risk_level!=='Low').length} require approval.`
          : 'Evaluating action risk levels…',
        delay: 500
      },
      ...actions.map(act => {
        const isAuto = act.risk_level === 'Low';
        return {
          icon: isAuto ? '⚡' : '⚠️',
          title: isAuto ? `Auto-Executing: ${act.name}` : `Awaiting Approval: ${act.name}`,
          detail: isAuto
            ? `Low risk — running automatically. Command: ${act.command?.slice(0,60)}…`
            : `${act.risk_level} risk — blocked until a human approves this action.`,
          delay: isAuto ? 1400 : 400,
          isApproval: !isAuto
        };
      }),
      {
        icon: '🔍', title: 'Verifying Resolution',
        detail: 'Sampling post-remediation metrics and comparing to baseline…',
        delay: 1000
      },
      {
        icon: '✅', title: 'Incident Resolved',
        detail: `Pipeline complete. MTTR: ${_randomMTTR(inc)} min. Full audit log written.`,
        delay: 600,
        isFinal: true
      }
    ];

    return steps;
  }

  function _randomMTTR(inc) {
    if (inc.mttr) return inc.mttr;
    const base = { Critical: 22, High: 35, Medium: 18, Low: 10 }[inc.severity] || 20;
    return base + Math.floor(Math.random() * 10);
  }

  /* ── Animate steps one by one ───────────────────────────────── */
  function _runSteps() {
    if (_stepIdx >= _steps.length) { _showSummary(); return; }

    const step     = _steps[_stepIdx];
    const list     = document.getElementById('agentStepList');
    if (!list) return;

    const el = document.createElement('div');
    el.className = `agent-step running`;
    el.id = `agent-step-${_stepIdx}`;
    el.innerHTML = `
      <div class="agent-step-icon">${step.icon}</div>
      <div class="agent-step-body">
        <div class="agent-step-title">${_esc(step.title)}</div>
        <div class="agent-step-detail">${_esc(step.detail)}</div>
        ${step.isApproval ? `<div class="approval-required-box" style="margin-top:0.4rem;font-size:0.76rem;">⚠ Waiting for human approval</div>` : ''}
      </div>
      <div class="agent-step-time">
        <span class="spinner"></span>
      </div>`;
    list.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    _timer = setTimeout(() => {
      // Mark step done
      el.className = `agent-step ${step.isApproval ? 'error' : 'done'}`;
      el.querySelector('.agent-step-time').innerHTML =
        `<span style="font-size:0.72rem;color:var(--text-muted);">${_ts()}</span>`;

      _stepIdx++;
      _timer = setTimeout(() => _runSteps(), 150);
    }, step.delay || 700);
  }

  function _showSummary() {
    const summary = document.getElementById('agentSummary');
    if (!summary) return;
    summary.style.display = 'block';
    summary.innerHTML = `
      <div class="demo-summary-box" style="font-size:0.85rem;">
        ✅ Autonomous pipeline complete — all applicable actions executed. 
        Check the Investigation view for full results and to approve any pending high-risk actions.
      </div>
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;">
        <button class="btn btn-ghost btn-sm" onclick="App.closeModal('modal-agent')">Close</button>
      </div>`;
  }

  function _ts() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function _esc(str) { return App.esc ? App.esc(str) : String(str || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* ── Cleanup on modal close ─────────────────────────────────── */
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('modal-close')) {
      if (_timer) { clearTimeout(_timer); _timer = null; }
    }
  });

  return { open };
})();
