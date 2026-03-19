// ═══════════════════════════════════════════════════════
// mv-api.js — MultiViewer for F1 local API integration
//
// MultiViewer exposes the official F1 live timing feed
// via a local GraphQL API at localhost:10101/api/graphql
//
// Data source: F1 SignalR feed (same as official F1 app)
// Topics used:
//   SessionInfo      — circuit, session name, type
//   SessionData      — session status (started/ended)
//   DriverList       — driver numbers, names, teams, colours
//   TimingData       — gaps, intervals, sector times, pit status
//   TimingAppData    — tyre compound, tyre age, stints
//   LapCount         — current lap / total laps
//   Position.z       — x/y/z track positions (compressed)
//   CarData.z        — speed/throttle/brake/gear/RPM/DRS (compressed)
//   TrackStatus      — green/yellow/SC/VSC/red flag
//   RaceControlMessages — steward messages, flags
//   WeatherData      — track temp, air temp, rain, wind
//   TeamRadio        — audio clips
// ═══════════════════════════════════════════════════════

const MV = (() => {

  const MV_HOST = 'http://localhost:10101';
  const GQL_URL = `${MV_HOST}/api/graphql`;

  let _pollTimer  = null;
  let _running    = false;
  const POLL_MS   = 1000; // poll every 1s — MV caches at ~1Hz

  // ── Debug log ────────────────────────────────────────
  // Toggle with backtick ` — hidden by default after boot completes
  function dbg(msg, level = 'info') {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    console.log(`[MV ${ts}] ${msg}`);
    DBG.log(`MV`, msg, level);
  }

  // ── GraphQL fetch ────────────────────────────────────
  async function gql(query) {
    try {
      const res = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors) throw new Error(json.errors[0]?.message || 'GQL error');
      return json.data;
    } catch(e) {
      if (e.name !== 'AbortError') dbg(`GQL failed: ${e.message}`, 'error');
      return null;
    }
  }

  // ── Check if MultiViewer is running ──────────────────
  async function isAvailable() {
    const data = await gql(`{ systemInfo { version } }`);
    return !!data?.systemInfo?.version;
  }

  // ── Fetch all live timing topics in one query ─────────
  async function fetchLiveTiming() {
    const data = await gql(`{
      f1LiveTimingState {
        SessionInfo
        SessionData
        DriverList
        TimingData
        TimingAppData
        LapCount
        TrackStatus
        WeatherData
        RaceControlMessages
        TeamRadio
      }
    }`);
    return data?.f1LiveTimingState ?? null;
  }

  // ── Fetch compressed position/car data separately ────
  // These are large blobs, fetched only when needed
  async function fetchPositions() {
    const data = await gql(`{
      f1LiveTimingState {
        Position: PositionZ
      }
    }`);
    return data?.f1LiveTimingState?.Position ?? null;
  }

  async function fetchCarData() {
    const focused = State.get('focusedDriver');
    if (!focused || document.hidden) return null;
    const data = await gql(`{
      f1LiveTimingState {
        CarData: CarDataZ
      }
    }`);
    return data?.f1LiveTimingState?.CarData ?? null;
  }

  // ── Parsers ──────────────────────────────────────────

  function parseSessionInfo(raw) {
    if (!raw) return;
    try {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const meeting = s.Meeting || {};
      const name = `${meeting.Location || s.Name || '?'} — ${s.Name || '?'}`;
      State.set('sessionName',    name);
      State.set('circuitName',    meeting.Circuit?.ShortName || meeting.Location || '?');
      State.set('sessionType',    s.Type || null);
      State.set('sessionStartTime', s.StartDate || null);
      State.set('sessionEndTime',   s.EndDate   || null);

      // Update header
      const nameEl = document.getElementById('session-name');
      if (nameEl) nameEl.textContent = name;
      const circEl = document.getElementById('circuit-name');
      if (circEl) circEl.textContent = State.get('circuitName');

      // Session type badge
      const badge = document.getElementById('session-type-badge');
      if (badge) {
        const t = (s.Type || '').toLowerCase();
        const label = s.Name?.toUpperCase() || s.Type?.toUpperCase() || '';
        badge.textContent = label;
        badge.className = 'badge';
        if (t.includes('race'))       badge.classList.add('badge--race');
        else if (t.includes('quali')) badge.classList.add('badge--quali');
        else if (t.includes('sprint'))badge.classList.add('badge--sprint');
        else                          badge.classList.add('badge--practice');
      }
    } catch(e) { dbg(`SessionInfo parse error: ${e.message}`, 'warn'); }
  }

  function parseDriverList(raw) {
    if (!raw) return;
    try {
      const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // DriverList is an object keyed by racing number string
      Object.entries(list).forEach(([num, d]) => {
        if (typeof d !== 'object' || !d.RacingNumber) return;
        const n = parseInt(d.RacingNumber || num);
        State.setDriver(n, {
          driver_number: n,
          name_acronym:  d.Tla || d.NameFormat?.slice(0,3).toUpperCase() || '???',
          full_name:     `${d.FirstName || ''} ${d.LastName || ''}`.trim(),
          team_name:     d.TeamName || '',
          team_colour:   d.TeamColour ? `#${d.TeamColour}` : '#ffffff',
          headshot_url:  d.HeadshotUrl || null,
        });
      });
      State.emit('driversLoaded', State.raw.drivers);
    } catch(e) { dbg(`DriverList parse error: ${e.message}`, 'warn'); }
  }

  function parseTimingData(raw) {
    if (!raw) return;
    try {
      const td = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const lines = td.Lines || td;
      const posUpdates = {};
      const intUpdates = {};
      const lapUpdates = {};

      Object.entries(lines).forEach(([num, d]) => {
        const n = parseInt(num);
        if (!n) return;

        // Position
        if (d.Position != null) {
          posUpdates[n] = { position: parseInt(d.Position), date: new Date().toISOString() };
        }

        // Gap / interval
        const gap      = d.GapToLeader     ?? d.Gap ?? null;
        const interval = d.IntervalToPositionAhead?.Value ?? d.Interval ?? null;
        if (gap !== null || interval !== null) {
          intUpdates[n] = {
            gap_to_leader: gap,
            interval:      interval,
            date:          new Date().toISOString(),
          };
        }

        // Last lap time + sectors
        const lastLap = d.LastLapTime;
        if (lastLap) {
          const existing = State.raw.lastLaps?.[n] || {};
          lapUpdates[n] = {
            ...existing,
            driver_number: n,
            lap_duration:  lastLap.Value || null,
            is_pit_out_lap: !!d.InPit || !!d.PitOut,
            // Sector times
            duration_sector_1: d.Sectors?.[0]?.Value ?? d.BestLapTime?.Sectors?.[0]?.Value ?? null,
            duration_sector_2: d.Sectors?.[1]?.Value ?? null,
            duration_sector_3: d.Sectors?.[2]?.Value ?? null,
            i1_speed: d.Speeds?.I1?.Value ?? null,
            i2_speed: d.Speeds?.I2?.Value ?? null,
            st_speed:  d.Speeds?.FL?.Value ?? null,
          };
          // Track best lap
          const lapNum = parseInt(d.NumberOfLaps) || 0;
          if (lapNum > (State.get('currentLap') || 0)) {
            State.set('currentLap', lapNum);
          }
        }

        // Pit status
        if (d.InPit !== undefined || d.PitOut !== undefined) {
          State.raw.pitStatus = State.raw.pitStatus || {};
          State.raw.pitStatus[n] = { inPit: !!d.InPit, pitOut: !!d.PitOut };
        }
      });

      if (Object.keys(posUpdates).length) State.merge('positions',  posUpdates);
      if (Object.keys(intUpdates).length) State.merge('intervals',  intUpdates);
      if (Object.keys(lapUpdates).length) State.merge('lastLaps',   lapUpdates);

    } catch(e) { dbg(`TimingData parse error: ${e.message}`, 'warn'); }
  }

  function parseTimingAppData(raw) {
    if (!raw) return;
    try {
      const tad = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const lines = tad.Lines || tad;
      const stintUpdates = {};

      Object.entries(lines).forEach(([num, d]) => {
        const n = parseInt(num);
        if (!n || !d.Stints) return;

        // Get the latest stint
        const stints = Array.isArray(d.Stints)
          ? d.Stints
          : Object.values(d.Stints);
        if (!stints.length) return;

        const latest = stints[stints.length - 1];
        stintUpdates[n] = {
          driver_number:   n,
          stint_number:    stints.length,
          compound:        latest.Compound?.toLowerCase() || null,
          tyre_age_at_start: latest.TyreAge || 0,
          lap_start:       latest.LapNumber || null,
        };
      });

      if (Object.keys(stintUpdates).length) State.set('stints', {
        ...State.raw.stints,
        ...stintUpdates,
      });
    } catch(e) { dbg(`TimingAppData parse error: ${e.message}`, 'warn'); }
  }

  function parseLapCount(raw) {
    if (!raw) return;
    try {
      const lc = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (lc.CurrentLap) State.set('currentLap',  parseInt(lc.CurrentLap));
      if (lc.TotalLaps)  State.set('totalLaps',   parseInt(lc.TotalLaps));
    } catch(e) {}
  }

  function parseTrackStatus(raw) {
    if (!raw) return;
    try {
      const ts = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Status codes: 1=green, 2=yellow, 4=SC, 5=red, 6=VSC, 7=VSC ending
      const codeMap = {
        '1': 'GREEN', '2': 'YELLOW', '3': 'YELLOW',
        '4': 'SC',    '5': 'RED',    '6': 'VSC', '7': 'GREEN',
      };
      const status = codeMap[String(ts.Status)] || 'GREEN';
      State.set('trackStatus', status);
    } catch(e) {}
  }

  function parseWeather(raw) {
    if (!raw) return;
    try {
      const w = typeof raw === 'string' ? JSON.parse(raw) : raw;
      State.set('weather', {
        air_temperature:   parseFloat(w.AirTemp)   || null,
        track_temperature: parseFloat(w.TrackTemp)  || null,
        humidity:          parseFloat(w.Humidity)  || null,
        wind_speed:        parseFloat(w.WindSpeed)  || null,
        wind_direction:    parseFloat(w.WindDirection) || null,
        rainfall:          w.Rainfall === 'true' || w.Rainfall === true,
      });
    } catch(e) {}
  }

  function parseRaceControl(raw) {
    if (!raw) return;
    try {
      const rc = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const msgs = rc.Messages || (Array.isArray(rc) ? rc : Object.values(rc));

      // Only process messages newer than what we've seen
      const lastSeen = State.raw._mvRcLastSeen || 0;
      let maxTs = lastSeen;

      msgs.forEach(m => {
        const ts = new Date(m.Utc || m.Timestamp || 0).getTime();
        if (ts <= lastSeen) return;
        if (ts > maxTs) maxTs = ts;

        const msg = {
          date:     m.Utc || m.Timestamp,
          category: m.Category || '',
          flag:     m.Flag || '',
          message:  m.Message || m.Msg || '',
          lap:      m.Lap || null,
        };
        State.pushRaceControl(msg);

        // Update track status from flags
        const flag = (msg.flag || '').toUpperCase();
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

      if (maxTs > lastSeen) State.raw._mvRcLastSeen = maxTs;
    } catch(e) { dbg(`RaceControl parse error: ${e.message}`, 'warn'); }
  }

  function parseTeamRadio(raw) {
    if (!raw) return;
    try {
      const tr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const clips = tr.Captures || (Array.isArray(tr) ? tr : Object.values(tr));
      const lastSeen = State.raw._mvRadioLastSeen || 0;
      let maxTs = lastSeen;

      clips.forEach(c => {
        const ts = new Date(c.Utc || c.Timestamp || 0).getTime();
        if (ts <= lastSeen) return;
        if (ts > maxTs) maxTs = ts;

        const driverNum = parseInt(c.RacingNumber || c.DriverNumber);
        State.emit('newRadioClip', {
          driver_number: driverNum,
          date:          c.Utc || c.Timestamp,
          recording_url: c.Path ? `https://livetiming.formula1.com/static/${c.Path}` : null,
        });
      });

      if (maxTs > lastSeen) State.raw._mvRadioLastSeen = maxTs;
    } catch(e) {}
  }

  function parsePositions(raw) {
    if (!raw) return;
    try {
      // Position.z is a compressed base64 blob — MV may decode it for us
      // If it's already an object/array, parse directly
      const pos = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const entries = pos.Position || (Array.isArray(pos) ? pos : null);
      if (!entries?.length) return;

      // Take the latest position snapshot
      const latest = entries[entries.length - 1];
      const updates = {};
      (latest.Entries || Object.entries(latest)).forEach(([num, entry]) => {
        const n = parseInt(num);
        if (!n || isNaN(n)) return;
        const e = typeof entry === 'object' ? entry : { X: 0, Y: 0, Z: 0 };
        updates[n] = { x: e.X, y: e.Y, z: e.Z, date: latest.Timestamp };
      });
      if (Object.keys(updates).length) State.merge('locations', updates);
    } catch(e) {}
  }

  function parseCarData(raw) {
    if (!raw) return;
    try {
      const cd = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const entries = cd.Entries || (Array.isArray(cd) ? cd : null);
      if (!entries?.length) return;

      const latest = entries[entries.length - 1];
      const cars   = latest.Cars || latest;
      const focused = State.get('focusedDriver');
      if (!focused || !cars[focused]) return;

      const c = cars[focused].Channels || cars[focused];
      State.merge('carData', {
        [focused]: {
          speed:    c[2]  ?? c.Speed    ?? null,
          throttle: c[3]  ?? c.Throttle ?? null,
          brake:    c[45] ?? c.Brake    ?? null,
          drs:      c[45] ?? c.DRS      ?? null,
          gear:     c[4]  ?? c.nGear    ?? null,
          rpm:      c[0]  ?? c.RPM      ?? null,
        }
      });
    } catch(e) {}
  }

  // ── Main poll cycle ───────────────────────────────────
  let _pollCount = 0;

  async function poll() {
    _pollCount++;

    // Every cycle: fetch main timing bundle
    const lt = await fetchLiveTiming();
    if (!lt) return; // MV not responding

    // Parse all topics
    parseSessionInfo(lt.SessionInfo);
    parseDriverList(lt.DriverList);
    parseTimingData(lt.TimingData);
    parseTimingAppData(lt.TimingAppData);
    parseLapCount(lt.LapCount);
    parseTrackStatus(lt.TrackStatus);
    parseWeather(lt.WeatherData);
    parseRaceControl(lt.RaceControlMessages);
    parseTeamRadio(lt.TeamRadio);

    // Every 2nd cycle: positions (a bit heavier)
    if (_pollCount % 2 === 0) {
      const pos = await fetchPositions();
      if (pos) parsePositions(pos);
    }

    // Every 3rd cycle: car data (only if driver focused)
    if (_pollCount % 3 === 0) {
      const cd = await fetchCarData();
      if (cd) parseCarData(cd);
    }

    if (_pollCount === 1) {
      dbg('MV: first poll complete ✓');
    }
  }

  // ── Boot ─────────────────────────────────────────────
  async function start() {
    if (_running) return;

    dbg('checking MultiViewer availability...');
    const available = await isAvailable();

    if (!available) {
      dbg('MultiViewer not running or not accessible at localhost:10101', 'error');
      dbg('→ falling back to OpenF1 API', 'warn');
      return false; // Signal to caller to fall back
    }

    // Check if live timing is active in MV
    const lt = await fetchLiveTiming();
    if (!lt || !lt.SessionInfo) {
      dbg('MV running but no live timing session active', 'warn');
      dbg('→ open MultiViewer and start Live Timing to use this feed', 'warn');
      return false;
    }

    dbg(`MV connected — starting live timing poll at ${POLL_MS}ms`);
    _running = true;

    // Set data source badge
    DBG.setSource('mv');

    // Immediate first poll, then interval
    await poll();
    _pollTimer = setInterval(poll, POLL_MS);

    // Mark session as live
    State.set('sessionIsLive', true);
    State.set('dataSource', 'multiviewer');

    // Hide debug panel after successful boot
    setTimeout(() => DBG.autoHide(), 3000);

    return true;
  }

  function stop() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _running = false;
  }

  function isRunning() { return _running; }

  return { start, stop, isRunning, dbg };

})();