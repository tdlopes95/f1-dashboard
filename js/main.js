// ═══════════════════════════════════════════════════════
// main.js — App entry point
// Boots all components, starts session clock
// ═══════════════════════════════════════════════════════

(function () {

  // ── Session clock ────────────────────────────────────
  const clockEl = document.getElementById('session-clock');

  function updateClock() {
    const start = State.get('sessionStartTime');
    if (!start) {
      clockEl.textContent = '--:--:--';
      return;
    }
    const elapsed = Math.floor((Date.now() - new Date(start)) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    clockEl.textContent = [h, m, s]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
  }

  setInterval(updateClock, 1000);

  // ── Init all components ──────────────────────────────
  EventTimer.init();
  TeamRadio.init();
  SessionPicker.init();
  Timing.init();
  TrackMap.init();
  Telemetry.init();
  RaceControl.init();
  Weather.init();

  // ── Start API polling ────────────────────────────────
  API.start();

  console.log('[Main] F1 Dashboard booted ✓');

})();