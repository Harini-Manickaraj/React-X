/* ================================================================
   settings.js  —  REACT-X  v2
   Every toggle reads from and writes to Config — changes immediately
   affect the pipeline, live feed, and notification behaviour.
   ================================================================ */
const Settings = (() => {

  /* ── Public: render the settings page ──────────────────────── */
  function render() {
    const container = document.getElementById('settingsContent');
    if (!container) return;

    container.innerHTML = `
      <div class="settings-grid">

        <!-- Alert Thresholds -->
        <div class="settings-card">
          <h3>Alert Thresholds</h3>
          <p>Configure when incidents are automatically escalated based on severity.</p>
          ${_toggle('autoEscalateCritical', 'Auto-escalate Critical incidents',
            'Immediately open an investigation for any Critical alert')}
          ${_toggle('autoEscalateHigh', 'Auto-escalate High incidents',
            'Immediately open an investigation for High severity alerts')}
          ${_toggle('autoEscalateMedium', 'Auto-escalate Medium incidents',
            'Queue Medium incidents for investigation automatically')}
          ${_toggle('notifyLow', 'Notify on Low severity',
            'Show notification banners for Low severity alerts')}
        </div>

        <!-- Live Monitoring -->
        <div class="settings-card">
          <h3>Live Monitoring</h3>
          <p>Control the live incident signal feed and auto-detection behaviour.</p>
          ${_toggle('liveSignalEnabled', 'Enable live signal feed',
            'Allow the live signal feed to stream new incidents')}
          ${_toggle('liveAutoStart', 'Auto-start on login',
            'Begin the live signal feed automatically when you sign in')}
          ${_toggle('soundAlerts', 'Sound alerts',
            'Play an audible beep when a Critical incident arrives')}
          ${_toggle('desktopNotifications', 'Desktop notifications',
            'Request browser permission and show desktop notifications')}
        </div>

        <!-- AI Pipeline -->
        <div class="settings-card">
          <h3>AI Pipeline Policy</h3>
          <p>Control which risk levels execute automatically vs. wait for human approval.</p>
          ${_toggle('autoExecLow', 'Auto-execute Low risk actions',
            'Run pre-authorised Low risk actions without manual approval')}
          ${_toggle('requireApprovalMedium', 'Require approval for Medium risk',
            'Block Medium risk actions until a team member approves')}
          ${_toggleLocked('requireApprovalHigh', 'Always require approval for High/Critical',
            'High and Critical risk actions always need human sign-off — cannot be disabled')}
          ${_toggle('autoRollback', 'Enable auto-rollback on failure',
            'Automatically rollback if post-execution verification fails')}
        </div>

        <!-- Permissions -->
        <div class="settings-card">
          <h3>User Permissions <span class="future-badge">Future Enhancement</span></h3>
          <p>Per-user role and permission customisation is planned for a future release.
             Currently all authenticated users share the same access level.</p>
          ${_static('Current role', 'On-call Engineer (full access)')}
          ${_static('Can approve High risk actions', 'Yes — all users')}
          ${_static('Can resolve incidents', 'Yes — all users')}
          ${_static('Per-user roles', 'Coming soon')}
        </div>

        <!-- Notifications -->
        <div class="settings-card">
          <h3>Notification Preferences</h3>
          <p>Choose how and when you are notified about incident activity.</p>
          ${_toggle('inAppBanners', 'In-app banners',
            'Show notification banners inside the dashboard for new incidents')}
          ${_toggle('approvalAlerts', 'Approval request alerts',
            'Show a badge and panel when an action is waiting for your approval')}
          ${_toggle('emailOnCritical', 'Email on Critical incident',
            'Send an email notification when a Critical incident is detected (demo only)')}
          ${_toggle('dailyDigest', 'Daily digest',
            'Receive a daily summary of open and resolved incidents (demo only)')}
        </div>

        <!-- Account -->
        <div class="settings-card">
          <h3>Account</h3>
          <p>Manage your session and reset configuration.</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
            <button class="btn btn-ghost btn-sm" onclick="Settings._resetDefaults()">Reset all to defaults</button>
            <button class="btn btn-danger  btn-sm" onclick="App.logout()">Sign out</button>
          </div>
        </div>

      </div>`;
  }

  /* ── Toggle row (reads Config, writes Config) ────────────────── */
  let _uid = 0;
  function _toggle(key, label, sub) {
    const id = 'stg-' + key;
    const checked = Config.get(key) ? 'checked' : '';
    return `
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${_esc(label)}</div>
          <div class="settings-row-sub">${_esc(sub)}</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="${id}" ${checked}
            onchange="Settings._onChange('${key}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>`;
  }

  function _toggleLocked(key, label, sub) {
    // requireApprovalHigh is always on and cannot be toggled
    return `
      <div class="settings-row">
        <div>
          <div class="settings-row-label">${_esc(label)}</div>
          <div class="settings-row-sub" style="color:var(--risk-high)">${_esc(sub)}</div>
        </div>
        <label class="toggle-switch" title="This setting cannot be disabled for safety">
          <input type="checkbox" checked disabled>
          <span class="toggle-slider" style="opacity:0.6;"></span>
        </label>
      </div>`;
  }

  function _static(label, value) {
    return `
      <div class="settings-row">
        <div class="settings-row-label">${_esc(label)}</div>
        <span style="font-size:0.8rem;color:var(--text-muted);">${_esc(value)}</span>
      </div>`;
  }

  /* ── onChange — write to Config and apply side-effects ───────── */
  function _onChange(key, value) {
    Config.set(key, value);

    // Side-effects: apply the change to the running app immediately
    switch (key) {
      case 'liveSignalEnabled':
        if (!value) Store.stopLiveSignals();
        App.toast(`Live signal feed ${value ? 'enabled' : 'disabled'}.`, value ? 'success' : '');
        break;

      case 'liveAutoStart':
        App.toast(`Live auto-start on login ${value ? 'enabled' : 'disabled'}.`, '');
        break;

      case 'soundAlerts':
        App.toast(`Sound alerts ${value ? 'enabled' : 'disabled'}.`, '');
        break;

      case 'desktopNotifications':
        if (value && 'Notification' in window) {
          Notification.requestPermission().then(p => {
            if (p !== 'granted') {
              Config.set('desktopNotifications', false);
              const el = document.getElementById('stg-desktopNotifications');
              if (el) el.checked = false;
              App.toast('Browser denied notification permission.', 'error');
            } else {
              App.toast('Desktop notifications enabled.', 'success');
            }
          });
        } else if (!value) {
          App.toast('Desktop notifications disabled.', '');
        }
        break;

      case 'autoExecLow':
        App.toast(`Low risk auto-execution ${value ? 'on' : 'off'} — affects new incidents.`, '');
        break;

      case 'requireApprovalMedium':
        App.toast(`Medium risk ${value ? 'now requires approval' : 'will auto-execute'}.`, value ? 'warning' : 'success');
        break;

      case 'autoRollback':
        App.toast(`Auto-rollback on failure ${value ? 'enabled' : 'disabled'}.`, '');
        break;

      case 'autoEscalateCritical':
      case 'autoEscalateHigh':
      case 'autoEscalateMedium':
        App.toast(`Escalation policy updated.`, '');
        break;

      case 'inAppBanners':
        App.toast(`In-app banners ${value ? 'enabled' : 'disabled'}.`, '');
        break;

      case 'approvalAlerts':
        App.toast(`Approval alerts ${value ? 'enabled' : 'disabled'}.`, '');
        break;

      default:
        App.toast(`Setting "${key}" ${value ? 'enabled' : 'disabled'}.`, '');
    }
  }

  function _resetDefaults() {
    Config.reset();
    render(); // re-render to reflect new values
    App.toast('Settings reset to defaults.', 'success');
  }

  function _esc(s) { return String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { render, _onChange, _resetDefaults };
})();
