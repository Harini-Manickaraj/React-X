/* ================================================================
   REACT-X — Mock Data Store
   Single source of truth for all incident/user data.
   In a real app this would be replaced by API calls.
   ================================================================ */

const Store = (() => {

  /* ── helpers ── */
  let _nextId = 3000;
  const newId  = () => `INC-${++_nextId}`;
  const nowISO = () => new Date().toISOString();
  const minsAgo = n => new Date(Date.now() - n * 60000).toISOString();
  const hrsAgo  = n => new Date(Date.now() - n * 3600000).toISOString();
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

  /* ── change listeners ── */
  const _listeners = [];
  const _emit = (event, payload) => _listeners.forEach(fn => fn(event, payload));

  /* ── user store (mock auth) ── */
  const _users = [
    { email: 'admin@company.com', name: 'Admin User',    password: 'admin123' },
    { email: 'jane@company.com',  name: 'Jane Smith',    password: 'pass123'  }
  ];

  /* ── investigation templates ── */
  const _analysisMap = {
    'Performance': {
      evidence: [
        'CPU utilization reached 95% for over 8 minutes before alert fired',
        'Query execution times increased 12× above baseline',
        'Connection pool exhausted — 512 / 512 connections in use',
        'Slow-query log shows 3 long-running transactions (>30 s) on payments table'
      ],
      rootCause: 'A missing index on the payments table combined with a spike in concurrent writes caused a query lock chain. Long-running transactions held row-level locks, blocking subsequent reads and exhausting the connection pool.',
      recommendation: 'Immediate: kill the long-running queries to release locks. Short-term: add a composite index on (account_id, created_at). Long-term: review connection pool sizing and add query timeout limits at the application layer.',
      impactUsers: 'All users', impactRevenue: 'High', impactSLA: 'Breached'
    },
    'Availability': {
      evidence: [
        'Service returning HTTP 503 for 100% of requests since 14:22 UTC',
        'Health-check endpoint not responding for 3 consecutive checks',
        'Load balancer removed all 4 backend instances from rotation',
        'No deployment or config change in the 2 hours prior'
      ],
      rootCause: 'All service pods entered a crash-loop due to an OOM (out-of-memory) condition. Memory usage grew steadily over 6 hours until the container limit was hit, triggering restarts that prevented the service from recovering.',
      recommendation: 'Immediate: increase container memory limit to stop the crash loop and restore service. Short-term: identify and fix the memory leak (heap profiling recommended). Long-term: add memory usage alerts at 75% threshold.',
      impactUsers: 'All users', impactRevenue: 'Critical', impactSLA: 'Breached'
    },
    'Network': {
      evidence: [
        'API timeout rate increased from 0.2% to 38% within 5 minutes',
        'p99 response time: 4 800 ms vs baseline of 180 ms',
        'Upstream dependency (payment-gateway) showing elevated latency',
        'Retries amplifying load — 3× normal request volume observed'
      ],
      rootCause: 'The upstream payment gateway experienced a regional slowdown. Client-side retry logic with no backoff multiplied the load, causing a self-reinforcing timeout storm across dependent services.',
      recommendation: 'Immediate: enable circuit breaker on the payment-gateway client. Short-term: add exponential backoff with jitter to all retry logic. Long-term: implement timeout budgets and fallback responses for non-critical payment paths.',
      impactUsers: 'Checkout users', impactRevenue: 'High', impactSLA: 'At risk'
    },
    'Security': {
      evidence: [
        '4 200 failed login attempts from 18 distinct IP addresses in 10 minutes',
        'All attempts targeting 3 high-privilege accounts',
        'Geographic anomaly: requests originating from unusual regions',
        'No successful logins recorded in the affected window'
      ],
      rootCause: 'A credential-stuffing attack used a list of leaked username/password pairs to attempt account takeover. The rate limiter was configured with a threshold too high to catch distributed low-rate attempts.',
      recommendation: 'Immediate: temporarily block the 18 source IPs and force password resets for targeted accounts. Short-term: tighten rate-limiter thresholds and enable CAPTCHA for repeated failures. Long-term: implement adaptive authentication and monitor breach databases.',
      impactUsers: 'Targeted accounts', impactRevenue: 'Low', impactSLA: 'OK'
    },
    'Data': {
      evidence: [
        'Replication lag between primary and replica exceeded 4 minutes',
        'Read queries routed to replica returning stale data',
        'Replica I/O thread stopped at 14:08 UTC',
        'Disk I/O on replica host at 98% utilisation'
      ],
      rootCause: 'Disk I/O saturation on the replica host caused the replication I/O thread to stall. A large batch export job running on the replica was competing for the same disk bandwidth as incoming replication events.',
      recommendation: 'Immediate: stop the batch export job and restart the replication I/O thread. Short-term: route batch jobs to a dedicated read replica. Long-term: separate analytical and operational workloads at the infrastructure level.',
      impactUsers: 'Read-heavy features', impactRevenue: 'Medium', impactSLA: 'At risk'
    },
    'Other': {
      evidence: [
        'Alert triggered by automated monitoring',
        'Service metrics showing deviation from normal baseline',
        'Recent change or deployment may be a contributing factor'
      ],
      rootCause: 'Root cause is under investigation. Initial signals suggest a configuration or dependency change contributed to the incident.',
      recommendation: 'Review recent deployments and configuration changes. Check upstream dependencies. Escalate to service owner for further investigation.',
      impactUsers: 'Unknown', impactRevenue: 'Unknown', impactSLA: 'Unknown'
    }
  };

  /* ── risk scoring ── */
  const _riskScore = (severity, type) => {
    const sevScore  = { Critical: 90, High: 65, Medium: 40, Low: 15 };
    const typeScore = { Availability: 20, Performance: 15, Security: 18, Data: 12, Network: 10, Other: 5 };
    return Math.min(100, (sevScore[severity] || 50) + (typeScore[type] || 5));
  };

  /* ── seed incidents ── */
  const _incidents = [
    {
      id: 'INC-2901',
      title: 'Database CPU High — production-db-01',
      severity: 'Critical',
      status: 'Investigating',
      type: 'Performance',
      service: 'database-primary',
      environment: 'Production',
      description: 'CPU utilization on production-db-01 has been above 90% for the past 12 minutes. Slow query alerts are firing. The payments table appears to have a lock contention issue.',
      createdAt: minsAgo(18),
      updatedAt: minsAgo(4),
      createdBy: 'Jane Smith',
      resolvedAt: null
    },
    {
      id: 'INC-2902',
      title: 'Payment API Timeout — checkout service',
      severity: 'Critical',
      status: 'Open',
      type: 'Network',
      service: 'payment-api',
      environment: 'Production',
      description: 'Payment API requests timing out. Error: ECONNRESET after 30 s. Affects all users attempting checkout. Error rate 38%. Started at approximately 14:22 UTC.',
      createdAt: minsAgo(35),
      updatedAt: minsAgo(8),
      createdBy: 'Admin User',
      resolvedAt: null
    },
    {
      id: 'INC-2903',
      title: 'Service Unavailable — auth-service pods crash-looping',
      severity: 'High',
      status: 'Open',
      type: 'Availability',
      service: 'auth-service',
      environment: 'Production',
      description: 'Auth service returning 503 for all requests. Pods are in CrashLoopBackOff state. Memory limit hit. Users unable to log in.',
      createdAt: minsAgo(52),
      updatedAt: minsAgo(12),
      createdBy: 'Jane Smith',
      resolvedAt: null
    },
    {
      id: 'INC-2904',
      title: 'Memory Usage High — order-service',
      severity: 'High',
      status: 'Investigating',
      type: 'Performance',
      service: 'order-service',
      environment: 'Production',
      description: 'Memory usage on order-service instances has been climbing steadily. Currently at 87% of limit. If not addressed, OOM kill expected within 30 minutes.',
      createdAt: hrsAgo(2),
      updatedAt: minsAgo(22),
      createdBy: 'Admin User',
      resolvedAt: null
    },
    {
      id: 'INC-2905',
      title: 'Payment Failure — Stripe webhook 400 errors',
      severity: 'Medium',
      status: 'Open',
      type: 'Data',
      service: 'billing-service',
      environment: 'Production',
      description: 'Stripe webhook endpoint returning HTTP 400. Payment confirmations not being processed. Affects post-payment order fulfilment. ~200 orders pending confirmation.',
      createdAt: hrsAgo(1),
      updatedAt: minsAgo(41),
      createdBy: 'Jane Smith',
      resolvedAt: null
    },
    {
      id: 'INC-2906',
      title: 'Database Replica Lag — read queries returning stale data',
      severity: 'Medium',
      status: 'Investigating',
      type: 'Data',
      service: 'database-replica',
      environment: 'Production',
      description: 'Replication lag on the primary read replica has exceeded 4 minutes. Users on product listing and dashboard pages seeing data that is up to 4 minutes old.',
      createdAt: hrsAgo(3),
      updatedAt: hrsAgo(1),
      createdBy: 'Admin User',
      resolvedAt: null
    },
    {
      id: 'INC-2907',
      title: 'API Rate Limit Errors — third-party maps service',
      severity: 'Low',
      status: 'Open',
      type: 'Network',
      service: 'location-service',
      environment: 'Production',
      description: 'HTTP 429 errors from maps provider. Location features degraded. Non-critical user-facing impact. Need to review quota usage and implement caching.',
      createdAt: hrsAgo(4),
      updatedAt: hrsAgo(2),
      createdBy: 'Jane Smith',
      resolvedAt: null
    },
    /* ── resolved incidents (history) ── */
    {
      id: 'INC-2895',
      title: 'Database CPU High — analytics-db spike',
      severity: 'High',
      status: 'Resolved',
      type: 'Performance',
      service: 'analytics-db',
      environment: 'Production',
      description: 'Analytics database CPU spiked to 98% during batch report generation. Resolved by rescheduling the batch job to off-peak hours.',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      createdBy: 'Admin User',
      resolvedAt: daysAgo(1),
      resolution: 'Rescheduled batch job. Added CPU alert at 80% threshold.',
      mttr: '34 min'
    },
    {
      id: 'INC-2890',
      title: 'Service Unavailable — notification-service down',
      severity: 'Medium',
      status: 'Resolved',
      type: 'Availability',
      service: 'notification-service',
      environment: 'Production',
      description: 'Email and push notification service went down due to a misconfigured environment variable after a deploy.',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      createdBy: 'Jane Smith',
      resolvedAt: daysAgo(2),
      resolution: 'Rolled back deploy. Corrected environment variable. Redeployed.',
      mttr: '18 min'
    },
    {
      id: 'INC-2885',
      title: 'Payment Failure — expired API key',
      severity: 'Critical',
      status: 'Resolved',
      type: 'Data',
      service: 'payment-api',
      environment: 'Production',
      description: 'Payment processor API key expired causing all payment attempts to fail for 22 minutes.',
      createdAt: daysAgo(3),
      updatedAt: daysAgo(3),
      createdBy: 'Admin User',
      resolvedAt: daysAgo(3),
      resolution: 'Rotated API key. Added 30-day expiry alert to secrets manager.',
      mttr: '22 min'
    },
    {
      id: 'INC-2880',
      title: 'API Timeout — search service cold start',
      severity: 'Medium',
      status: 'Resolved',
      type: 'Network',
      service: 'search-service',
      environment: 'Production',
      description: 'Search service scaled to zero overnight. Cold start on first morning request caused 45 s timeout for ~800 users.',
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      createdBy: 'Jane Smith',
      resolvedAt: daysAgo(4),
      resolution: 'Enabled minimum instance count of 1. Added warm-up endpoint.',
      mttr: '12 min'
    },
    {
      id: 'INC-2875',
      title: 'Memory Usage High — image processing worker',
      severity: 'High',
      status: 'Resolved',
      type: 'Performance',
      service: 'media-service',
      environment: 'Production',
      description: 'Image processing workers consuming excessive memory due to a bug introduced in v2.4.1 that failed to release buffers after processing.',
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
      createdBy: 'Admin User',
      resolvedAt: daysAgo(5),
      resolution: 'Deployed hotfix v2.4.2. Confirmed memory stable below 60%.',
      mttr: '55 min'
    },
    {
      id: 'INC-2870',
      title: 'Database Replica Lag — report generation overload',
      severity: 'Low',
      status: 'Resolved',
      type: 'Data',
      service: 'reporting-db',
      environment: 'Production',
      description: 'Unthrottled report generation job saturated replica disk I/O causing replication lag.',
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
      createdBy: 'Jane Smith',
      resolvedAt: daysAgo(6),
      resolution: 'Added I/O throttle to report job. Isolated to dedicated replica.',
      mttr: '28 min'
    },
    {
      id: 'INC-2865',
      title: 'Service Unavailable — staging deploy went to production',
      severity: 'Critical',
      status: 'Resolved',
      type: 'Availability',
      service: 'api-gateway',
      environment: 'Production',
      description: 'A CI/CD pipeline misconfiguration deployed a staging build to the production environment, causing immediate downtime.',
      createdAt: daysAgo(7),
      updatedAt: daysAgo(7),
      createdBy: 'Admin User',
      resolvedAt: daysAgo(7),
      resolution: 'Immediate rollback. Pipeline environment checks added. Post-mortem complete.',
      mttr: '9 min'
    }
  ];

  /* ── volume data (last 7 days) ── */
  const _volume = (() => {
    const labels = [];
    const counts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      counts.push(Math.floor(Math.random() * 8) + 2);
    }
    return { labels, counts };
  })();

  /* ================================================================
     PUBLIC API
     ================================================================ */
  return {

    /* ── auth ── */
    findUser(email, password) {
      return _users.find(u =>
        u.email.toLowerCase() === email.toLowerCase() && u.password === password
      ) || null;
    },
    registerUser(name, email, password) {
      if (_users.find(u => u.email.toLowerCase() === email.toLowerCase())) return false;
      _users.push({ name, email, password });
      return true;
    },

    /* ── incidents CRUD ── */
    getIncidents(statusFilter) {
      const open = _incidents.filter(i => i.status !== 'Resolved');
      if (!statusFilter || statusFilter === 'all') return [...open];
      return open.filter(i => i.status === statusFilter);
    },

    getHistory() {
      return _incidents.filter(i => i.status === 'Resolved').sort((a,b) => new Date(b.resolvedAt) - new Date(a.resolvedAt));
    },

    getAll() { return [..._incidents]; },

    getById(id) { return _incidents.find(i => i.id === id) || null; },

    createIncident({ title, severity, type, service, environment, description, createdBy }) {
      const inc = {
        id: newId(),
        title: title.trim(),
        severity,
        status: 'Open',
        type: type || 'Other',
        service: (service || '').trim(),
        environment: environment || 'Production',
        description: description.trim(),
        createdAt: nowISO(),
        updatedAt: nowISO(),
        createdBy: createdBy || 'User',
        resolvedAt: null
      };
      _incidents.unshift(inc);
      _emit('incident:created', inc);
      return inc;
    },

    updateStatus(id, newStatus, resolution) {
      const inc = _incidents.find(i => i.id === id);
      if (!inc) return null;
      inc.status    = newStatus;
      inc.updatedAt = nowISO();
      if (newStatus === 'Resolved') {
        inc.resolvedAt = nowISO();
        inc.resolution = resolution || 'Resolved by team.';
        inc.mttr = _calcMTTR(inc.createdAt, inc.resolvedAt);
      }
      _emit('incident:updated', inc);
      return inc;
    },

    /* ── analysis ── */
    analyse(inc) {
      const template = _analysisMap[inc.type] || _analysisMap['Other'];
      return {
        summary: inc.description,
        evidence: template.evidence,
        rootCause: template.rootCause,
        recommendation: template.recommendation,
        impact: {
          users:   template.impactUsers,
          revenue: template.impactRevenue,
          sla:     template.impactSLA
        },
        risk: _riskScore(inc.severity, inc.type)
      };
    },

    /* ── chart data ── */
    getSeverityCounts() {
      const open = _incidents.filter(i => i.status !== 'Resolved');
      const c = { Critical: 0, High: 0, Medium: 0, Low: 0 };
      open.forEach(i => { if (c[i.severity] !== undefined) c[i.severity]++; });
      return c;
    },

    getTypeCounts() {
      const open = _incidents.filter(i => i.status !== 'Resolved');
      const c = {};
      open.forEach(i => { c[i.type] = (c[i.type] || 0) + 1; });
      return c;
    },

    getVolume() { return _volume; },

    /* ── live signal subscription ── */
    subscribe(fn) { _listeners.push(fn); },
    unsubscribe(fn) {
      const idx = _listeners.indexOf(fn);
      if (idx > -1) _listeners.splice(idx, 1);
    },

    /* ── simulate live incoming alerts ── */
    startLiveSignals() {
      const liveIncidents = [
        { title: 'Database CPU High — reporting-db spike', severity: 'High', type: 'Performance', service: 'reporting-db', environment: 'Production', description: 'Reporting database CPU spiked to 91% following a scheduled report run at 15:00 UTC.' },
        { title: 'API Timeout — user-service /profile endpoint', severity: 'Medium', type: 'Network', service: 'user-service', environment: 'Production', description: 'Profile API requests timing out intermittently. p99 latency: 8 200 ms. Affecting ~5% of users.' },
        { title: 'Memory Usage High — cache service', severity: 'Low', type: 'Performance', service: 'cache-service', environment: 'Production', description: 'In-memory cache service memory at 82% of limit. No OOM events yet but monitoring closely.' },
        { title: 'Payment Failure — invalid card BIN list', severity: 'Medium', type: 'Data', service: 'payment-api', environment: 'Production', description: 'BIN validation rejecting valid cards due to stale lookup table. Affects ~3% of transactions.' }
      ];
      let idx = 0;
      return setInterval(() => {
        if (idx >= liveIncidents.length) return;
        const data = { ...liveIncidents[idx++], createdBy: 'System Monitor' };
        const inc  = this.createIncident(data);
        _emit('live:new', inc);
      }, 45000); // every 45 s
    }
  };

  /* ── private ── */
  function _calcMTTR(createdAt, resolvedAt) {
    const mins = Math.round((new Date(resolvedAt) - new Date(createdAt)) / 60000);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
})();

window.Store = Store;
