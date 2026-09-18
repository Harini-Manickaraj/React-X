/* ================================================================
   REACT-X — dashboard.js
   Clean dashboard: high-risk panel, KPIs, charts, recent list
   ================================================================ */

const Dashboard = (() => {

  let _initialized = false;
  let _charts = {};

  /* ── Init / Refresh ──────────────────────────────────── */
  function init() {
    _renderHighRiskPanel();
    _renderKPIs();
    _renderCharts();
    _renderRecentList();
    if (!_initialized) _initialized = true;

    const ts = document.getElementById('dashTimestamp');
    if (ts) ts.textContent = `Updated ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
  }

  function refresh() {
    const page = document.getElementById('page-dashboard');
    if (!page || !page.classList.contains('active')) return;
    _renderHighRiskPanel();
    _renderKPIs();
    _renderRecentList();
    _rebuildCharts();
  }

  /* ── High-Risk Alert Panel ───────────────────────────── */
  function _renderHighRiskPanel() {
    const panel = document.getElementById('highRiskPanel');
    if (!panel) return;

    const highRisk = Store.getAll().filter(i =>
      i.status !== 'Resolved' && (i.severity === 'Critical' || i.severity === 'High')
    );

    if (highRisk.length === 0) {
      panel.style.display = 'none';
      return;
    }

    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="high-risk-box" onclick="Dashboard.openHighRiskModal()">
        <div class="hrb-left">
          <div class="hrb-icon">🚨</div>
          <div class="hrb-text">
            <div class="hrb-title">
              ${highRisk.length} High-Risk Alert${highRisk.length > 1 ? 's' : ''} Require Immediate Attention
            </div>
            <div class="hrb-sub">
              ${highRisk.filter(i=>i.severity==='Critical').length} Critical
              &nbsp;·&nbsp;
              ${highRisk.filter(i=>i.severity==='High').length} High
              &nbsp;·&nbsp; Click to investigate
            </div>
          </div>
        </div>
        <div class="hrb-right">
          <span class="hrb-cta">View All →</span>
          <div class="hrb-pulse"></div>
        </div>
      </div>`;
  }

  function openHighRiskModal() {
    const highRisk = Store.getAll().filter(i =>
      i.status !== 'Resolved' && (i.severity === 'Critical' || i.severity === 'High')
    );

    const body = document.getElementById('highRiskModalBody');
    if (!body) return;

    if (highRisk.length === 0) {
      body.innerHTML = '<div class="empty-state"><p>No high-risk alerts at this time.</p></div>';
    } else {
      body.innerHTML = `
        <p style="font-size:0.82rem;color:#999;margin-bottom:1rem">
          ${highRisk.length} unresolved alert${highRisk.length>1?'s':''} with Critical or High severity.
          Click any row to open its full investigation.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          ${highRisk.map(inc => `
            <div class="hrm-row" onclick="App.closeModal('modal-high-risk');Investigation.open('${inc.id}')">
              <div class="hrm-left">
                <div class="hrm-title">${_esc(inc.title)}</div>
                <div class="hrm-meta">
                  ${App.severityBadge(inc.severity)}
                  ${App.statusBadge(inc.status)}
                  <span class="text-xs text-muted">${_esc(inc.service || inc.type)}</span>
                  <span class="text-xs text-muted">· ${App.formatTime(inc.createdAt)}</span>
                </div>
              </div>
              <button class="btn btn-sm btn-danger"
                onclick="event.stopPropagation();App.closeModal('modal-high-risk');Investigation.open('${inc.id}')">
                Investigate →
              </button>
            </div>`).join('')}
        </div>`;
    }

    App.openModal('modal-high-risk');
  }

  /* ── KPI Cards ───────────────────────────────────────── */
  function _renderKPIs() {
    const all          = Store.getAll();
    const open         = all.filter(i => i.status !== 'Resolved');
    const critical     = open.filter(i => i.severity === 'Critical').length;
    const high         = open.filter(i => i.severity === 'High').length;
    const investigating= open.filter(i => i.status === 'Investigating').length;
    const resolved     = all.filter(i => i.status === 'Resolved').length;

    const kpis = [
      {
        label: 'Open Incidents', value: open.length,
        meta: `${critical} critical · ${high} high`,
        css: critical > 0 ? 'red-left' : 'accent-left',
        icon: '⚡',
        filter: { type: 'open' }
      },
      {
        label: 'Critical', value: critical,
        meta: 'need immediate action',
        css: critical > 0 ? 'red-left' : 'green-left',
        icon: '🔴',
        filter: { type: 'severity', value: 'Critical' }
      },
      {
        label: 'Investigating', value: investigating,
        meta: 'in progress',
        css: 'yellow-left',
        icon: '🔍',
        filter: { type: 'status', value: 'Investigating' }
      },
      {
        label: 'Resolved', value: resolved,
        meta: 'all time total',
        css: 'green-left',
        icon: '✅',
        filter: { type: 'resolved' }
      }
    ];

    const el = document.getElementById('kpiRow');
    if (!el) return;
    el.innerHTML = kpis.map((k, i) => `
      <div class="kpi-card ${k.css} kpi-clickable"
           onclick="Dashboard.openKpiModal(${i})"
           title="Click to view ${k.label}">
        <div class="kpi-card-top">
          <div class="kpi-icon-large">${k.icon}</div>
          <svg class="kpi-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-meta">${k.meta}</div>
      </div>`).join('');

    // store kpi config for modal use
    _kpiConfig = kpis;
  }

  /* ── KPI Drill-down Modal ────────────────────────────── */
  let _kpiConfig = [];

  function openKpiModal(idx) {
    const k    = _kpiConfig[idx];
    if (!k) return;
    const all  = Store.getAll();

    let list;
    if      (k.filter.type === 'open')             list = all.filter(i => i.status !== 'Resolved');
    else if (k.filter.type === 'severity')         list = all.filter(i => i.severity === k.filter.value && i.status !== 'Resolved');
    else if (k.filter.type === 'status')           list = all.filter(i => i.status === k.filter.value);
    else if (k.filter.type === 'resolved')         list = all.filter(i => i.status === 'Resolved');
    else                                           list = [];

    // Sort: most recent first
    list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const titleEl = document.getElementById('kpiModalTitle');
    if (titleEl) titleEl.innerHTML = `${k.icon} ${k.label} <span style="font-size:0.82rem;font-weight:500;color:#888;margin-left:0.5rem">${list.length} incident${list.length !== 1 ? 's' : ''}</span>`;

    const body = document.getElementById('kpiModalBody');
    if (!body) return;

    if (list.length === 0) {
      body.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/>
          </svg>
          <h3>All clear</h3>
          <p>No incidents in this category right now.</p>
        </div>`;
    } else {
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.5rem">
          ${list.map(inc => `
            <div class="kpi-modal-row" onclick="App.closeModal('modal-kpi');Investigation.open('${inc.id}')">
              <div class="kpi-modal-left">
                <div class="kpi-modal-title">${_esc(inc.title)}</div>
                <div class="kpi-modal-meta">
                  ${App.severityBadge(inc.severity)}
                  ${App.statusBadge(inc.status)}
                  <span class="text-xs text-muted">${_esc(inc.service || inc.type)}</span>
                  <span class="text-xs text-muted">·</span>
                  <span class="text-xs text-muted">${_esc(inc.environment)}</span>
                  <span class="text-xs text-muted">·</span>
                  <span class="text-xs text-muted">${App.formatTime(inc.createdAt)}</span>
                </div>
                ${inc.status === 'Resolved' && inc.resolution ? `
                  <div class="kpi-modal-resolution">✓ ${_esc(inc.resolution.slice(0, 90))}${inc.resolution.length > 90 ? '…' : ''}</div>
                ` : ''}
              </div>
              <div class="kpi-modal-right">
                <button class="btn btn-sm ${inc.severity === 'Critical' ? 'btn-danger' : inc.status === 'Resolved' ? 'btn-ghost' : 'btn-ghost'}"
                  onclick="event.stopPropagation();App.closeModal('modal-kpi');Investigation.open('${inc.id}')">
                  ${inc.status === 'Resolved' ? 'View' : 'Investigate →'}
                </button>
              </div>
            </div>`).join('')}
        </div>`;
    }

    App.openModal('modal-kpi');
  }

  /* ── Charts ──────────────────────────────────────────── */
  function _renderCharts() {
    _destroyAll();
    _buildSeverityChart();
    _buildTypeChart();
    _buildVolumeChart();
  }

  function _rebuildCharts() {
    _destroyAll();
    _buildSeverityChart();
    _buildTypeChart();
    _buildVolumeChart();
  }

  function _destroyAll() {
    Object.values(_charts).forEach(c => { try { c.destroy(); } catch(_) {} });
    _charts = {};
  }

  const _cd = {
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#ffffff',
        bodyColor: '#999999',
        borderColor: 'rgba(185,204,221,0.15)',
        borderWidth: 1,
        padding: 9,
        cornerRadius: 6
      }
    },
    animation: { duration: 500, easing: 'easeOutQuart' }
  };

  function _buildSeverityChart() {
    const ctx = document.getElementById('chartSeverity')?.getContext('2d');
    if (!ctx) return;
    const c = Store.getSeverityCounts();
    _charts.severity = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Critical','High','Medium','Low'],
        datasets: [{
          data: [c.Critical, c.High, c.Medium, c.Low],
          backgroundColor: [
            'rgba(255,68,68,0.85)', 'rgba(255,136,0,0.85)',
            'rgba(185,204,221,0.7)', 'rgba(90,154,90,0.85)'
          ],
          borderColor: ['#ff4444','#ff8800','#b9ccdd','#5a9a5a'],
          borderWidth: 1, borderRadius: 5, borderSkipped: false, barThickness: 32
        }]
      },
      options: {
        ..._cd, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#666', font: { size: 11, weight: '500' } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666', font: { size: 11 }, stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }

  function _buildTypeChart() {
    const ctx = document.getElementById('chartType')?.getContext('2d');
    if (!ctx) return;
    const counts = Store.getTypeCounts();
    const labels = Object.keys(counts);
    const data   = Object.values(counts);
    const palette = [
      'rgba(255,68,68,0.8)','rgba(255,136,0,0.8)','rgba(185,204,221,0.8)',
      'rgba(90,154,90,0.8)','rgba(129,140,248,0.8)','rgba(251,191,36,0.8)'
    ];
    _charts.type = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map((_,i) => palette[i % palette.length]),
          borderColor: '#111111',
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        ..._cd,
        plugins: {
          ..._cd.plugins,
          legend: {
            display: true, position: 'bottom',
            labels: { color: '#888', font: { size: 10 }, padding: 10, boxWidth: 10 }
          }
        },
        responsive: true, maintainAspectRatio: false, cutout: '60%'
      }
    });
  }

  function _buildVolumeChart() {
    const ctx = document.getElementById('chartVolume')?.getContext('2d');
    if (!ctx) return;
    const { labels, counts } = Store.getVolume();
    _charts.volume = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Incidents',
          data: counts,
          borderColor: '#660000',
          backgroundColor: 'rgba(102,0,0,0.15)',
          borderWidth: 2.5,
          pointBackgroundColor: '#aa0000',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        ..._cd, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#666', font: { size: 10 }, maxRotation: 30 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666', font: { size: 11 }, stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }

  /* ── Recent incidents list ───────────────────────────── */
  function _renderRecentList() {
    const el = document.getElementById('dashRecentList');
    if (!el) return;

    const incidents = Store.getIncidents().slice(0, 6);

    if (incidents.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding:2rem">
          <p>✅ No open incidents. All systems healthy.</p>
        </div>`;
      return;
    }

    el.innerHTML = incidents.map(inc => {
      const isHigh = inc.severity === 'Critical' || inc.severity === 'High';
      return `
        <div class="incident-row${isHigh ? ' dash-row-urgent' : ''}"
          onclick="Investigation.open('${inc.id}')" style="cursor:pointer">
          <div class="inc-left">
            <div class="inc-title">
              ${isHigh ? '<span style="color:#ff4444">●</span> ' : ''}${_esc(inc.title)}
            </div>
            <div class="inc-meta">
              ${App.severityBadge(inc.severity)}
              ${App.statusBadge(inc.status)}
              <span>${_esc(inc.service || inc.type)}</span>
              <span>${_esc(inc.environment)}</span>
            </div>
          </div>
          <div class="inc-right">
            <span class="inc-time">${App.formatTime(inc.createdAt)}</span>
            <button class="btn btn-sm${isHigh ? ' btn-danger' : ' btn-ghost'}"
              onclick="event.stopPropagation();Investigation.open('${inc.id}')">
              Investigate
            </button>
          </div>
        </div>`;
    }).join('');
  }

  function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, refresh, openHighRiskModal };
})();

window.Dashboard = Dashboard;
