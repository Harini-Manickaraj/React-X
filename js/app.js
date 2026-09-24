/* ================================================================
   app.js  —  REACT-X
   Top-level controller: routing, auth, nav, toasts, live toggle.

   Fix log (v2.2):
   - AbortSignal.timeout replaced with Promise.race — works in all
     browsers and doesn't crash init() on unsupported platforms.
   - init() no longer awaits the health check before binding forms;
     forms are bound immediately on DOMContentLoaded.
   - _setupApp() is idempotent — nav listeners are added once via a
     flag to prevent duplicates on multiple calls.
   - Auth screen CSS fix: id-level display rules removed so that the
     .screen / .screen.active cascade correctly controls visibility.
   - Settings page wired in as a new nav destination.
   - Page refresh now shows home screen instead of auto-resuming into
     the app; session resume only happens if rx_session flag is set
     (written on login, cleared on logout / tab close via sessionStorage).
   - Admin role correctly routed to #screen-admin on session resume.
   - adminLogout() added for admin sign-out button.
   ================================================================ */
const App = (() => {

  let _currentScreen  = 'home';
  let _currentPage    = 'dashboard';
  let _currentUser    = null;
  let _currentRole    = 'user';   // 'user' or 'admin'  (login page)
  let _signupRole     = 'user';   // 'user' or 'admin'  (signup page)
  let _liveOn         = false;
  let _navBound       = false;

  /* ── Bootstrap ─────────────────────────────────────────────── */
  async function init() {
    // Bind auth forms FIRST — don't wait for network
    _bindForms();

    // Check backend health with a safe timeout that works everywhere
    _checkHealthSafe().then(online => {
      if (online) API.connectWS();
    });

    // Listen for live WS new incidents
    API.onWS('live:new', inc => {
      _showLiveNotification(inc);
      if (_currentPage === 'dashboard') Dashboard.refresh();
    });

    // Listen for store changes — always update KPIs and approval badge,
    // full refresh only when on dashboard page.
    // NOTE: admin.js registers its own Store.subscribe for the admin screen.
    Store.subscribe(() => {
      _updateApprovalBadge();
      if (_currentScreen === 'app') {
        if (_currentPage === 'dashboard') {
          Dashboard.refresh();
        } else {
          // Even off-page, keep KPI row fresh so numbers are correct when navigating back
          Dashboard.refreshKPIsOnly();
        }
      }
    });

    // Check if already logged in (session resume).
    // We use sessionStorage (not localStorage) so that a hard refresh / new tab
    // always starts at home — sessionStorage is cleared when the tab closes.
    const tok = API.getToken();
    const sessionActive = sessionStorage.getItem('rx_session');
    if (tok && sessionActive) {
      const res = await _offlineMeSafe();
      if (res.ok) {
        _currentUser = res.user;
        // Restore the current user tag in the store for incident attribution
        Store.setCurrentUser(_currentUser.email);
        // Route to admin screen if the user is an admin
        if (_currentUser.role === 'admin') {
          const navUser = document.getElementById('adminNavUser');
          if (navUser) navUser.textContent = _currentUser.name || _currentUser.email || '';
          showScreen('admin');
          if (typeof Admin !== 'undefined') Admin.render();
        } else {
          showScreen('app');
          _setupApp();
        }
        return;
      } else {
        // Stale token — clear it and show home
        API.clearToken();
        sessionStorage.removeItem('rx_session');
      }
    }

    showScreen('home');
  }

  /* Safe health check that doesn't throw in any browser */
  async function _checkHealthSafe() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch('http://localhost:8000/api/health', { signal: controller.signal });
      clearTimeout(timer);
      // Manually update API's internal state via the exported method
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  /* Resolve current user from localStorage without any await */
  async function _offlineMeSafe() {
    try {
      const u = localStorage.getItem('rx_user');
      if (u) return { ok: true, user: JSON.parse(u) };
    } catch (_) {}
    // Fall back to API.getMe() for online mode
    return API.getMe();
  }

  /* ── Screen routing ─────────────────────────────────────────── */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    _currentScreen = name;

    // Re-bind forms whenever the login/signup screen becomes visible
    if (name === 'login' || name === 'signup') _bindForms();

    // Reset signup role selector to 'user' each time the signup screen opens
    if (name === 'signup') {
      _signupRole = 'user';
      const userBtn  = document.getElementById('signupRoleUserBtn');
      const adminBtn = document.getElementById('signupRoleAdminBtn');
      if (userBtn)  userBtn.classList.add('role-btn-active');
      if (adminBtn) adminBtn.classList.remove('role-btn-active');
      const adminField = document.getElementById('signupAdminKeyField');
      if (adminField) adminField.style.display = 'none';
    }
  }

  /* ── In-app page navigation ─────────────────────────────────── */
  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');

    // Highlight nav links — skip the Live Demo link (it's a modal trigger, not a page)
    document.querySelectorAll('.nav-link[data-page]').forEach(a => {
      a.classList.toggle('active', a.dataset.page === page);
    });

    _currentPage = page;

    if (page === 'dashboard') Dashboard.refresh();
    if (page === 'incidents') Incidents.refresh();
    if (page === 'history')   History.refresh();
    if (page === 'settings')  Settings.render();
    if (page === 'contact')   Contact.render();
  }

  /* ── App setup (runs once after login) ──────────────────────── */
  function _setupApp() {
    // Only bind nav click listeners once
    if (!_navBound) {
      _navBound = true;
      document.querySelectorAll('.nav-link[data-page]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          navigateTo(a.dataset.page);
        });
      });
    }

    // Show logged-in user name
    const navUser = document.getElementById('navUser');
    if (navUser && _currentUser) {
      navUser.textContent = _currentUser.name || _currentUser.email || '';
    }

    // Auto-start live feed if configured
    if (Config.get('liveAutoStart') && Config.get('liveSignalEnabled')) {
      _liveOn = true;
      Store.startLiveSignals(45000);
      Store.onLiveIncident(inc => _showLiveNotification(inc));
      const btn = document.getElementById('liveToggleBtn');
      btn && btn.classList.add('live-on');
      const dot = document.getElementById('liveIndicator');
      dot && dot.classList.add('live-on');
    }

    // Land on dashboard
    navigateTo('dashboard');
    _updateApprovalBadge();
  }

  /* ── Auth forms ─────────────────────────────────────────────── */
  function _bindForms() {
    _bindLoginForm();
    _bindSignupForm();
  }

  function _bindLoginForm() {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm || loginForm._bound) return;
    loginForm._bound = true;

    loginForm.addEventListener('submit', async e => {
      e.preventDefault();
      _clearErrors('login');

      const email = document.getElementById('loginEmail').value.trim();
      const pw    = document.getElementById('loginPassword').value;
      let valid   = true;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        _setError('loginEmailError', 'Enter a valid email address.');
        valid = false;
      }
      if (!pw || pw.length < 6) {
        _setError('loginPasswordError', 'Password must be at least 6 characters.');
        valid = false;
      }
      if (!valid) return;

      const btn = document.getElementById('loginBtn');
      _setBtnLoading(btn, 'Signing in…');

      const res = await API.login(email, pw);

      _resetBtn(btn, 'Sign In');

      if (!res.ok) {
        _setError('loginFormError', res.error || 'Login failed. Try any email and a password of 6+ characters.');
        return;
      }

      _currentUser = res.user;

      // Route based on selected role
      if (_currentRole === 'admin') {
        // Admin credentials check
        if (email !== 'admin@reactx.com' || pw !== 'admin123') {
          _setError('loginFormError', 'Invalid admin credentials. Use admin@reactx.com / admin123');
          _resetBtn(btn, 'Sign In');
          return;
        }
        _currentUser.role = 'admin';
        // Persist user with role and mark session active (sessionStorage survives navigation but not refresh)
        localStorage.setItem('rx_user', JSON.stringify(_currentUser));
        sessionStorage.setItem('rx_session', '1');
        Store.setCurrentUser(_currentUser.email);
        // Track this admin login in AdminStore
        if (typeof AdminStore !== 'undefined') AdminStore.recordLogin(_currentUser);
        const navUser = document.getElementById('adminNavUser');
        if (navUser) navUser.textContent = _currentUser.name || _currentUser.email || '';
        showScreen('admin');
        if (typeof Admin !== 'undefined') Admin.render();
        toast('Welcome, Admin!', 'success');
      } else {
        _currentUser.role = 'user';
        // Persist user with role and mark session active
        localStorage.setItem('rx_user', JSON.stringify(_currentUser));
        sessionStorage.setItem('rx_session', '1');
        Store.setCurrentUser(_currentUser.email);
        // Track this user login in AdminStore
        if (typeof AdminStore !== 'undefined') AdminStore.recordLogin(_currentUser);
        showScreen('app');
        _setupApp();
        toast('Welcome back, ' + (_currentUser.name || 'there') + '!', 'success');
      }    });
  }

  function _bindSignupForm() {
    const signupForm = document.getElementById('signupForm');
    if (!signupForm || signupForm._bound) return;
    signupForm._bound = true;

    signupForm.addEventListener('submit', async e => {
      e.preventDefault();
      _clearErrors('signup');

      const name  = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const pw    = document.getElementById('signupPassword').value;
      const conf  = document.getElementById('signupConfirm').value;
      let valid   = true;

      if (!name)  { _setError('signupNameError', 'Please enter your name.'); valid = false; }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _setError('signupEmailError', 'Enter a valid email.'); valid = false; }
      if (!pw || pw.length < 6) { _setError('signupPasswordError', 'At least 6 characters required.'); valid = false; }
      if (pw !== conf) { _setError('signupConfirmError', 'Passwords do not match.'); valid = false; }

      // Validate admin key if admin role selected
      if (_signupRole === 'admin') {
        const keyEl = document.getElementById('signupAdminKey');
        const key   = keyEl ? keyEl.value.trim() : '';
        if (key !== 'admin123') {
          _setError('signupAdminKeyError', 'Invalid admin key.');
          valid = false;
        }
      }

      if (!valid) return;

      const btn = document.getElementById('signupBtn');
      _setBtnLoading(btn, 'Creating account…');

      const res = await API.register(name, email, pw);

      _resetBtn(btn, 'Create Account');

      if (!res.ok) {
        _setError('signupFormError', res.error || 'Registration failed.');
        return;
      }

      _currentUser       = res.user;
      _currentUser.name  = name;   // ensure name is set from form
      _currentUser.email = email;
      _currentUser.role  = _signupRole;

      // Persist with role and mark session active
      localStorage.setItem('rx_user', JSON.stringify(_currentUser));
      sessionStorage.setItem('rx_session', '1');

      // Tag the store so new incidents are associated to this user
      Store.setCurrentUser(_currentUser.email);

      // Track login in AdminStore
      if (typeof AdminStore !== 'undefined') AdminStore.recordLogin(_currentUser);

      if (_signupRole === 'admin') {
        const navUser = document.getElementById('adminNavUser');
        if (navUser) navUser.textContent = _currentUser.name || _currentUser.email || '';
        showScreen('admin');
        if (typeof Admin !== 'undefined') Admin.render();
        toast('Admin account created! Welcome.', 'success');
      } else {
        showScreen('app');
        _setupApp();
        toast('Account created! Welcome to REACT-X.', 'success');
      }
    });
  }

  /* ── Signup role selector ────────────────────────────────────── */
  function selectSignupRole(role) {
    _signupRole = role;
    const userBtn  = document.getElementById('signupRoleUserBtn');
    const adminBtn = document.getElementById('signupRoleAdminBtn');
    if (userBtn)  userBtn.classList.toggle('role-btn-active',  role === 'user');
    if (adminBtn) adminBtn.classList.toggle('role-btn-active', role === 'admin');

    // Show/hide admin key field
    const adminField = document.getElementById('signupAdminKeyField');
    if (adminField) adminField.style.display = role === 'admin' ? 'block' : 'none';

    // Clear admin key error when switching away
    if (role === 'user') _setError('signupAdminKeyError', '');
  }

  function _setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function _clearErrors(prefix) {
    document.querySelectorAll(`[id^="${prefix}"][id$="Error"]`).forEach(el => { el.textContent = ''; });
  }

  function _setBtnLoading(btn, label) {
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = label;
  }

  function _resetBtn(btn, label) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = label;
  }

  /* ── Role selection (login page) ────────────────────────────── */
  function selectRole(role) {
    _currentRole = role;
    const userBtn  = document.getElementById('roleUserBtn');
    const adminBtn = document.getElementById('roleAdminBtn');
    if (userBtn)  userBtn.classList.toggle('role-btn-active',  role === 'user');
    if (adminBtn) adminBtn.classList.toggle('role-btn-active', role === 'admin');

    // Pre-fill admin credentials as a hint when admin is selected
    const emailEl = document.getElementById('loginEmail');
    const pwEl    = document.getElementById('loginPassword');
    if (role === 'admin') {
      if (emailEl && !emailEl.value) emailEl.value = 'admin@reactx.com';
      if (pwEl    && !pwEl.value)    pwEl.value    = 'admin123';
    } else {
      if (emailEl && emailEl.value === 'admin@reactx.com') emailEl.value = '';
      if (pwEl    && pwEl.value    === 'admin123')          pwEl.value    = '';
    }
  }

  /* ── Logout ─────────────────────────────────────────────────── */
  function logout() {
    API.clearToken();
    localStorage.removeItem('rx_user');
    sessionStorage.removeItem('rx_session');
    _currentUser  = null;
    _currentRole  = 'user';
    _signupRole   = 'user';
    _navBound     = false;   // reset so nav re-binds on next login
    Store.stopLiveSignals();
    _liveOn = false;
    const btn = document.getElementById('liveToggleBtn');
    if (btn) btn.classList.remove('live-on');
    showScreen('home');
    toast('Signed out.', '');
  }

  /* ── Admin Logout ────────────────────────────────────────────── */
  function adminLogout() {
    API.clearToken();
    localStorage.removeItem('rx_user');
    sessionStorage.removeItem('rx_session');
    _currentUser = null;
    _currentRole = 'user';
    _signupRole  = 'user';
    showScreen('home');
    toast('Signed out.', '');
  }

  /* ── Live toggle ─────────────────────────────────────────────── */
  function toggleLive() {
    // Honour the liveSignalEnabled config setting
    if (!Config.get('liveSignalEnabled') && !_liveOn) {
      App.toast('Live signal feed is disabled in Settings.', 'warning');
      return;
    }
    _liveOn = !_liveOn;
    const btn   = document.getElementById('liveToggleBtn');
    const dot   = document.getElementById('liveIndicator');
    const label = document.getElementById('liveToggleLabel');

    if (_liveOn) {
      Store.startLiveSignals(45000);
      Store.onLiveIncident(inc => _showLiveNotification(inc));
      btn   && btn.classList.add('live-on');
      dot   && dot.classList.add('live-on');
      if (label) label.textContent = 'Live';
      toast('Live alerts enabled — new incidents every ~45 s', 'success');
    } else {
      Store.stopLiveSignals();
      btn   && btn.classList.remove('live-on');
      dot   && dot.classList.remove('live-on');
      toast('Live alerts paused.', '');
    }
  }

  /* ── Live incident notification ──────────────────────────────── */
  function _showLiveNotification(inc) {
    // Respect in-app banners setting
    if (!Config.get('inAppBanners')) return;

    const sev   = inc.severity || 'Medium';
    const color = { Critical: '#ae0d19', High: '#c62828', Medium: '#b45309', Low: '#2e7d32' }[sev] || '#ae0d19';

    // Requirement #7/#8: For Critical incidents, only notify if they REQUIRE human approval.
    // If a Critical incident can be auto-resolved, resolve it silently with no banner.
    if (sev === 'Critical') {
      // Check if any of its actions would require approval
      const rca = Store.getRCA(inc.id);
      if (rca) {
        inc._rca = rca;
        const needsApproval = rca.actions.some(a => !Config.shouldAutoExecute(a.risk_level));
        if (!needsApproval) {
          // All actions are auto-executable — run silently, no notification
          _runSilentAutoResolve(inc, rca);
          return;
        }
      }
    }

    // Low severity: skip banner if notifyLow is disabled
    if (sev === 'Low' && !Config.get('notifyLow')) return;

    const existing = document.getElementById('liveNotif');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'liveNotif';
    el.className = 'live-notification';
    el.style.borderColor = color;
    el.innerHTML = `
      <div class="notif-title" style="color:${color}">
        ${sev === 'Critical' ? '🚨' : sev === 'High' ? '⚠️' : '🔔'} 
        ${sev === 'Critical' ? 'Critical Incident — Approval Required' : 'New Incident Detected'}
      </div>
      <div class="notif-body">
        <strong>${_esc(inc.title)}</strong><br/>
        <span class="badge badge-${sev.toLowerCase()}" style="margin-top:4px;display:inline-flex;">${sev}</span>
        &nbsp;${_esc(inc.service || '')}
      </div>
      <div class="notif-actions">
        <button class="btn btn-primary btn-sm"
          onclick="Investigation.open('${inc.id}');document.getElementById('liveNotif')?.remove();">
          ${sev === 'Critical' || sev === 'High' ? 'Review & Approve' : 'Investigate'}
        </button>
        <button class="btn btn-ghost btn-sm"
          onclick="this.closest('.live-notification').remove();">
          Dismiss
        </button>
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, 12000);

    // Desktop notification if enabled and permitted
    if (Config.get('desktopNotifications') && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(`REACT-X — ${sev} Incident`, { body: inc.title, icon: '' });
    }

    // Sound alert for Critical if enabled (only when approval is needed — already filtered above)
    if (Config.get('soundAlerts') && (sev === 'Critical' || sev === 'High')) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.start(); osc.stop(ctx.currentTime + 0.18);
      } catch (_) {}
    }

    if (_currentPage === 'incidents') Incidents.refresh();
  }

  /* Silent auto-resolution for Critical incidents that don't need approval (req #7/#8) */
  async function _runSilentAutoResolve(inc, rca) {
    // Execute all auto-approvable actions without any banner or toast
    for (const act of rca.actions) {
      if (Config.shouldAutoExecute(act.risk_level)) {
        const result = Store.executeAction(act);
        const ai = rca.actions.findIndex(a => a.id === act.id);
        if (ai !== -1) rca.actions[ai] = result;
      }
    }
    // Attempt auto-resolve
    const resolved = Store.tryAutoResolve(inc.id);
    if (resolved && _currentPage === 'dashboard') Dashboard.refresh();
    // No toast, no banner — completely silent
  }

  /* ── Approval badge (nav bar) ────────────────────────────────── */
  function _updateApprovalBadge() {
    const awaiting = Store.getAwaiting();
    const badge    = document.getElementById('navApprovalBadge');
    const count    = document.getElementById('navApprovalCount');
    if (!badge) return;
    if (awaiting.length > 0) {
      badge.style.display = 'inline-flex';
      if (count) count.textContent = awaiting.length;
    } else {
      badge.style.display = 'none';
    }
  }

  /* ── Modal helpers ───────────────────────────────────────────── */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('open');
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  }

  // Close modal when clicking the backdrop
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('open');
    }
  });

  /* ── Password show/hide toggle ───────────────────────────────── */
  function togglePassword(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const isText = inp.type === 'text';
    inp.type = isText ? 'password' : 'text';
    const show = btn.querySelector('.eye-show');
    const hide = btn.querySelector('.eye-hide');
    if (show) show.style.display = isText ? '' : 'none';
    if (hide) hide.style.display = isText ? 'none' : '';
  }

  /* ── Toast notifications ─────────────────────────────────────── */
  function toast(message, type = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast${type ? ' toast-' + type : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 320);
    }, 3500);
  }

  /* ── HTML-escape helper ──────────────────────────────────────── */
  function _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function esc(str) { return _esc(str); }

  /* ── Boot ────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', init);

  return {
    init, showScreen, navigateTo, logout, adminLogout,
    selectRole, selectSignupRole,
    toggleLive,
    openModal, closeModal,
    togglePassword,
    toast, esc
  };
})();
