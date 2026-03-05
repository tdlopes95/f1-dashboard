// ═══════════════════════════════════════════════════════
// trackmap.js — Live track map canvas renderer
// Draws car positions using OpenF1 location X/Y data
// ═══════════════════════════════════════════════════════

const TrackMap = (() => {

  const canvas    = document.getElementById('track-canvas');
  const noDataEl  = document.getElementById('track-no-data');
  const chipsEl   = document.getElementById('driver-chips');
  const ctx       = canvas.getContext('2d');

  let _raf        = null;
  let _trackPath  = null;   // Computed once from first full lap of data
  let _bounds     = null;   // { minX, maxX, minY, maxY }
  let _allPoints  = [];     // Array of {x,y} for track outline
  let _lastRender = 0;

  // ── Sizing ───────────────────────────────────────────
  function resize() {
    const container = canvas.parentElement;
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
  }

  // ── Map x,y from openf1 coords to canvas pixels ─────
  function project(x, y) {
    if (!_bounds) return { px: 0, py: 0 };
    const pad = 40;
    const scaleX = (canvas.width  - pad * 2) / (_bounds.maxX - _bounds.minX);
    const scaleY = (canvas.height - pad * 2) / (_bounds.maxY - _bounds.minY);
    const scale  = Math.min(scaleX, scaleY);
    const offX   = (canvas.width  - (_bounds.maxX - _bounds.minX) * scale) / 2;
    const offY   = (canvas.height - (_bounds.maxY - _bounds.minY) * scale) / 2;
    return {
      px: offX + (x - _bounds.minX) * scale,
      py: offY + (y - _bounds.minY) * scale,
    };
  }

  // ── Build track outline from accumulated location data ──
  function updateTrackPath() {
    const locs = State.raw.locations;
    const allPts = Object.values(locs).filter(l => l.x != null);
    if (allPts.length < 10) return;

    // Accumulate points over time for a proper track outline
    allPts.forEach(p => {
      if (!_allPoints.find(q => Math.abs(q.x - p.x) < 5 && Math.abs(q.y - p.y) < 5)) {
        _allPoints.push({ x: p.x, y: p.y });
      }
    });

    if (_allPoints.length < 5) return;

    const xs = _allPoints.map(p => p.x);
    const ys = _allPoints.map(p => p.y);
    _bounds = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };
  }

  // ── Draw ─────────────────────────────────────────────
  function draw() {
    const now = performance.now();
    if (now - _lastRender < 100) {  // Cap at ~10fps for map
      _raf = requestAnimationFrame(draw);
      return;
    }
    _lastRender = now;

    const locs    = State.raw.locations;
    const drivers = State.raw.drivers;
    const hasData = Object.keys(locs).length > 0;

    if (!hasData) {
      noDataEl.classList.remove('hidden');
      _raf = requestAnimationFrame(draw);
      return;
    }
    noDataEl.classList.add('hidden');

    updateTrackPath();
    if (!_bounds) {
      _raf = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw track outline (accumulated dots as path hint)
    if (_allPoints.length > 50) {
      // Sort points by angle around centroid for a rough track outline
      const cx = (_bounds.minX + _bounds.maxX) / 2;
      const cy = (_bounds.minY + _bounds.maxY) / 2;
      const sorted = [..._allPoints].sort((a, b) =>
        Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
      );

      ctx.beginPath();
      sorted.forEach((p, i) => {
        const { px, py } = project(p.x, p.y);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth   = 12;
      ctx.lineJoin    = 'round';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // Draw car dots
    const focused = State.get('focusedDriver');

    Object.entries(locs).forEach(([dnum, loc]) => {
      const d   = drivers[dnum];
      if (!d) return;

      const { px, py } = project(loc.x, loc.y);
      const color = '#' + (d.team_colour || 'FFFFFF');
      const pos   = State.raw.positions[dnum]?.position;
      const isFocused = parseInt(dnum) === focused;

      // Glow for focused driver
      if (isFocused) {
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fillStyle = color + '33';
        ctx.fill();
      }

      // Car dot
      ctx.beginPath();
      ctx.arc(px, py, isFocused ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      if (isFocused) {
        ctx.shadowColor = color;
        ctx.shadowBlur  = 10;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Driver label
      if (isFocused || _allPoints.length < 100) {
        ctx.font      = isFocused
          ? 'bold 11px "Barlow Condensed", sans-serif'
          : '9px "Barlow Condensed", sans-serif';
        ctx.fillStyle = isFocused ? '#ffffff' : 'rgba(255,255,255,0.6)';
        ctx.textAlign = 'center';
        ctx.fillText(d.name_acronym || dnum, px, py - 10);
      }
    });

    _raf = requestAnimationFrame(draw);
  }

  // ── Driver chips (focus selector) ───────────────────
  function renderChips() {
    const drivers = State.getDriversSortedByPosition();
    chipsEl.innerHTML = '';
    drivers.forEach(d => {
      const chip = document.createElement('button');
      chip.className = 'driver-chip' + (d.driver_number === State.get('focusedDriver') ? ' active' : '');
      chip.textContent = d.name_acronym || d.driver_number;
      chip.style.setProperty('--team-color', '#' + (d.team_colour || 'FFFFFF'));
      chip.addEventListener('click', () => {
        State.setFocusedDriver(d.driver_number);
      });
      chipsEl.appendChild(chip);
    });
  }

  function init() {
    resize();
    window.addEventListener('resize', () => { resize(); });

    State.on('change:locations',    () => {}); // draw loop handles it
    State.on('driversLoaded',       renderChips);
    State.on('change:positions',    renderChips);
    State.on('change:focusedDriver', renderChips);

    draw();
    console.log('[TrackMap] Initialized');
  }

  return { init };

})();