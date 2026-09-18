/* ================================================================
   REACT-X — app.js
   Auth, routing, toasts, modal helpers, live update signals
   ================================================================ */

const App = (() => {

  let _currentUser  = null;
  let _currentPage  = 'dashboard';
  let _liveInterval = null;

  /* ── Boot ─────────────────────────────────────────────── */
  function init() {
    _setupAuth();
    _setupNav();
    _restoreSession();
  }

  /* ── Screen routing ────────────────────────────────────── */
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
    if (name !== 'app' && _liveInterval) {
      clearInterval(_liveInterval);
      _liveInterval = null;
    }
    // scroll to top when switching screens
    window.scrollTo(0, 0);
  }

  function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');
    const navEl = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');

    _currentPage = page;

    if (page === 'dashboard')  Dashboard.init();
    if (page === 'incidents')  Incidents.init();
    if (page === 'history')    History.init();
  }

  /* ================================================================
     AUTH — accepts ANY email + password (min 6 chars) for demo.
     Registered users are stored in sessionStorage so they persist
     across page reloads within the same browser tab.
  ================================================================ */
  function _setupAuth() {

    /* ── Pre-fill login email from last session ── */
    const lastEmail = localStorage.getItem('rx_last_email');
    if (lastEmail) {
      const el = document.getElementById('loginEmail');
      if (el) el.value = lastEmail;
    }

    /* ── Signup: auto-fill name when email is typed ── */
    document.getElementById('signupEmail')?.addEventListener('input', function () {
      const email   = this.value.trim();
      const nameEl  = document.getElementById('signupName');
      const hintEl  = document.getElementById('signupEmailHint');
      if (!email.includes('@')) { if (hintEl) hintEl.textContent = ''; return; }

      const existing = _loadUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        if (hintEl) hintEl.textContent = `✓ Account found for ${existing.name} — sign in instead?`;
        if (nameEl && !nameEl.value) nameEl.value = existing.name;
      } else {
        if (hintEl) hintEl.textContent = '';
        if (nameEl && !nameEl.value) nameEl.value = _nameFromEmail(email);
      }
    });

    /* ── Login ── */
    document.getElementById('loginForm')?.addEventListener('submit', e => {
      e.preventDefault();
      _clearErrors('loginEmailError', 'loginPasswordError', 'loginFormError');

      const email    = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      let ok = true;
      if (!email || !_validEmail(email)) {
        _setError('loginEmailError', 'Enter a valid email address.');
        ok = false;
      }
      if (!password || password.length < 6) {
        _setError('loginPasswordError', 'Password must be at least 6 characters.');
        ok = false;
      }
      if (!ok) return;

      // Try registered users first
      let user = _loadUsers().find(
        u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
      );

      // Demo fallback — accept any valid email+password combo
      if (!user) {
        user = { name: _nameFromEmail(email), email, password };
        _saveUser(user);
      }

      localStorage.setItem('rx_last_email', email);
      _signIn(user);
    });

    /* ── Sign-up ── */
    document.getElementById('signupForm')?.addEventListener('submit', e => {
      e.preventDefault();
      _clearErrors('signupNameError', 'signupEmailError', 'signupPasswordError', 'signupConfirmError', 'signupFormError');

      const name     = document.getElementById('signupName').value.trim();
      const email    = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const confirm  = document.getElementById('signupConfirm').value;

      let ok = true;
      if (!name)                        { _setError('signupNameError',     'Full name is required.');                   ok = false; }
      if (!email || !_validEmail(email)){ _setError('signupEmailError',    'Enter a valid email address.');             ok = false; }
      if (!password || password.length < 6){ _setError('signupPasswordError','Password must be at least 6 characters.'); ok = false; }
      if (password !== confirm)          { _setError('signupConfirmError', 'Passwords do not match.');                  ok = false; }
      if (!ok) return;

      const exists = _loadUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
      if (exists) {
        _setError('signupFormError', 'An account with this email already exists. Sign in instead.');
        return;
      }

      const user = { name, email, password };
      _saveUser(user);
      localStorage.setItem('rx_last_email', email);
      _signIn(user);
    });
  }

  function _signIn(user) {
    _currentUser = user;
    // Persist active session
    sessionStorage.setItem('rx_session', JSON.stringify({ name: user.name, email: user.email }));

    const navUser = document.getElementById('navUser');
    if (navUser) navUser.textContent = user.name;

    showScreen('app');
    navigateTo('dashboard');
    _startLive();
    toast(`Welcome, ${user.name}!`, 'success');
  }

  function logout() {
    if (_liveInterval) { clearInterval(_liveInterval); _liveInterval = null; }
    Store.unsubscribe(_onStoreEvent);
    _currentUser = null;
    sessionStorage.removeItem('rx_session');
    document.getElementById('loginForm')?.reset();
    document.getElementById('signupForm')?.reset();
    _clearErrors('loginEmailError','loginPasswordError','loginFormError',
                 'signupNameError','signupEmailError','signupPasswordError','signupConfirmError','signupFormError');
    showScreen('home');
    toast('You have been signed out.', 'info');
  }

  function _restoreSession() {
    try {
      const raw = sessionStorage.getItem('rx_session');
      if (raw) {
        const session = JSON.parse(raw);
        if (session && session.name && session.email) {
          _currentUser = session;
          const navUser = document.getElementById('navUser');
          if (navUser) navUser.textContent = session.name;
          showScreen('app');
          navigateTo('dashboard');
          _startLive();
          return;
        }
      }
    } catch (_) {}
    showScreen('home');
  }

  function getUser() { return _currentUser; }

  /* ── Persistent user store (localStorage) ─────────────── */
  function _loadUsers() {
    try { return JSON.parse(localStorage.getItem('rx_users') || '[]'); } catch { return []; }
  }
  function _saveUser(user) {
    const users = _loadUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (idx >= 0) users[idx] = user; else users.push(user);
    localStorage.setItem('rx_users', JSON.stringify(users));
  }
  function _nameFromEmail(email) {
    const local = email.split('@')[0].replace(/[._\-+]/g, ' ');
    return local.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'User';
  }

  /* ── Live signals ──────────────────────────────────────── */
  function _startLive() {
    const dot = document.getElementById('liveIndicator');
    if (dot) dot.classList.add('pulse');
    Store.unsubscribe(_onStoreEvent);
    Store.subscribe(_onStoreEvent);
    if (_liveInterval) clearInterval(_liveInterval);
    _liveInterval = Store.startLiveSignals();
  }

  function _onStoreEvent(event, payload) {
    if (event === 'live:new') _showLiveBanner(payload);
    if (event === 'incident:created' || event === 'incident:updated') {
      if (_currentPage === 'dashboard') Dashboard.refresh();
      if (_currentPage === 'incidents') Incidents.refresh();
      if (_currentPage === 'history')   History.refresh();
    }
  }

  function _showLiveBanner(inc) {
    const old = document.querySelector('.live-banner');
    if (old) old.remove();

    const isCritical = inc.severity === 'Critical' || inc.severity === 'High';
    const banner = document.createElement('div');
    banner.className = `live-banner${isCritical ? ' live-banner-critical' : ''}`;
    banner.innerHTML = `
      <span class="live-dot"></span>
      <span>${isCritical ? '🚨 ' : ''}<strong>${_esc(inc.title)}</strong> — ${inc.severity}</span>
      <button class="btn btn-sm btn-ghost" style="margin-left:auto"
        onclick="Investigation.open('${inc.id}');this.closest('.live-banner').remove()">Investigate</button>
      <button style="background:none;border:none;cursor:pointer;color:inherit;font-size:1.1rem;padding:0 0.3rem"
        onclick="this.parentElement.remove()">×</button>`;

    const main = document.querySelector('.app-main');
    if (main) main.prepend(banner);
    toast(`${isCritical ? '🚨 ' : ''}New: ${inc.title}`, isCritical ? 'error' : 'warning', 6000);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
  }

  /* ── Nav ───────────────────────────────────────────────── */
  function _setupNav() {
    document.querySelectorAll('.nav-link[data-page]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        navigateTo(link.dataset.page);
      });
    });
  }

  /* ── Modals ────────────────────────────────────────────── */
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.addEventListener('click', _backdropClose);
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    el.removeEventListener('click', _backdropClose);
  }
  function _backdropClose(e) {
    if (e.target === e.currentTarget) closeModal(e.currentTarget.id);
  }

  /* ── Toast ─────────────────────────────────────────────── */
  function toast(message, type = 'info', duration = 3500) {
    const icon = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ';
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icon}</span><span>${_esc(message)}</span>`;
    const c = document.getElementById('toastContainer');
    if (!c) return;
    c.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      t.style.transition = '0.25s ease';
      setTimeout(() => t.remove(), 280);
    }, duration);
  }

  /* ── Helpers ───────────────────────────────────────────── */
  function _validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function _setError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
  function _clearErrors(...ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; }); }
  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function formatTime(iso) {
    if (!iso) return '—';
    const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (diff < 60)    return 'Just now';
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  function severityBadge(sev) {
    const cls = { Critical:'badge-critical', High:'badge-high', Medium:'badge-medium', Low:'badge-low' }[sev] || 'badge-neutral';
    return `<span class="badge ${cls}">${sev}</span>`;
  }
  function statusBadge(status) {
    const cls = { Open:'badge-open', Investigating:'badge-investigating', Resolved:'badge-resolved' }[status] || 'badge-neutral';
    return `<span class="badge ${cls}">${status}</span>`;
  }

  /* ── Toggle password visibility ───────────────────────── */
  function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const eyeShow = btn.querySelector('.eye-show');
    const eyeHide = btn.querySelector('.eye-hide');
    if (eyeShow) eyeShow.style.display = isHidden ? 'none'  : '';
    if (eyeHide) eyeHide.style.display = isHidden ? ''      : 'none';
  }

  return {
    init, showScreen, navigateTo, logout, getUser,
    openModal, closeModal, toast, togglePassword,
    formatTime, severityBadge, statusBadge
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
window.App = App;
