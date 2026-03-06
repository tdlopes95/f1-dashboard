// ═══════════════════════════════════════════════════════
// telemetry.js — Driver telemetry panel
// ═══════════════════════════════════════════════════════

const Telemetry = (() => {

  // DOM refs
  const els = {
    driverAcronym:  document.getElementById('telem-driver-acronym'),
    driverTeam:     document.getElementById('telem-driver-team'),
    driverColorBar: document.getElementById('telem-driver-color'),

    gSpeed:    document.getElementById('g-speed'),
    gvSpeed:   document.getElementById('gv-speed'),
    gThrottle: document.getElementById('g-throttle'),
    gvThrottle:document.getElementById('gv-throttle'),
    gBrake:    document.getElementById('g-brake'),
    gvBrake:   document.getElementById('gv-brake'),
    gRpm:      document.getElementById('g-rpm'),
    gvRpm:     document.getElementById('gv-rpm'),

    gearValue: document.getElementById('gear-value'),
    drsIndicator: document.getElementById('drs-indicator'),

    tyreCompound: document.getElementById('tyre-compound'),
    tyreAge:      document.getElementById('tyre-age'),
    stintNumber:  document.getElementById('stint-number'),

    sparklineCanvas: document.getElementById('sparkline-canvas'),
    sparklineTip:    document.getElementById('sparkline-tooltip'),
    sparklineEmpty:  document.getElementById('sparkline-empty'),
    sparklineBest:   document.getElementById('sparkline-best-label'),
  };

  const MAX_SPEED = 380;
  const MAX_RPM   = 15000;

  function setGauge(barEl, valueEl, pct, displayValue, unit) {
    barEl.style.setProperty('--pct', Math.min(100, Math.max(0, pct)));
    valueEl.innerHTML = `${displayValue} <span class="gauge-unit">${unit}</span>`;
  }

  function drsStatus(drsVal) {
    // 10, 12, 14 = DRS on
    if ([10, 12, 14].includes(drsVal)) return 'on';
    // 8 = eligible
    if (drsVal === 8) return 'elig';
    return 'off';
  }

  function drsLabel(status) {
    if (status === 'on')   return 'ON';
    if (status === 'elig') return 'OPEN';
    return 'OFF';
  }

  function tyreClass(compound) {
    if (!compound) return 'tyre--unknown';
    const c = compound.toLowerCase();
    if (c === 'soft')         return 'tyre--soft';
    if (c === 'medium')       return 'tyre--medium';
    if (c === 'hard')         return 'tyre--hard';
    if (c.includes('inter'))  return 'tyre--inter';
    if (c.includes('wet'))    return 'tyre--wet';
    return 'tyre--unknown';
  }

  // ── Sparkline ─────────────────────────────────────────

  // Tyre compound → colour
  function compoundColor(compound) {
    const c = (compound || '').toUpperCase();
    if (c === 'SOFT')          return '#e8002d';
    if (c === 'MEDIUM')        return '#ffe600';
    if (c === 'HARD')          return '#f0f0f0';
    if (c.includes('INTER'))   return '#39c935';
    if (c.includes('WET'))     return '#0068ff';
    return '#888888';
  }

  // Map a lap to its stint compound
  function lapCompound(lapNum, stints) {
    if (!stints) return null;
    const s = stints.find(st => lapNum >= st.lap_start && (st.lap_end == null || lapNum <= st.lap_end));
    return s?.compound || null;
  }

  // Is this lap a SC/VSC lap? Check race control messages
  function isSCLap(lapNum) {
    const msgs = State.raw.raceControl || [];
    return msgs.some(m => {
      const txt = (m.message || '').toUpperCase();
      const isSC = txt.includes('SAFETY CAR') || txt.includes('VIRTUAL SAFETY CAR');
      return isSC && m.lap_number === lapNum;
    });
  }

  function renderSparkline(driverNum) {
    const canvas  = els.sparklineCanvas;
    const tooltip = els.sparklineTip;
    const emptyEl = els.sparklineEmpty;
    const bestLbl = els.sparklineBest;

    const all    = State.raw.allLaps[driverNum];
    const stints = Object.values(State.raw.stints).filter
      ? null
      : null;
    // Get all stints as array for this driver from allLaps context
    const driverStints = (() => {
      const s = State.raw.stints;
      // stints is keyed by driver_number and holds the LATEST stint only
      // For compound coloring we need all stints — stored in allLaps metadata isn't enough
      // Use what we have: current stint compound as fallback
      return s[driverNum] ? [s[driverNum]] : [];
    })();

    if (!all || all.length < 2) {
      canvas.style.display  = 'none';
      emptyEl.style.display = 'block';
      bestLbl.textContent   = '';
      return;
    }

    // Filter: valid lap times, skip pit-out laps for the scale baseline
    const valid = all.filter(l => l.lap_duration && l.lap_duration > 0);
    if (valid.length < 2) {
      canvas.style.display  = 'none';
      emptyEl.style.display = 'block';
      return;
    }

    canvas.style.display  = 'block';
    emptyEl.style.display = 'none';

    // Size canvas to its container
    const box = canvas.parentElement;
    canvas.width  = box.clientWidth  || 260;
    canvas.height = box.clientHeight - 32 || 100; // minus header

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Scale — exclude outlier pit-out laps from min/max
    const raceTimes = valid
      .filter(l => !l.is_pit_out_lap)
      .map(l => l.lap_duration);
    const minT  = Math.min(...raceTimes);
    const maxT  = Math.max(...raceTimes);
    const range = (maxT - minT) || 1;

    const PAD = { top: 8, right: 10, bottom: 18, left: 6 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top  - PAD.bottom;

    // Helper: map lap → canvas coords
    function xOf(i)   { return PAD.left + (i / (valid.length - 1)) * plotW; }
    function yOf(dur) {
      if (dur > maxT * 1.05) return PAD.top + plotH; // push pit-out laps to bottom
      const clamped = Math.min(maxT, Math.max(minT, dur));
      return PAD.top + plotH - ((clamped - minT) / range) * plotH;
    }

    // ── Draw gridlines ──────────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    [0.25, 0.5, 0.75].forEach(frac => {
      const y = PAD.top + plotH * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();
    });

    // ── Draw stint background bands ─────────────────────
    // Shade each stint a very subtle tint of its compound color
    const stintBands = (() => {
      // Group laps by compound changes
      const bands = [];
      let cur = null;
      valid.forEach((lap, i) => {
        const compound = lap.is_pit_out_lap
          ? (cur?.compound || null)
          : (driverStints.find(s =>
              lap.lap_number >= s.lap_start &&
              (s.lap_end == null || lap.lap_number <= s.lap_end)
            )?.compound || null);
        if (!cur || compound !== cur.compound) {
          cur = { compound, startI: i };
          bands.push(cur);
        }
        cur.endI = i;
      });
      return bands;
    })();

    stintBands.forEach(band => {
      const color = compoundColor(band.compound);
      const x1 = xOf(band.startI);
      const x2 = xOf(band.endI);
      ctx.fillStyle = color + '18'; // very subtle
      ctx.fillRect(x1, PAD.top, x2 - x1, plotH);
    });

    // ── Draw the line ───────────────────────────────────
    // Split into segments by compound so each segment gets its own color
    const driver   = State.raw.drivers[driverNum];
    const teamColor= '#' + (driver?.team_colour || 'e8002d');

    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    // Draw shadow line first for depth
    ctx.beginPath();
    valid.forEach((lap, i) => {
      const x = xOf(i);
      const y = yOf(lap.lap_duration);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth   = 4;
    ctx.stroke();

    // Main line in team color
    ctx.beginPath();
    valid.forEach((lap, i) => {
      const x = xOf(i);
      const y = yOf(lap.lap_duration);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = teamColor + 'cc';
    ctx.lineWidth   = 2;
    ctx.stroke();

    // ── Draw dots ───────────────────────────────────────
    const fastestTime = minT;
    valid.forEach((lap, i) => {
      const x   = xOf(i);
      const y   = yOf(lap.lap_duration);
      const isFastest   = !lap.is_pit_out_lap && lap.lap_duration === fastestTime;
      const isPitOut    = lap.is_pit_out_lap;
      const compound    = driverStints.find(s =>
        lap.lap_number >= s.lap_start &&
        (s.lap_end == null || lap.lap_number <= s.lap_end)
      )?.compound || null;
      const dotColor    = isPitOut ? '#555' : compoundColor(compound) || teamColor;

      ctx.beginPath();
      ctx.arc(x, y, isFastest ? 4.5 : isPitOut ? 2 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isFastest ? '#39ff6f' : dotColor;
      if (isFastest) {
        ctx.shadowColor = '#39ff6f';
        ctx.shadowBlur  = 8;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      // Fastest lap star marker
      if (isFastest) {
        ctx.font      = 'bold 9px "Barlow Condensed"';
        ctx.fillStyle = '#39ff6f';
        ctx.textAlign = 'center';
        ctx.fillText('★', x, y - 8);
      }
    });

    // ── Lap number axis labels (every ~10 laps) ──────────
    ctx.font      = '8px "Share Tech Mono"';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    valid.forEach((lap, i) => {
      if (lap.lap_number % 10 === 0) {
        ctx.fillText(`L${lap.lap_number}`, xOf(i), H - 4);
      }
    });

    // ── Best lap label ───────────────────────────────────
    bestLbl.textContent = `BEST ${formatTime(fastestTime)}`;

    // ── Hover tooltip ────────────────────────────────────
    // Remove old listener by cloning
    const newCanvas = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(newCanvas, canvas);
    els.sparklineCanvas = newCanvas;

    newCanvas.addEventListener('mousemove', e => {
      const rect  = newCanvas.getBoundingClientRect();
      const mx    = e.clientX - rect.left;
      const hoverI = Math.round(((mx - PAD.left) / plotW) * (valid.length - 1));
      const lap   = valid[Math.max(0, Math.min(valid.length - 1, hoverI))];
      if (!lap) return;

      tooltip.classList.remove('sparkline-tooltip--hidden');
      tooltip.innerHTML = `
        <span class="stt-lap">L${lap.lap_number}</span>
        <span class="stt-time">${formatTime(lap.lap_duration)}</span>
        ${lap.is_pit_out_lap ? '<span class="stt-tag">PIT OUT</span>' : ''}
      `;

      // Position tooltip left/right of cursor depending on space
      const tipX = mx > W / 2 ? mx - 90 : mx + 10;
      tooltip.style.left = `${tipX}px`;
      tooltip.style.top  = '4px';
    });

    newCanvas.addEventListener('mouseleave', () => {
      tooltip.classList.add('sparkline-tooltip--hidden');
    });
  }

  function formatTime(seconds) {
    if (seconds == null) return '–';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    return mins > 0 ? `${mins}:${secs}` : secs;
  }

  function render() {
    const num = State.get('focusedDriver');
    if (!num) return;

    const driver = State.raw.drivers[num];
    const car    = State.raw.carData[num];
    const stint  = State.raw.stints[num];
    const lap    = State.raw.lastLaps[num];

    // Driver badge
    if (driver) {
      els.driverAcronym.textContent  = driver.name_acronym || '–';
      els.driverTeam.textContent     = driver.team_name    || '–';
      els.driverColorBar.style.background = '#' + (driver.team_colour || 'E8002D');
    }

    // Car telemetry
    if (car) {
      setGauge(els.gSpeed,    els.gvSpeed,   (car.speed    / MAX_SPEED) * 100, car.speed    ?? '–', 'km/h');
      setGauge(els.gThrottle, els.gvThrottle, car.throttle ?? 0,               car.throttle ?? '–', '%');
      setGauge(els.gBrake,    els.gvBrake,   car.brake     ?? 0,               car.brake    ?? '–', '%');
      setGauge(els.gRpm,      els.gvRpm,     (car.rpm      / MAX_RPM)  * 100,
        car.rpm ? car.rpm.toLocaleString() : '–', 'rpm');

      // Gear
      const gear = car.n_gear;
      els.gearValue.textContent = (gear === 0 || gear == null) ? 'N' : gear;

      // DRS
      const drs = drsStatus(car.drs);
      els.drsIndicator.className = `drs-indicator drs--${drs}`;
      els.drsIndicator.querySelector('.drs-status').textContent = drsLabel(drs);
    }

    // Stint / tyre info
    if (stint) {
      const compound = stint.compound || '–';
      const lapsDone = lap ? (lap.lap_number - stint.lap_start + stint.tyre_age_at_start) : stint.tyre_age_at_start;
      els.tyreCompound.textContent = compound;
      els.tyreCompound.className   = `tyre-badge ${tyreClass(compound)}`;
      els.tyreAge.textContent      = `${lapsDone ?? '?'} laps`;
      els.stintNumber.textContent  = `#${stint.stint_number}`;
    }

    // Sparkline
    renderSparkline(num);
  }

  function init() {
    State.on('change:carData',       render);
    State.on('change:stints',        render);
    State.on('change:allLaps',       render);
    State.on('change:focusedDriver', render);
    State.on('driversLoaded',        render);

    console.log('[Telemetry] Initialized');
  }

  return { init, render };

})();