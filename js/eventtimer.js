// ═══════════════════════════════════════════════════════
// eventtimer.js — Countdown to next session
// Shows an overlay when no session is live.
// Blocks OpenF1 fast/medium polls to save API quota.
// Rechecks every 60s to detect session start.
// ═══════════════════════════════════════════════════════

const EventTimer = (() => {

  let _overlayEl   = null;
  let _countdownEl = null;
  let _nameEl      = null;
  let _tickTimer   = null;
  let _recheckTimer= null;
  let _active      = false;   // true = overlay is shown, polls blocked

  // ── Build overlay DOM (once) ─────────────────────────
  function buildOverlay() {
    if (_overlayEl) return;

    _overlayEl = document.createElement('div');
    _overlayEl.id = 'event-timer-overlay';
    _overlayEl.className = 'et-overlay';
    _overlayEl.innerHTML = `
      <div class="et-panel">
        <div class="et-logo">F1</div>
        <div class="et-status">NO LIVE SESSION</div>
        <div id="et-session-name" class="et-session-name">–</div>
        <div class="et-countdown-label">NEXT SESSION IN</div>
        <div id="et-countdown" class="et-countdown">–:––:––</div>
        <div class="et-sub">Live timing will start automatically</div>
        <div class="et-actions">
          <button id="et-browse-btn" class="et-browse-btn">⊞ BROWSE PAST SESSIONS</button>
        </div>
        <div class="et-dots">
          <span class="et-dot"></span>
          <span class="et-dot"></span>
          <span class="et-dot"></span>
        </div>
      </div>
    `;

    document.body.appendChild(_overlayEl);

    document.getElementById('et-browse-btn').addEventListener('click', () => {
      document.getElementById('session-picker-btn').click();
    });

    _countdownEl = document.getElementById('et-countdown');
    _nameEl      = document.getElementById('et-session-name');
  }

  // ── Format countdown ─────────────────────────────────
  function formatCountdown(ms) {
    if (ms <= 0) return '00:00:00';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = n => String(n).padStart(2, '0');
    if (h > 24) {
      const days = Math.floor(h / 24);
      return `${days}d ${pad(h % 24)}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // ── Tick every second ────────────────────────────────
  function tick() {
    const nextStart = State.get('nextSessionStart');
    if (!nextStart) {
      _countdownEl.textContent = 'SOON™';
      return;
    }

    const ms = new Date(nextStart) - Date.now();
    if (ms <= 0) {
      // Session should be starting — recheck the API
      _countdownEl.textContent = 'STARTING…';
      recheck();
      return;
    }

    _countdownEl.textContent = formatCountdown(ms);
  }

  // ── Recheck session status every 60s ────────────────
  async function recheck() {
    // Fetch latest session silently
    const sessions = await API.fetchJSON('sessions', { session_key: 'latest' });
    if (!sessions?.length) return;
    const s = sessions[0];

    const now     = new Date();
    const started = new Date(s.date_start) <= now;
    const ended   = s.date_end && new Date(s.date_end) < now;
    const isLive  = started && !ended;

    if (isLive) {
      // Session has started — hand off to normal boot
      deactivate();
      State.set('sessionIsLive', true);
      API.start();
    }
  }

  // ── Show overlay, block polls ────────────────────────
  function activate() {
    if (_active) return;
    _active = true;
    buildOverlay();

    const nextName = State.get('nextSessionName') || '–';
    _nameEl.textContent = nextName;

    _overlayEl.classList.remove('et-overlay--hidden');

    // Tick countdown every second
    tick();
    _tickTimer = setInterval(tick, 1000);

    // Recheck session status every 60s
    _recheckTimer = setInterval(recheck, 60_000);

    console.log('[EventTimer] Activated — polls blocked');
  }

  // ── Hide overlay, unblock polls ──────────────────────
  function deactivate() {
    if (!_active) return;
    _active = false;

    clearInterval(_tickTimer);
    clearInterval(_recheckTimer);

    if (_overlayEl) {
      _overlayEl.classList.add('et-overlay--hidden');
    }

    console.log('[EventTimer] Deactivated — session is live');
  }

  // ── Init: check on boot whether session is live ──────
  function init() {
    // Wait for API to load session info, then decide
    State.on('change:sessionIsLive', val => {
      if (val === false) activate();
      else               deactivate();
    });

    // Also update the next session label dynamically
    State.on('change:nextSessionName', name => {
      if (_nameEl) _nameEl.textContent = name || '–';
    });
    State.on('change:nextSessionStart', () => tick());

    console.log('[EventTimer] Initialized');
  }

  function isActive() { return _active; }

  return { init, activate, deactivate, isActive };

})();