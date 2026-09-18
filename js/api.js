/* ================================================================
   REACT-X — api.js
   Backend integration layer.
   Falls back gracefully to in-memory Store if backend is unavailable.
   ================================================================ */

const API = (() => {

  const BASE = 'http://localhost:8000/api';
  let _token   = localStorage.getItem('rx_api_token') || null;
  let _wsConn  = null;
  let _online  = false;          // true once backend responds
  let _wsListeners = [];         // {event, fn}

  /* ── Connection check ─────────────────────────────────── */
  async function checkBackend() {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      _online = r.ok;
    } catch (_) {
      _online = false;
    }
    return _online;
  }

  function isOnline() { return _online; }

  /* ── HTTP helpers ─────────────────────────────────────── */
  async function _request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  }

  const get  = (path)        => _request('GET',    path);
  const post = (path, body)  => _request('POST',   path, body);
  const patch= (path, body)  => _request('PATCH',  path, body);

  /* ── Auth ─────────────────────────────────────────────── */
  async function login(email, password) {
    const data = await post('/auth/login', { email, password });
    _token = data.access_token;
    localStorage.setItem('rx_api_token', _token);
    return data.user;
  }

  async function register(name, email, password) {
    const data = await post('/auth/register', { name, email, password });
    _token = data.access_token;
    localStorage.setItem('rx_api_token', _token);
    return data.user;
  }

  function apiLogout() {
    _token = null;
    localStorage.removeItem('rx_api_token');
    _closeWs();
  }

  /* ── Incidents ────────────────────────────────────────── */
  async function getIncidents(params = {}) {
    const q = new URLSearchParams(params).toString();
    return get(`/incidents${q ? '?'+q : ''}`);
  }

  async function createIncident(payload) {
    return post('/incidents', payload);
  }

  async function updateIncident(id, payload) {
    const user = App.getUser();
    const q = user ? `?updated_by=${encodeURIComponent(user.name)}` : '';
    return patch(`/incidents/${id}${q}`, payload);
  }

  async function getIncidentRCA(id) {
    return get(`/incidents/${id}/rca`);
  }

  /* ── Pipeline ─────────────────────────────────────────── */
  async function runPipeline(incident_id) {
    return post('/pipeline/run', { incident_id });
  }

  async function approveAction(action_id) {
    const user = App.getUser();
    return post('/pipeline/approve', { action_id, approved_by: user?.name || 'User' });
  }

  async function getActions(incident_id) {
    return get(`/pipeline/actions/${incident_id}`);
  }

  /* ── Stats & Audit ────────────────────────────────────── */
  async function getStats()      { return get('/audit/stats'); }
  async function getAuditLogs(params = {}) {
    const q = new URLSearchParams(params).toString();
    return get(`/audit${q ? '?'+q : ''}`);
  }

  /* ── WebSocket ────────────────────────────────────────── */
  function connectWs() {
    if (_wsConn && _wsConn.readyState < 2) return;
    try {
      const wsUrl = BASE.replace('http', 'ws').replace('/api', '') + '/ws';
      _wsConn = new WebSocket(wsUrl);

      _wsConn.onopen = () => {
        console.log('[WS] Connected to REACT-X backend');
        _wsConn.send('ping');
      };

      _wsConn.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          _wsListeners
            .filter(l => l.event === msg.event || l.event === '*')
            .forEach(l => l.fn(msg.data, msg.event));
        } catch (_) {}
      };

      _wsConn.onclose = () => {
        console.log('[WS] Disconnected. Reconnecting in 5s…');
        setTimeout(connectWs, 5000);
      };

      _wsConn.onerror = (err) => {
        console.warn('[WS] Error — backend may be offline.', err);
      };
    } catch (err) {
      console.warn('[WS] Could not connect:', err);
    }
  }

  function _closeWs() {
    if (_wsConn) { _wsConn.close(); _wsConn = null; }
  }

  function onWsEvent(event, fn) {
    _wsListeners.push({ event, fn });
  }

  function offWsEvent(fn) {
    _wsListeners = _wsListeners.filter(l => l.fn !== fn);
  }

  return {
    checkBackend, isOnline,
    // auth
    login, register, apiLogout,
    // incidents
    getIncidents, createIncident, updateIncident, getIncidentRCA,
    // pipeline
    runPipeline, approveAction, getActions,
    // stats
    getStats, getAuditLogs,
    // ws
    connectWs, onWsEvent, offWsEvent,
  };
})();

window.API = API;
