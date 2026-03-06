// ═══════════════════════════════════════════════════════
// teamradio.js — Team radio toast notifications
// Pops a toast when a new radio clip arrives.
// Clips auto-dismiss after 12s, or can be closed/played.
// ═══════════════════════════════════════════════════════

const TeamRadio = (() => {

  // Toast container — injected once into the DOM
  let _container = null;

  // Currently playing Audio object
  let _currentAudio = null;
  let _currentPlayBtn = null;

  // Queue of toasts (max 4 visible at once)
  const MAX_TOASTS = 4;
  const AUTODISMISS_MS = 14000;

  // ── Bootstrap container ──────────────────────────────
  function ensureContainer() {
    if (_container) return;
    _container = document.createElement('div');
    _container.id = 'radio-toast-container';
    _container.className = 'radio-toast-container';
    document.body.appendChild(_container);
  }

  // ── Format time ──────────────────────────────────────
  function formatTime(isoDate) {
    if (!isoDate) return '';
    return new Date(isoDate).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  // ── Play / pause audio ───────────────────────────────
  function toggleAudio(url, btn, waveEl) {
    // Stop whatever is currently playing
    if (_currentAudio && !_currentAudio.paused) {
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
      if (_currentPlayBtn) {
        _currentPlayBtn.textContent = '▶';
        _currentPlayBtn.classList.remove('playing');
      }
      if (_currentAudio.src === url && _currentPlayBtn === btn) {
        // Clicked the same button — just stop
        _currentAudio = null;
        _currentPlayBtn = null;
        waveEl?.classList.remove('animating');
        return;
      }
    }

    // Start new clip
    const audio = new Audio(url);
    _currentAudio = audio;
    _currentPlayBtn = btn;

    btn.textContent = '■';
    btn.classList.add('playing');
    waveEl?.classList.add('animating');

    audio.play().catch(() => {
      // CORS or network issue — show visual feedback
      btn.textContent = '✕';
      btn.classList.add('error');
      setTimeout(() => {
        btn.textContent = '▶';
        btn.classList.remove('error', 'playing');
      }, 2000);
    });

    audio.addEventListener('ended', () => {
      btn.textContent = '▶';
      btn.classList.remove('playing');
      waveEl?.classList.remove('animating');
      _currentAudio = null;
      _currentPlayBtn = null;
    });
  }

  // ── Build and show a toast ───────────────────────────
  function showToast(clip) {
    ensureContainer();

    const driver  = State.raw.drivers[clip.driver_number] || {};
    const color   = '#' + (driver.team_colour || 'FFFFFF');
    const acronym = driver.name_acronym || `#${clip.driver_number}`;
    const team    = driver.team_name    || '';
    const time    = formatTime(clip.date);

    // Cap visible toasts
    const existing = _container.querySelectorAll('.radio-toast');
    if (existing.length >= MAX_TOASTS) {
      existing[0].classList.add('radio-toast--exit');
      setTimeout(() => existing[0].remove(), 350);
    }

    const toast = document.createElement('div');
    toast.className = 'radio-toast radio-toast--enter';

    toast.innerHTML = `
      <div class="rt-color-bar" style="background:${color}"></div>
      <div class="rt-body">
        <div class="rt-header">
          <span class="rt-icon">📻</span>
          <span class="rt-driver" style="color:${color}">${acronym}</span>
          <span class="rt-team">${team}</span>
          <span class="rt-time">${time}</span>
          <button class="rt-close">✕</button>
        </div>
        <div class="rt-controls">
          <button class="rt-play-btn">▶</button>
          <div class="rt-wave">
            <span class="rt-wave-bar"></span>
            <span class="rt-wave-bar"></span>
            <span class="rt-wave-bar"></span>
            <span class="rt-wave-bar"></span>
            <span class="rt-wave-bar"></span>
          </div>
          <span class="rt-label">TEAM RADIO</span>
        </div>
      </div>
    `;

    // Wire up play button
    const playBtn = toast.querySelector('.rt-play-btn');
    const waveEl  = toast.querySelector('.rt-wave');
    playBtn.addEventListener('click', () => toggleAudio(clip.recording_url, playBtn, waveEl));

    // Wire up close button
    const closeBtn = toast.querySelector('.rt-close');
    closeBtn.addEventListener('click', () => dismissToast(toast));

    // Auto-dismiss
    const timer = setTimeout(() => dismissToast(toast), AUTODISMISS_MS);
    toast._dismissTimer = timer;

    // Pause auto-dismiss on hover
    toast.addEventListener('mouseenter', () => clearTimeout(toast._dismissTimer));
    toast.addEventListener('mouseleave', () => {
      toast._dismissTimer = setTimeout(() => dismissToast(toast), 4000);
    });

    _container.appendChild(toast);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.remove('radio-toast--enter'));
    });
  }

  function dismissToast(toast) {
    clearTimeout(toast._dismissTimer);

    // Stop audio if this toast's clip is playing
    if (_currentAudio && !_currentAudio.paused) {
      const playBtn = toast.querySelector('.rt-play-btn');
      if (playBtn === _currentPlayBtn) {
        _currentAudio.pause();
        _currentAudio = null;
        _currentPlayBtn = null;
      }
    }

    toast.classList.add('radio-toast--exit');
    setTimeout(() => toast.remove(), 350);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    ensureContainer();
    State.on('newRadioClip', showToast);
    console.log('[TeamRadio] Initialized');
  }

  return { init, showToast };

})();