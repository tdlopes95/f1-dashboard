// ═══════════════════════════════════════════════════════
// api.js — OpenF1 API polling layer
// Handles all fetch calls, rate limiting, and state updates
//
// BALANCING STRATEGY:
// - Staggered boot: pollers fire 600ms apart, never all at T=0
// - Per-poller concurrency lock: skips cycle if previous still in flight
// - Date watermarks on ALL endpoints: only fetches new data each cycle
// - sessionStorage snapshot: restores state on refresh, cold-start avoided
// - carData gated on focused driver + tab visibility
// - Intervals tuned: fast=4s, medium=12s, slow=45s
// ═══════════════════════════════════════════════════════

const API = (() => {

  const BASE = 'https://api.openf1.org/v1';

  const INTERVALS = {
    fast:   4000,   // positions, intervals, race_control, locations
    medium: 12000,  // laps, stints, pits, radio
    slow:   45000,  // weather, overtakes
  };

  // carData is special — very fast but only for focused driver
  const CAR_DATA_INTERVAL = 2000;

  let _timers  = {};
  let _running = false;

  // Per-poller in-flight locks — prevents overlapping requests
  const _inFlight = {};

  // Date watermarks — only fetch data newer than last seen
  let _wm = {
    positions:  null,
    intervals:  null,
    raceControl:null,
    locations:  null,
    laps:       null,
    radio:      null,
  };

  // ── Debug log — delegates to shared DBG module ─────
  function dbg(msg, level = 'info') {
    console.log(`[API] ${msg}`);
    DBG.log('API', msg, level);
  }

  // ── sessionStorage snapshot ──────────────────────────
  const SNAP_KEY = 'f1dash_state_snap';
  const SNAP_FIELDS = [
    'sessionKey','meetingKey','sessionName','sessionType',
    'circuitName','sessionStartTime','sessionEndTime','sessionIsLive',
    'drivers','positions','intervals','lastLaps','allLaps',
    'stints','pitStops','raceControl','weather','trackStatus',
    'currentLap','nextSessionName','nextSessionStart',
  ];

  function saveSnapshot() {
    try {
      const snap = {};
      SNAP_FIELDS.forEach(k => { snap[k] = State.get(k) ?? State.raw[k]; });
      snap._wm  = _wm;
      snap._ts  = Date.now();
      sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch(e) { /* quota exceeded — ignore */ }
  }

  function restoreSnapshot(expectedSessionKey) {
    try {
      const raw = sessionStorage.getItem(SNAP_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw);

      // Only restore if snapshot is <90 minutes old
      if (Date.now() - snap._ts > 90 * 60 * 1000) {
        sessionStorage.removeItem(SNAP_KEY);
        return false;
      }

      // Only restore if snapshot is for the same session — prevents stale data poisoning
      if (expectedSessionKey && snap.sessionKey !== expectedSessionKey) {
        console.log('[API] Snapshot session mismatch — discarding');
        sessionStorage.removeItem(SNAP_KEY);
        return false;
      }

      // Restore state fields
      SNAP_FIELDS.forEach(k => {
        if (snap[k] != null) {
          if (['drivers','positions','intervals','lastLaps','allLaps',
               'stints','pitStops'].includes(k)) {
            State.raw[k] = snap[k];
          } else {
            State.set(k, snap[k]);
          }
        }
      });

      // Restore watermarks
      if (snap._wm) _wm = { ..._wm, ...snap._wm };

      // Fire driversLoaded so components re-render
      if (Object.keys(State.raw.drivers || {}).length) {
        State.emit('driversLoaded', State.raw.drivers);
      }

      console.log('[API] Snapshot restored — age:', Math.round((Date.now() - snap._ts) / 1000), 's');
      return true;
    } catch(e) {
      console.warn('[API] Snapshot restore failed:', e.message);
      return false;
    }
  }

  // ── Core fetch with concurrency guard ───────────────
  async function fetchJSON(endpoint, params = {}) {
    const url = new URL(`${BASE}/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    try {
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      dbg(`FETCH FAILED: ${endpoint} — ${err.message}`, 'error');
      return null;
    }
  }

  // Wrap a poll function with an in-flight lock
  function guarded(name, fn) {
    return async () => {
      if (_inFlight[name]) return; // skip — previous still running
      _inFlight[name] = true;
      try { await fn(); }
      finally { _inFlight[name] = false; }
    };
  }

  // ── Session bootstrap ────────────────────────────────
  async function loadSession() {
    // Avoid session_key:'latest' — prone to 401 on OpenF1 free tier.
    // Instead: fetch all sessions for the current year, find the most recent one.
    const now = new Date();
    const year = now.getFullYear();

    dbg(`fetching sessions for ${year}...`);
    let allSessions = await fetchJSON('sessions', { year });

    // If current year returns nothing, try previous year (early in season)
    if (!allSessions?.length) {
      dbg(`no sessions for ${year}, trying ${year - 1}...`, 'warn');
      allSessions = await fetchJSON('sessions', { year: year - 1 });
    }

    if (!allSessions?.length) {
      dbg('sessions API returned nothing — check network/CORS', 'error');
      State.set('sessionIsLive', false);
      return;
    }

    // Sort by date descending — most recent first
    allSessions.sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

    // Find a currently live session first
    let s = allSessions.find(x => {
      const started = new Date(x.date_start) <= now;
      const ended   = x.date_end ? new Date(x.date_end) < now : false;
      return started && !ended;
    });

    // Fallback: most recent past session
    if (!s) s = allSessions[0];

    dbg(`picked session: ${s.session_name} (${s.date_start})`);

    State.set('sessionKey',      s.session_key);
    State.set('meetingKey',      s.meeting_key);
    State.set('sessionName',     `${s.location} — ${s.session_name}`);
    State.set('sessionType',     s.session_type);
    State.set('circuitName',     s.circuit_short_name);
    State.set('sessionStartTime',s.date_start);
    State.set('sessionEndTime',  s.date_end);

    let   started = new Date(s.date_start) <= now;
    // date_end is often null for practice/quali — treat null as not-yet-ended
    const ended   = s.date_end ? new Date(s.date_end) < now : false;
    let   isLive  = started && !ended;

    // (live detection already done above by scanning all year sessions)

    State.set('sessionIsLive', isLive);

    if (!isLive) {
      // Scan current + next year sessions to find the next upcoming one
      const year = now.getFullYear();
      let future = [];
      for (const y of [year, year + 1]) {
        const all = await fetchJSON('sessions', { year: y });
        if (all?.length) {
          future = all
            .filter(x => new Date(x.date_start) > now)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
          if (future.length) break;
        }
      }
      if (future.length) {
        const next = future[0];
        State.set('nextSessionName',  `${next.location} — ${next.session_name}`);
        State.set('nextSessionStart', next.date_start);
      } else {
        State.set('nextSessionName',  'Next session TBC');
        State.set('nextSessionStart', null);
      }
    }

    document.getElementById('session-name').textContent = State.get('sessionName') || '–';
    document.getElementById('circuit-name').textContent = State.get('circuitName') || '–';

    const badge = document.getElementById('session-type-badge');
    badge.textContent = s.session_name?.toUpperCase() || '';
    badge.className = 'badge';
    const t = (s.session_type || '').toLowerCase();
    if (t.includes('race'))        badge.classList.add('badge--race');
    else if (t.includes('quali'))  badge.classList.add('badge--quali');
    else if (t.includes('sprint')) badge.classList.add('badge--sprint');
    else                           badge.classList.add('badge--practice');

    dbg(`session: ${s.session_name} key=${s.session_key} live=${State.get("sessionIsLive")} start=${s.date_start} end=${s.date_end || "null"}`);
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
    dbg(`drivers loaded: ${data.length}`);
  }

  // ── Fast polls ───────────────────────────────────────

  async function _pollPositions() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.positions) params['date>'] = _wm.positions;

    const data = await fetchJSON('position', params);
    if (!data?.length) return;

    const updates = {};
    data.forEach(p => {
      const cur = State.raw.positions[p.driver_number];
      if (!cur || new Date(p.date) > new Date(cur.date)) {
        updates[p.driver_number] = { position: p.position, date: p.date };
        if (!_wm.positions || p.date > _wm.positions) _wm.positions = p.date;
      }
    });
    if (Object.keys(updates).length) State.merge('positions', updates);
  }

  async function _pollIntervals() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.intervals) params['date>'] = _wm.intervals;

    const data = await fetchJSON('intervals', params);
    if (!data?.length) return;

    const updates = {};
    data.forEach(i => {
      updates[i.driver_number] = {
        gap_to_leader: i.gap_to_leader,
        interval:      i.interval,
        date:          i.date,
      };
      if (!_wm.intervals || i.date > _wm.intervals) _wm.intervals = i.date;
    });
    if (Object.keys(updates).length) State.merge('intervals', updates);
  }

  async function _pollCarData() {
    const focused = State.get('focusedDriver');
    if (!focused) return;

    // Skip if tab not visible — saves requests while user is elsewhere
    if (document.hidden) return;

    const sk     = State.get('sessionKey');
    const lastDate = (_wm.carData || {})[focused];
    const params   = { session_key: sk, driver_number: focused };
    if (lastDate) params['date>'] = lastDate;

    const data = await fetchJSON('car_data', params);
    if (!data?.length) return;

    const latest = data[data.length - 1];
    if (!_wm.carData) _wm.carData = {};
    _wm.carData[focused] = latest.date;

    State.merge('carData', { [focused]: latest });
  }

  async function _pollLocations() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.locations) params['date>'] = _wm.locations;

    const data = await fetchJSON('location', params);
    if (!data?.length) return;

    const updates = {};
    data.forEach(l => {
      if (!updates[l.driver_number] || l.date > updates[l.driver_number].date) {
        updates[l.driver_number] = { x: l.x, y: l.y, z: l.z, date: l.date };
        if (!_wm.locations || l.date > _wm.locations) _wm.locations = l.date;
      }
    });
    if (Object.keys(updates).length) State.merge('locations', updates);
  }

  async function _pollRaceControl() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.raceControl) params['date>'] = _wm.raceControl;

    const data = await fetchJSON('race_control', params);
    if (!data?.length) return;

    data.forEach(msg => {
      State.pushRaceControl(msg);
      if (!_wm.raceControl || msg.date > _wm.raceControl) _wm.raceControl = msg.date;

      const flag = (msg.flag    || '').toUpperCase();
      const txt  = (msg.message || '').toUpperCase();

      if (flag === 'RED' || txt.includes('RED FLAG'))                State.set('trackStatus', 'RED');
      else if (txt.includes('SAFETY CAR DEPLOYED'))                  State.set('trackStatus', 'SC');
      else if (txt.includes('VIRTUAL SAFETY CAR DEPLOYED'))          State.set('trackStatus', 'VSC');
      else if (txt.includes('SAFETY CAR IN THIS LAP') ||
               txt.includes('VIRTUAL SAFETY CAR ENDING'))            State.set('trackStatus', 'GREEN');
      else if (flag === 'GREEN' || txt.includes('GREEN FLAG'))       State.set('trackStatus', 'GREEN');
      else if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW')        State.set('trackStatus', 'YELLOW');
      else if (flag === 'CHEQUERED')                                 State.set('trackStatus', 'CHEQUERED');
    });
  }

  // ── Medium polls ─────────────────────────────────────

  async function _pollLaps() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.laps) params['date>'] = _wm.laps;

    const data = await fetchJSON('laps', params);
    if (!data?.length) return;

    // Merge into existing allLaps rather than replacing
    const allLaps  = { ...State.raw.allLaps  } || {};
    const lastLaps = { ...State.raw.lastLaps } || {};

    data.forEach(lap => {
      const n = lap.driver_number;
      if (!allLaps[n]) allLaps[n] = [];

      // Avoid duplicates
      const exists = allLaps[n].some(l => l.lap_number === lap.lap_number);
      if (!exists) allLaps[n].push(lap);

      // Update last lap
      if (!lastLaps[n] || lap.lap_number > lastLaps[n].lap_number) {
        lastLaps[n] = lap;
        if (lap.lap_number > (State.get('currentLap') || 0)) {
          State.set('currentLap', lap.lap_number);
        }
      }

      if (!_wm.laps || lap.date_start > _wm.laps) _wm.laps = lap.date_start;
    });

    // Sort each driver's laps by lap number
    Object.keys(allLaps).forEach(n => {
      allLaps[n].sort((a, b) => a.lap_number - b.lap_number);
    });

    State.set('allLaps',  allLaps);
    State.merge('lastLaps', lastLaps);
  }

  async function _pollStints() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('stints', { session_key: sk });
    if (!data?.length) return;

    const stints = {};
    data.forEach(s => {
      const n = s.driver_number;
      if (!stints[n] || s.stint_number > stints[n].stint_number) stints[n] = s;
    });
    State.set('stints', stints);
  }

  async function _pollPits() {
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

  async function _pollTeamRadio() {
    const sk = State.get('sessionKey');
    const params = { session_key: sk };
    if (_wm.radio) params['date>'] = _wm.radio;

    const data = await fetchJSON('team_radio', params);
    if (!data?.length) return;

    data.forEach(clip => {
      const isNew = _wm.radio !== null;
      if (!_wm.radio || clip.date > _wm.radio) _wm.radio = clip.date;
      if (isNew) State.emit('newRadioClip', clip);
    });
  }

  // ── Slow polls ───────────────────────────────────────

  async function _pollWeather() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('weather', { session_key: sk });
    if (!data?.length) return;
    State.set('weather', data[data.length - 1]);
  }

  async function _pollOvertakes() {
    const sk = State.get('sessionKey');
    const data = await fetchJSON('overtakes', { session_key: sk });
    if (data?.length) State.set('overtakes', data);
  }

  // ── Staggered scheduler ──────────────────────────────
  // Fires fn() after `delayMs`, then every `interval`
  // Each poller is wrapped in a concurrency guard
  function schedule(name, fn, interval, delayMs = 0) {
    const locked = guarded(name, fn);
    const timer = setTimeout(() => {
      locked(); // first fire after stagger delay
      _timers[name] = setInterval(locked, interval);
    }, delayMs);
    _timers[`${name}_init`] = timer;
  }

  // ── Boot sequence ────────────────────────────────────
  function start() {
    if (_running) return;
    _running = true;

    (async () => {
      // 1. Try MultiViewer first — best live data source, no rate limits
      dbg('boot: trying MultiViewer local API...');
      const mvOk = await MV.start();

      if (mvOk) {
        // MV is handling everything — OpenF1 pollers not needed
        dbg('boot: MultiViewer active ✓ — OpenF1 pollers suppressed');
        _running = false; // MV runs its own loop
        return;
      }

      // 2. MV not available — fall back to OpenF1
      dbg('boot: MultiViewer unavailable, trying OpenF1...', 'warn');
      await loadSession();

      const isLiveVal = State.get('sessionIsLive');
      if (!isLiveVal) {
        if (isLiveVal === undefined) {
          dbg('OpenF1 also failed — check network/CORS', 'error');
        } else {
          dbg(`no live session — isLive=${isLiveVal}`, 'warn');
        }
        _running = false;
        return;
      }

      // 3. Snapshot restore (OpenF1 path only)
      const currentKey = State.get('sessionKey');
      dbg(`OpenF1 session key: ${currentKey}`);
      const restored = restoreSnapshot(currentKey);

      if (!restored) {
        await loadDrivers();
        await _pollLaps();
        await _pollStints();
        await _pollPits();
        await _pollWeather();
      } else {
        await loadDrivers();
      }

      // 4. Start OpenF1 pollers (staggered)
      schedule('positions',   _pollPositions,   INTERVALS.fast,       0);
      schedule('intervals',   _pollIntervals,   INTERVALS.fast,     600);
      schedule('raceControl', _pollRaceControl, INTERVALS.fast,    1200);
      schedule('locations',   _pollLocations,   INTERVALS.fast,    1800);
      schedule('carData',     _pollCarData,     CAR_DATA_INTERVAL, 2400);
      schedule('laps',        _pollLaps,        INTERVALS.medium,  3000);
      schedule('stints',      _pollStints,      INTERVALS.medium,  4000);
      schedule('pits',        _pollPits,        INTERVALS.medium,  5000);
      schedule('radio',       _pollTeamRadio,   INTERVALS.medium,  6000);
      schedule('weather',     _pollWeather,     INTERVALS.slow,    7000);
      schedule('overtakes',   _pollOvertakes,   INTERVALS.slow,    8000);

      _timers['snapshot'] = setInterval(saveSnapshot, 15_000);
      DBG.setSource('openf1');
      setTimeout(() => DBG.autoHide(), 3000);
      dbg('OpenF1 pollers started ✓');
    })();
  }

  function stop() {
    Object.values(_timers).forEach(t => { clearTimeout(t); clearInterval(t); });
    _timers = {};
    _running = false;
    // Save one final snapshot before stopping
    saveSnapshot();
  }

  // ── Historical load (past sessions) ─────────────────
  async function loadHistorical(sessionKey) {
    console.log('[API] Loading historical session:', sessionKey);

    // Sequential to avoid hammering — drivers first, then rest in two batches
    const drivers = await fetchJSON('drivers', { session_key: sessionKey });
    const [laps, stints, pits] = await Promise.all([
      fetchJSON('laps',    { session_key: sessionKey }),
      fetchJSON('stints',  { session_key: sessionKey }),
      fetchJSON('pit',     { session_key: sessionKey }),
    ]);
    const [positions, rc, weather] = await Promise.all([
      fetchJSON('position',     { session_key: sessionKey }),
      fetchJSON('race_control', { session_key: sessionKey }),
      fetchJSON('weather',      { session_key: sessionKey }),
    ]);

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

    if (positions?.length) {
      const finalPos = {};
      positions.forEach(p => {
        if (!finalPos[p.driver_number] || p.date > finalPos[p.driver_number].date)
          finalPos[p.driver_number] = p;
      });
      const posMap = {};
      Object.values(finalPos).forEach(p => {
        posMap[p.driver_number] = { position: p.position, date: p.date };
      });
      State.merge('positions', posMap);
    }

    if (laps?.length) {
      const allLaps = {}, lastLaps = {};
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

    if (stints?.length) {
      const stintMap = {};
      stints.forEach(s => {
        const n = s.driver_number;
        if (!stintMap[n] || s.stint_number > stintMap[n].stint_number) stintMap[n] = s;
      });
      State.set('stints', stintMap);
    }

    if (pits?.length) {
      const pitMap = {};
      pits.forEach(p => {
        if (!pitMap[p.driver_number]) pitMap[p.driver_number] = [];
        pitMap[p.driver_number].push(p);
      });
      State.set('pitStops', pitMap);
    }

    if (rc?.length) {
      const sorted = [...rc].sort((a, b) => new Date(b.date) - new Date(a.date));
      State.set('raceControl', sorted);
      State.emit('change:raceControl', sorted);
      const lastFlag = sorted.find(m => m.flag);
      if (lastFlag?.flag === 'CHEQUERED') State.set('trackStatus', 'CHEQUERED');
    }

    if (weather?.length) State.set('weather', weather[weather.length - 1]);

    console.log('[API] Historical load complete');
  }

  function isSessionLive() { return !!State.get('sessionIsLive'); }

  return { start, stop, fetchJSON, loadHistorical, isSessionLive };

})();