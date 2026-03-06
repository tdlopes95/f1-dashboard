// ═══════════════════════════════════════════════════════
// timing.js — Timing Tower component
// Supports Race mode and Qualifying mode (Q1/Q2/Q3)
// ═══════════════════════════════════════════════════════

const Timing = (() => {

  const listEl    = document.getElementById('timing-list');
  const headerEl  = document.getElementById('timing-columns-header');
  const updatedEl = document.getElementById('timing-updated');

  // Cutoff positions per quali phase
  const QUALI_CUTOFFS = { Q1: 15, Q2: 10 };

  // ── Formatters ───────────────────────────────────────
  function formatTime(seconds) {
    if (seconds == null) return '–';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3).padStart(6, '0');
    return mins > 0 ? `${mins}:${secs}` : secs;
  }

  function formatGap(gap) {
    if (gap == null) return '–';
    if (typeof gap === 'string') return gap;
    return `+${gap.toFixed(3)}`;
  }

  function getTyreClass(compound) {
    if (!compound) return '';
    const c = compound.toLowerCase();
    if (c === 'soft')        return 'soft';
    if (c === 'medium')      return 'medium';
    if (c === 'hard')        return 'hard';
    if (c.includes('inter')) return 'inter';
    if (c.includes('wet'))   return 'wet';
    return '';
  }

  function getTyreLetter(compound) {
    if (!compound) return '?';
    const c = compound.toUpperCase();
    if (c === 'SOFT')        return 'S';
    if (c === 'MEDIUM')      return 'M';
    if (c === 'HARD')        return 'H';
    if (c.includes('INTER')) return 'I';
    if (c.includes('WET'))   return 'W';
    return '?';
  }

  // ── Session type helpers ─────────────────────────────
  function isQuali() {
    const t = (State.get('sessionType') || '').toLowerCase();
    return t.includes('qualifying') || t.includes('quali');
  }

  function getQualiPhase() {
    const name = (State.get('sessionName') || '').toUpperCase();
    if (name.includes('Q3')) return 'Q3';
    if (name.includes('Q2')) return 'Q2';

    // Derive from recent race control messages
    const msgs = State.get('raceControl') || [];
    for (const m of msgs) {
      const txt = (m.message || '').toUpperCase();
      if (txt.includes('Q3')) return 'Q3';
      if (txt.includes('Q2')) return 'Q2';
    }
    return 'Q1';
  }

  // ── Build best lap times per driver from all laps ────
  function getBestLaps() {
    const best = {};
    const allLaps = State.raw.allLaps || {};
    Object.entries(allLaps).forEach(([num, laps]) => {
      const valid = laps.filter(l => l.lap_duration && !l.is_pit_out_lap);
      if (!valid.length) return;
      best[num] = valid.reduce((a, b) => a.lap_duration < b.lap_duration ? a : b);
    });
    return best;
  }

  function getOverallBest(bestLaps) {
    const times = Object.values(bestLaps).map(l => l.lap_duration).filter(Boolean);
    return times.length ? Math.min(...times) : null;
  }

  // ── Qualifying elimination status ────────────────────
  function getQualiStatus(pos, phase) {
    const cutoff = QUALI_CUTOFFS[phase];
    if (!cutoff) return 'safe';           // Q3: all remaining are in
    if (pos <= cutoff - 1) return 'safe';
    if (pos === cutoff)    return 'bubble-safe';
    if (pos === cutoff + 1)return 'bubble-out';
    return 'eliminated';
  }

  // ── Swap header columns based on session type ────────
  function updateHeader() {
    if (!headerEl) return;
    if (isQuali()) {
      headerEl.innerHTML = `
        <span class="tc tc--pos">POS</span>
        <span class="tc tc--driver">DRIVER</span>
        <span class="tc tc--tyre">TYR</span>
        <span class="tc tc--best">BEST LAP</span>
        <span class="tc tc--gap">GAP</span>
        <span class="tc tc--s1">S1</span>
        <span class="tc tc--s2">S2</span>
        <span class="tc tc--s3">S3</span>
        <span class="tc tc--status">Q?</span>
      `;
      headerEl.dataset.mode = 'quali';
    } else {
      headerEl.innerHTML = `
        <span class="tc tc--pos">POS</span>
        <span class="tc tc--driver">DRIVER</span>
        <span class="tc tc--tyre">TYR</span>
        <span class="tc tc--gap">GAP</span>
        <span class="tc tc--lap">LAST LAP</span>
        <span class="tc tc--s1">S1</span>
        <span class="tc tc--s2">S2</span>
        <span class="tc tc--s3">S3</span>
        <span class="tc tc--pits">PIT</span>
      `;
      headerEl.dataset.mode = 'race';
    }
  }

  // ── Pit / tyre urgency helpers ───────────────────────

  function getTyreAge(num) {
    const stint = State.raw.stints[num];
    const lap   = State.raw.lastLaps[num];
    if (!stint) return null;
    const lapsDone = lap ? Math.max(0, lap.lap_number - stint.lap_start) : 0;
    return stint.tyre_age_at_start + lapsDone;
  }

  function getMedianTyreAge() {
    const ages = Object.keys(State.raw.drivers)
      .map(n => getTyreAge(parseInt(n)))
      .filter(a => a != null && a > 0);
    if (!ages.length) return null;
    ages.sort((a, b) => a - b);
    return ages[Math.floor(ages.length / 2)];
  }

  function getTyreUrgency(num, medianAge) {
    const age = getTyreAge(num);
    if (age == null || medianAge == null) return 0;
    if (age >= medianAge + 10) return 2;
    if (age >= medianAge + 5)  return 1;
    return 0;
  }

  function isInPit(num) {
    const pits   = State.raw.pitStops[num];
    const curLap = State.raw.lastLaps[num]?.lap_number;
    if (!pits?.length || curLap == null) return false;
    const lastPit = pits[pits.length - 1];
    return lastPit.lap_number === curLap && !lastPit.stop_duration;
  }

  // ── RACE row ─────────────────────────────────────────
  function buildRaceRow(driver, medianAge) {
    const num      = driver.driver_number;
    const pos      = State.raw.positions[num]?.position ?? '–';
    const intv     = State.raw.intervals[num];
    const lap      = State.raw.lastLaps[num];
    const stint    = State.raw.stints[num];
    const pits     = State.raw.pitStops[num]?.length ?? 0;
    const focused  = State.get('focusedDriver') === num;
    const compound = stint?.compound || null;
    const inPit    = isInPit(num);
    const urgency  = getTyreUrgency(num, medianAge);
    const tyreAge  = getTyreAge(num);

    const gap = pos === 1
      ? '<span style="color:var(--accent-yellow)">LEADER</span>'
      : formatGap(intv?.gap_to_leader);

    const posClass   = pos === 1 ? 'pos-1' : pos === 2 ? 'pos-2' : pos === 3 ? 'pos-3' : '';
    const urgencyCls = urgency === 2 ? ' tyre-urgent' : urgency === 1 ? ' tyre-due' : '';
    const tyreAgeLbl = tyreAge != null ? `<span class="tr-tyre-age">${tyreAge}L</span>` : '';

    let pitCell = '';
    if (inPit)            pitCell = '<span class="pit-inpit">PIT</span>';
    else if (urgency===2) pitCell = `<span class="pit-overdue">${pits||0} !</span>`;
    else if (urgency===1) pitCell = `<span class="pit-due">${pits||0} ~</span>`;
    else                  pitCell = `<span class="tr-pits">${pits||'–'}</span>`;

    let rowClass = 'timing-row';
    if (focused)          rowClass += ' is-focused';
    if (inPit)            rowClass += ' row--inpit';
    else if (urgency===2) rowClass += ' row--overdue';
    else if (urgency===1) rowClass += ' row--due';

    const row = document.createElement('div');
    row.className    = rowClass;
    row.dataset.driver = num;

    row.innerHTML = `
      <span class="tr-pos ${posClass}">${pos}</span>
      <span class="tr-driver">
        <span class="tr-acronym">
          <span class="tr-color-bar" style="background:#${driver.team_colour||'fff'}"></span>${driver.name_acronym || num}
          ${inPit ? '<span class="tr-inpit-badge">IN PIT</span>' : ''}
        </span>
        <span class="tr-team">${driver.team_name || ''}</span>
      </span>
      <span class="tr-tyre">
        <span class="tyre-dot ${getTyreClass(compound)}${urgencyCls}">${getTyreLetter(compound)}</span>
        ${tyreAgeLbl}
      </span>
      <span class="tr-gap">${gap}</span>
      <span class="tr-lap">${lap ? formatTime(lap.lap_duration) : '–'}</span>
      <span class="tr-s1">${lap?.duration_sector_1 ? formatTime(lap.duration_sector_1) : '–'}</span>
      <span class="tr-s2">${lap?.duration_sector_2 ? formatTime(lap.duration_sector_2) : '–'}</span>
      <span class="tr-s3">${lap?.duration_sector_3 ? formatTime(lap.duration_sector_3) : '–'}</span>
      ${pitCell}
    `;

    row.addEventListener('click', () => { State.setFocusedDriver(num); render(); });
    return row;
  }

  // ── QUALIFYING row ───────────────────────────────────
  function buildQualiRow(driver, pos, bestLaps, overallBest, phase) {
    const num     = driver.driver_number;
    const focused = State.get('focusedDriver') === num;
    const best    = bestLaps[num];
    const stint   = State.raw.stints[num];
    const compound = stint?.compound || null;
    const status   = getQualiStatus(pos, phase);

    // Gap to pole
    let gapHtml = '–';
    if (pos === 1) {
      gapHtml = '<span class="q-pole">POLE</span>';
    } else if (best && overallBest) {
      gapHtml = `+${(best.lap_duration - overallBest).toFixed(3)}`;
    }

    // Was last lap an improvement?
    const lastLap = State.raw.lastLaps[num];
    const improved = best && lastLap && lastLap.lap_duration === best.lap_duration;

    // Status badge content + next session label
    const nextQ = phase === 'Q1' ? 'Q2' : phase === 'Q2' ? 'Q3' : 'FINAL';
    const statusMap = {
      'safe':        { cls: 'q-status--safe',        label: nextQ },
      'bubble-safe': { cls: 'q-status--bubble-safe', label: nextQ },
      'bubble-out':  { cls: 'q-status--bubble-out',  label: 'OUT' },
      'eliminated':  { cls: 'q-status--out',         label: 'OUT' },
    };
    const { cls: statusCls, label: statusLabel } = statusMap[status] || { cls: '', label: '' };

    const rowClass = {
      'safe':        '',
      'bubble-safe': 'qrow--bubble-safe',
      'bubble-out':  'qrow--bubble-out',
      'eliminated':  'qrow--eliminated',
    }[status] || '';

    const posClass = pos === 1 ? 'pos-1' : pos === 2 ? 'pos-2' : pos === 3 ? 'pos-3' : '';

    const row = document.createElement('div');
    row.className = `timing-row timing-row--quali ${rowClass}${focused ? ' is-focused' : ''}`;
    row.dataset.driver = num;

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
      <span class="tr-lap${improved ? ' tr-lap--improved' : ''}">${best ? formatTime(best.lap_duration) : '–'}</span>
      <span class="tr-gap">${gapHtml}</span>
      <span class="tr-s1">${best?.duration_sector_1 ? formatTime(best.duration_sector_1) : '–'}</span>
      <span class="tr-s2">${best?.duration_sector_2 ? formatTime(best.duration_sector_2) : '–'}</span>
      <span class="tr-s3">${best?.duration_sector_3 ? formatTime(best.duration_sector_3) : '–'}</span>
      <span class="q-status-cell"><span class="q-status ${statusCls}">${statusLabel}</span></span>
    `;

    row.addEventListener('click', () => { State.setFocusedDriver(num); render(); });
    return row;
  }

  // ── Phase divider bar ────────────────────────────────
  function buildCutoffDivider(phase) {
    const cutoff = QUALI_CUTOFFS[phase];
    const nextQ  = phase === 'Q1' ? 'Q2' : 'Q3';
    const div = document.createElement('div');
    div.className = 'quali-cutoff-line';
    div.innerHTML = `<span class="qcl-label">▲ ADVANCE TO ${nextQ} &nbsp;│&nbsp; ELIMINATED BELOW ▼</span>`;
    return div;
  }

  // ── Main render ──────────────────────────────────────
  function render() {
    const drivers = State.getDriversSortedByPosition();
    if (!drivers.length) return;

    updateHeader();
    listEl.innerHTML = '';

    if (isQuali()) {
      const phase       = getQualiPhase();
      const bestLaps    = getBestLaps();
      const overallBest = getOverallBest(bestLaps);
      const cutoff      = QUALI_CUTOFFS[phase];

      // Sort by best lap time (no time = bottom)
      const sorted = [...drivers].sort((a, b) => {
        const ta = bestLaps[a.driver_number]?.lap_duration ?? Infinity;
        const tb = bestLaps[b.driver_number]?.lap_duration ?? Infinity;
        return ta - tb;
      });

      // Phase banner
      const banner = document.createElement('div');
      banner.className = 'quali-phase-banner';
      banner.innerHTML = `
        <span class="qpb-phase">${phase}</span>
        <span class="qpb-label">QUALIFYING SESSION</span>
        ${overallBest ? `<span class="qpb-best">BEST: ${formatTime(overallBest)}</span>` : '<span class="qpb-best">NO TIMES YET</span>'}
      `;
      listEl.appendChild(banner);

      sorted.forEach((d, i) => {
        const pos = i + 1;
        listEl.appendChild(buildQualiRow(d, pos, bestLaps, overallBest, phase));
        // Insert cutoff line after the last safe driver
        if (cutoff && pos === cutoff) {
          listEl.appendChild(buildCutoffDivider(phase));
        }
      });

    } else {
      const medianAge = getMedianTyreAge();
      drivers.forEach(d => listEl.appendChild(buildRaceRow(d, medianAge)));
    }

    updatedEl.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }

  function init() {
    State.on('change:positions',    render);
    State.on('change:intervals',    render);
    State.on('change:lastLaps',     render);
    State.on('change:allLaps',      render);
    State.on('change:stints',       render);
    State.on('change:pitStops',     render);
    State.on('change:focusedDriver',render);
    State.on('change:sessionType',  render);
    State.on('change:raceControl',  render);
    State.on('driversLoaded',       render);
    console.log('[Timing] Initialized');
  }

  return { init, render };

})();