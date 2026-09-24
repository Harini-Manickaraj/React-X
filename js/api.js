/* ================================================================
   api.js  —  REACT-X
   All backend communication. Falls back to Store (offline mode)
   when the FastAPI backend at localhost:8000 is not reachable.
   ================================================================ */
const API = (() => {

  const BASE = 'http://localhost:8000/api';
  let _token = null;
  let _online = false;   // updated by health-check on init
  let _wsConn = null;
  let _wsCallbacks = {};

  /* ── token helpers ──────────────────────────────────────────── */
  function setToken(t) { _token = t; if (t) localStorage.setItem('rx_token', t); else localStorage.removeItem('rx_token'); }
  function getToken()  { return _token || localStorage.getItem('rx_token'); }
  function clearToken(){ setToken(null); }

  /* ── low-level fetch wrapper ────────────────────────────────── */
  async function _fetch(path, opts = {}) {
    const tok = getToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
    const res = await fetch(BASE + path, { ...opts, headers });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); msg = j.detail || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  /* ── connectivity check ─────────────────────────────────────── */
  async function checkHealth() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(BASE + '/health', { signal: controller.signal });
      clearTimeout(timer);
      _online = r.ok;
    } catch (_) {
      _online = false;
    }
    return _online;
  }

  function isOnline() { return _online; }

  /* ── Auth endpoints ─────────────────────────────────────────── */
  async function login(email, password) {
    if (!_online) return _offlineLogin(email, password);
    try {
      const data = await _fetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setToken(data.access_token);
      // Return user without persisting — app.js merges the role then persists
      return { ok: true, user: data.user || { name: email.split('@')[0], email } };
    } catch (e) {
      // Backend failed — fall back to offline auth
      return _offlineLogin(email, password);
    }
  }

  async function register(name, email, password) {
    if (!_online) return _offlineRegister(name, email, password);
    try {
      const data = await _fetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
      });
      setToken(data.access_token);
      // Return user without persisting — app.js merges the role then persists
      return { ok: true, user: data.user || { name, email } };
    } catch (e) {
      return _offlineRegister(name, email, password);
    }
  }

  async function getMe() {
    // Try localStorage first (instant, works offline)
    const cached = localStorage.getItem('rx_user');
    if (cached) {
      try { return { ok: true, user: JSON.parse(cached) }; } catch (_) {}
    }
    if (!_online) return { ok: false, error: 'Not logged in.' };
    try {
      const user = await _fetch('/auth/me');
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ── Incidents endpoints ────────────────────────────────────── */
  async function getIncidents(params = {}) {
    if (!_online) return { ok: true, data: Store.getAll() };
    try {
      const qs = new URLSearchParams(params).toString();
      const data = await _fetch(`/incidents${qs ? '?' + qs : ''}`);
      return { ok: true, data: data.items || data };
    } catch (e) {
      return { ok: true, data: Store.getAll() }; // fallback to store
    }
  }

  async function getIncident(id) {
    if (!_online) return { ok: true, data: Store.getById(id) };
    try {
      const data = await _fetch(`/incidents/${id}`);
      return { ok: true, data };
    } catch (e) {
      return { ok: true, data: Store.getById(id) };
    }
  }

  async function createIncident(payload) {
    if (!_online) {
      const inc = Store.add(payload);
      return { ok: true, data: inc };
    }
    try {
      const data = await _fetch('/incidents', { method: 'POST', body: JSON.stringify(payload) });
      Store.add(data); // keep store in sync
      return { ok: true, data };
    } catch (e) {
      const inc = Store.add(payload);
      return { ok: true, data: inc };
    }
  }

  async function updateIncident(id, patch) {
    Store.update(id, patch); // optimistic
    if (!_online) return { ok: true, data: Store.getById(id) };
    try {
      const data = await _fetch(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return { ok: true, data };
    } catch (e) {
      return { ok: true, data: Store.getById(id) };
    }
  }

  async function resolveIncident(id, resolutionNote) {
    if (!_online) {
      const inc = Store.resolve(id, resolutionNote);
      return { ok: true, data: inc };
    }
    try {
      const data = await _fetch(`/incidents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Resolved', resolution: resolutionNote })
      });
      Store.resolve(id, resolutionNote);
      return { ok: true, data };
    } catch (e) {
      const inc = Store.resolve(id, resolutionNote);
      return { ok: true, data: inc };
    }
  }

  /* ── Pipeline endpoints ─────────────────────────────────────── */
  async function runPipeline(incidentId) {
    if (!_online) return { ok: true, data: Store.getRCA(incidentId) };
    try {
      const data = await _fetch('/pipeline/run', {
        method: 'POST',
        body: JSON.stringify({ incident_id: incidentId })
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: true, data: Store.getRCA(incidentId) };
    }
  }

  async function approveAction(actionId, incidentId) {
    if (!_online) return { ok: true };
    try {
      await _fetch('/pipeline/approve', {
        method: 'POST',
        body: JSON.stringify({ action_id: actionId, incident_id: incidentId })
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function getIncidentRCA(incidentId) {
    if (!_online) return { ok: true, data: Store.getRCA(incidentId) };
    try {
      const data = await _fetch(`/incidents/${incidentId}/rca`);
      return { ok: true, data };
    } catch (e) {
      return { ok: true, data: Store.getRCA(incidentId) };
    }
  }

  /* ── Audit stats ─────────────────────────────────────────────── */
  async function getStats() {
    if (!_online) {
      const all = Store.getAll();
      return {
        ok: true,
        data: {
          total_incidents: all.length,
          open: all.filter(i => i.status === 'Open').length,
          investigating: all.filter(i => i.status === 'Investigating').length,
          resolved: all.filter(i => i.status === 'Resolved').length,
          critical: all.filter(i => i.severity === 'Critical' && i.status !== 'Resolved').length
        }
      };
    }
    try {
      const data = await _fetch('/audit/stats');
      return { ok: true, data };
    } catch (e) {
      const all = Store.getAll();
      return {
        ok: true,
        data: {
          total_incidents: all.length,
          open: all.filter(i => i.status === 'Open').length,
          investigating: all.filter(i => i.status === 'Investigating').length,
          resolved: all.filter(i => i.status === 'Resolved').length,
          critical: all.filter(i => i.severity === 'Critical' && i.status !== 'Resolved').length
        }
      };
    }
  }

  /* ── WebSocket ───────────────────────────────────────────────── */
  function connectWS() {
    if (!_online) return;
    try {
      _wsConn = new WebSocket('ws://localhost:8000/ws');
      _wsConn.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          const cbs = _wsCallbacks[msg.type] || [];
          cbs.forEach(fn => fn(msg.data || msg));
        } catch (_) {}
      };
      _wsConn.onclose = () => { setTimeout(connectWS, 5000); };
      _wsConn.onerror = () => {};
    } catch (_) {}
  }

  function onWS(eventType, fn) {
    if (!_wsCallbacks[eventType]) _wsCallbacks[eventType] = [];
    _wsCallbacks[eventType].push(fn);
  }

  /* ── Offline auth helpers ────────────────────────────────────── */
  function _offlineLogin(email, password) {
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
    const name = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, ' ');
    setToken('offline-jwt-' + btoa(email));
    // Do NOT persist rx_user here — app.js sets the role first then persists
    return { ok: true, user: { name, email } };
  }
  function _offlineRegister(name, email, password) {
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters.' };
    setToken('offline-jwt-' + btoa(email));
    // Do NOT persist rx_user here — app.js sets the role first then persists
    return { ok: true, user: { name, email } };
  }
  function _offlineMe() {
    const u = localStorage.getItem('rx_user');
    if (!u) return { ok: false, error: 'Not logged in.' };
    return { ok: true, user: JSON.parse(u) };
  }

  return {
    checkHealth, isOnline,
    login, register, getMe, clearToken, getToken,
    getIncidents, getIncident, createIncident, updateIncident, resolveIncident,
    runPipeline, approveAction, getIncidentRCA,
    getStats,
    connectWS, onWS
  };
})();
