/* ================================================================
   config.js  —  REACT-X
   Live settings singleton. Every module reads from Config.*
   Changes persist to localStorage immediately.
   ================================================================ */
const Config = (() => {

  const STORAGE_KEY = 'rx_config';

  /* ── Defaults ────────────────────────────────────────────────── */
  const DEFAULTS = {
    // Alert Thresholds
    autoEscalateCritical:  true,
    autoEscalateHigh:      true,
    autoEscalateMedium:    false,
    notifyLow:             false,

    // Live Monitoring
    liveSignalEnabled:     true,
    liveAutoStart:         false,
    soundAlerts:           false,
    desktopNotifications:  false,

    // AI Pipeline — risk policy
    autoExecLow:           true,   // Low risk → execute automatically
    requireApprovalMedium: false,  // Medium risk → auto-exec unless this is true
    requireApprovalHigh:   true,   // High/Critical → always require approval (locked)
    autoRollback:          true,   // Rollback automatically if verification fails

    // Notifications
    inAppBanners:          true,
    approvalAlerts:        true,
    emailOnCritical:       false,
    dailyDigest:           false
  };

  /* ── Load from localStorage, merge with defaults ─────────────── */
  let _state = { ...DEFAULTS };
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      _state = { ...DEFAULTS, ...parsed };
    }
  } catch (_) {}

  /* ── Persist ─────────────────────────────────────────────────── */
  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch (_) {}
  }

  /* ── Get / Set ───────────────────────────────────────────────── */
  function get(key) {
    return _state[key] !== undefined ? _state[key] : DEFAULTS[key];
  }

  function set(key, value) {
    // requireApprovalHigh is locked — cannot be disabled
    if (key === 'requireApprovalHigh') value = true;
    _state[key] = value;
    _save();
  }

  /* ── Convenience: should an action be auto-executed? ─────────── */
  function shouldAutoExecute(riskLevel) {
    switch (riskLevel) {
      case 'Low':      return _state.autoExecLow;
      case 'Medium':   return !_state.requireApprovalMedium;
      case 'High':
      case 'Critical': return false;   // always requires human approval
      default:         return false;
    }
  }

  /* ── Reset to defaults ───────────────────────────────────────── */
  function reset() {
    _state = { ...DEFAULTS };
    _save();
  }

  return { get, set, shouldAutoExecute, reset, DEFAULTS };
})();
