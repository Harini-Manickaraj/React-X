/* ================================================================
   REACT-X — investigation.js
   Investigation modal: 7-section view with numbered resolution steps
   ================================================================ */

const Investigation = (() => {

  /* ── Resolution step templates per incident type ── */
  const _resolutionSteps = {
    Performance: [
      'Open your database monitoring tool and identify the top slow queries by execution time.',
      'Kill the long-running blocking queries: run SELECT pg_terminate_backend(pid) for each query with duration > 30s.',
      'Add a composite index on the most-queried columns (e.g. account_id, created_at) to eliminate full table scans.',
      'Increase the connection pool limit in your application config (e.g. max_connections=1024) and reload the config.',
      'Set a query timeout limit at the application layer (e.g. statement_timeout = 10000ms) to prevent future lock chains.',
      'Monitor CPU and connection count for 10 minutes to confirm metrics are recovering below thresholds.',
      'If metrics do not recover within 15 minutes, restart the affected service pods and re-verify.'
    ],
    Availability: [
      'Check pod status: run kubectl get pods -n <namespace> and identify all pods in CrashLoopBackOff state.',
      'Inspect crash logs: kubectl logs <pod-name> --previous to find the OOM kill signal or crash reason.',
      'Increase the container memory limit immediately: edit the deployment manifest and raise limits.memory.',
      'Apply the change: kubectl apply -f <deployment.yaml> and watch pods recover with kubectl get pods -w.',
      'Profile the application for memory leaks using heap profiling tools (e.g. heapdump, pprof, JVM heap analysis).',
      'Add a memory usage alert at 75% of the limit so future OOM conditions are caught early.',
      'Verify all health-check endpoints respond with HTTP 200 before closing the incident.'
    ],
    Network: [
      'Confirm the upstream service (e.g. payment-gateway) is experiencing elevated latency via its status page or metrics.',
      'Enable the circuit breaker on the affected client: set circuit-breaker.enabled=true and threshold to 50% error rate.',
      'Immediately stop retry storms by adding a short-circuit: return a fallback response if the upstream is degraded.',
      'Update retry logic across all affected clients to use exponential backoff with jitter (e.g. base 100ms, max 10s).',
      'Set explicit timeout budgets per downstream call (e.g. connect_timeout=2s, read_timeout=5s).',
      'Monitor error rate and p99 latency every 2 minutes until both return below acceptable thresholds.',
      'Once upstream recovers, open the circuit breaker and confirm traffic resumes normally.'
    ],
    Security: [
      'Immediately block all 18 identified source IPs at the firewall or WAF level.',
      'Force password resets for all targeted high-privilege accounts and invalidate their active sessions.',
      'Review authentication logs for the past 24 hours to confirm no successful unauthorised logins occurred.',
      'Lower the rate-limiter threshold to 10 failed attempts per IP per minute and deploy the config change.',
      'Enable CAPTCHA or MFA challenges after 3 consecutive failed login attempts for all accounts.',
      'Subscribe to have-i-been-pwned or a similar breach database feed for early detection of leaked credentials.',
      'Schedule a post-incident security review and update your threat model within 48 hours.'
    ],
    Data: [
      'Identify the replication I/O thread status: run SHOW SLAVE STATUS\\G on the replica host.',
      'Stop the batch export job that is competing for disk I/O: kill the process or pause the scheduled job.',
      'Restart the replication I/O thread: run STOP SLAVE IO_THREAD; START SLAVE IO_THREAD; on the replica.',
      'Monitor replication lag with Seconds_Behind_Master every 60 seconds until it returns to < 5 seconds.',
      'Move batch export and analytics jobs to a dedicated read replica or a separate analytics database.',
      'Add disk I/O throttle limits to all batch jobs (e.g. ionice, cgroups blkio) to prevent future saturation.',
      'Set up a replication lag alert that fires when lag exceeds 30 seconds so the team is notified early.'
    ],
    Other: [
      'Review all deployments and config changes made in the last 2 hours using your CI/CD pipeline audit log.',
      'Check upstream service health pages and dependency status dashboards for any known outages.',
      'Inspect application error logs for the first occurrence of the issue to establish an accurate start time.',
      'Identify the minimal reproducible change that triggered the incident and prepare a rollback if needed.',
      'Escalate to the service owner with the evidence collected and the suspected root cause.',
      'Apply the identified fix and monitor the service for 10 minutes before confirming resolution.',
      'Write a post-mortem summary with timeline, root cause, fix, and prevention steps within 24 hours.'
    ]
  };

  /* ── Open ────────────────────────────────────────────── */
  function open(id) {
    const inc = Store.getById(id);
    if (!inc) { App.toast('Incident not found.', 'error'); return; }
    _render(inc);
    App.openModal('modal-investigation');
  }

  /* ── Render ──────────────────────────────────────────── */
  function _render(inc) {
    const body    = document.getElementById('investigationBody');
    const titleEl = document.getElementById('investigationTitle');
    if (!body) return;

    if (titleEl) titleEl.textContent = `${inc.id} — Investigation`;

    const analysis   = Store.analyse(inc);
    const risk       = analysis.risk;
    const riskLabel  = risk >= 75 ? 'High' : risk >= 45 ? 'Medium' : 'Low';
    const riskColor  = risk >= 75 ? '#ff4444' : risk >= 45 ? '#ff8800' : '#5a9a5a';
    const isResolved = inc.status === 'Resolved';

    const steps = _resolutionSteps[inc.type] || _resolutionSteps['Other'];

    body.innerHTML = `

    <!-- ① Incident header ─────────────────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Incident</div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.65rem;flex-wrap:wrap">
        ${App.severityBadge(inc.severity)}
        ${App.statusBadge(inc.status)}
        <span class="text-xs text-muted">${_esc(inc.id)}</span>
        <span class="text-xs text-muted">·</span>
        <span class="text-xs text-muted">${_esc(inc.service || inc.type)}</span>
        <span class="text-xs text-muted">·</span>
        <span class="text-xs text-muted">${_esc(inc.environment)}</span>
        <span class="text-xs text-muted">·</span>
        <span class="text-xs text-muted">Opened ${App.formatTime(inc.createdAt)} by ${_esc(inc.createdBy)}</span>
      </div>
      <div style="font-weight:700;font-size:0.97rem;color:#ffffff;margin-bottom:0.65rem">${_esc(inc.title)}</div>
      <div class="inv-summary">${_esc(inc.description)}</div>
      ${inc.imageDataUrl ? `
        <div style="margin-top:0.85rem">
          <div class="inv-section-title" style="margin-bottom:0.45rem">Attached Screenshot</div>
          <img src="${inc.imageDataUrl}" alt="Incident screenshot"
               style="max-width:100%;max-height:340px;border-radius:8px;border:1px solid var(--border-mid);cursor:pointer;object-fit:contain"
               onclick="this.style.maxHeight=this.style.maxHeight==='none'?'340px':'none'" title="Click to expand" />
          <div class="text-xs text-muted" style="margin-top:0.3rem">Click image to expand / collapse</div>
        </div>` : ''}
    </div>

    <!-- ② Key Evidence ────────────────────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Key Evidence</div>
      <div class="inv-evidence">
        ${analysis.evidence.map(e => `
          <div class="inv-evidence-item">
            <div class="inv-evidence-bullet"></div>
            <span>${_esc(e)}</span>
          </div>`).join('')}
      </div>
    </div>

    <!-- ③ Root Cause ───────────────────────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Root Cause</div>
      <div class="inv-root-cause">${_esc(analysis.rootCause)}</div>
    </div>

    <!-- ④ Impact ───────────────────────────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Impact</div>
      <div class="inv-impact-grid">
        <div class="inv-impact-item">
          <div class="inv-impact-label">Users Affected</div>
          <div class="inv-impact-value">${_esc(analysis.impact.users)}</div>
        </div>
        <div class="inv-impact-item">
          <div class="inv-impact-label">Revenue Impact</div>
          <div class="inv-impact-value">${_esc(analysis.impact.revenue)}</div>
        </div>
        <div class="inv-impact-item">
          <div class="inv-impact-label">SLA Status</div>
          <div class="inv-impact-value">${_esc(analysis.impact.sla)}</div>
        </div>
        <div class="inv-impact-item">
          <div class="inv-impact-label">Incident Type</div>
          <div class="inv-impact-value">${_esc(inc.type)}</div>
        </div>
      </div>
    </div>

    <!-- ⑤ Step-by-step Resolution Plan ────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Resolution Action Plan</div>
      <div class="resolution-steps">
        ${steps.map((step, i) => `
          <div class="res-step" id="res-step-${inc.id}-${i}">
            <div class="res-step-num">${i + 1}</div>
            <div class="res-step-body">
              <div class="res-step-text">${_esc(step)}</div>
              ${!isResolved ? `
                <label class="res-step-check">
                  <input type="checkbox" onchange="Investigation._toggleStep(this,'${inc.id}',${i})" />
                  <span>Done</span>
                </label>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- ⑥ Risk Score ───────────────────────────────── -->
    <div class="inv-section">
      <div class="inv-section-title">Risk Score</div>
      <div class="risk-row">
        <span style="font-size:0.85rem;font-weight:700;color:${riskColor};min-width:90px">
          ${riskLabel} — ${risk}/100
        </span>
        <div class="risk-bar-track">
          <div class="risk-bar-fill" style="width:${risk}%;background:${riskColor}"></div>
        </div>
      </div>
    </div>

    <!-- ⑦ Resolution note (if resolved) ───────────── -->
    ${isResolved && inc.resolution ? `
    <div class="inv-section">
      <div class="inv-section-title">Resolution Note</div>
      <div class="inv-summary" style="border-left:3px solid #5a9a5a;background:rgba(90,154,90,0.08)">
        ${_esc(inc.resolution)}
      </div>
      ${inc.mttr ? `<p class="text-xs text-muted" style="margin-top:0.4rem">
        MTTR: <strong style="color:#b9ccdd">${inc.mttr}</strong>
      </p>` : ''}
    </div>` : ''}

    <!-- ⑧ Actions ─────────────────────────────────── -->
    ${!isResolved ? `
    <div class="inv-section">
      <div class="inv-section-title">Update Status</div>
      <div style="display:flex;flex-direction:column;gap:0.75rem">
        <textarea id="invResolutionNote" class="input" rows="2"
          placeholder="Resolution note — summarise what steps you took and what fixed it…"></textarea>
        <div class="action-bar" style="padding-top:0;border-top:none">
          ${inc.status === 'Open' ? `
            <button class="btn btn-ghost btn-sm"
              onclick="Investigation._setStatus('${inc.id}','Investigating')">
              Mark Investigating
            </button>` : ''}
          <button class="btn btn-success btn-sm"
            onclick="Investigation._resolve('${inc.id}')">
            ✓ Mark Resolved
          </button>
          <button class="btn btn-danger btn-sm"
            onclick="Investigation._escalate('${inc.id}')">
            Escalate
          </button>
        </div>
      </div>
    </div>` : `
    <div class="action-bar" style="padding-top:1rem;border-top:1px solid var(--border)">
      <span class="text-sm text-muted">✓ This incident has been resolved.</span>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto"
        onclick="App.closeModal('modal-investigation')">Close</button>
    </div>`}

    ${!isResolved ? `
    <div class="action-bar" style="border-top:1px solid var(--border);margin-top:0.5rem;padding-top:1rem">
      <button class="btn btn-ghost btn-sm" style="margin-left:auto"
        onclick="App.closeModal('modal-investigation')">Close</button>
    </div>` : ''}`;
  }

  /* ── Step checkbox toggle ────────────────────────── */
  function _toggleStep(checkbox, incId, stepIdx) {
    const stepEl = document.getElementById(`res-step-${incId}-${stepIdx}`);
    if (!stepEl) return;
    if (checkbox.checked) {
      stepEl.style.opacity = '0.5';
      stepEl.querySelector('.res-step-text').style.textDecoration = 'line-through';
    } else {
      stepEl.style.opacity = '1';
      stepEl.querySelector('.res-step-text').style.textDecoration = 'none';
    }
  }

  /* ── Status actions ──────────────────────────────── */
  function _setStatus(id, newStatus) {
    const inc = Store.updateStatus(id, newStatus);
    if (!inc) return;
    App.toast(`${id} marked as ${newStatus}.`, 'success');
    _render(inc);
    _refreshAll();
  }

  function _resolve(id) {
    const noteEl = document.getElementById('invResolutionNote');
    const note   = noteEl ? noteEl.value.trim() : '';
    if (!note) {
      noteEl?.classList.add('error');
      App.toast('Add a resolution note before marking resolved.', 'warning');
      noteEl?.focus();
      return;
    }
    noteEl.classList.remove('error');
    const inc = Store.updateStatus(id, 'Resolved', note);
    if (!inc) return;
    App.toast(`✓ ${id} resolved. MTTR: ${inc.mttr}`, 'success', 4000);
    _render(inc);
    _refreshAll();
  }

  function _escalate(id) {
    const inc = Store.updateStatus(id, 'Investigating');
    if (!inc) return;
    App.toast(`${id} escalated — marked Investigating.`, 'warning');
    _render(inc);
    _refreshAll();
  }

  function _refreshAll() {
    Dashboard.refresh();
    Incidents.refresh();
    History.refresh();
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { open, _setStatus, _resolve, _escalate, _toggleStep };
})();

window.Investigation = Investigation;
