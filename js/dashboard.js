/* ================================================================
   dashboard.js  —  REACT-X  v4
   CSV import: accepts ANY columns/rows, auto-detects fields and
   severity, creates real incidents (NOT demo incidents), runs the
   full risk-based pipeline, shows a result panel.
   ================================================================ */
const Dashboard = (() => {

  let _charts = {};
  let _importing = false;  // true while CSV/ORC import pipeline is running

  /* ── Public ─────────────────────────────────────────────────── */
  function refresh() {
    // Skip full refresh during active import to avoid overwriting status UI
    // and repeatedly destroying/recreating charts
    if (_importing) {
      _renderKPIs();
      _renderHighRiskPanel();
      _renderApprovalPanel();
      return;
    }
    _renderTimestamp();
    _renderKPIs();
    _renderHighRiskPanel();
    _renderApprovalPanel();
    _renderRecentList();
    _renderCharts();
    // Always try to init — guarded by input._bound flag
    _initOCR();
    _initCSV();
  }

  /* Lightweight refresh — only KPIs, no charts redraw */
  function refreshKPIsOnly() {
    _renderKPIs();
    _renderHighRiskPanel();
    _renderApprovalPanel();
  }

  /* ── Timestamp ───────────────────────────────────────────────── */
  function _renderTimestamp() {
    const el = document.getElementById('dashTimestamp');
    if (el) el.textContent = 'Last updated ' +
      new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }

  /* ── KPI Cards ───────────────────────────────────────────────── */
  function _renderKPIs() {
    const all      = Store.getAll();
    const open     = all.filter(i => i.status === 'Open').length;
    const inv      = all.filter(i => i.status === 'Investigating').length;
    const critical = all.filter(i =>
      (i.severity === 'Critical' || i.severity === 'High') && i.status !== 'Resolved').length;
    const resolved = all.filter(i => i.status === 'Resolved').length;

    const row = document.getElementById('kpiRow');
    if (!row) return;
    row.innerHTML = `
      ${_kpiCard('Open Incidents',  open,     'Needs attention',           '',                     'open')}
      ${_kpiCard('Investigating',   inv,      'AI pipeline running',       '',                     'investigating')}
      ${_kpiCard('Critical / High', critical, 'Immediate action required', critical>0?'kpi-critical':'', 'critical')}
      ${_kpiCard('Resolved',        resolved, 'Successfully closed',       '',                     'resolved')}`;
    row.querySelectorAll('.kpi-card').forEach(c =>
      c.addEventListener('click', () => openKpiModal(c.dataset.filter)));
  }

  function _kpiCard(label, value, sub, valClass, filter) {
    return `<div class="kpi-card" data-filter="${filter}" title="Click to drill down">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${valClass}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  }

  /* ── High-Risk Panel ─────────────────────────────────────────── */
  function _renderHighRiskPanel() {
    const panel = document.getElementById('highRiskPanel');
    if (!panel) return;
    const crit = Store.getCritical();
    if (!crit.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="alert-panel alert-panel-critical" onclick="Dashboard.openHighRiskModal()">
        <div>
          <div class="panel-heading">
            🚨 ${crit.length} Critical/High incident${crit.length > 1 ? 's' : ''} need immediate attention
          </div>
          <div class="panel-sub">${crit.slice(0, 2).map(i => _e(i.title)).join(' · ')}
            ${crit.length > 2 ? ` · +${crit.length - 2} more` : ''}</div>
        </div>
        <button class="btn btn-danger btn-sm">View All →</button>
      </div>`;
  }

  /* ── Approval Panel ──────────────────────────────────────────── */
  function _renderApprovalPanel() {
    const panel = document.getElementById('approvalPanel');
    if (!panel) return;
    if (!Config.get('approvalAlerts')) { panel.style.display = 'none'; return; }

    const items = [];
    Store.getAll().filter(i => i.status !== 'Resolved').forEach(inc => {
      (inc._rca?.actions || []).forEach(act => {
        if (act.status === 'awaiting_approval') items.push({ inc, act });
      });
    });

    if (!items.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="section-card" style="border-color:var(--risk-high-border);">
        <div class="section-head" style="background:var(--risk-high-bg);">
          <div class="section-title" style="color:var(--risk-high);">⚠ Human Approval Required</div>
          <span style="font-size:0.78rem;color:var(--risk-high);">${items.length} action${items.length > 1 ? 's' : ''} waiting</span>
        </div>
        ${items.slice(0, 4).map(({ inc, act }) => `
          <div class="incident-item" style="padding:0.7rem 1rem;">
            <div class="inc-left">
              <div class="inc-title">${_e(inc.title)}</div>
              <div class="inc-meta">
                ${Store.severityBadge(inc.severity)}
                <span>Action: <strong>${_e(act.name)}</strong></span>
                ${Store.riskBadge(act.risk_level)}
              </div>
            </div>
            <div class="inc-actions">
              <button class="btn btn-primary btn-sm" onclick="Investigation.open('${inc.id}')">Review &amp; Approve</button>
            </div>
          </div>`).join('')}
        ${items.length > 4 ? `<div style="padding:0.5rem 1rem;font-size:0.78rem;color:var(--text-muted);">
          +${items.length - 4} more — check Incidents page</div>` : ''}
      </div>`;
  }

  /* ── Recent list ─────────────────────────────────────────────── */
  function _renderRecentList() {
    const container = document.getElementById('dashRecentList');
    if (!container) return;
    const incidents = Store.getOpen().slice(0, 8);
    if (!incidents.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <h4>No open incidents</h4><p>Everything looks healthy.</p></div>`;
      return;
    }
    container.innerHTML = incidents.map(inc => `
      <div class="incident-item">
        <div class="inc-left">
          <div class="inc-title">${_e(inc.title)}</div>
          <div class="inc-meta">
            ${Store.severityBadge(inc.severity)}
            ${Store.statusBadge(inc.status)}
            <span class="sep">·</span><span>${_e(inc.service || '—')}</span>
            <span class="sep">·</span><span>${Store.relativeTime(inc.created_at)}</span>
          </div>
        </div>
        <div class="inc-actions">
          <button class="btn btn-ghost btn-sm" onclick="Investigation.open('${inc.id}')">Investigate</button>
        </div>
      </div>`).join('');
  }

  /* ── Charts ──────────────────────────────────────────────────── */
  function _renderCharts() { _chartSeverity(); _chartType(); _chartVolume(); }

  function _chartSeverity() {
    const all = Store.getAll();
    const ctx = document.getElementById('chartSeverity');
    if (!ctx) return;
    if (_charts.severity) _charts.severity.destroy();
    _charts.severity = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low'],
        datasets: [{
          data: ['Critical', 'High', 'Medium', 'Low'].map(s => all.filter(i => i.severity === s).length),
          backgroundColor: ['#ae0d19', '#c62828', '#d4a800', '#2e7d32'],
          borderRadius: 6, borderSkipped: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, family: 'DM Sans' }, color: '#374151' } },
          y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 11, family: 'DM Sans' }, color: '#374151', stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }

  function _chartType() {
    const all   = Store.getAll();
    const types = ['Performance', 'Availability', 'Security', 'Data', 'Network', 'Other'];
    const ctx   = document.getElementById('chartType');
    if (!ctx) return;
    if (_charts.type) _charts.type.destroy();
    _charts.type = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: types,
        datasets: [{ data: types.map(t => all.filter(i => i.type === t).length),
          backgroundColor: ['#ae0d19', '#c62828', '#e65100', '#d4a800', '#2e7d32', '#6b7280'],
          borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: { legend: { position: 'bottom',
          labels: { font: { size: 11, family: 'DM Sans' }, color: '#374151', padding: 8, boxWidth: 12 } } }
      }
    });
  }

  function _chartVolume() {
    const all = Store.getAll();
    const labels = [], data = [];
    for (let d = 6; d >= 0; d--) {
      const day = new Date(); day.setDate(day.getDate() - d);
      labels.push(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const s = new Date(day); s.setHours(0, 0, 0, 0);
      const ex = new Date(day); ex.setHours(23, 59, 59, 999);
      data.push(all.filter(i => { const c = new Date(i.created_at); return c >= s && c <= ex; }).length);
    }
    const ctx = document.getElementById('chartVolume');
    if (!ctx) return;
    if (_charts.volume) _charts.volume.destroy();
    _charts.volume = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: '#ae0d19', backgroundColor: 'rgba(174,13,25,0.08)',
        tension: 0.35, fill: true, pointBackgroundColor: '#ae0d19', pointRadius: 4, pointHoverRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10, family: 'DM Sans' }, color: '#374151' } },
          y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 11, family: 'DM Sans' }, color: '#374151', stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }

  /* ── OCR import ──────────────────────────────────────────────── */
  function _initOCR() {
    const input = document.getElementById('dashOcrFileInput');
    if (!input || input._bound) return;
    input._bound = true;
    input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('dashOcrStatus');
      status.innerHTML = '<span class="spinner"></span> Reading screenshot…';
      try {
        const result = await Tesseract.recognize(file, 'eng', { logger: () => {} });
        const text = result.data.text || '';
        const sev = _detectSeverityFromText(text);
        Incidents.openNewIncidentModal({
          title: text.split('\n')[0].trim().slice(0, 80),
          description: text.slice(0, 400), severity: sev
        });
        status.innerHTML = `<span style="color:var(--risk-low)">✓ OCR complete — ${sev} severity detected, form pre-filled</span>`;
        input.value = '';
        setTimeout(() => { status.textContent = ''; }, 5000);
      } catch (err) {
        status.innerHTML = `<span style="color:var(--risk-high)">OCR failed: ${err.message}</span>`;
      }
    });
  }

  /* ── CSV / ORC Import ────────────────────────────────────────── */
  function _initCSV() {
    const input = document.getElementById('dashCsvFileInput');
    if (!input || input._bound) return;
    input._bound = true;
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('csvUploadStatus');
      const isORC  = file.name.toLowerCase().endsWith('.orc');

      status.innerHTML = `<span class="spinner"></span> ${isORC ? 'Reading ORC file…' : 'Reading CSV…'}`;

      if (isORC) {
        // ORC is a binary columnar format — read as ArrayBuffer and extract text
        const reader = new FileReader();
        reader.onload = async ev => {
          try {
            const text = _extractTextFromBinary(ev.target.result);
            await _processImportedText(text, status, input, 'ORC');
          } catch (err) {
            _importing = false;
            status.innerHTML = `<span style="color:var(--risk-high)">ORC import failed: ${err.message}</span>`;
            console.error('ORC import error:', err);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = async ev => {
          try {
            await _processImportedText(ev.target.result, status, input, 'CSV');
          } catch (err) {
            _importing = false;
            status.innerHTML = `<span style="color:var(--risk-high)">Import failed: ${err.message}</span>`;
            console.error('CSV import error:', err);
          }
        };
        reader.readAsText(file);
      }
    });
  }

  /* Extract readable text strings from an ORC binary ArrayBuffer.
     ORC stores string data as UTF-8 byte sequences inside the binary.
     We scan for printable ASCII/UTF-8 runs of 4+ chars and join them.
     If the result looks like JSON or CSV we parse it; otherwise we
     treat each line as a title. */
  function _extractTextFromBinary(buffer) {
    const bytes = new Uint8Array(buffer);
    const strings = [];
    let cur = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      // Accept printable ASCII (0x20–0x7E), tab (0x09), newline (0x0A/0x0D)
      if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) {
        cur += String.fromCharCode(b);
      } else {
        if (cur.trim().length >= 4) strings.push(cur.trim());
        cur = '';
      }
    }
    if (cur.trim().length >= 4) strings.push(cur.trim());
    return strings.join('\n');
  }

  /* Shared pipeline for both CSV and ORC text once decoded */
  async function _processImportedText(text, status, input, label) {
    // Try JSON array first (some ORC exporters produce JSON)
    let rows = null;
    const trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed.startsWith('{') ? '[' + trimmed + ']' : trimmed);
        if (Array.isArray(parsed) && parsed.length) rows = parsed;
      } catch (_) { /* not valid JSON — fall through to CSV */ }
    }
    if (!rows) rows = _parseCSV(text);

    if (!rows.length) {
      _importing = false;
      status.innerHTML = `<span style="color:var(--risk-high)">No data rows found in ${label} file.</span>`;
      return;
    }

    const incidents = _smartMapRows(rows);
    if (!incidents.length) {
      _importing = false;
      status.innerHTML = `<span style="color:var(--risk-high)">Could not detect any incident data.</span>`;
      return;
    }

    status.innerHTML = `<span class="spinner"></span> Creating ${incidents.length} incident${incidents.length > 1 ? 's' : ''}…`;
    input.value = '';

    // Add all to store immediately so they appear in the list
    _importing = true;
    const added = incidents.map(inc => Store.add(inc));
    refresh();

    let autoExec = 0, needApproval = 0, autoResolved = 0;

    for (let i = 0; i < added.length; i++) {
      await _delay(60 * i);
      const inc = added[i];
      const rca = Store.getRCA(inc.id);
      inc._rca  = rca;
      Store.update(inc.id, { status: 'Investigating' });

      for (let j = 0; j < rca.actions.length; j++) {
        const act = rca.actions[j];
        if (Config.shouldAutoExecute(act.risk_level)) {
          const result = Store.executeAction(act);
          rca.actions[j] = result;
          autoExec++;
        } else {
          rca.actions[j].status = 'awaiting_approval';
          needApproval++;
        }
      }

      const wasResolved = Store.tryAutoResolve(inc.id);
      if (wasResolved) autoResolved++;
    }

    _importing = false;
    refresh();
    _showCSVResultPanel(added.length, autoExec, autoResolved, needApproval, added);

    const summary = `✓ ${added.length} imported — ${autoExec} actions executed, ${autoResolved} resolved, ${needApproval} await approval`;
    status.innerHTML = `<span style="color:var(--risk-low)">${summary}</span>`;
    App.toast(summary, 'success');
    setTimeout(() => { status.textContent = ''; }, 8000);
  }

  /* Smart column mapper — no fixed column names required */
  function _smartMapRows(rows) {
    if (!rows.length) return [];
    const sample = rows[0];
    const keys   = Object.keys(sample);

    // Helper: find the first key whose name contains any of the candidates
    const find = (...candidates) =>
      keys.find(k => candidates.some(c => k.includes(c))) || null;

    const titleKey   = find('title','name','incident','summary','subject','alert','message','event','issue');
    const descKey    = find('description','detail','body','text','info','notes');
    const sevKey     = find('severity','priority','level','urgency','criticality');
    const typeKey    = find('type','category','kind','class','group');
    const serviceKey = find('service','component','system','app','host','source','target');
    const envKey     = find('environment','env','stage','region','cluster','namespace');

    return rows.map((r, idx) => {
      // Safe getter — never returns undefined
      const get = key => (key && r[key]) ? String(r[key]).trim() : '';

      // Best title: dedicated title col → description col (truncated) → first non-empty value → fallback
      const rawTitle = get(titleKey)
        || get(descKey).slice(0, 80)
        || Object.values(r).map(v => String(v||'').trim()).find(v => v.length > 4)
        || `Imported incident #${idx + 1}`;

      // Best description: dedicated desc col → title col → all values joined
      const rawDesc = get(descKey)
        || (titleKey !== descKey ? get(titleKey) : '')
        || Object.entries(r).map(([k,v]) => `${k}: ${v}`).join(' | ');

      const combined = rawTitle + ' ' + rawDesc;

      // Severity: dedicated column first, then text detection
      const severity = _mapSeverity(get(sevKey)) || _detectSeverityFromText(combined);

      // Type: dedicated column first, then text detection
      const type = _mapType(get(typeKey)) || _detectTypeFromText(combined);

      const service     = get(serviceKey) || 'unknown';
      const environment = get(envKey)     || 'Production';

      return {
        title:       rawTitle.slice(0, 120),
        severity,
        type,
        service:     service.slice(0, 60),
        environment: environment.slice(0, 40),
        description: rawDesc.slice(0, 500),
        status:      'Open'
      };
    }).filter(i => i.title && i.title.trim());
  }

  /* ── Severity detection ──────────────────────────────────────── */
  function _mapSeverity(raw) {
    if (!raw) return null;
    const s = raw.toString().toLowerCase().trim();
    if (/^(critical|crit|p0|sev0|sev-0|s0)$/.test(s))      return 'Critical';
    if (/^(high|p1|sev1|sev-1|s1|major|urgent)$/.test(s))   return 'High';
    if (/^(medium|med|p2|sev2|sev-2|s2|moderate|normal)$/.test(s)) return 'Medium';
    if (/^(low|p3|p4|sev3|sev4|minor|info|informational)$/.test(s)) return 'Low';
    return null;
  }

  function _detectSeverityFromText(text) {
    if (!text) return 'Medium';
    const t = text.toLowerCase();
    if (/\b(critical|fatal|outage|down|unavailable|complete failure|total loss)\b/.test(t))    return 'Critical';
    if (/\b(high|error|fail|crash|exception|spike|alert|breach|attack|urgent)\b/.test(t))     return 'High';
    if (/\b(warn|warning|degraded|slow|latency|elevated|moderate|increased|threshold)\b/.test(t)) return 'Medium';
    return 'Low';
  }

  /* ── Type detection ──────────────────────────────────────────── */
  function _mapType(raw) {
    if (!raw) return null;
    const t = raw.toString().toLowerCase();
    if (t.includes('perf') || t.includes('cpu') || t.includes('memory') || t.includes('resource')) return 'Performance';
    if (t.includes('avail') || t.includes('down') || t.includes('outage') || t.includes('crash')) return 'Availability';
    if (t.includes('sec') || t.includes('auth') || t.includes('access') || t.includes('vuln')) return 'Security';
    if (t.includes('data') || t.includes('db') || t.includes('database') || t.includes('replica')) return 'Data';
    if (t.includes('net') || t.includes('dns') || t.includes('connect') || t.includes('timeout')) return 'Network';
    return null;
  }

  function _detectTypeFromText(text) {
    if (!text) return 'Other';
    const t = text.toLowerCase();
    if (/\b(cpu|memory|latency|slow|performance|throughput|queue|disk)\b/.test(t)) return 'Performance';
    if (/\b(down|crash|restart|unavailable|outage|pod|service restart)\b/.test(t)) return 'Availability';
    if (/\b(auth|login|security|certificate|tls|ssl|brute|attack|token|credential)\b/.test(t)) return 'Security';
    if (/\b(database|db|sql|replica|query|data|migration|backup)\b/.test(t))       return 'Data';
    if (/\b(network|dns|timeout|packet|connection|firewall|routing|ip)\b/.test(t)) return 'Network';
    return 'Other';
  }

  /* ── CSV result summary panel ────────────────────────────────── */
  function _showCSVResultPanel(total, autoExec, resolved, needApproval, added) {
    const panel = document.getElementById('csvResultPanel');
    if (!panel) return;

    const rows = added.slice(0, 5).map(inc => `
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;
                  border-bottom:1px solid var(--border-light);font-size:0.8rem;">
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${_e(inc.title)}
        </div>
        ${Store.severityBadge(inc.severity)}
        ${Store.riskBadge(inc._rca?.risk_score >= 60 ? 'High' : inc._rca?.risk_score >= 34 ? 'Medium' : 'Low')}
        <span style="font-size:0.73rem;color:${inc._rca?.actions?.some(a=>a.status==='awaiting_approval') ? 'var(--risk-high)' : 'var(--risk-low)'}">
          ${inc._rca?.actions?.some(a => a.status === 'awaiting_approval') ? '⚠ Needs approval' : '✓ Auto-handled'}
        </span>
      </div>`).join('');

    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="section-card">
        <div class="section-head">
          <div class="section-title">📥 CSV Import Complete</div>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('csvResultPanel').style.display='none'">Dismiss</button>
        </div>
        <div style="padding:0.75rem 1.25rem;">
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:0.75rem;">
            <div style="font-size:0.82rem;"><strong style="font-size:1.2rem;">${total}</strong><br/><span style="color:var(--text-muted)">Incidents created</span></div>
            <div style="font-size:0.82rem;"><strong style="font-size:1.2rem;color:var(--risk-low)">${autoExec}</strong><br/><span style="color:var(--text-muted)">Auto-executed</span></div>
            <div style="font-size:0.82rem;"><strong style="font-size:1.2rem;color:var(--risk-low)">${resolved}</strong><br/><span style="color:var(--text-muted)">Resolved</span></div>
            <div style="font-size:0.82rem;"><strong style="font-size:1.2rem;color:var(--risk-high)">${needApproval}</strong><br/><span style="color:var(--text-muted)">Need approval</span></div>
          </div>
          ${rows}
          ${added.length > 5 ? `<div style="font-size:0.76rem;color:var(--text-muted);padding-top:0.5rem;">+${added.length - 5} more — see Incidents page</div>` : ''}
        </div>
      </div>`;
  }

  /* ── CSV parser — RFC-4180 compliant, handles any delimiter ─────
     Supports: quoted fields with embedded commas/newlines/quotes,
     Windows (\r\n) and Unix (\n) line endings, tab/semicolon/comma
     delimiters, BOM prefix, trailing whitespace.
  ──────────────────────────────────────────────────────────────── */
  function _parseCSV(rawText) {
    // Strip UTF-8 BOM if present, normalise Windows line endings
    const text = rawText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!text) return [];

    // Auto-detect delimiter from the first line
    const firstLine = text.split('\n')[0];
    const delim = firstLine.includes('\t') ? '\t'
                : (firstLine.split(';').length > firstLine.split(',').length) ? ';'
                : ',';

    // Full RFC-4180 parse — handles quoted fields with embedded delimiters/newlines
    const records = [];
    let cur = '', inQ = false, fields = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          // Peek ahead — doubled quote means escaped quote inside field
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else { inQ = false; }   // closing quote
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;             // opening quote
        } else if (ch === delim) {
          fields.push(cur.trim());
          cur = '';
        } else if (ch === '\n') {
          fields.push(cur.trim());
          cur = '';
          if (fields.some(f => f !== '')) records.push(fields);
          fields = [];
        } else {
          cur += ch;
        }
      }
    }
    // Last field / last record
    fields.push(cur.trim());
    if (fields.some(f => f !== '')) records.push(fields);

    if (records.length < 2) return [];

    // First record is headers — normalise to safe key names
    const headers = records[0].map(h =>
      h.replace(/^["']|["']$/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'col'
    );

    // Build row objects
    return records.slice(1).map(vals => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (vals[i] !== undefined ? vals[i] : '').replace(/^["']|["']$/g, '').trim();
      });
      return obj;
    }).filter(r => Object.values(r).some(v => v.length > 0));
  }

  /* _splitLine is kept for backwards compatibility but no longer used by _parseCSV */
  function _splitLine(line, delim) {
    const vals = []; let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === delim && !inQ) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    return vals;
  }

  /* ── KPI drill-down modal ────────────────────────────────────── */
  function openKpiModal(filter) {
    const all = Store.getAll();
    const map = {
      open:          { list: all.filter(i => i.status === 'Open'),          title: 'Open Incidents'      },
      investigating: { list: all.filter(i => i.status === 'Investigating'), title: 'Investigating'       },
      critical:      { list: all.filter(i => (i.severity === 'Critical' || i.severity === 'High') && i.status !== 'Resolved'), title: 'Critical & High' },
      resolved:      { list: all.filter(i => i.status === 'Resolved'),      title: 'Resolved Incidents'  }
    };
    const { list = all, title = 'All Incidents' } = map[filter] || {};
    const isResolved = filter === 'resolved';

    document.getElementById('kpiModalTitle').textContent = title;
    const body = document.getElementById('kpiModalBody');
    if (!body) return;

    body.innerHTML = list.length ? list.map(inc => `
      <div class="incident-item">
        <div class="inc-left">
          <div class="inc-title">${_e(inc.title)}</div>
          <div class="inc-meta">
            ${Store.severityBadge(inc.severity)} ${Store.statusBadge(inc.status)}
            <span class="sep">·</span><span>${_e(inc.service || '—')}</span>
            <span class="sep">·</span><span>${Store.relativeTime(inc.created_at)}</span>
            ${inc.mttr != null ? `<span class="sep">·</span><span>MTTR: ${inc.mttr} min</span>` : ''}
          </div>
        </div>
        <div class="inc-actions">
          ${isResolved
            ? `<button class="btn btn-ghost btn-sm"
                onclick="App.closeModal('modal-kpi');History.viewIncident('${inc.id}')">View</button>`
            : `<button class="btn btn-ghost btn-sm"
                onclick="App.closeModal('modal-kpi');Investigation.open('${inc.id}')">Investigate</button>`}
        </div>
      </div>`).join('')
      : `<div class="empty-state"><div class="empty-state-icon">✅</div><p>No incidents here.</p></div>`;

    App.openModal('modal-kpi');
  }

  /* ── High-risk modal ─────────────────────────────────────────── */
  function openHighRiskModal() {
    const crit = Store.getCritical();
    const body = document.getElementById('highRiskModalBody');
    if (!body) return;
    body.innerHTML = crit.length ? crit.map(inc => `
      <div class="incident-item">
        <div class="inc-left">
          <div class="inc-title">${_e(inc.title)}</div>
          <div class="inc-meta">
            ${Store.severityBadge(inc.severity)} ${Store.statusBadge(inc.status)}
            <span class="sep">·</span><span>${_e(inc.service || '—')}</span>
            <span class="sep">·</span><span>${Store.relativeTime(inc.created_at)}</span>
          </div>
        </div>
        <div class="inc-actions">
          <button class="btn btn-danger btn-sm"
            onclick="App.closeModal('modal-high-risk');Investigation.open('${inc.id}')">Investigate Now</button>
        </div>
      </div>`).join('')
      : `<div class="empty-state"><p>No critical incidents right now.</p></div>`;
    App.openModal('modal-high-risk');
  }

  /* ── CSV template download ───────────────────────────────────── */
  function downloadCsvTemplate() {
    const csv = 'title,severity,type,service,environment,description\n'
      + '"Database CPU spike — production-db","Critical","Performance","production-db","Production","CPU at 98% for 10 min. Queries timing out."\n'
      + '"Auth service crash loop","High","Availability","auth-svc","Production","OOMKilled 5 times in 20 min after v3.4.1 deploy"\n'
      + '"DNS resolution failures","Medium","Network","api-gateway","Production","Packet loss 8.3%, DNS latency 2400ms"';
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      download: 'reactx-incidents-template.csv'
    });
    a.click();
    App.toast('Template downloaded.', 'success');
  }

  function _e(s) { return App.esc ? App.esc(s) : String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { refresh, refreshKPIsOnly, openKpiModal, openHighRiskModal, downloadCsvTemplate };
})();
