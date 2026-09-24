/* ================================================================
   mock-data.js  —  REACT-X
   Central in-memory data store + seed incidents + live signal gen.
   All modules read/write through Store.*
   ================================================================ */
const Store = (() => {

  /* ── helpers ─────────────────────────────────────────────────── */
  function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function ago(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
           ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  /* ── AI action templates ─────────────────────────────────────── */
  const ACTION_TEMPLATES = {
    'disk_check': {
      name: 'Check Disk Usage',
      command: 'df -h / && du -sh /var/log/*',
      rollback: null,
      description: 'Scan disk usage across volumes and identify largest consumers.'
    },
    'log_cleanup': {
      name: 'Clean Temporary Logs',
      command: 'find /var/log -name "*.log" -mtime +7 -delete && journalctl --vacuum-time=7d',
      rollback: null,
      description: 'Remove log files older than 7 days to reclaim disk space.'
    },
    'service_restart': {
      name: 'Restart Service',
      command: 'systemctl restart {service} && systemctl status {service}',
      rollback: 'systemctl stop {service}',
      description: 'Gracefully restart the affected service and verify it comes back healthy.'
    },
    'scale_up': {
      name: 'Scale Up Service',
      command: 'kubectl scale deployment/{service} --replicas=4',
      rollback: 'kubectl scale deployment/{service} --replicas=2',
      description: 'Increase pod count to absorb elevated load and reduce latency.'
    },
    'rollback_deployment': {
      name: 'Rollback Deployment',
      command: 'kubectl rollout undo deployment/{service}',
      rollback: 'kubectl rollout undo deployment/{service} --to-revision=0',
      description: 'Roll the deployment back to the previous known-good revision.'
    },
    'db_connection_pool': {
      name: 'Expand Connection Pool',
      command: 'psql -c "ALTER SYSTEM SET max_connections = 200;" && pg_reload_conf()',
      rollback: 'psql -c "ALTER SYSTEM SET max_connections = 100;" && pg_reload_conf()',
      description: 'Increase the database connection pool to resolve connection exhaustion.'
    }
  };

  /* ── RCA templates keyed by incident type ───────────────────── */
  const RCA_TEMPLATES = {
    'Performance': {
      root_cause: 'CPU and memory saturation caused by unbounded query execution on the primary database replica.',
      confidence: 0.91,
      evidence: [
        'CPU usage peaked at 98% for 12+ minutes',
        'Query execution time exceeded 30 seconds on 847 requests',
        'Connection pool exhausted — 200/200 slots occupied',
        'No indexes found on the frequently queried columns'
      ],
      shap_factors: [
        { feature: 'CPU utilisation', value: 0.87, direction: 'positive' },
        { feature: 'Query count spike', value: 0.74, direction: 'positive' },
        { feature: 'Missing index', value: 0.68, direction: 'positive' },
        { feature: 'Connection pool size', value: 0.52, direction: 'positive' }
      ],
      actions: ['disk_check', 'db_connection_pool', 'service_restart'],
      action_risks: ['Low', 'Medium', 'Low'],
      plan: [
        'Run disk check to verify storage capacity',
        'Expand connection pool to 200 connections',
        'Restart the database service to clear stale connections',
        'Add index on the hot query column',
        'Monitor CPU usage over the next 15 minutes'
      ]
    },
    'Availability': {
      root_cause: 'Service crash-loop triggered by an out-of-memory event after a recent deployment with an unconstrained worker thread pool.',
      confidence: 0.88,
      evidence: [
        'OOMKilled events logged in container runtime',
        'Service restarted 7 times in the past 30 minutes',
        'Memory limit of 512 MB exceeded — peak at 680 MB',
        'Deployment v3.4.1 pushed 45 minutes before incident'
      ],
      shap_factors: [
        { feature: 'Restart count', value: 0.92, direction: 'positive' },
        { feature: 'Memory over-limit', value: 0.83, direction: 'positive' },
        { feature: 'Recent deployment', value: 0.71, direction: 'positive' },
        { feature: 'Pod age', value: 0.44, direction: 'negative' }
      ],
      actions: ['service_restart', 'rollback_deployment', 'log_cleanup'],
      action_risks: ['Low', 'High', 'Low'],
      plan: [
        'Restart the affected service pod',
        'If restart fails, roll back to previous deployment',
        'Clean up accumulated logs to free memory pressure',
        'Set memory limit to 1 GB in deployment manifest',
        'Verify service health via readiness probe'
      ]
    },
    'Network': {
      root_cause: 'Intermittent DNS resolution failures caused by stale cache entries after a network policy update.',
      confidence: 0.79,
      evidence: [
        'DNS resolution latency increased to 2400 ms (normal: 12 ms)',
        'Network policy updated 2 hours ago',
        'Packet loss at 8.3% on inter-service communication',
        '14 timeout errors logged per minute'
      ],
      shap_factors: [
        { feature: 'DNS latency', value: 0.81, direction: 'positive' },
        { feature: 'Packet loss rate', value: 0.66, direction: 'positive' },
        { feature: 'Policy change age', value: 0.55, direction: 'positive' },
        { feature: 'Retry rate', value: 0.42, direction: 'positive' }
      ],
      actions: ['service_restart', 'log_cleanup'],
      action_risks: ['Low', 'Low'],
      plan: [
        'Flush DNS cache on all affected nodes',
        'Restart the network-dependent service',
        'Review and revert the recent network policy change',
        'Monitor packet loss rate until below 0.5%'
      ]
    },
    'Security': {
      root_cause: 'Brute-force attack on the authentication endpoint causing account lockouts and elevated error rates.',
      confidence: 0.95,
      evidence: [
        '4,200 failed login attempts in 10 minutes from 3 IPs',
        'Auth service error rate at 67% (normal: 0.2%)',
        'IPs flagged in threat intelligence feed',
        'JWT signing key not rotated in 180 days'
      ],
      shap_factors: [
        { feature: 'Failed auth rate', value: 0.94, direction: 'positive' },
        { feature: 'Source IP reputation', value: 0.88, direction: 'positive' },
        { feature: 'Key age', value: 0.61, direction: 'positive' },
        { feature: 'Request volume', value: 0.57, direction: 'positive' }
      ],
      actions: ['service_restart'],
      action_risks: ['Medium'],
      plan: [
        'Rate-limit auth endpoint to 10 requests/minute per IP',
        'Block the 3 offending IP addresses at the firewall',
        'Rotate JWT signing key',
        'Restart auth service to purge in-memory session state',
        'Enable CAPTCHA for repeated failed logins'
      ]
    },
    'Data': {
      root_cause: 'Database replica lag exceeded 45 seconds due to a large bulk migration job running concurrently with peak read traffic.',
      confidence: 0.83,
      evidence: [
        'Replica lag: 47 seconds (threshold: 5 seconds)',
        'Bulk migration job started at 14:30 UTC',
        'Read traffic 340% of normal baseline',
        'Write-ahead log (WAL) accumulation rate: 2.4 GB/hour'
      ],
      shap_factors: [
        { feature: 'Replica lag seconds', value: 0.89, direction: 'positive' },
        { feature: 'WAL accumulation', value: 0.72, direction: 'positive' },
        { feature: 'Migration job active', value: 0.65, direction: 'positive' },
        { feature: 'Read traffic spike', value: 0.58, direction: 'positive' }
      ],
      actions: ['scale_up', 'db_connection_pool'],
      action_risks: ['Medium', 'Medium'],
      plan: [
        'Pause the bulk migration job immediately',
        'Scale up read replicas to handle traffic',
        'Expand connection pool to reduce queuing',
        'Reschedule migration to off-peak hours',
        'Monitor replica lag until below 2 seconds'
      ]
    },
    'Other': {
      root_cause: 'Misconfigured health-check timeout caused the load balancer to mark healthy instances as unhealthy, triggering cascading failures.',
      confidence: 0.76,
      evidence: [
        'Load balancer health check timeout set to 1 second (service needs 3 seconds to respond)',
        '60% of healthy instances marked unhealthy',
        'Remaining instances overwhelmed with redirected traffic',
        'Config change deployed 20 minutes before incident'
      ],
      shap_factors: [
        { feature: 'Health-check timeout', value: 0.82, direction: 'positive' },
        { feature: 'Instance failure rate', value: 0.75, direction: 'positive' },
        { feature: 'Config change recency', value: 0.63, direction: 'positive' },
        { feature: 'Traffic redistribution', value: 0.51, direction: 'positive' }
      ],
      actions: ['service_restart', 'log_cleanup'],
      action_risks: ['Low', 'Low'],
      plan: [
        'Update health-check timeout to 5 seconds',
        'Force re-evaluation of all instances by the load balancer',
        'Restart services still marked unhealthy',
        'Clean old health check logs',
        'Set alert threshold for health-check failure rate > 10%'
      ]
    }
  };

  /* ── blast radius by type ─────────────────────────────────────── */
  const BLAST_RADIUS = {
    'Performance':  [
      { service: 'api-gateway',     impact: 85, level: 'critical' },
      { service: 'payment-service', impact: 72, level: 'high' },
      { service: 'user-service',    impact: 45, level: 'medium' }
    ],
    'Availability': [
      { service: 'api-gateway',     impact: 90, level: 'critical' },
      { service: 'frontend-web',    impact: 80, level: 'critical' },
      { service: 'notification-svc',impact: 35, level: 'low' }
    ],
    'Network':      [
      { service: 'auth-service',    impact: 60, level: 'high' },
      { service: 'api-gateway',     impact: 55, level: 'high' },
      { service: 'session-store',   impact: 30, level: 'medium' }
    ],
    'Security':     [
      { service: 'auth-service',    impact: 95, level: 'critical' },
      { service: 'user-service',    impact: 70, level: 'high' },
      { service: 'session-store',   impact: 65, level: 'high' }
    ],
    'Data':         [
      { service: 'primary-db',      impact: 80, level: 'critical' },
      { service: 'reporting-svc',   impact: 60, level: 'high' },
      { service: 'analytics-api',   impact: 40, level: 'medium' }
    ],
    'Other':        [
      { service: 'api-gateway',     impact: 50, level: 'medium' },
      { service: 'health-checker',  impact: 40, level: 'medium' }
    ]
  };

  /* ── 13 seed incidents (7 open/investigating, 6 resolved) ─────── */
  const _seedIncidents = [
    {
      id: uid(), title: 'Database CPU spike — production-db-01',
      severity: 'Critical', type: 'Performance', service: 'production-db-01',
      environment: 'Production', status: 'Investigating',
      description: 'CPU usage at 98% for 12 minutes. Queries timing out. Connection pool exhausted.',
      created_at: ago(35), updated_at: ago(10), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'Auth service crash loop — auth-svc-prod',
      severity: 'Critical', type: 'Availability', service: 'auth-service',
      environment: 'Production', status: 'Open',
      description: 'OOMKilled 7 times in 30 minutes after deployment v3.4.1.',
      created_at: ago(28), updated_at: ago(5), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'Payment API latency elevated — p99 > 8s',
      severity: 'High', type: 'Performance', service: 'payment-api',
      environment: 'Production', status: 'Investigating',
      description: 'p99 latency jumped from 200 ms to 8.4 s. Affecting checkout flow.',
      created_at: ago(52), updated_at: ago(15), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'DNS resolution failures — inter-service',
      severity: 'High', type: 'Network', service: 'api-gateway',
      environment: 'Production', status: 'Open',
      description: 'Packet loss 8.3%. DNS latency 2400 ms after network policy update.',
      created_at: ago(18), updated_at: ago(8), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'Brute-force attack on login endpoint',
      severity: 'Medium', type: 'Security', service: 'auth-service',
      environment: 'Production', status: 'Investigating',
      description: '4,200 failed login attempts in 10 minutes from 3 IP addresses.',
      created_at: ago(45), updated_at: ago(20), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'DB replica lag exceeds 45 seconds',
      severity: 'Medium', type: 'Data', service: 'primary-db',
      environment: 'Production', status: 'Open',
      description: 'Replica lag at 47 s. Bulk migration running concurrently with peak traffic.',
      created_at: ago(62), updated_at: ago(30), resolution: null, mttr: null
    },
    {
      id: uid(), title: 'Load balancer mis-routing healthy pods',
      severity: 'Low', type: 'Other', service: 'api-gateway',
      environment: 'Staging', status: 'Open',
      description: 'Health-check timeout too low. 60% of healthy instances marked unhealthy.',
      created_at: ago(90), updated_at: ago(45), resolution: null, mttr: null
    },

    /* ── Resolved ────────────────────────────────────────────────── */
    {
      id: uid(), title: 'Redis memory exhaustion — cache-01',
      severity: 'High', type: 'Performance', service: 'cache-01',
      environment: 'Production', status: 'Resolved',
      description: 'Redis hit 99% memory limit. Eviction policy triggered, causing cache misses.',
      created_at: ago(300), updated_at: ago(240),
      resolution: 'Increased Redis maxmemory to 4 GB and restarted the service. Cache miss rate returned to normal within 5 minutes.',
      mttr: 58
    },
    {
      id: uid(), title: 'Certificate expiry — wildcard TLS cert',
      severity: 'Critical', type: 'Security', service: 'api-gateway',
      environment: 'Production', status: 'Resolved',
      description: 'Wildcard TLS certificate expired. HTTPS connections rejected.',
      created_at: ago(480), updated_at: ago(460),
      resolution: 'Renewed certificate via Let\'s Encrypt and reloaded nginx. Downtime: 18 minutes.',
      mttr: 22
    },
    {
      id: uid(), title: 'Disk full — log volume /var/log',
      severity: 'High', type: 'Availability', service: 'app-server-03',
      environment: 'Production', status: 'Resolved',
      description: '/var/log at 100% capacity. Service writes failing. Log cleanup + resize applied.',
      created_at: ago(720), updated_at: ago(680),
      resolution: 'Ran log cleanup script (removed 12 GB of logs > 14 days). Added logrotate cron. Volume resized to 50 GB.',
      mttr: 35
    },
    {
      id: uid(), title: 'Notification service deployment failure',
      severity: 'Medium', type: 'Availability', service: 'notification-svc',
      environment: 'Production', status: 'Resolved',
      description: 'Deployment v2.1.0 failed — missing env var SMTP_HOST caused startup crash.',
      created_at: ago(1440), updated_at: ago(1420),
      resolution: 'Added missing SMTP_HOST env var and redeployed. Service healthy.',
      mttr: 15
    },
    {
      id: uid(), title: 'Frontend CDN latency spike — EU region',
      severity: 'Medium', type: 'Network', service: 'cdn-eu',
      environment: 'Production', status: 'Resolved',
      description: 'CDN origin latency increased 10× in EU region. Cache bypass observed.',
      created_at: ago(2880), updated_at: ago(2850),
      resolution: 'CDN cache TTL misconfiguration corrected. Cache hit rate restored to 94%. Latency normal.',
      mttr: 28
    },
    {
      id: uid(), title: 'Scheduled job causing connection storm',
      severity: 'Low', type: 'Performance', service: 'scheduler-svc',
      environment: 'Production', status: 'Resolved',
      description: 'Cron job opened 500 simultaneous DB connections at 03:00 UTC.',
      created_at: ago(4320), updated_at: ago(4300),
      resolution: 'Added connection pooling to scheduler. Max concurrency capped at 20 connections.',
      mttr: 18
    }
  ];

  /* ── In-memory store ──────────────────────────────────────────── */
  let _incidents = [..._seedIncidents];
  let _listeners = [];
  let _currentUserEmail = null;   // set by app.js after login so incidents are tagged

  function setCurrentUser(email) { _currentUserEmail = email; }

  /* ── Live signal templates for auto-arriving incidents ───────── */
  const LIVE_TEMPLATES = [
    { title: 'Memory leak detected — worker-service',         severity: 'High',     type: 'Availability', service: 'worker-service',   description: 'Worker process memory growing unbounded. 840 MB and climbing.' },
    { title: 'API gateway 503 errors — 12% error rate',       severity: 'Critical', type: 'Availability', service: 'api-gateway',       description: 'API gateway returning 503 to 12% of requests. Upstream timeout.' },
    { title: 'Slow query — analytics dashboard times out',    severity: 'Medium',   type: 'Performance',  service: 'analytics-db',      description: 'Dashboard query taking > 45 s. Affecting all reporting users.' },
    { title: 'SSH brute-force — bastion-01 flagged',          severity: 'High',     type: 'Security',     service: 'bastion-01',        description: '2,800 SSH attempts in 5 min from unknown IPs. Root login attempted.' },
    { title: 'Order service pod crash loop — staging',        severity: 'Low',      type: 'Availability', service: 'order-service',     description: 'Pod restarting every 2 minutes in staging after merge to main.' },
    { title: 'Kafka consumer lag — 240k messages behind',     severity: 'High',     type: 'Performance',  service: 'kafka-consumer',    description: 'Event processing consumer 240,000 messages behind. Alerts delayed.' },
    { title: 'Object storage quota at 98% — S3 bucket',      severity: 'Medium',   type: 'Data',         service: 's3-media-bucket',   description: 'Media bucket at 98% capacity. Uploads beginning to fail.' },
    { title: 'TLS handshake failures — payment gateway',      severity: 'Critical', type: 'Network',      service: 'payment-gateway',   description: 'Intermittent TLS 1.2 handshake failures causing payment timeouts.' },
    { title: 'Elasticsearch index size warning — logs-idx',   severity: 'Low',      type: 'Data',         service: 'elasticsearch',     description: 'Log index shard size exceeding 50 GB. Approaching limit.' },
    { title: 'Config server unreachable — config-svc',        severity: 'High',     type: 'Availability', service: 'config-service',    description: 'Config service health check failing. 3 dependent services degraded.' }
  ];

  let _liveIdx = 0;

  /* ── Public API ───────────────────────────────────────────────── */
  function getAll()      { return [..._incidents]; }
  function getById(id)   { return _incidents.find(i => i.id === id) || null; }
  function getOpen()     { return _incidents.filter(i => i.status !== 'Resolved'); }
  function getResolved() { return _incidents.filter(i => i.status === 'Resolved'); }
  function getCritical() { return _incidents.filter(i => (i.severity === 'Critical' || i.severity === 'High') && i.status !== 'Resolved'); }
  function getAwaiting() {
    // Returns incidents that have at least one action with status 'awaiting_approval'
    // on their cached _rca object (set by Investigation.open or CSV import)
    return _incidents.filter(i => {
      if (i.status === 'Resolved') return false;
      if (i._awaitingApproval) return true;   // legacy flag
      if (i._rca?.actions?.some(a => a.status === 'awaiting_approval')) return true;
      return false;
    });
  }

  function add(inc) {
    const full = {
      id: uid(),
      status: 'Open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resolution: null,
      mttr: null,
      environment: 'Production',
      createdBy: _currentUserEmail || null,   // tag which user created this incident
      ...inc
    };
    _incidents.unshift(full);
    _notify('add', full);
    return full;
  }

  function update(id, patch) {
    const idx = _incidents.findIndex(i => i.id === id);
    if (idx === -1) return null;
    _incidents[idx] = { ..._incidents[idx], ...patch, updated_at: new Date().toISOString() };
    _notify('update', _incidents[idx]);
    return _incidents[idx];
  }

  function resolve(id, resolutionNote) {
    const inc = getById(id);
    if (!inc) return null;
    const created = new Date(inc.created_at);
    const now = new Date();
    const mttr = Math.round((now - created) / 60000);
    return update(id, {
      status: 'Resolved',
      resolution: resolutionNote || 'Resolved by team.',
      mttr,
      updated_at: now.toISOString()
    });
  }

  function subscribe(fn) { _listeners.push(fn); }
  function _notify(type, data) { _listeners.forEach(fn => fn(type, data)); }

  /* ── RCA / pipeline simulation ─────────────────────────────────── */
  function getRCA(incidentId) {
    const inc = getById(incidentId);
    if (!inc) return null;
    const tpl = RCA_TEMPLATES[inc.type] || RCA_TEMPLATES['Other'];
    const riskScore = { Critical: 85, High: 65, Medium: 40, Low: 18 }[inc.severity] || 40;
    const actions = tpl.actions.map((key, i) => {
      const tmpl     = ACTION_TEMPLATES[key];
      const riskLevel = tpl.action_risks[i] || 'Low';
      // Use Config to determine initial status — respects policy settings
      // Config may not be loaded in some edge cases, fall back to Low=auto
      const autoOk = (typeof Config !== 'undefined')
        ? Config.shouldAutoExecute(riskLevel)
        : (riskLevel === 'Low');
      return {
        id: uid(),
        type: key,
        name: tmpl.name,
        command: tmpl.command.replace(/{service}/g, inc.service || 'app'),
        rollback_command: tmpl.rollback ? tmpl.rollback.replace(/{service}/g, inc.service || 'app') : null,
        description: tmpl.description,
        risk_level: riskLevel,
        confidence: tpl.confidence - (i * 0.05),
        status: autoOk ? 'auto_approved' : 'awaiting_approval',
        execution_result: null,
        verification_result: null
      };
    });

    return {
      root_cause: tpl.root_cause,
      confidence: tpl.confidence,
      evidence: tpl.evidence,
      shap_factors: tpl.shap_factors,
      blast_radius: BLAST_RADIUS[inc.type] || BLAST_RADIUS['Other'],
      resolution_steps: tpl.plan,
      risk_score: riskScore,
      actions
    };
  }

  /* Simulate executing a single action.
     If ALL actions for an incident pass verification, auto-resolve the incident. */
  function executeAction(action) {
    const success = action.risk_level !== 'High' || Math.random() > 0.15;
    return {
      ...action,
      status: success ? 'completed' : 'failed',
      execution_result: success
        ? { output: 'Command completed successfully.', duration_s: (Math.random() * 4 + 1).toFixed(1), executor: 'AI Agent' }
        : { output: 'Execution failed: connection timeout. Rollback initiated.', duration_s: '8.3', executor: 'AI Agent' },
      verification_result: success
        ? { passed: true, message: 'Service metrics returned to normal. Incident resolved.' }
        : { passed: false, message: 'Metrics still abnormal. Manual intervention needed.' }
    };
  }

  /* Auto-resolve an incident if all executable actions passed verification.
     Called by investigation.js after each auto-execution batch completes. */
  function tryAutoResolve(incidentId) {
    const inc = getById(incidentId);
    if (!inc || inc.status === 'Resolved') return false;
    const rca = inc._rca;
    if (!rca?.actions?.length) return false;

    // Only auto-resolve if every non-rejected action that was executed passed
    const executed = rca.actions.filter(a => a.status === 'completed' || a.status === 'failed');
    const pending  = rca.actions.filter(a => a.status === 'awaiting_approval');
    // Don't resolve if any actions are still pending approval
    if (pending.length > 0) return false;
    // Don't resolve if nothing was executed
    if (executed.length === 0) return false;
    // Fail if any executed action failed verification
    const allPassed = executed.every(a => a.verification_result?.passed);
    if (!allPassed) return false;

    const actionNames = executed.map(a => a.name).join(', ');
    resolve(incidentId, `Auto-resolved by AI pipeline. Actions executed: ${actionNames}. All verification checks passed.`);
    return true;
  }

  /* ── Live incident generator ─────────────────────────────────── */
  let _liveTimer = null;
  let _liveCallbacks = [];

  function onLiveIncident(fn) { _liveCallbacks.push(fn); }

  function startLiveSignals(intervalMs) {
    if (_liveTimer) return;
    _liveTimer = setInterval(() => {
      const tpl = LIVE_TEMPLATES[_liveIdx % LIVE_TEMPLATES.length];
      _liveIdx++;
      const inc = add({
        ...tpl,
        status: 'Open',
        environment: 'Production'
      });
      _liveCallbacks.forEach(fn => fn(inc));
    }, intervalMs || 45000);
  }

  function stopLiveSignals() {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
  }

  function isLiveActive() { return !!_liveTimer; }

  /* ── Formatting helpers (shared across modules) ─────────────────── */
  function severityBadge(sev) {
    const map = { Critical: 'badge-critical', High: 'badge-high', Medium: 'badge-medium', Low: 'badge-low' };
    return `<span class="badge ${map[sev] || 'badge-low'}">${sev}</span>`;
  }
  function statusBadge(st) {
    const map = { Open: 'badge-open', Investigating: 'badge-investigating', Resolved: 'badge-resolved' };
    return `<span class="badge ${map[st] || 'badge-open'}">${st}</span>`;
  }
  function riskBadge(level) {
    const map = { Low: 'badge-low', Medium: 'badge-medium', High: 'badge-high', Critical: 'badge-critical' };
    const cls = map[level] || 'badge-high';
    return `<span class="badge ${cls}">${level} Risk</span>`;
  }
  function relativeTime(iso) {
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  return {
    uid, ago, fmtTime,
    getAll, getById, getOpen, getResolved, getCritical, getAwaiting,
    add, update, resolve, tryAutoResolve,
    getRCA, executeAction,
    subscribe,
    setCurrentUser,
    startLiveSignals, stopLiveSignals, isLiveActive, onLiveIncident,
    severityBadge, statusBadge, riskBadge, relativeTime,
    ACTION_TEMPLATES, RCA_TEMPLATES, BLAST_RADIUS
  };
})();
