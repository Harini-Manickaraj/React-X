/* ================================================================
   demo.js  —  REACT-X  v3
   Live Demo: 9-stage pipeline.
   Stage 8 (Execute) calls Store.executeAction() for real.
   Stage 9 (Verify)  marks the incident Resolved in Store.
   High/Critical actions in stage 8 show real Approve/Reject UI
   that waits for a click before proceeding.
   ================================================================ */
const LiveDemo = (() => {

  /* ── Stage registry ─────────────────────────────────────────── */
  const STAGES = [
    { key:'detect',     label:'1 · Detect',          banner:'🔍 Stage 1 — Alert Detection: Monitoring signals streaming in from all services.' },
    { key:'correlate',  label:'2 · Correlate',        banner:'🔗 Stage 2 — Correlation: Grouping related alerts into one incident cluster.' },
    { key:'investigate',label:'3 · Investigate',      banner:'🧪 Stage 3 — Investigation: Collecting evidence from logs, metrics, and traces.' },
    { key:'root_cause', label:'4 · Root Cause',       banner:'🧠 Stage 4 — Root Cause Analysis: AI identifies the most likely failure point.' },
    { key:'impact',     label:'5 · Blast Radius',     banner:'💥 Stage 5 — Impact: Mapping all downstream services affected by this incident.' },
    { key:'plan',       label:'6 · Plan',             banner:'📋 Stage 6 — Remediation Plan: AI selects the best actions ranked by confidence.' },
    { key:'risk',       label:'7 · Risk Check',       banner:'⚖️ Stage 7 — Policy Gate: Low-risk auto-approved. High-risk requires human sign-off.' },
    { key:'execute',    label:'8 · Execute',          banner:'⚡ Stage 8 — Execution: Approved actions dispatched to the affected service.' },
    { key:'verify',     label:'9 · Verify & Resolve', banner:'✅ Stage 9 — Verification: Post-remediation metrics confirm resolution.' }
  ];

  /* ── State ───────────────────────────────────────────────────── */
  let _idx      = -1;
  let _playing  = false;
  let _timer    = null;
  let _incident = null;
  let _rca      = null;
  let _waitingForApproval = false;   // pauses auto-advance during approval UI

  /* ── Open / close / restart ─────────────────────────────────── */
  function open() {
    _idx = -1; _playing = false; _waitingForApproval = false;

    // Always create a fresh demo incident so the demo is self-contained
    // and doesn't depend on the state of real incidents
    _incident = _createDemoIncident();
    _rca      = Store.getRCA(_incident.id);

    _clearAll();
    _buildDots();
    _updateControls();
    _addLog('Demo loaded. Starting pipeline automatically…', '');
    App.openModal('modal-live-demo');
    // Auto-start after the modal renders
    setTimeout(() => { _play(); }, 600);
  }

  /* Create a fresh Critical incident for the demo run */
  function _createDemoIncident() {
    const templates = [
      {
        title: 'Demo: Database CPU spike — production-db-01',
        severity: 'Critical', type: 'Performance', service: 'production-db-01',
        environment: 'Production',
        description: 'CPU usage at 98% for 12 minutes. Queries timing out. Connection pool exhausted.'
      },
      {
        title: 'Demo: Auth service crash loop — auth-svc-prod',
        severity: 'High', type: 'Availability', service: 'auth-service',
        environment: 'Production',
        description: 'OOMKilled 7 times in 30 minutes after deployment v3.4.1.'
      },
      {
        title: 'Demo: Payment API latency elevated — p99 > 8s',
        severity: 'Critical', type: 'Performance', service: 'payment-api',
        environment: 'Production',
        description: 'p99 latency jumped from 200ms to 8.4s. Affecting checkout flow.'
      }
    ];
    // Pick a different template each time (round-robin)
    const tpl = templates[Math.floor(Math.random() * templates.length)];
    return Store.add({ ...tpl, status: 'Open' });
  }

  function close() { _pause(); App.closeModal('modal-live-demo'); }

  function restart() {
    _pause();
    _idx = -1; _waitingForApproval = false;
    _incident = _createDemoIncident();
    _rca      = Store.getRCA(_incident.id);
    _clearAll(); _buildDots(); _updateControls();
    const box = document.getElementById('demoSummaryBox');
    if (box) box.style.display = 'none';
    _addLog('Restarted. Starting pipeline…', '');
    setTimeout(() => { _play(); }, 400);
  }

  function _pickIncident() {
    return Store.getCritical()[0] || Store.getOpen()[0] || Store.getAll()[0];
  }

  /* ── Play / Pause ────────────────────────────────────────────── */
  function togglePlay() { _playing ? _pause() : _play(); }

  function _play() {
    if (_waitingForApproval) {
      App.toast('Waiting for your approval decision before continuing.', 'warning');
      return;
    }
    _playing = true;
    _updatePlayBtn();
    _scheduleNext();
  }

  function _pause() {
    _playing = false;
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _updatePlayBtn();
  }

  function _scheduleNext() {
    if (!_playing || _waitingForApproval) return;
    if (_idx >= STAGES.length - 1) { _pause(); _showFinalSummary(); return; }
    next();
  }

  /* ── Navigation ──────────────────────────────────────────────── */
  function next() {
    if (_waitingForApproval) { App.toast('Approve or reject the pending action first.', 'warning'); return; }
    if (_idx >= STAGES.length - 1) { _pause(); return; }
    _idx++;
    _runStage(_idx);
    if (_playing && !_waitingForApproval) {
      _timer = setTimeout(_scheduleNext, _stageDelay(_idx));
    }
  }

  function prev() {
    _pause();
    if (_idx <= 0) return;
    _idx--;
    _runStage(_idx);
  }

  function _jumpTo(i) { _pause(); _idx = i; _runStage(i); }

  function _stageDelay(i) {
    // Keep demo moving — total runtime ~30s for 9 stages
    if (i === 7) return 3500;   // execute (has real work + approval UI)
    if (i === 8) return 2500;   // verify
    return 2500;                // all other stages
  }

  /* ── Run a stage ─────────────────────────────────────────────── */
  function _runStage(i) {
    const stage = STAGES[i];
    _updateBanner(stage.banner);
    _updateDots();
    _updateProgress();
    document.getElementById('demoStageLabel').textContent = stage.label;
    _updateControls();

    switch (stage.key) {
      case 'detect':      _stageDetect();      break;
      case 'correlate':   _stageCorrelate();   break;
      case 'investigate': _stageInvestigate(); break;
      case 'root_cause':  _stageRCA();         break;
      case 'impact':      _stageImpact();      break;
      case 'plan':        _stagePlan();        break;
      case 'risk':        _stageRisk();        break;
      case 'execute':     _stageExecute();     break;
      case 'verify':      _stageVerify();      break;
    }
  }

  /* ── Stage implementations ─────────────────────────────────── */
  function _stageDetect() {
    _clearAlerts();
    const inc = _incident;
    const alerts = [
      { sev: inc.severity.toLowerCase(), text: inc.title,          svc: inc.service },
      { sev: 'high',   text: `CPU spike — ${inc.service||'app'}`,  svc: inc.service },
      { sev: 'medium', text: 'Response time degraded — api-gateway', svc: 'api-gateway' },
      { sev: 'low',    text: 'Health check latency elevated',       svc: 'monitor-01'  }
    ];
    alerts.forEach((a, i) => setTimeout(() => {
      _appendAlert(a);
      _log(`[${_ts()}] ${a.sev.toUpperCase()}: ${a.text}`, a.sev==='critical'?'err':'');
    }, i * 300));
    _kpis({ 'Alerts Received': alerts.length, 'Services Monitored': '14', 'Severity': inc.severity });
  }

  function _stageCorrelate() {
    const inc = _incident;
    const box = document.getElementById('demoClusterBox');
    if (box) box.innerHTML = `
      <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:0.3rem;">Incident Cluster</div>
      <div class="demo-cluster-item">${Store.severityBadge(inc.severity)} ${_e(inc.title.slice(0,50))}</div>
      <div class="demo-cluster-item" style="opacity:0.7;">${Store.severityBadge('High')} CPU spike — ${_e(inc.service||'app')}</div>
      <div class="demo-cluster-item" style="opacity:0.55;">${Store.severityBadge('Medium')} Response time — api-gateway</div>
      <div style="font-size:0.72rem;color:var(--risk-low);padding:0.3rem 0.4rem;font-weight:600;">✓ 3 alerts → 1 cluster</div>`;
    _log(`[${_ts()}] Correlation complete. Cluster formed.`, 'ok');
    _kpis({ 'Alerts Grouped': '3', 'Cluster': '1', 'Confidence': '91%' });
  }

  function _stageInvestigate() {
    const rca  = _rca;
    const card = document.getElementById('demoAnalysisCard');
    if (card) card.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;">Evidence Collected</div>
      ${(rca?.evidence||['Collecting…']).map(ev =>
        `<div class="demo-alert-item" style="margin-bottom:0.3rem;">• ${_e(ev)}</div>`).join('')}`;
    _log(`[${_ts()}] ${(rca?.evidence||[]).length} evidence signals collected.`, 'ok');
    _kpis({ 'Evidence Items': (rca?.evidence||[]).length, 'Signals Analysed': '847' });
  }

  function _stageRCA() {
    const rca  = _rca;
    const conf = rca ? Math.round((rca.confidence||0.85)*100) : 85;
    const card = document.getElementById('demoAnalysisCard');
    if (card) card.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;color:var(--accent);margin-bottom:0.4rem;">Root Cause Identified</div>
      <div style="font-size:0.8rem;color:var(--text);margin-bottom:0.4rem;">${_e(rca?.root_cause||'Analysing…')}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);">Confidence: <strong>${conf}%</strong></div>
      <div style="height:6px;background:var(--border);border-radius:3px;margin-top:0.3rem;overflow:hidden;">
        <div style="height:100%;width:${conf}%;background:var(--accent);border-radius:3px;"></div></div>`;
    const shapTitle = document.getElementById('demoShapTitle');
    const shapList  = document.getElementById('demoShapList');
    if (shapTitle) shapTitle.style.display = 'flex';
    if (shapList && rca?.shap_factors) {
      shapList.innerHTML = rca.shap_factors.slice(0,4).map(f => `
        <div class="shap-item" style="margin-bottom:0.35rem;">
          <div class="shap-label">
            <span style="font-size:0.74rem;">${_e(f.feature)}</span>
            <span style="font-size:0.74rem;">${Math.round(f.value*100)}%</span>
          </div>
          <div class="shap-bar"><div class="shap-fill" style="width:${Math.round(f.value*100)}%"></div></div>
        </div>`).join('');
    }
    _log(`[${_ts()}] Root cause: ${(rca?.root_cause||'').slice(0,60)}…`, 'ok');
    _kpis({ 'Root Cause': _incident.type, 'Confidence': conf + '%' });
  }

  function _stageImpact() {
    const blast = _rca?.blast_radius||[];
    const list  = document.getElementById('demoBlastList');
    const lc    = {critical:'var(--risk-high)',high:'#e65100',medium:'var(--risk-medium)',low:'var(--risk-low)'};
    if (list) list.innerHTML = blast.length ? blast.map(b=>`
      <div class="demo-blast-item">
        <span style="font-size:0.76rem;font-weight:600;">${_e(b.service)}</span>
        <span style="font-size:0.73rem;color:${lc[b.level]||'#888'};">${b.impact}% · ${b.level}</span>
      </div>`).join('') : '<div class="demo-empty-hint">No blast radius data.</div>';
    _log(`[${_ts()}] Blast radius: ${blast.length} services affected.`, blast.some(b=>b.level==='critical')?'err':'warn');
    _kpis({ 'Services Affected': blast.length, 'Max Impact': (blast[0]?.impact||0)+'%' });
  }

  function _stagePlan() {
    const remT = document.getElementById('demoRemTitle');
    const remL = document.getElementById('demoRemList');
    if (remT) remT.style.display = 'flex';
    if (remL && _rca?.resolution_steps) {
      remL.innerHTML = _rca.resolution_steps.slice(0,4).map((s,i)=>`
        <div class="demo-blast-item">
          <span style="background:var(--accent);color:#fff;width:18px;height:18px;border-radius:50%;
            font-size:0.68rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</span>
          <span style="font-size:0.76rem;">${_e(s)}</span>
        </div>`).join('');
    }
    _log(`[${_ts()}] ${(_rca?.resolution_steps||[]).length}-step plan ready.`, 'ok');
    _kpis({ 'Plan Steps': (_rca?.resolution_steps||[]).length, 'Actions Available': (_rca?.actions||[]).length });
  }

  function _stageRisk() {
    const actions = _rca?.actions||[];
    const autoOk  = actions.filter(a => Config.shouldAutoExecute(a.risk_level)).length;
    const needApp = actions.length - autoOk;
    const score   = _rca?.risk_score||40;
    const label   = score>=80?'Critical':score>=60?'High':score>=34?'Medium':'Low';
    const color   = score>=60?'var(--risk-high)':score>=34?'#d4a800':'var(--risk-low)';
    const card    = document.getElementById('demoAnalysisCard');
    if (card) card.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;">Risk Assessment</div>
      <div style="font-size:0.88rem;font-weight:700;color:${color};margin-bottom:0.3rem;">
        ${score>=60?'🔴':score>=34?'🟡':'🟢'} ${label} Risk — Score ${score}/100</div>
      <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-bottom:0.5rem;">
        <div style="height:100%;width:${score}%;background:${color};border-radius:4px;"></div></div>
      <div style="font-size:0.76rem;color:var(--risk-low);margin-bottom:0.25rem;">
        ✓ ${autoOk} action(s) pre-authorised</div>
      ${needApp>0?`<div style="font-size:0.76rem;color:var(--risk-high);">
        ⚠ ${needApp} action(s) require human approval</div>`:''}`;
    _log(`[${_ts()}] Policy gate: ${autoOk} auto-approved, ${needApp} need approval.`, needApp>0?'warn':'ok');
    _kpis({ 'Auto-Approved': autoOk, 'Needs Approval': needApp });
  }

  /* ── Stage 8 Execute — REAL execution ────────────────────────── */
  function _stageExecute() {
    const actions = _rca?.actions||[];
    const autoActions = actions.filter(a => Config.shouldAutoExecute(a.risk_level));
    const gatedActions= actions.filter(a => !Config.shouldAutoExecute(a.risk_level));

    /* Execute auto-approved actions for real */
    autoActions.forEach((act, i) => {
      setTimeout(() => {
        const result = Store.executeAction(act);
        const ai = _rca.actions.findIndex(a => a.id === act.id);
        if (ai !== -1) _rca.actions[ai] = result;
        _log(`[${_ts()}] ⚡ ${act.name}: ${result.verification_result?.passed ? 'SUCCESS' : 'FAILED'}`,
             result.verification_result?.passed ? 'ok' : 'err');
      }, i * 600);
    });

    const card = document.getElementById('demoAnalysisCard');
    if (card) {
      card.innerHTML = `
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin-bottom:0.5rem;">Executing Actions</div>
        ${autoActions.map(a=>`
          <div style="padding:0.4rem 0.5rem;background:var(--risk-low-bg);border-radius:4px;margin-bottom:0.3rem;font-size:0.76rem;">
            <span style="color:var(--risk-low);font-weight:700;">⚡ ${_e(a.name)}</span><br/>
            <span style="color:var(--text-muted);font-family:monospace;">${_e(a.command.slice(0,55))}…</span>
          </div>`).join('')}
        ${gatedActions.length ? _renderApprovalUI(gatedActions) : ''}`;
    }

    /* If there are gated actions — pause auto-advance until user decides */
    if (gatedActions.length) {
      _waitingForApproval = true;
      _pause();
      _log(`[${_ts()}] ⚠ ${gatedActions.length} action(s) blocked — waiting for human approval.`, 'warn');
    }

    _kpis({ 'Auto-Executed': autoActions.length, 'Pending Approval': gatedActions.length });
  }

  function _renderApprovalUI(gatedActions) {
    return gatedActions.map(a => `
      <div style="padding:0.5rem 0.6rem;background:var(--risk-high-bg);border:1px solid var(--risk-high-border);
        border-radius:4px;margin-bottom:0.4rem;font-size:0.76rem;" id="demo-gate-${a.id}">
        <div style="color:var(--risk-high);font-weight:700;margin-bottom:0.3rem;">
          ⚠ Human Approval Required — ${_e(a.name)} (${a.risk_level} risk)
        </div>
        <div style="font-family:monospace;color:var(--text-muted);margin-bottom:0.4rem;font-size:0.72rem;">
          ${_e(a.command.slice(0,60))}…</div>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-primary btn-sm"
            onclick="LiveDemo._demoApprove('${a.id}')">✓ Approve</button>
          <button class="btn btn-danger btn-sm"
            onclick="LiveDemo._demoReject('${a.id}')">✗ Reject</button>
        </div>
      </div>`).join('');
  }

  /* Called when user clicks Approve in demo stage 8 */
  function _demoApprove(actionId) {
    const act = _rca.actions.find(a => a.id === actionId);
    if (!act) return;

    const gate = document.getElementById('demo-gate-' + actionId);
    if (gate) gate.innerHTML = `<div style="color:var(--risk-low);font-weight:700;font-size:0.76rem;">
      ✓ Approved — executing ${_e(act.name)}…</div>`;

    const result = Store.executeAction(act);
    const ai = _rca.actions.findIndex(a => a.id === actionId);
    if (ai !== -1) _rca.actions[ai] = result;

    _log(`[${_ts()}] ✓ ${act.name} approved and executed — ${result.verification_result?.passed?'SUCCESS':'FAILED'}`,
         result.verification_result?.passed?'ok':'err');

    setTimeout(() => {
      if (gate) gate.innerHTML = `<div style="color:${result.verification_result?.passed?'var(--risk-low)':'var(--risk-high)'};
        font-weight:700;font-size:0.76rem;">
        ${result.verification_result?.passed?'✓ Executed successfully':'✗ Execution failed — rollback may be needed'}</div>`;
    }, 800);

    /* Check if all gated actions now have decisions */
    _checkApprovalsDone();
  }

  function _demoReject(actionId) {
    const act = _rca.actions.find(a => a.id === actionId);
    if (act) act.status = 'rejected';
    const gate = document.getElementById('demo-gate-' + actionId);
    if (gate) gate.innerHTML = `<div style="color:var(--risk-high);font-weight:700;font-size:0.76rem;">
      ✗ Rejected — ${act ? _e(act.name) : ''} will not be executed.</div>`;
    _log(`[${_ts()}] ✗ ${act?.name||'Action'} rejected by operator.`, 'warn');
    _checkApprovalsDone();
  }

  function _checkApprovalsDone() {
    const stillPending = (_rca.actions||[]).filter(a =>
      !Config.shouldAutoExecute(a.risk_level) &&
      a.status === 'awaiting_approval'
    );
    if (!stillPending.length) {
      _waitingForApproval = false;
      _updateControls();
      _log(`[${_ts()}] All approval decisions made. Ready to continue.`, 'ok');
      /* Resume auto-play if it was playing */
      if (_playing) {
        _timer = setTimeout(_scheduleNext, 1500);
      }
    }
  }

  /* ── Stage 9 Verify — REAL resolution ───────────────────────── */
  function _stageVerify() {
    const card = document.getElementById('demoAnalysisCard');

    /* Check if any executed action passed verification */
    const actions  = _rca?.actions||[];
    const executed = actions.filter(a => a.status === 'completed');
    const passed   = executed.filter(a => a.verification_result?.passed);
    const allGood  = executed.length > 0 && passed.length > 0;

    if (card) card.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;
        color:${allGood?'var(--risk-low)':'var(--risk-high)'};margin-bottom:0.5rem;">
        ${allGood ? '✅ Verification Passed' : '⚠ Verification Issues Detected'}</div>
      <div style="font-size:0.8rem;color:var(--text);margin-bottom:0.4rem;">
        ${allGood
          ? 'Post-remediation metrics returned to normal baseline.'
          : 'Some actions failed or metrics have not fully recovered.'}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);">
        CPU: 22% ↓ &nbsp; Latency: 180ms ↓ &nbsp; Error rate: 0.1% ↓</div>`;

    /* Actually mark the incident as Resolved in Store */
    if (allGood && _incident) {
      const mttr = _estimateMTTR(_incident);
      Store.update(_incident.id, {
        status: 'Resolved',
        resolution: `Resolved via Live Demo pipeline. Actions executed: ${passed.map(a=>a.name).join(', ')}.`,
        mttr
      });
      _log(`[${_ts()}] ✓ Incident marked Resolved. MTTR: ${mttr} min.`, 'ok');
    } else {
      _log(`[${_ts()}] ⚠ Partial resolution — manual follow-up may be needed.`, 'warn');
    }

    _log(`[${_ts()}] Audit log written.`, 'ok');
    _kpis({ 'Status': allGood ? 'Resolved ✓' : 'Partial', 'MTTR': _estimateMTTR(_incident) + ' min' });

    /* Refresh dashboard so KPI cards update */
    if (typeof Dashboard !== 'undefined') Dashboard.refresh();
  }

  function _estimateMTTR(inc) {
    if (!inc) return 20;
    return inc.mttr || ({ Critical:22, High:35, Medium:18, Low:10 }[inc.severity] || 20);
  }

  /* ── Final summary ───────────────────────────────────────────── */
  function _showFinalSummary() {
    const box = document.getElementById('demoSummaryBox');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `✅ Pipeline complete — all 9 stages finished. Incident resolved in ~${_estimateMTTR(_incident)} min. Dashboard KPIs updated.`;
    }
    _log(`[${_ts()}] === DEMO COMPLETE ===`, 'ok');
  }

  /* ── UI helpers ──────────────────────────────────────────────── */
  function _buildDots() {
    const c = document.getElementById('demoDots');
    if (!c) return;
    c.innerHTML = STAGES.map((s,i) =>
      `<div class="demo-stage-dot" id="dot-${i}" title="${s.label}" onclick="LiveDemo._jumpTo(${i})"></div>`
    ).join('');
  }

  function _updateDots() {
    STAGES.forEach((_,i) => {
      const d = document.getElementById('dot-'+i);
      if (d) d.className = 'demo-stage-dot'+(i<_idx?' done':i===_idx?' active':'');
    });
  }

  function _updateProgress() {
    const f = document.getElementById('demoProgressFill');
    if (f) f.style.width = `${((_idx+1)/STAGES.length)*100}%`;
  }

  function _updateBanner(t) {
    const b = document.getElementById('demoPipelineBanner');
    if (b) b.textContent = t;
  }

  function _updatePlayBtn() {
    const ip = document.getElementById('demoIconPlay');
    const ipa= document.getElementById('demoIconPause');
    const lb = document.getElementById('demoBtnPlayLabel');
    if (ip)  ip.style.display  = _playing ? 'none' : '';
    if (ipa) ipa.style.display = _playing ? '' : 'none';
    if (lb)  lb.textContent = _playing ? 'Pause' : 'Play';
  }

  function _updateControls() {
    const p = document.getElementById('demoBtnPrev');
    const n = document.getElementById('demoBtnNext');
    if (p) p.disabled = _idx <= 0;
    if (n) n.disabled = _idx >= STAGES.length - 1 || _waitingForApproval;
    _updatePlayBtn();
  }

  function _clearAll() {
    _clearAlerts();
    [['demoClusterBox','<div class="demo-empty-hint">Waiting for alerts…</div>'],
     ['demoAnalysisCard',`<div class="demo-analysis-waiting"><div class="demo-waiting-spinner"></div><p>Press ▶ Play to begin</p></div>`],
     ['demoShapList',''],['demoBlastList',''],['demoRemList',''],['demoLog',''],['demoKpiStrip','']
    ].forEach(([id,html]) => { const el=document.getElementById(id); if(el) el.innerHTML=html; });
    ['demoShapTitle','demoRemTitle'].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display='none';
    });
    const banner = document.getElementById('demoPipelineBanner'); if(banner) banner.textContent='';
    const lbl    = document.getElementById('demoStageLabel');     if(lbl)    lbl.textContent='Ready';
    const fill   = document.getElementById('demoProgressFill');   if(fill)   fill.style.width='0%';
    _updateDots();
  }

  function _clearAlerts() {
    const f = document.getElementById('demoAlertFeed'); if(f) f.innerHTML='';
  }

  function _appendAlert({ sev, text, svc }) {
    const f = document.getElementById('demoAlertFeed'); if(!f) return;
    const d = document.createElement('div');
    d.className = `demo-alert-item ${sev}`;
    d.innerHTML = `<strong>${_e(svc||'system')}</strong> — ${_e(text)}`;
    f.appendChild(d);
    f.scrollTop = f.scrollHeight;
  }

  function _log(line, type) {
    const log = document.getElementById('demoLog'); if(!log) return;
    const d = document.createElement('div');
    d.className = `demo-log-line${type?' '+type:''}`;
    d.textContent = line;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function _kpis(obj) {
    const s = document.getElementById('demoKpiStrip'); if(!s) return;
    s.innerHTML = Object.entries(obj).map(([k,v]) =>
      `<div class="demo-kpi-item"><span class="demo-kpi-key">${k}:</span><span class="demo-kpi-val">${v}</span></div>`
    ).join('');
  }

  function _ts() {
    return new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }

  function _e(s) { return App.esc ? App.esc(s) : String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { open, close, restart, togglePlay, next, prev, _jumpTo, _demoApprove, _demoReject };
})();
