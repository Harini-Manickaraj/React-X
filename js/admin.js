/* ================================================================
   admin.js  —  REACT-X
   AdminStore  — tracks user logins, associates all incidents to users
   Admin       — renders admin dashboard UI, live-synced to Store
   ================================================================ */

/* ── AdminStore ─────────────────────────────────────────────────── */
const AdminStore = (() => {
  const SK = 'rx_admin_sessions';

  function _load() {
    try { return JSON.parse(localStorage.getItem(SK) || '[]'); } catch(_) { return []; }
  }
  function _save(s) {
    try { localStorage.setItem(SK, JSON.stringify(s)); } catch(_) {}
  }

  /* Record a login — increments count for returning users */
  function recordLogin(user) {
    const sessions = _load();
    const existing = sessions.find(s => s.email === user.email);
    if (existing) {
      existing.loginCount++;
      existing.lastLogin = new Date().toISOString();
      existing.name = user.name || existing.name;
      existing.role = user.role || existing.role || 'user';
    } else {
      sessions.push({
        id:         Store.uid(),
        email:      user.email,
        name:       user.name || user.email.split('@')[0],
        role:       user.role || 'user',
        loginCount: 1,
        firstLogin: new Date().toISOString(),
        lastLogin:  new Date().toISOString()
      });
    }
    _save(sessions);
  }

  function getSessions() { return _load(); }
  function getUsers()    { return _load().filter(s => s.role !== 'admin'); }

  /* Returns ALL incidents created by this user.
     Uses the createdBy field stamped on Store.add().
     Falls back to round-robin for seed/legacy incidents that predate
     the createdBy field, so the admin dashboard always shows data. */
  function getIncidentsForUser(email) {
    const all   = Store.getAll();
    const users = getUsers();
    if (!all.length || !users.length) return [];

    // Incidents explicitly tagged to this user
    const owned = all.filter(i => i.createdBy === email);
    if (owned.length > 0) return owned;

    // Fallback: round-robin for seed incidents (no createdBy)
    const untagged = all.filter(i => !i.createdBy);
    if (!untagged.length) return [];
    const userIdx = users.findIndex(u => u.email === email);
    if (userIdx === -1) return [];
    return untagged.filter((_, i) => i % users.length === userIdx);
  }

  /* Live stats — reads directly from Store every time */
  function getStats() {
    const all      = Store.getAll();
    const sessions = _load();
    const users    = sessions.filter(s => s.role !== 'admin');

    // Count resolved by summing per-user to handle both tagged and fallback incidents
    let totalResolved = 0;
    users.forEach(u => {
      const userIncs = getIncidentsForUser(u.email);
      totalResolved += userIncs.filter(i => i.status === 'Resolved').length;
    });
    // De-dup: if no users yet, just count from the store directly
    if (!users.length) totalResolved = all.filter(i => i.status === 'Resolved').length;

    return {
      totalUsers:     users.length,
      activeToday:    sessions.filter(s => {
        return new Date(s.lastLogin).toDateString() === new Date().toDateString();
      }).length,
      totalIncidents: all.length,
      totalResolved
    };
  }

  return { recordLogin, getSessions, getUsers, getIncidentsForUser, getStats };
})();


/* ── Admin ──────────────────────────────────────────────────────── */
const Admin = (() => {

  let _selectedUser = null;
  let _filterSev    = '';
  let _searchText   = '';
  let _subscribed   = false;

  /* ── Public: main render ─────────────────────────────────────── */
  function render() {
    const el = document.getElementById('adminContent');
    if (!el) return;

    // Reset selection state only on explicit navigation (not subscriber-driven refreshes)
    _selectedUser = null;
    _filterSev    = '';
    _searchText   = '';

    // Subscribe to Store changes once — refreshes admin live
    if (!_subscribed) {
      _subscribed = true;
      Store.subscribe(() => {
        // Only re-render if admin screen is currently visible
        const adminScreen = document.getElementById('screen-admin');
        if (!adminScreen?.classList.contains('active')) return;

        if (_selectedUser) {
          _refreshUserTable();   // update user detail table live
        } else {
          // Re-render dashboard but don't reset state
          const content = document.getElementById('adminContent');
          if (content) _renderDashboard(content);
        }
      });
    }

    _renderDashboard(el);
  }

  /* ── Admin dashboard ─────────────────────────────────────────── */
  function _renderDashboard(el) {
    if (!el) return;
    const stats = AdminStore.getStats();
    const users = AdminStore.getUsers();
    const now   = new Date().toLocaleString('en-US', {
      month:'short', day:'numeric', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });

    el.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">Admin Dashboard</h1>
          <p class="page-sub">Last updated ${now}</p>
        </div>
        <button class="btn btn-primary" onclick="Admin._exportAllCSV()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5" style="flex-shrink:0;">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Export All
        </button>
      </div>

      <!-- KPI row — 4 cards, no Open/Still active -->
      <div class="kpi-row" style="margin-bottom:1.5rem;grid-template-columns:repeat(4,1fr);">
        ${_kpi('Total Users',    stats.totalUsers,    'Accounts logged in')}
        ${_kpi('Active Today',   stats.activeToday,   'Logged in today')}
        ${_kpi('Total Incidents',stats.totalIncidents,'Across all users')}
        ${_kpi('Resolved',       stats.totalResolved, 'Successfully closed')}
      </div>

      <!-- Users table -->
      <div class="section-card" style="margin-bottom:1.25rem;">
        <div class="section-head">
          <div class="section-title">👥 Logged-In Users</div>
          <span style="font-size:0.78rem;color:var(--text-muted);">
            Click a row to view that user's incidents
          </span>
        </div>
        ${users.length ? `
          <div style="overflow-x:auto;">
            <table class="history-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Login Count</th>
                  <th>Last Login</th>
                  <th>First Login</th>
                  <th>Incidents</th>
                  <th>Resolved</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => {
                  const all      = AdminStore.getIncidentsForUser(u.email);
                  const resolved = all.filter(i => i.status === 'Resolved').length;
                  return `
                    <tr style="cursor:pointer;" onclick="Admin._openUser('${e(u.email)}')">
                      <td>
                        <div style="display:flex;align-items:center;gap:0.6rem;">
                          <div style="width:32px;height:32px;border-radius:50%;
                            background:var(--accent);color:#fff;display:flex;
                            align-items:center;justify-content:center;
                            font-weight:700;font-size:0.82rem;flex-shrink:0;">
                            ${e(u.name.charAt(0).toUpperCase())}
                          </div>
                          <span style="font-weight:600;">${e(u.name)}</span>
                        </div>
                      </td>
                      <td style="font-size:0.8rem;color:var(--text-secondary);">${e(u.email)}</td>
                      <td style="font-size:0.82rem;font-weight:600;">${u.loginCount}</td>
                      <td style="font-size:0.79rem;color:var(--text-secondary);">${_fmt(u.lastLogin)}</td>
                      <td style="font-size:0.79rem;color:var(--text-secondary);">${_fmt(u.firstLogin)}</td>
                      <td style="font-weight:600;">${all.length}</td>
                      <td>
                        <span style="font-weight:700;color:${resolved>0?'var(--risk-low)':'var(--text-muted)'};">
                          ${resolved}
                        </span>
                      </td>
                      <td>
                        <button class="btn btn-ghost btn-sm"
                          onclick="event.stopPropagation();Admin._openUser('${e(u.email)}')">
                          View →
                        </button>
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state" style="padding:2.5rem;">
            <div class="empty-state-icon">👤</div>
            <h4>No users have logged in yet</h4>
            <p>Users will appear here after they sign in with the User role.</p>
          </div>
        `}
      </div>

      <!-- All incidents overview -->
      <div class="section-card">
        <div class="section-head">
          <div class="section-title">📊 All Incidents Overview</div>
          <button class="btn btn-ghost btn-sm" onclick="Admin._exportAllCSV()">Export CSV</button>
        </div>
        ${_renderAllIncidentsTable(Store.getAll())}
      </div>`;
  }

  /* ── User detail view ─────────────────────────────────────────── */
  function _openUser(email) {
    const user = AdminStore.getUsers().find(u => u.email === email);
    if (!user) return;
    _selectedUser = user;
    _filterSev    = '';
    _searchText   = '';
    _renderUserView();
  }

  function _renderUserView() {
    const el = document.getElementById('adminContent');
    if (!el || !_selectedUser) return;
    const u         = _selectedUser;
    const incidents = AdminStore.getIncidentsForUser(u.email);
    const resolved  = incidents.filter(i => i.status === 'Resolved').length;
    const withMTTR  = incidents.filter(i => i.mttr != null);
    const avgMTTR   = withMTTR.length
      ? Math.round(withMTTR.reduce((a,i) => a + i.mttr, 0) / withMTTR.length)
      : null;

    el.innerHTML = `
      <div class="page-head">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <button class="btn btn-ghost btn-sm" onclick="Admin.render()">← Back</button>
          <div>
            <h1 class="page-title" style="font-size:1.25rem;">
              ${e(u.name)}'s Incidents
            </h1>
            <p class="page-sub">
              ${e(u.email)} &nbsp;·&nbsp;
              ${u.loginCount} login${u.loginCount > 1 ? 's' : ''} &nbsp;·&nbsp;
              Last active ${_fmt(u.lastLogin)}
            </p>
          </div>
        </div>
        <button class="btn btn-primary" onclick="Admin._exportUserCSV('${e(u.email)}')">
          Export CSV
        </button>
      </div>

      <!-- 3 KPI cards — no Open/Still active -->
      <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.25rem;">
        ${_kpi('Total Incidents', incidents.length, 'Assigned to this user')}
        ${_kpi('Resolved',        resolved,         'Closed successfully')}
        ${_kpi('Avg MTTR',        avgMTTR != null ? avgMTTR + ' min' : '—', 'Mean time to resolve')}
      </div>

      <!-- Filters -->
      <div class="filter-bar" style="margin-bottom:1rem;">
        <input type="text" class="input input-sm" id="adminUserSearch"
          placeholder="Search incidents…" value="${e(_searchText)}"
          oninput="Admin._onSearch(this.value)" style="max-width:260px;"/>
        <select class="input input-sm" id="adminSevFilter"
          onchange="Admin._onFilter(this.value)">
          <option value="">All severities</option>
          <option value="Critical" ${_filterSev==='Critical'?'selected':''}>Critical</option>
          <option value="High"     ${_filterSev==='High'    ?'selected':''}>High</option>
          <option value="Medium"   ${_filterSev==='Medium'  ?'selected':''}>Medium</option>
          <option value="Low"      ${_filterSev==='Low'     ?'selected':''}>Low</option>
        </select>
      </div>

      <!-- Incidents table (refreshes live via Store.subscribe) -->
      <div class="section-card" id="adminUserTable">
        ${_renderUserIncidents(incidents)}
      </div>`;
  }

  /* ── Incident table for a user (filtered) ─────────────────────── */
  function _renderUserIncidents(incidents) {
    let list = [...incidents];
    if (_filterSev)  list = list.filter(i => i.severity === _filterSev);
    if (_searchText) list = list.filter(i =>
      i.title.toLowerCase().includes(_searchText.toLowerCase()) ||
      (i.service || '').toLowerCase().includes(_searchText.toLowerCase()));
    list.sort((a,b) => new Date(b.updated_at||b.created_at) - new Date(a.updated_at||a.created_at));

    if (!list.length) {
      return `<div class="empty-state" style="padding:2rem;">
        <div class="empty-state-icon">🔍</div>
        <h4>No incidents match</h4>
        <p>Try adjusting the filters.</p>
      </div>`;
    }

    return `
      <div style="overflow-x:auto;">
        <table class="history-table">
          <thead>
            <tr>
              <th>Incident</th>
              <th>Severity</th>
              <th>Type</th>
              <th>Service</th>
              <th>Status</th>
              <th>MTTR</th>
              <th>Date</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(inc => `
              <tr>
                <td>
                  <div style="font-weight:600;font-size:0.84rem;">${e(inc.title)}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);">${e(inc.environment||'')}</div>
                </td>
                <td>${Store.severityBadge(inc.severity)}</td>
                <td style="font-size:0.79rem;color:var(--text-secondary);">${e(inc.type||'—')}</td>
                <td style="font-size:0.79rem;color:var(--text-secondary);">${e(inc.service||'—')}</td>
                <td>${Store.statusBadge(inc.status)}</td>
                <td>
                  <span style="font-weight:700;color:${_mttrColor(inc.mttr)};">
                    ${inc.mttr != null ? inc.mttr + ' min' : '—'}
                  </span>
                </td>
                <td style="font-size:0.78rem;color:var(--text-secondary);white-space:nowrap;">
                  ${(inc.updated_at || inc.created_at)
                    ? new Date(inc.updated_at || inc.created_at).toLocaleDateString('en-US',
                        {month:'short', day:'numeric', year:'numeric'})
                    : '—'}
                </td>
                <td style="font-size:0.77rem;color:var(--text-secondary);max-width:200px;">
                  ${inc.resolution
                    ? e(inc.resolution).slice(0,80) + (inc.resolution.length > 80 ? '…' : '')
                    : '—'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ── All incidents overview table ─────────────────────────────── */
  function _renderAllIncidentsTable(incidents) {
    const sorted = [...incidents]
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 20);
    if (!sorted.length) return `<div class="empty-state"><p>No incidents yet.</p></div>`;
    return `
      <div style="overflow-x:auto;">
        <table class="history-table">
          <thead>
            <tr>
              <th>Incident</th><th>Severity</th><th>Type</th>
              <th>Service</th><th>Status</th><th>MTTR</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(inc => `
              <tr>
                <td><div style="font-weight:600;font-size:0.84rem;">${e(inc.title)}</div></td>
                <td>${Store.severityBadge(inc.severity)}</td>
                <td style="font-size:0.79rem;color:var(--text-secondary);">${e(inc.type||'—')}</td>
                <td style="font-size:0.79rem;color:var(--text-secondary);">${e(inc.service||'—')}</td>
                <td>${Store.statusBadge(inc.status)}</td>
                <td style="font-weight:600;color:${_mttrColor(inc.mttr)};">
                  ${inc.mttr != null ? inc.mttr + ' min' : '—'}
                </td>
                <td style="font-size:0.78rem;color:var(--text-secondary);">
                  ${new Date(inc.created_at).toLocaleDateString('en-US',
                    {month:'short', day:'numeric', year:'numeric'})}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:0.5rem 1rem;font-size:0.75rem;color:var(--text-muted);">
        Showing latest 20 of ${incidents.length} incidents
      </div>`;
  }

  /* ── Filter / search handlers ────────────────────────────────── */
  function _onFilter(val) {
    _filterSev = val;
    _refreshUserTable();
  }

  function _onSearch(val) {
    _searchText = val;
    _refreshUserTable();
  }

  function _refreshUserTable() {
    if (!_selectedUser) return;
    const el = document.getElementById('adminUserTable');
    if (!el) return;
    el.innerHTML = _renderUserIncidents(AdminStore.getIncidentsForUser(_selectedUser.email));
  }

  /* ── Export ──────────────────────────────────────────────────── */
  function _exportUserCSV(email) {
    const user = AdminStore.getUsers().find(u => u.email === email);
    if (!user) return;
    let list = AdminStore.getIncidentsForUser(email);
    if (_filterSev)  list = list.filter(i => i.severity === _filterSev);
    if (_searchText) list = list.filter(i =>
      i.title.toLowerCase().includes(_searchText.toLowerCase()));
    _downloadCSV(list, `reactx-${user.name.replace(/\s+/g,'-').toLowerCase()}.csv`);
    App.toast(`Exported ${list.length} incidents for ${user.name}.`, 'success');
  }

  function _exportAllCSV() {
    const list = Store.getAll();
    _downloadCSV(list, `reactx-all-${new Date().toISOString().slice(0,10)}.csv`);
    App.toast(`Exported ${list.length} incidents.`, 'success');
  }

  function _downloadCSV(list, filename) {
    const headers = ['id','title','severity','type','service','environment',
                     'status','mttr_min','created_at','updated_at','resolution'];
    const rows = list.map(i =>
      headers.map(h => {
        const v = h === 'mttr_min' ? (i.mttr != null ? i.mttr : '') : (i[h] || '');
        return `"${String(v).replace(/"/g,'""')}"`;
      }).join(','));
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([[headers.join(','), ...rows].join('\n')], {type:'text/csv'})),
      download: filename
    });
    a.click();
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _kpi(label, value, sub, valClass = '') {
    return `<div class="kpi-card" style="cursor:default;">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${valClass}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  }

  function _fmt(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-US',
      {month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'});
  }

  function _mttrColor(mttr) {
    if (mttr == null) return 'var(--text-muted)';
    if (mttr <= 20)   return 'var(--risk-low)';
    if (mttr <= 60)   return 'var(--risk-medium)';
    return 'var(--risk-high)';
  }

  function e(s) {
    return App.esc
      ? App.esc(s)
      : String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render, _openUser, _onFilter, _onSearch, _exportUserCSV, _exportAllCSV };
})();
