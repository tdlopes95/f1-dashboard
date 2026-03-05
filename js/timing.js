// ═══════════════════════════════════════════════════════
// timing.js — Timing Tower component
// ═══════════════════════════════════════════════════════

const Timing = (() => {

  const listEl     = document.getElementById('timing-list');
  const updatedEl  = document.getElementById('timing-updated');

  function formatTime(seconds) {
    if (seconds == null) return '–';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    return mins > 0 ? `${mins}:${secs}` : `${secs}`;
  }

  function formatGap(gap) {
    if (gap == null) return '–';
    if (typeof gap === 'string') return gap; // '+1 LAP' etc
    return `+${gap.toFixed(3)}`;
  }

  function getTyreClass(compound) {
    if (!compound) return '';
    const c = compound.toLowerCase();
    if (c === 'soft')   return 'soft';
    if (c === 'medium') return 'medium';
    if (c === 'hard')   return 'hard';
    if (c.includes('inter')) return 'inter';
    if (c.includes('wet'))   return 'wet';
    return '';
  }

  function getTyreLetter(compound) {
    if (!compound) return '?';
    const c = compound.toUpperCase();
    if (c === 'SOFT')   return 'S';
    if (c === 'MEDIUM') return 'M';
    if (c === 'HARD')   return 'H';
    if (c.includes('INTER')) return 'I';
    if (c.includes('WET'))   return 'W';
    return '?';
  }

  function buildRow(driver, index) {
    const num  = driver.driver_number;
    const pos  = State.raw.positions[num]?.position ?? '–';
    const intv = State.raw.intervals[num];
    const lap  = State.raw.lastLaps[num];
    const stint= State.raw.stints[num];
    const pits = State.raw.pitStops[num]?.length ?? 0;
    const color= '#' + (driver.team_colour || 'FFFFFF');
    const focused = State.get('focusedDriver') === num;

    const gap = pos === 1
      ? '<span style="color:var(--accent-yellow)">LEADER</span>'
      : formatGap(intv?.gap_to_leader);

    const lastLap = lap ? formatTime(lap.lap_duration) : '–';
    const s1 = lap?.duration_sector_1 ? formatTime(lap.duration_sector_1) : '–';
    const s2 = lap?.duration_sector_2 ? formatTime(lap.duration_sector_2) : '–';
    const s3 = lap?.duration_sector_3 ? formatTime(lap.duration_sector_3) : '–';

    const compound = stint?.compound || null;
    const tyreAge  = stint ? (stint.tyre_age_at_start + (lap?.lap_number - stint.lap_start || 0)) : '?';

    const posClass = pos === 1 ? 'pos-1' : pos === 2 ? 'pos-2' : pos === 3 ? 'pos-3' : '';

    const row = document.createElement('div');
    row.className = 'timing-row' + (focused ? ' is-focused' : '');
    row.dataset.driver = num;
    row.style.animationDelay = `${index * 0.04}s`;

    row.innerHTML = `
      <span class="tr-pos ${posClass}">${pos}</span>
      <span class="tr-driver">
        <span class="tr-acronym">
          <span class="tr-color-bar" style="background:#${driver.team_colour||'fff'}"></span>${driver.name_acronym || num}
        </span>
        <span class="tr-team">${driver.team_name || ''}</span>
      </span>
      <span class="tr-tyre">
        <span class="tyre-dot ${getTyreClass(compound)}">${getTyreLetter(compound)}</span>
      </span>
      <span class="tr-gap">${gap}</span>
      <span class="tr-lap">${lastLap}</span>
      <span class="tr-s1">${s1}</span>
      <span class="tr-s2">${s2}</span>
      <span class="tr-s3">${s3}</span>
      <span class="tr-pits">${pits || '–'}</span>
    `;

    row.addEventListener('click', () => {
      State.setFocusedDriver(num);
      render();
    });

    return row;
  }

  function render() {
    const drivers = State.getDriversSortedByPosition();
    if (!drivers.length) return;

    listEl.innerHTML = '';
    drivers.forEach((d, i) => {
      listEl.appendChild(buildRow(d, i));
    });

    const now = new Date();
    updatedEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
  }

  function init() {
    // Re-render on relevant state changes
    State.on('change:positions',  render);
    State.on('change:intervals',  render);
    State.on('change:lastLaps',   render);
    State.on('change:stints',     render);
    State.on('change:pitStops',   render);
    State.on('change:focusedDriver', render);
    State.on('driversLoaded',     render);

    console.log('[Timing] Initialized');
  }

  return { init, render };

})();