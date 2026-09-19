/* ================================================================
   REACT-X — demo.js  v3
   Live Demo: CSV → deterministic step-by-step AI resolution
   - Accurate per-severity KPI counters from CSV, updating live
   - 9-step pipeline banner: Detect→Correlate→Investigate→
     Priority & Impact→Decide→Approve→Remediate→Verify→Resolve
   - Grouped alert cluster view, root-cause highlight,
     downstream resolution chain, evidence & confidence shown
   No randomness. Fully deterministic from uploaded data.
   ================================================================ */

const LiveDemo = (() => {

  /* ── State ──────────────────────────────────────────────── */
  let _incidents   = [];
  let _stepIndex   = 0;
  let _playing     = false;
  let _timer       = null;
  let _steps       = [];
  let _resolvedIds = new Set();   // incident indices resolved so far
  let _detectedIds = new Set();   // incident indices whose ALERT_APPEAR started
  let _stepDelay   = 1600;

  /* ── Pipeline stage definitions (for the progress banner) ── */
  const PIPELINE_STAGES = [
    { id: 'detect',   label: 'Detect' },
    { id: 'correlate',label: 'Correlate' },
    { id: 'rca',      label: 'Investigate' },
    { id: 'impact',   label: 'Priority & Impact' },
    { id: 'decide',   label: 'Decide' },
    { id: 'approve',  label: 'Approve' },
    { id: 'remediate',label: 'Remediate' },
    { id: 'verify',   label: 'Verify' },
    { id: 'resolve',  label: 'Resolve' },
  ];

  // Map step types → pipeline stage id
  const STEP_STAGE_MAP = {
    INIT:         null,
    ALERT_APPEAR: 'detect',
    CORRELATE:    'correlate',
    RCA:          'rca',
    IMPACT:       'impact',
    REMEDIATION:  'decide',
    SIMULATE:     'approve',
    EXECUTE:      'remediate',
    VERIFY:       'verify',
    RESOLVE:      'resolve',
    SUMMARY:      'resolve',
  };

  /* ── Launch ─────────────────────────────────────────────── */
  function launch(incidents) {
    if (!incidents || incidents.length === 0) {
      _alert('No incidents to demo. Upload a CSV first.'); return;
    }
    _incidents   = _prepare(incidents);
    if (_incidents.length === 0) {
      _alert('No valid incidents found in the CSV.'); return;
    }
    _steps       = _buildSteps(_incidents);
    _resolvedIds = new Set();
    _detectedIds = new Set();
    _stepIndex   = 0;
    _playing     = false;

    document.getElementById('modal-live-demo').classList.add('open');
    setTimeout(() => {
      _buildPipelineBanner();
      _buildDots();
      _resetUI();
      _renderStep(0);
      setTimeout(() => play(), 500);
    }, 80);
  }

  function close()        { pause(); document.getElementById('modal-live-demo').classList.remove('open'); }
  function togglePlay()   { _playing ? pause() : play(); }

  function play() {
    _playing = true;
    _updatePlayBtn(true);
    _autoAdvance();
  }
  function pause() {
    _playing = false;
    _updatePlayBtn(false);
    if (_timer) { clearTimeout(_timer); _timer = null; }
  }
  function next() {
    pause();
    if (_stepIndex < _steps.length - 1) { _stepIndex++; _renderStep(_stepIndex); }
  }
  function prev() {
    pause();
    if (_stepIndex > 0) { _stepIndex--; _renderStep(_stepIndex); }
  }
  function restart() {
    pause();
    _resolvedIds = new Set();
    _detectedIds = new Set();
    _stepIndex   = 0;
    _resetUI();
    _buildDots();
    _renderStep(0);
    setTimeout(() => play(), 400);
  }

  /* ── Auto advance ───────────────────────────────────────── */
  function _autoAdvance() {
    if (!_playing || !_steps.length) return;
    const s     = _steps[_stepIndex];
    const delay = s ? Math.max(150, s.delay || _stepDelay) : _stepDelay;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      if (!_playing) return;
      if (_stepIndex < _steps.length - 1) {
        _stepIndex++;
        _renderStep(_stepIndex);
        _autoAdvance();
      } else {
        pause();
      }
    }, delay);
  }

  /* ── Prepare + sort incidents ───────────────────────────── */
  function _prepare(raw) {
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return [...raw]
      .map((i, idx) => ({
        ...i,
        _idx:        idx,
        title:       String(i.title || i.name || i.summary || i.message || i.alert || `Incident ${idx+1}`).trim().slice(0, 120),
        severity:    _normaliseSev(i.severity || ''),
        type:        i.type || 'Other',
        service:     String(i.service || i.component || i.host || i.system || '').trim(),
        environment: i.environment || 'Production',
        description: String(i.description || i.details || i.notes || i.text || i.error || '').trim(),
      }))
      .filter(i => i.title.length > 0)
      .sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));
  }

  function _normaliseSev(s) {
    const t = String(s).toLowerCase();
    if (/critical|p0|sev1|fatal|down/.test(t)) return 'Critical';
    if (/high|p1|sev2|error|urgent/.test(t))   return 'High';
    if (/medium|p2|sev3|warn/.test(t))          return 'Medium';
    if (/low|p3|sev4|info|minor/.test(t))       return 'Low';
    if (s === 'Critical' || s === 'High' || s === 'Medium' || s === 'Low') return s;
    return 'Medium';
  }

  /* ── Build all steps ────────────────────────────────────── */
  function _buildSteps(incidents) {
    const steps = [];
    steps.push({ type: 'INIT', label: 'Initialising pipeline…', delay: 500 });

    incidents.forEach((inc, incIdx) => {
      const analysis = _analyse(inc);
      const alerts   = _buildAlerts(inc, analysis);
      const needsApproval = analysis.riskScore >= 75;

      alerts.forEach((alert, aIdx) => {
        steps.push({
          type: 'ALERT_APPEAR', label: `Detecting: ${inc.title.slice(0,40)}`,
          incIdx, alertIdx: aIdx, alert, incident: inc, analysis, alerts,
          delay: aIdx === 0 ? 800 : 500,
        });
      });

      steps.push({ type:'CORRELATE',   label:`Correlating alerts — ${alerts.length} signals grouped`,     incIdx, incident:inc, analysis, alerts, delay:900  });
      steps.push({ type:'RCA',         label:`Investigating root cause — ${analysis.cat}`,               incIdx, incident:inc, analysis, alerts, delay:1100 });
      steps.push({ type:'IMPACT',      label:`Scoring priority & blast radius — ${inc.severity}`,        incIdx, incident:inc, analysis, alerts, delay:850  });
      steps.push({ type:'REMEDIATION', label:`Deciding remediation — ${analysis.steps[0]?.description?.slice(0,40)||''}`, incIdx, incident:inc, analysis, alerts, delay:900  });

      if (needsApproval) {
        steps.push({ type:'APPROVE', label:`Approval required — risk ${analysis.riskScore}/100`, incIdx, incident:inc, analysis, alerts, delay:1000 });
      }

      steps.push({ type:'EXECUTE',   label:`Remediating: ${analysis.steps[0]?.description?.slice(0,40)||''}`, incIdx, incident:inc, analysis, alerts, delay:950  });
      steps.push({ type:'VERIFY',    label:`Verifying resolution — checking metrics`,                           incIdx, incident:inc, analysis, alerts, delay:850  });
      steps.push({ type:'RESOLVE',   label:`✓ Resolved — ${inc.title.slice(0,50)}`,                           incIdx, incident:inc, analysis, alerts, delay:700  });
    });

    steps.push({ type:'SUMMARY', label:'✅ All incidents resolved', incidents, delay:400 });
    return steps;
  }

  /* ── Deterministic analysis from incident data ──────────── */
  function _analyse(inc) {
    const text = `${inc.title} ${inc.description} ${inc.service} ${inc.type}`.toLowerCase();

    const RULES = [
      { cat:'Database Performance',      kws:['cpu','query','connection','lock','database','postgres','db','slow query'],          conf:0.94, risk:90 },
      { cat:'Availability / Crash Loop', kws:['crash','oom','503','unavailable','restart','pod','memory','crashloop'],            conf:0.91, risk:88 },
      { cat:'Network / Timeout Storm',   kws:['timeout','econnreset','latency','gateway','retry','upstream','connection reset'],  conf:0.88, risk:75 },
      { cat:'Replication Lag',           kws:['replica','replication','stale','lag','disk','i/o','slave'],                        conf:0.86, risk:65 },
      { cat:'Security Attack',           kws:['brute','credential','unauthorized','attack','login','403','401'],                  conf:0.89, risk:80 },
      { cat:'Configuration Drift',       kws:['config','deploy','rollout','env','variable','secret','misconfigur'],               conf:0.84, risk:60 },
      { cat:'Message Queue Backlog',     kws:['kafka','queue','consumer','backlog','lag','topic','partition'],                    conf:0.87, risk:70 },
      { cat:'Cache Invalidation',        kws:['redis','cache','eviction','miss','ttl','memcache'],                               conf:0.85, risk:62 },
      { cat:'Payment / Data Failure',    kws:['payment','stripe','webhook','transaction','billing','checkout'],                  conf:0.90, risk:82 },
    ];

    let best = null, maxHits = 0;
    for (const r of RULES) {
      const hits = r.kws.filter(k => text.includes(k)).length;
      if (hits > maxHits) { best = r; maxHits = hits; }
    }
    // Require at least 1 keyword match; else fall back to type-based mapping
    if (!best || maxHits === 0) {
      const typeMap = {
        Performance: RULES[0], Availability: RULES[1], Network: RULES[2],
        Data: RULES[3], Security: RULES[4], Other: { cat:'Unknown / Deployment', conf:0.68, risk:50 },
      };
      best = typeMap[inc.type] || typeMap.Other;
    }

    const sev  = inc.severity || 'Medium';
    const sevRisk = { Critical:20, High:12, Medium:6, Low:2 }[sev] || 6;
    const riskScore = Math.min(100, (best.risk || 50) + sevRisk);

    // Deterministic SHAP: derive values from text keyword hits
    const kwHits = { cpu:0, memory:0, latency:0, error:0, network:0, deploy:0 };
    for (const k of Object.keys(kwHits)) if (text.includes(k)) kwHits[k] = 1;
    const shapFactors = [
      { feature: `${sev} severity signal`,           value: sev === 'Critical' ? 0.42 : sev === 'High' ? 0.31 : 0.18 },
      { feature: 'Error rate deviation',             value: kwHits.error   ? 0.30 : 0.15 },
      { feature: 'CPU / memory pressure',           value: (kwHits.cpu + kwHits.memory) * 0.14 + 0.08 },
      { feature: 'Service dependency chain',         value: 0.22 },
      { feature: 'Network / latency signal',         value: kwHits.latency || kwHits.network ? 0.19 : 0.06 },
      { feature: 'Recent deployment marker',         value: kwHits.deploy ? 0.17 : 0.05 },
      { feature: 'Historical pattern match',         value: -(best.conf - 0.6) },
    ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    const svcGraph = {
      'database-primary':   ['payment-service','order-service','user-service','auth-service'],
      'payment-api':        ['order-service','billing-service','notification-service'],
      'auth-service':       ['api-gateway','user-service'],
      'api-gateway':        ['order-service','payment-service','user-service'],
      'redis-cluster':      ['auth-service','cache-layer','user-service'],
      'notification-service':['order-service'],
      'order-service':      ['notification-service'],
    };
    const ds = svcGraph[inc.service] || [];
    const blastRadius = ds.map((svc, i) => ({
      service: svc, impact: Math.max(20, 90 - i * 22),
      level: i === 0 ? 'critical' : i === 1 ? 'high' : 'medium',
    }));

    const STEP_PLANS = {
      'Database Performance':      ['Kill blocking queries: pg_terminate_backend()', 'Expand connection pool to max_connections=1024', 'Add composite index on high-traffic columns', 'Set statement_timeout at application layer', 'Monitor CPU for 10 min to confirm recovery'],
      'Availability / Crash Loop': ['Increase container memory limit in manifest', 'Apply: kubectl rollout restart deployment', 'Heap-profile app to locate memory leak', 'Add memory alert at 75% of limit', 'Verify health-check endpoints → HTTP 200'],
      'Network / Timeout Storm':   ['Enable circuit breaker on upstream client', 'Add exponential backoff + jitter to retries', 'Set connect_timeout=2s, read_timeout=5s', 'Monitor error rate every 2 min until recovery', 'Open circuit breaker once upstream recovers'],
      'Replication Lag':           ['Check replica: SHOW SLAVE STATUS\\G', 'Stop competing batch export job', 'Restart: STOP SLAVE IO_THREAD; START', 'Monitor Seconds_Behind_Master < 5', 'Move batch jobs to dedicated read replica'],
      'Security Attack':           ['Block attacker IPs at WAF / firewall', 'Force password reset on targeted accounts', 'Lower rate-limiter to 10 failures/IP/min', 'Enable CAPTCHA after 3 failures', 'Subscribe to breach-database feed'],
      'Configuration Drift':       ['Identify changed key via CI/CD audit log', 'Roll back to last known-good config', 'Deploy corrected config to production', 'Verify metrics return to baseline', 'Add config-drift detection to pipeline'],
      'Message Queue Backlog':     ['Pause rolling deployment', 'Patch session.timeout.ms to 30000', 'Resume deployment with corrected config', 'Monitor consumer lag until < 100 msgs', 'Add consumer-lag alert at 10 000 messages'],
      'Cache Invalidation':        ['Identify TTL misconfiguration', 'Roll back session TTL to previous value', 'Flush stale keys from cache cluster', 'Monitor memory and hit rate', 'Add TTL validation to CI/CD'],
      'Payment / Data Failure':    ['Check webhook logs for 4xx errors', 'Rotate expired API key in secrets manager', 'Replay failed events from dead-letter queue', 'Verify payment processor confirms receipt', 'Add payment-failure runbook alert'],
      'Unknown / Deployment':      ['Review deploys in last 2 hrs via CI/CD', 'Check upstream health dashboards', 'Inspect error logs for first occurrence', 'Prepare rollback if change identified', 'Monitor 10 min post-fix before closing'],
    };

    const steps = (STEP_PLANS[best.cat] || STEP_PLANS['Unknown / Deployment'])
      .map((description, i) => ({ step: i + 1, description }));

    const RCA_TEXTS = {
      'Database Performance':      `Query lock chain on ${inc.service || 'the database'} caused connection pool exhaustion. ${sev} severity confirmed by slow-query and CPU metrics.`,
      'Availability / Crash Loop': `Pods for ${inc.service || 'the service'} entered CrashLoopBackOff due to gradual memory leak reaching container OOM limit.`,
      'Network / Timeout Storm':   `Unthrottled client retries to an upstream dependency created a self-reinforcing timeout storm, raising error rate to 38%.`,
      'Replication Lag':           `Disk I/O saturation from a concurrent batch export job stalled the replication I/O thread on the replica host.`,
      'Security Attack':           `Credential-stuffing attack (4 200 attempts from 18 IPs, 10 min). Rate-limiter threshold was too permissive for distributed patterns.`,
      'Configuration Drift':       `A configuration key in ${inc.service || 'the service'} was modified without a matching deployment, causing unexpected downstream behaviour.`,
      'Message Queue Backlog':     `Rolling deployment with insufficient session.timeout.ms caused repeated Kafka consumer group rebalances, growing backlog to 82 000.`,
      'Cache Invalidation':        `TTL misconfiguration in the last release caused immediate key expiry and a cache miss storm against the origin database.`,
      'Payment / Data Failure':    `Stripe webhook returning HTTP 400 due to an expired API key. 200+ unconfirmed orders in dead-letter queue.`,
      'Unknown / Deployment':      `Root cause under active investigation. Signals point to a recent deployment or config change as the trigger.`,
    };

    const impactMap = {
      Critical: { users:'All users',        revenue:'Critical', sla:'Breached' },
      High:     { users:'Many users',        revenue:'High',     sla:'At risk' },
      Medium:   { users:'Partial user base', revenue:'Medium',   sla:'At risk' },
      Low:      { users:'Minimal impact',    revenue:'Low',      sla:'OK' },
    };
    const impact = impactMap[sev] || impactMap.Medium;

    const simBefore = {
      'Error rate':    sev === 'Critical' ? '31.4%' : sev === 'High' ? '18.2%' : '8.1%',
      'p99 latency':   sev === 'Critical' ? '4 800 ms' : '1 200 ms',
      'Availability':  sev === 'Critical' ? '72%' : '88%',
    };
    const simAfter = { 'Error rate':'0.8%', 'p99 latency':'180 ms', 'Availability':'99.9%' };

    return {
      cat:         best.cat,
      confidence:  best.conf,
      riskScore,
      rcaText:     RCA_TEXTS[best.cat] || 'Root cause identified via AI classification.',
      shapFactors,
      blastRadius,
      steps,
      impact,
      simBefore,
      simAfter,
      needsApproval: riskScore >= 75,
    };
  }

  /* ── Build synthetic alert cluster for each incident ────── */
  function _buildAlerts(inc, analysis) {
    const SOURCES = ['Prometheus', 'Datadog', 'PagerDuty', 'CloudWatch', 'Grafana', 'New Relic'];
    const METRICS = {
      Critical: 'error_rate=31%', High: 'error_rate=18%',
      Medium:   'latency_p99=1200ms', Low: 'cpu=72%',
    };
    const sev = inc.severity || 'Medium';
    const alerts = [
      {
        source: SOURCES[0], sev, service: inc.service || 'unknown',
        msg:    inc.description ? inc.description.slice(0, 80) : inc.title,
        metric: METRICS[sev] || 'value=high',
        isRoot: true,
        id:     `root-${inc._idx}`,
      },
    ];
    // Add 1–2 downstream alerts from blast radius
    analysis.blastRadius.slice(0, 2).forEach((br, i) => {
      alerts.push({
        source:  SOURCES[(i + 1) % SOURCES.length],
        sev:     i === 0 ? (sev === 'Critical' ? 'High' : 'Medium') : 'Medium',
        service: br.service,
        msg:     `Elevated errors on ${br.service} — cascading from ${inc.service || 'upstream'}`,
        metric:  `latency_p99=${1100 + i * 700}ms`,
        isRoot:  false,
        id:      `ds-${inc._idx}-${i}`,
      });
    });
    return alerts;
  }

  /* ================================================================
     RENDER PIPELINE
  ================================================================ */
  function _renderStep(idx) {
    if (!_steps.length) return;
    const s = _steps[idx];
    if (!s) return;
    try {
      _updateProgress(idx);
      _updateStageLabel(s.label || '');
      _highlightPipelineStage(STEP_STAGE_MAP[s.type] || null);

      const renders = {
        INIT:        _rInit,
        ALERT_APPEAR:_rAlertAppear,
        CORRELATE:   _rCorrelate,
        RCA:         _rRCA,
        IMPACT:      _rImpact,
        REMEDIATION: _rRemediation,
        APPROVE:     _rApprove,
        EXECUTE:     _rExecute,
        VERIFY:      _rVerify,
        RESOLVE:     _rResolve,
        SUMMARY:     _rSummary,
      };
      if (renders[s.type]) renders[s.type](s);

      _updateKpiStrip(s);
      _updateNavButtons(idx);
    } catch (err) {
      console.error('[LiveDemo] step render error', idx, s.type, err);
    }
  }

  /* ── Step renderers ─────────────────────────────────────── */
  function _rInit() {
    _setHtml('demoAlertFeed',  '<div class="demo-empty-hint">Waiting for CSV alerts…</div>');
    _setHtml('demoClusterBox', '<div class="demo-empty-hint">Correlation pending…</div>');
    _setHtml('demoBlastList',  '<div class="demo-empty-hint">Impact analysis pending…</div>');
    _setHtml('demoShapList',   '');
    _setHtml('demoRemList',    '');
    _hide('demoShapTitle');
    _hide('demoRemTitle');
    _showWaiting('Pipeline ready — starting detection…');
  }

  function _rAlertAppear(s) {
    _detectedIds.add(s.incIdx);
    const feed = _$('demoAlertFeed');
    if (!feed) return;
    // Clear feed on the very first alert
    if (s.alertIdx === 0 && s.incIdx === 0) feed.innerHTML = '';

    const a   = s.alert;
    const dot = { Critical:'#ff4444', High:'#ff8800', Medium:'#b9ccdd', Low:'#5a9a5a' }[a.sev] || '#888';
    const el  = document.createElement('div');
    el.className = a.isRoot ? 'demo-alert-row demo-alert-root' : 'demo-alert-row';
    el.id        = `alert-el-${a.id}`;
    el.innerHTML = `
      <span class="demo-alert-dot" style="background:${dot};box-shadow:0 0 5px ${dot}"></span>
      <div class="demo-alert-body">
        <div class="demo-alert-title">${_esc(a.msg.slice(0,75))}</div>
        <div class="demo-alert-meta">
          <span class="demo-badge demo-badge-${a.sev.toLowerCase()}">${a.sev}</span>
          <span>${_esc(a.service||'—')}</span>
          <span class="demo-muted">${a.source}</span>
          <span class="demo-mono demo-muted">${a.metric}</span>
          ${a.isRoot ? '<span class="demo-root-tag">⚠ ROOT</span>' : '<span class="demo-downstream-tag">↳ downstream</span>'}
        </div>
      </div>`;
    feed.insertBefore(el, feed.firstChild);
    while (feed.children.length > 14) feed.removeChild(feed.lastChild);
    _log(`Alert #${s.alertIdx+1} detected: [${a.sev}] ${a.service} — ${a.metric}`, 'info');
  }

  function _rCorrelate(s) {
    const box = _$('demoClusterBox');
    if (!box) return;
    const alerts = s.alerts;
    const rootSvc = s.incident.service || 'unknown';
    box.innerHTML = `
      <div class="demo-cluster-header">
        <span class="demo-badge demo-badge-${s.incident.severity.toLowerCase()}">${s.incident.severity}</span>
        <span class="demo-cluster-title">${_esc(s.incident.title.slice(0,55))}</span>
        <span class="demo-muted">${alerts.length} alert${alerts.length>1?'s':''} grouped</span>
      </div>
      <div class="demo-cluster-body">
        ${alerts.map(a => `
          <div class="demo-cluster-item ${a.isRoot?'demo-cluster-root':'demo-cluster-ds'}">
            <div class="demo-cluster-item-left">
              <span class="demo-cluster-dot" style="background:${a.isRoot?'#ff4444':'#555'}"></span>
              <span class="demo-mono" style="font-size:0.75rem">${_esc(a.service||'—')}</span>
              <span class="demo-muted demo-mono" style="font-size:0.7rem">${a.metric}</span>
            </div>
            <div class="demo-cluster-item-right">
              ${a.isRoot
                ? '<span class="demo-root-tag">⚠ ROOT CAUSE</span>'
                : `<span class="demo-downstream-tag">↳ caused by ${_esc(rootSvc)}</span>`}
            </div>
          </div>`).join('')}
      </div>
      <div class="demo-cluster-score">
        Ensemble: Temporal + Topology + Semantic ·
        <strong style="color:#818cf8">${(s.analysis.confidence*100).toFixed(0)}% confidence</strong>
      </div>`;
    // Mark correlated alerts in the feed
    alerts.forEach(a => {
      const el = document.getElementById(`alert-el-${a.id}`);
      if (el) el.classList.add('demo-alert-correlated');
    });
    _log(`${alerts.length} alerts correlated → 1 incident cluster (${(s.analysis.confidence*100).toFixed(0)}% conf)`, 'ai');
  }

  function _rRCA(s) {
    const a = s.analysis;
    _showCard(`
      <div class="demo-step-badge demo-step-badge-rca">🔍 ROOT CAUSE IDENTIFIED</div>
      <div class="demo-rca-category">${_esc(a.cat)}</div>
      <div class="demo-rca-text">${_esc(a.rcaText)}</div>
      <div class="demo-conf-row">
        <span class="demo-muted" style="font-size:0.72rem">Confidence</span>
        <div class="demo-conf-bar"><div class="demo-conf-fill" style="width:${(a.confidence*100).toFixed(0)}%"></div></div>
        <span class="demo-conf-val">${(a.confidence*100).toFixed(0)}%</span>
      </div>
      <div class="demo-rca-meta-grid">
        <div class="demo-meta-chip"><div class="demo-meta-label">SLA</div><div class="demo-meta-val" style="color:${a.impact.sla==='Breached'?'#ff4444':a.impact.sla==='At risk'?'#ff8800':'#5a9a5a'}">${a.impact.sla}</div></div>
        <div class="demo-meta-chip"><div class="demo-meta-label">Users</div><div class="demo-meta-val">${a.impact.users}</div></div>
        <div class="demo-meta-chip"><div class="demo-meta-label">Revenue</div><div class="demo-meta-val">${a.impact.revenue}</div></div>
        <div class="demo-meta-chip"><div class="demo-meta-label">Risk</div><div class="demo-meta-val" style="color:${a.riskScore>=75?'#ff4444':a.riskScore>=50?'#ff8800':'#5a9a5a'}">${a.riskScore}/100</div></div>
      </div>`);

    _show('demoShapTitle');
    _setHtml('demoShapList', a.shapFactors.map(f => {
      const pct = Math.min(100, Math.round(Math.abs(f.value) / 0.45 * 100));
      const col = f.value >= 0 ? '#ff4444' : '#b9ccdd';
      return `<div class="demo-shap-row">
        <div class="demo-shap-label">${_esc(f.feature)}</div>
        <div class="demo-shap-track"><div class="demo-shap-fill" style="width:${pct}%;background:${col}"></div></div>
        <span class="demo-shap-val" style="color:${col}">${f.value>=0?'+':''}${f.value.toFixed(2)}</span>
      </div>`;
    }).join(''));

    _log(`RCA: "${a.cat}" — risk ${a.riskScore}/100, confidence ${(a.confidence*100).toFixed(0)}%`, 'ai');
  }

  function _rImpact(s) {
    const a = s.analysis;
    const sev = s.incident.severity;
    // Show priority badge + blast radius
    _showCard(`
      <div class="demo-step-badge demo-step-badge-impact">⚖ PRIORITY & IMPACT</div>
      <div class="demo-priority-row">
        <div class="demo-priority-badge demo-priority-${sev.toLowerCase()}">${sev}</div>
        <div class="demo-priority-meta">
          <div>Handling this incident <strong>first</strong> — ${sev} severity, risk ${a.riskScore}/100</div>
          <div class="demo-muted" style="font-size:0.75rem;margin-top:0.2rem">Fixing root cause will resolve ${Math.max(0, s.alerts.length - 1)} downstream alert${s.alerts.length > 2 ? 's' : ''}</div>
        </div>
      </div>
      <div class="demo-impact-evidence">
        ${s.analysis.shapFactors.slice(0,3).map(f=>`
          <div class="demo-evidence-item">
            <span class="demo-evidence-dot" style="background:${f.value>=0?'#ff4444':'#b9ccdd'}"></span>
            <span>${_esc(f.feature)}: <strong>${f.value>=0?'+':''}${f.value.toFixed(2)}</strong></span>
          </div>`).join('')}
      </div>`);

    _setHtml('demoBlastList',
      a.blastRadius.length === 0
        ? '<div class="demo-empty-hint">No downstream services in graph</div>'
        : a.blastRadius.map(b => `
            <div class="demo-blast-row">
              <div class="demo-blast-svc">${_esc(b.service)}</div>
              <div class="demo-blast-track"><div class="demo-blast-fill demo-blast-${b.level}" style="width:${b.impact}%"></div></div>
              <span class="demo-blast-pct">${b.impact}%</span>
              <span class="demo-badge demo-badge-${b.level==='critical'?'critical':b.level==='high'?'high':'medium'}">${b.level}</span>
            </div>`).join('')
    );
    _log(`Priority: ${sev} · Blast radius: ${a.blastRadius.length} downstream services`, 'warn');
  }

  function _rRemediation(s) {
    const a = s.analysis;
    _show('demoRemTitle');
    _setHtml('demoRemList', a.steps.map((st, i) => `
      <div class="demo-rem-step" id="rs-${s.incIdx}-${i}">
        <div class="demo-rem-num">${st.step}</div>
        <div class="demo-rem-text">${_esc(st.description)}</div>
      </div>`).join(''));
    _showCard(`
      <div class="demo-step-badge demo-step-badge-decide">🧠 DECIDE — REMEDIATION PLAN</div>
      <div class="demo-sim-grid">
        <div class="demo-sim-col">
          <div class="demo-sim-head">🔴 Current state</div>
          ${Object.entries(a.simBefore).map(([k,v])=>`<div class="demo-sim-row"><span>${k}</span><span class="demo-sim-before">${v}</span></div>`).join('')}
        </div>
        <div class="demo-sim-arrow">→</div>
        <div class="demo-sim-col">
          <div class="demo-sim-head">✅ Target state</div>
          ${Object.entries(a.simAfter).map(([k,v])=>`<div class="demo-sim-row"><span>${k}</span><span class="demo-sim-after">${v}</span></div>`).join('')}
        </div>
      </div>
      <div class="demo-sim-prob">Success probability: <strong>${Math.round(a.confidence*100)}%</strong>${a.needsApproval?' · <span style="color:#fbbf24">⚠ Approval required</span>':' · <span style="color:#5a9a5a">Auto-approved</span>'}</div>`);
    _log(`Plan: ${a.steps.length} steps · ${Math.round(a.confidence*100)}% success · ${a.needsApproval?'needs approval':'auto-approved'}`, 'ai');
  }

  function _rApprove(s) {
    const a = s.analysis;
    _showCard(`
      <div class="demo-step-badge demo-step-badge-approve">✅ APPROVED</div>
      <div class="demo-approve-text">Risk score ${a.riskScore}/100 exceeds auto-approve threshold.<br>Human approval obtained — proceeding to execution.</div>
      <div class="demo-approve-meta">
        <span class="demo-badge demo-badge-high">Risk: ${a.riskScore >= 80 ? 'HIGH' : 'MEDIUM'}</span>
        <span class="demo-muted">Approver: On-call lead</span>
        <span class="demo-mono demo-muted">${new Date().toLocaleTimeString('en-GB',{hour12:false})}</span>
      </div>`);
    _log(`Approval granted — risk ${a.riskScore}/100 required human review`, 'action');
  }

  function _rExecute(s) {
    const a    = s.analysis;
    const step = a.steps[0];
    // Tick first step
    const el = document.getElementById(`rs-${s.incIdx}-0`);
    if (el) el.classList.add('demo-rem-done');
    _showCard(`
      <div class="demo-step-badge demo-step-badge-execute">⚡ EXECUTING</div>
      <div class="demo-exec-action">${_esc(step?.description || 'Executing remediation action…')}</div>
      <div class="demo-exec-meta">
        <span class="demo-badge demo-badge-low">Risk: LOW</span>
        <span class="demo-muted">AI Engine</span>
        <span class="demo-mono demo-muted">${new Date().toLocaleTimeString('en-GB',{hour12:false})}</span>
      </div>
      <div class="demo-exec-progress"><div class="demo-exec-bar"></div></div>
      <div class="demo-exec-chain">
        <div class="demo-chain-label">Resolves downstream:</div>
        ${s.alerts.filter(a=>!a.isRoot).map(a=>`
          <div class="demo-chain-item">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5a9a5a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span class="demo-mono" style="font-size:0.7rem">${_esc(a.service)}</span>
            <span class="demo-muted" style="font-size:0.68rem">${a.metric}</span>
          </div>`).join('') || '<span class="demo-muted" style="font-size:0.72rem">No downstream alerts</span>'}
      </div>`);
    _log(`Executing: "${step?.description?.slice(0,60)}"`, 'action');
  }

  function _rVerify(s) {
    // Tick all remaining steps
    s.analysis.steps.forEach((_, i) => {
      if (i > 0) { const el = document.getElementById(`rs-${s.incIdx}-${i}`); if (el) el.classList.add('demo-rem-done'); }
    });
    _showCard(`
      <div class="demo-step-badge demo-step-badge-verify">🔄 VERIFYING</div>
      <div class="demo-verify-checks">
        ${['Error rate returning to baseline','p99 latency below threshold','Service health-checks passing','Downstream alerts clearing','No rollback triggered'].map((c,i)=>`
          <div class="demo-verify-row" style="animation-delay:${i*100}ms">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5a9a5a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span>${c}</span>
          </div>`).join('')}
      </div>`);
    // Fade downstream alerts (showing they are resolved by root fix)
    s.alerts.filter(a => !a.isRoot).forEach(a => {
      const el = document.getElementById(`alert-el-${a.id}`);
      if (el) el.classList.add('demo-alert-resolving');
    });
    _log('Verification passed — all metrics recovering', 'success');
  }

  function _rResolve(s) {
    _resolvedIds.add(s.incIdx);
    // Strike all alerts for this incident
    s.alerts.forEach(a => {
      const el = document.getElementById(`alert-el-${a.id}`);
      if (el) { el.classList.remove('demo-alert-resolving'); el.classList.add('demo-alert-resolved'); }
    });
    _showCard(`
      <div class="demo-resolve-icon">✅</div>
      <div class="demo-resolve-title">Incident Resolved</div>
      <div class="demo-resolve-sub">${_esc(s.incident.title.slice(0,60))}</div>
      <div class="demo-resolve-details">
        <div class="demo-resolve-row"><span class="demo-muted">MTTR</span><strong>${_mttr(s.incident.severity)}</strong></div>
        <div class="demo-resolve-row"><span class="demo-muted">Root cause</span><strong>${_esc(s.analysis.cat)}</strong></div>
        <div class="demo-resolve-row"><span class="demo-muted">Method</span><strong>AI Autonomous</strong></div>
        <div class="demo-resolve-row"><span class="demo-muted">Confidence</span><strong>${(s.analysis.confidence*100).toFixed(0)}%</strong></div>
        <div class="demo-resolve-row"><span class="demo-muted">Downstream cleared</span><strong>${s.alerts.filter(a=>!a.isRoot).length} alert${s.alerts.filter(a=>!a.isRoot).length!==1?'s':''}</strong></div>
      </div>`);
    _log(`✓ Resolved — MTTR: ${_mttr(s.incident.severity)} · ${s.alerts.filter(a=>!a.isRoot).length} downstream alerts auto-cleared`, 'success');
  }

  function _rSummary(s) {
    const total   = s.incidents.length;
    const sevCounts = _sevCounts();
    _show('demoSummaryBox');
    _setHtml('demoSummaryBox', `
      <div class="demo-summary-header">
        <span class="demo-summary-icon">🎉</span>
        <div>
          <div class="demo-summary-title">All Incidents Resolved</div>
          <div class="demo-summary-sub">REACT-X resolved ${total} incident${total>1?'s':''} autonomously using AI pipeline</div>
        </div>
      </div>
      <div class="demo-summary-stats">
        <div class="demo-summary-stat"><div class="demo-summary-stat-val">${total}</div><div class="demo-summary-stat-label">Total</div></div>
        <div class="demo-summary-stat"><div class="demo-summary-stat-val">${sevCounts.Critical}</div><div class="demo-summary-stat-label">Critical</div></div>
        <div class="demo-summary-stat"><div class="demo-summary-stat-val">${sevCounts.High}</div><div class="demo-summary-stat-label">High</div></div>
        <div class="demo-summary-stat"><div class="demo-summary-stat-val">0</div><div class="demo-summary-stat-label">Rollbacks</div></div>
        <div class="demo-summary-stat"><div class="demo-summary-stat-val">AI</div><div class="demo-summary-stat-label">Mode</div></div>
      </div>
      <div class="demo-summary-pipeline">
        ${['Detect','Correlate','Investigate','Priority','Decide','Approve','Remediate','Verify','Resolve'].map((st,i)=>`
          <div class="demo-pip-step demo-pip-done">
            <div class="demo-pip-num">${i+1}</div>
            <div class="demo-pip-label">${st}</div>
          </div>${i<8?'<div class="demo-pip-arrow">→</div>':''}`).join('')}
      </div>`);
    _log(`All ${total} incidents resolved. Zero rollbacks. Full audit trail saved.`, 'success');
  }

  /* ── KPI strip — accurate counts from CSV ───────────────── */
  function _updateKpiStrip(s) {
    const el = _$('demoKpiStrip');
    if (!el) return;
    const sc  = _sevCounts();
    const det = _detectedIds.size;   // incidents detected so far
    const res = _resolvedIds.size;   // incidents resolved so far
    const open = det - res;

    // Per-severity detected/resolved
    const detBySev = { Critical:0, High:0, Medium:0, Low:0 };
    _incidents.forEach((inc, i) => { if (_detectedIds.has(i)) detBySev[inc.severity] = (detBySev[inc.severity]||0) + 1; });
    const resBySev = { Critical:0, High:0, Medium:0, Low:0 };
    _incidents.forEach((inc, i) => { if (_resolvedIds.has(i)) resBySev[inc.severity] = (resBySev[inc.severity]||0) + 1; });

    el.innerHTML = `
      <div class="demo-kpi-item demo-kpi-red">
        <div class="demo-kpi-num">${detBySev.Critical}</div>
        <div class="demo-kpi-lbl">Critical</div>
        ${resBySev.Critical > 0 ? `<div class="demo-kpi-sub">${resBySev.Critical} ✓</div>` : ''}
      </div>
      <div class="demo-kpi-item demo-kpi-orange">
        <div class="demo-kpi-num">${detBySev.High}</div>
        <div class="demo-kpi-lbl">High</div>
        ${resBySev.High > 0 ? `<div class="demo-kpi-sub">${resBySev.High} ✓</div>` : ''}
      </div>
      <div class="demo-kpi-item demo-kpi-blue">
        <div class="demo-kpi-num">${detBySev.Medium}</div>
        <div class="demo-kpi-lbl">Medium</div>
        ${resBySev.Medium > 0 ? `<div class="demo-kpi-sub">${resBySev.Medium} ✓</div>` : ''}
      </div>
      <div class="demo-kpi-item demo-kpi-green2">
        <div class="demo-kpi-num">${detBySev.Low}</div>
        <div class="demo-kpi-lbl">Low</div>
        ${resBySev.Low > 0 ? `<div class="demo-kpi-sub">${resBySev.Low} ✓</div>` : ''}
      </div>
      <div class="demo-kpi-sep"></div>
      <div class="demo-kpi-item demo-kpi-yellow">
        <div class="demo-kpi-num">${open}</div>
        <div class="demo-kpi-lbl">Open</div>
      </div>
      <div class="demo-kpi-item demo-kpi-green">
        <div class="demo-kpi-num">${res}</div>
        <div class="demo-kpi-lbl">Resolved</div>
      </div>`;
  }

  /* ── Pipeline banner ─────────────────────────────────────── */
  function _buildPipelineBanner() {
    const banner = _$('demoPipelineBanner');
    if (!banner) return;
    banner.innerHTML = PIPELINE_STAGES.map(st => `
      <div class="demo-pip-stage" id="pipstage-${st.id}">
        <div class="demo-pip-stage-dot"></div>
        <div class="demo-pip-stage-label">${st.label}</div>
      </div>`).join('<div class="demo-pip-stage-arrow">→</div>');
  }

  function _highlightPipelineStage(stageId) {
    document.querySelectorAll('.demo-pip-stage').forEach(el => {
      el.classList.remove('demo-pip-stage-active', 'demo-pip-stage-done');
    });
    if (!stageId) return;
    const stageIdx = PIPELINE_STAGES.findIndex(s => s.id === stageId);
    PIPELINE_STAGES.forEach((s, i) => {
      const el = _$(`pipstage-${s.id}`);
      if (!el) return;
      if (i < stageIdx)  el.classList.add('demo-pip-stage-done');
      if (i === stageIdx) el.classList.add('demo-pip-stage-active');
    });
  }

  /* ── Progress bar + dots ─────────────────────────────────── */
  function _updateProgress(idx) {
    const pct  = _steps.length > 1 ? (idx / (_steps.length - 1)) * 100 : 0;
    const fill = _$('demoProgressFill');
    if (fill) fill.style.width = `${pct}%`;

    const dotsEl = _$('demoDots');
    if (!dotsEl) return;
    const dots = Array.from(dotsEl.querySelectorAll('.demo-dot'));
    const s = _steps[idx];
    const curInc = s ? (s.incIdx ?? (s.type === 'SUMMARY' ? _incidents.length : -1)) : -1;
    dots.forEach((d, i) => {
      d.classList.remove('demo-dot-done','demo-dot-active');
      if (i < curInc) d.classList.add('demo-dot-done');
      if (i === curInc || (i === _incidents.length && s?.type === 'SUMMARY')) d.classList.add('demo-dot-active');
    });
  }

  function _buildDots() {
    const c = _$('demoDots');
    if (!c) return;
    c.innerHTML = '';
    _incidents.forEach((inc, i) => {
      const d = document.createElement('div');
      d.className = `demo-dot demo-dot-sev-${inc.severity.toLowerCase()}`;
      d.title     = `#${i+1} ${inc.title} [${inc.severity}]`;
      d.onclick   = () => {
        pause();
        const ri = _steps.findIndex(s => s.type === 'RESOLVE' && s.incIdx === i);
        _stepIndex = ri >= 0 ? ri : 0;
        _renderStep(_stepIndex);
      };
      c.appendChild(d);
    });
    const sd = document.createElement('div');
    sd.className = 'demo-dot demo-dot-sev-summary';
    sd.title = 'Summary';
    sd.onclick = () => { pause(); _stepIndex = _steps.length-1; _renderStep(_stepIndex); };
    c.appendChild(sd);
  }

  /* ── Shared helpers ──────────────────────────────────────── */
  function _showCard(html) {
    const el = _$('demoAnalysisCard');
    if (el) el.innerHTML = `<div class="demo-analysis-inner">${html}</div>`;
  }
  function _showWaiting(msg) {
    const el = _$('demoAnalysisCard');
    if (el) el.innerHTML = `<div class="demo-analysis-waiting"><div class="demo-waiting-spinner"></div><p>${msg}</p></div>`;
  }
  function _log(msg, type) {
    const log = _$('demoLog');
    if (!log) return;
    const icons = { info:'ℹ', ai:'🤖', warn:'⚠', success:'✓', action:'⚡' };
    const row = document.createElement('div');
    row.className = `demo-log-row demo-log-${type}`;
    row.innerHTML = `<span class="demo-log-icon">${icons[type]||'·'}</span><span class="demo-log-text">${_esc(msg)}</span><span class="demo-log-time">${new Date().toLocaleTimeString('en-GB',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>`;
    log.insertBefore(row, log.firstChild);
    while (log.children.length > 35) log.removeChild(log.lastChild);
  }
  function _sevCounts() {
    const c = { Critical:0, High:0, Medium:0, Low:0 };
    _incidents.forEach(i => { if (c[i.severity] !== undefined) c[i.severity]++; });
    return c;
  }
  function _mttr(sev) {
    return { Critical:'21 min', High:'34 min', Medium:'18 min', Low:'9 min' }[sev] || '25 min';
  }
  function _updateStageLabel(txt) { const e = _$('demoStageLabel'); if (e) e.textContent = txt; }
  function _updateNavButtons(idx) {
    const p = _$('demoBtnPrev'), n = _$('demoBtnNext');
    if (p) p.disabled = idx === 0;
    if (n) n.disabled = idx >= _steps.length - 1;
  }
  function _updatePlayBtn(playing) {
    const pi = _$('demoIconPlay'), pa = _$('demoIconPause'), lb = _$('demoBtnPlayLabel');
    if (pi) pi.style.display = playing ? 'none' : '';
    if (pa) pa.style.display = playing ? '' : 'none';
    if (lb) lb.textContent = playing ? 'Pause' : 'Play';
  }
  function _resetUI() {
    _setHtml('demoLog',        '');
    _setHtml('demoAlertFeed',  '<div class="demo-empty-hint">Loading CSV alerts…</div>');
    _setHtml('demoClusterBox', '<div class="demo-empty-hint">Correlation pending…</div>');
    _setHtml('demoBlastList',  '<div class="demo-empty-hint">Impact analysis pending…</div>');
    _setHtml('demoShapList',   '');
    _setHtml('demoRemList',    '');
    _hide('demoShapTitle'); _hide('demoRemTitle'); _hide('demoSummaryBox');
    _showWaiting('Pipeline ready — starting detection…');
    _updatePlayBtn(false);
    _updateProgress(0);
    _updateKpiStrip(null);
    _highlightPipelineStage(null);
  }
  function _setHtml(id, html) { const e = _$(id); if (e) e.innerHTML = html; }
  function _$(id) { return document.getElementById(id); }
  function _show(id) { const e = _$(id); if (e) e.style.display = ''; }
  function _hide(id) { const e = _$(id); if (e) e.style.display = 'none'; }
  function _alert(msg) { if (typeof App !== 'undefined') App.toast(msg, 'warning', 4000); else alert(msg); }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { launch, close, togglePlay, play, pause, next, prev, restart };
})();
window.LiveDemo = LiveDemo;
