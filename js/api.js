// ═══════════════════════════════════════════════════════
// api.js — OpenF1 API polling layer
// Handles all fetch calls, rate limiting, and state updates
// ═══════════════════════════════════════════════════════

const API = (() => {

  const BASE = 'https://api.openf1.org/v1';

  // Polling intervals (ms)
  const INTERVALS = {
    fast:   3000,   // positions, intervals, car data, locations, race_control
    medium: 8000,   // laps, stints, pit stops, overtakes
    slow:   30000,  // weather, session info
  };

  let _timers = {};
  let _running = false;
  let _lastPositionDate = null;
  let _lastRCDate = null;
  let _lastCarDataDate = {};   // per driver
  let _lastLocationDate = null;

  // ── Core fetch with error handling ──────────────────
  async function fetchJSON(endpoint, params = {}) {
    const url = new URL(`${BASE}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[API] ${endpoint} failed:`, err.message);
      return null;
    }
  }

  // ── Session bootstrap ────────────────────────────────
  async function loadSession() {
    const sessions = await fetchJSON('sessions', { session_key: 'latest' });
    if (!sessions?.length) return;
    const s = sessions[0];

    State.set('sessionKey',  s.session_key);
    State.set('meetingKey',  s.meeting_key);
    State.set('sessionName', `${s.location} — ${s.session_name}`);
    State.set('sessionType', s.session_type);
    State.set('circuitName', s.circuit_short_name);
    State.set('sessionStartTime', s.date_start);

    document.getElementById('session-name').textContent = State.get('sessionName') || '–';
    document.getElementById('circuit-name').textContent = State.get('circuitName') || '–';

    // Set session badge
    const badge = document.getElementById('session-type-badge');
    badge.textContent = s.session_name?.toUpperCase() || '';
    badge.className = 'badge';
    const t = (s.session_type || '').toLowerCase();
    if (t.includes('race'))       badge.classList.add('badge--race');
    else if (t.includes('quali')) badge.classList.add('badge--quali');
    else if (t.includes('sprint'))badge.classList.add('badge--sprint');
    else                           badge.classList.add('badge--practice');

    console.log(`[API] Session loaded: ${s.session_name} (key: ${s.session_key})`);
  }

  async function loadDrivers() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('drivers', { session_key: sk });
    if (!data?.length) return;

    data.forEach(d => {
      State.setDriver(d.driver_number, {
        driver_number: d.driver_number,
        name_acronym:  d.name_acronym,
        full_name:     d.full_name,
        team_name:     d.team_name,
        team_colour:   d.team_colour || 'FFFFFF',
        headshot_url:  d.headshot_url,
      });
    });

    State.emit('driversLoaded', State.raw.drivers);
    console.log(`[API] Loaded ${data.length} drivers`);
  }

  // ── Fast polls ───────────────────────────────────────

  async function pollPositions() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_lastPositionDate) params['date>' ] = _lastPositionDate;

    const data = await fetchJSON('position', params);
    if (!data?.length) return;

    const updates = {};
    data.forEach(p => {
      const cur = State.raw.positions[p.driver_number];
      if (!cur || new Date(p.date) > new Date(cur.date)) {
        updates[p.driver_number] = { position: p.position, date: p.date };
        _lastPositionDate = p.date;
      }
    });

    if (Object.keys(updates).length) {
      State.merge('positions', updates);
      State.set('lastUpdated', { ...State.get('lastUpdated'), positions: Date.now() });
    }
  }

  async function pollIntervals() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('intervals', { session_key: sk });
    if (!data?.length) return;

    const updates = {};
    data.forEach(i => {
      updates[i.driver_number] = {
        gap_to_leader: i.gap_to_leader,
        interval:      i.interval,
        date:          i.date,
      };
    });
    State.merge('intervals', updates);
  }

  async function pollCarData() {
    const focused = State.get('focusedDriver');
    if (!focused) return;

    const sk = State.get('sessionKey');
    const lastDate = _lastCarDataDate[focused];
    const params   = { session_key: sk, driver_number: focused };
    if (lastDate) params['date>'] = lastDate;

    const data = await fetchJSON('car_data', params);
    if (!data?.length) return;

    // Take the latest sample
    const latest = data[data.length - 1];
    _lastCarDataDate[focused] = latest.date;

    State.merge('carData', { [focused]: latest });
  }

  async function pollLocations() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_lastLocationDate) params['date>'] = _lastLocationDate;

    const data = await fetchJSON('location', params);
    if (!data?.length) return;

    // Keep only latest per driver
    const updates = {};
    data.forEach(l => {
      if (!updates[l.driver_number] || new Date(l.date) > new Date(updates[l.driver_number].date)) {
        updates[l.driver_number] = { x: l.x, y: l.y, z: l.z, date: l.date };
        _lastLocationDate = l.date;
      }
    });
    State.merge('locations', updates);
  }

  async function pollRaceControl() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_lastRCDate) params['date>'] = _lastRCDate;

    const data = await fetchJSON('race_control', params);
    if (!data?.length) return;

    data.forEach(msg => {
      State.pushRaceControl(msg);
      _lastRCDate = msg.date;

      // Update track status from flags/SC messages
      const cat  = (msg.category  || '').toLowerCase();
      const flag = (msg.flag      || '').toUpperCase();
      const txt  = (msg.message   || '').toUpperCase();

      if (flag === 'RED' || txt.includes('RED FLAG'))              State.set('trackStatus', 'RED');
      else if (txt.includes('SAFETY CAR DEPLOYED'))                State.set('trackStatus', 'SC');
      else if (txt.includes('VIRTUAL SAFETY CAR DEPLOYED'))        State.set('trackStatus', 'VSC');
      else if (txt.includes('SAFETY CAR IN THIS LAP') ||
               txt.includes('VIRTUAL SAFETY CAR ENDING'))          State.set('trackStatus', 'GREEN');
      else if (flag === 'GREEN' || txt.includes('GREEN FLAG'))     State.set('trackStatus', 'GREEN');
      else if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW')      State.set('trackStatus', 'YELLOW');
      else if (flag === 'CHEQUERED')                               State.set('trackStatus', 'CHEQUERED');
    });
  }

  // ── Medium polls ─────────────────────────────────────

  async function pollLaps() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('laps', { session_key: sk });
    if (!data?.length) return;

    const allLaps = {};
    const lastLaps = {};

    data.forEach(lap => {
      const n = lap.driver_number;
      if (!allLaps[n]) allLaps[n] = [];
      allLaps[n].push(lap);
    });

    // Sort and keep last lap
    Object.keys(allLaps).forEach(n => {
      allLaps[n].sort((a, b) => a.lap_number - b.lap_number);
      lastLaps[n] = allLaps[n][allLaps[n].length - 1];

      // Track max lap for lap counter
      const maxLap = lastLaps[n]?.lap_number;
      if (maxLap && (!State.raw.currentLap || maxLap > State.raw.currentLap)) {
        State.set('currentLap', maxLap);
      }
    });

    State.set('allLaps',  allLaps);
    State.merge('lastLaps', lastLaps);
  }

  async function pollStints() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('stints', { session_key: sk });
    if (!data?.length) return;

    // Keep current (latest) stint per driver
    const stints = {};
    data.forEach(s => {
      const n = s.driver_number;
      if (!stints[n] || s.stint_number > stints[n].stint_number) {
        stints[n] = s;
      }
    });
    State.set('stints', stints);
  }

  async function pollPits() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('pit', { session_key: sk });
    if (!data?.length) return;

    const pits = {};
    data.forEach(p => {
      if (!pits[p.driver_number]) pits[p.driver_number] = [];
      pits[p.driver_number].push(p);
    });
    State.set('pitStops', pits);
  }

  async function pollOvertakes() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('overtakes', { session_key: sk });
    if (data?.length) State.set('overtakes', data);
  }

  // ── Slow polls ───────────────────────────────────────

  async function pollWeather() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('weather', { session_key: sk });
    if (!data?.length) return;
    // Take most recent
    const latest = data[data.length - 1];
    State.set('weather', latest);
  }

  // ── Scheduler ────────────────────────────────────────

  function scheduleRepeat(fn, interval, name) {
    fn(); // run immediately
    _timers[name] = setInterval(fn, interval);
  }

  function start() {
    if (_running) return;
    _running = true;

    (async () => {
      await loadSession();
      await loadDrivers();
      await pollLaps();
      await pollStints();
      await pollPits();
      await pollWeather();

      // Fast polls
      scheduleRepeat(pollPositions,   INTERVALS.fast,   'positions');
      scheduleRepeat(pollIntervals,   INTERVALS.fast,   'intervals');
      scheduleRepeat(pollCarData,     INTERVALS.fast,   'carData');
      scheduleRepeat(pollLocations,   INTERVALS.fast,   'locations');
      scheduleRepeat(pollRaceControl, INTERVALS.fast,   'raceControl');

      // Medium polls
      scheduleRepeat(pollLaps,        INTERVALS.medium, 'laps');
      scheduleRepeat(pollStints,      INTERVALS.medium, 'stints');
      scheduleRepeat(pollPits,        INTERVALS.medium, 'pits');
      scheduleRepeat(pollOvertakes,   INTERVALS.medium, 'overtakes');

      // Slow polls
      scheduleRepeat(pollWeather,     INTERVALS.slow,   'weather');

      console.log('[API] All pollers started');
    })();
  }

  function stop() {
    Object.values(_timers).forEach(clearInterval);
    _timers = {};
    _running = false;
  }


  // ── Historical load (past sessions — fetch once, no polling) ──
  async function loadHistorical(sessionKey) {
    console.log('[API] Loading historical session:', sessionKey);

    // Load in parallel where possible
    const [drivers, laps, stints, pits, positions, rc, weather] = await Promise.all([
      fetchJSON('drivers',      { session_key: sessionKey }),
      fetchJSON('laps',         { session_key: sessionKey }),
      fetchJSON('stints',       { session_key: sessionKey }),
      fetchJSON('pit',          { session_key: sessionKey }),
      fetchJSON('position',     { session_key: sessionKey }),
      fetchJSON('race_control', { session_key: sessionKey }),
      fetchJSON('weather',      { session_key: sessionKey }),
    ]);

    // Drivers
    if (drivers?.length) {
      drivers.forEach(d => {
        State.setDriver(d.driver_number, {
          driver_number: d.driver_number,
          name_acronym:  d.name_acronym,
          full_name:     d.full_name,
          team_name:     d.team_name,
          team_colour:   d.team_colour || 'FFFFFF',
          headshot_url:  d.headshot_url,
        });
      });
      State.emit('driversLoaded', State.raw.drivers);
    }

    // Positions — keep only final position per driver
    if (positions?.length) {
      const finalPos = {};
      positions.forEach(p => {
        if (!finalPos[p.driver_number] || new Date(p.date) > new Date(finalPos[p.driver_number].date)) {
          finalPos[p.driver_number] = p;
        }
      });
      const posMap = {};
      Object.values(finalPos).forEach(p => {
        posMap[p.driver_number] = { position: p.position, date: p.date };
      });
      State.merge('positions', posMap);
    }

    // Laps — all laps + last lap per driver
    if (laps?.length) {
      const allLaps = {};
      const lastLaps = {};
      laps.forEach(lap => {
        const n = lap.driver_number;
        if (!allLaps[n]) allLaps[n] = [];
        allLaps[n].push(lap);
      });
      Object.keys(allLaps).forEach(n => {
        allLaps[n].sort((a, b) => a.lap_number - b.lap_number);
        lastLaps[n] = allLaps[n][allLaps[n].length - 1];
        const maxLap = lastLaps[n]?.lap_number;
        if (maxLap) State.set('currentLap', maxLap);
      });
      State.set('allLaps', allLaps);
      State.merge('lastLaps', lastLaps);
    }

    // Stints — latest per driver
    if (stints?.length) {
      const stintMap = {};
      stints.forEach(s => {
        const n = s.driver_number;
        if (!stintMap[n] || s.stint_number > stintMap[n].stint_number) {
          stintMap[n] = s;
        }
      });
      State.set('stints', stintMap);
    }

    // Pit stops
    if (pits?.length) {
      const pitMap = {};
      pits.forEach(p => {
        if (!pitMap[p.driver_number]) pitMap[p.driver_number] = [];
        pitMap[p.driver_number].push(p);
      });
      State.set('pitStops', pitMap);
    }

    // Race control
    if (rc?.length) {
      const sorted = [...rc].sort((a, b) => new Date(b.date) - new Date(a.date));
      State.set('raceControl', sorted);
      State.emit('change:raceControl', sorted);

      // Set final track status from last message
      const lastFlag = sorted.find(m => m.flag);
      if (lastFlag?.flag === 'CHEQUERED') State.set('trackStatus', 'CHEQUERED');
    }

    // Weather — most recent sample
    if (weather?.length) {
      State.set('weather', weather[weather.length - 1]);
    }

    console.log('[API] Historical load complete');
  }

  return { start, stop, fetchJSON, loadHistorical };

})();