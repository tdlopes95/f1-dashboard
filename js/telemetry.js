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

    lapBars:      document.getElementById('lap-history-bars'),
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

  function renderLapHistory(driverNum) {
    const all = State.raw.allLaps[driverNum];
    if (!all || all.length < 2) {
      els.lapBars.innerHTML = '<div class="lh-placeholder">No data</div>';
      return;
    }

    // Last 8 valid laps (exclude pit-out laps for scale)
    const valid = all
      .filter(l => l.lap_duration && !l.is_pit_out_lap)
      .slice(-8);

    if (!valid.length) return;

    const times  = valid.map(l => l.lap_duration);
    const minT   = Math.min(...times);
    const maxT   = Math.max(...times);
    const range  = maxT - minT || 1;

    els.lapBars.innerHTML = '';

    valid.forEach(lap => {
      const heightPct = 20 + 75 * (1 - (lap.lap_duration - minT) / range); // faster = taller
      const isFastest = lap.lap_duration === minT;

      const wrap = document.createElement('div');
      wrap.className = 'lh-bar-wrap';
      wrap.innerHTML = `
        <span class="lh-lap-time">${formatTime(lap.lap_duration)}</span>
        <div class="lh-bar ${isFastest ? 'fastest' : ''}"
             style="height:${heightPct}%"></div>
        <span class="lh-lap-num">L${lap.lap_number}</span>
      `;
      els.lapBars.appendChild(wrap);
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

    // Lap history bars
    renderLapHistory(num);
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