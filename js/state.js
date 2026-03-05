// ═══════════════════════════════════════════════════════
// state.js — Global app state
// Single source of truth for all live data
// ═══════════════════════════════════════════════════════

const State = (() => {

  const _state = {
    // Session
    sessionKey:   'latest',
    meetingKey:   'latest',
    sessionName:  null,
    sessionType:  null,   // 'Race' | 'Qualifying' | 'Practice' | 'Sprint'
    circuitName:  null,
    totalLaps:    null,

    // Drivers (keyed by driver_number)
    drivers: {},         // { 1: { name_acronym, team_name, team_colour, headshot_url, ... } }

    // Live positions (keyed by driver_number → { position, date })
    positions: {},

    // Live intervals (keyed by driver_number → { gap_to_leader, interval, date })
    intervals: {},

    // Last lap per driver (keyed by driver_number → lap object)
    lastLaps: {},

    // All laps per driver (keyed by driver_number → [lap, ...])
    allLaps: {},

    // Current stints (keyed by driver_number → latest stint object)
    stints: {},

    // Pit stops (keyed by driver_number → [pit, ...])
    pitStops: {},

    // Live car telemetry (keyed by driver_number → latest car_data sample)
    carData: {},

    // Live location (keyed by driver_number → { x, y, z })
    locations: {},

    // Race control messages [ { date, category, flag, message, ... } ]
    raceControl: [],

    // Weather (latest object)
    weather: null,

    // Overtakes (array)
    overtakes: [],

    // Track status
    trackStatus: 'GREEN',  // 'GREEN' | 'YELLOW' | 'SC' | 'VSC' | 'RED'

    // Currently focused driver (for telemetry panel)
    focusedDriver: null,

    // UI timestamps
    lastUpdated: {},

    // Session clock
    sessionStartTime: null,
    sessionElapsed:   0,
  };

  // Subscribers: { eventName: [callbacks] }
  const _subs = {};

  function on(event, cb) {
    if (!_subs[event]) _subs[event] = [];
    _subs[event].push(cb);
  }

  function emit(event, data) {
    (_subs[event] || []).forEach(cb => cb(data));
  }

  function get(key) {
    return _state[key];
  }

  function set(key, value) {
    _state[key] = value;
    emit('change:' + key, value);
    emit('change', { key, value });
  }

  // Merge into a sub-object (e.g. drivers, positions)
  function merge(key, updates) {
    _state[key] = { ..._state[key], ...updates };
    emit('change:' + key, _state[key]);
    emit('change', { key, value: _state[key] });
  }

  // Set a driver's field
  function setDriver(driverNum, data) {
    _state.drivers[driverNum] = { ..._state.drivers[driverNum], ...data };
    emit('change:drivers', _state.drivers);
  }

  function getDriversSortedByPosition() {
    return Object.values(_state.drivers)
      .map(d => ({
        ...d,
        position: _state.positions[d.driver_number]?.position ?? 99,
      }))
      .sort((a, b) => a.position - b.position);
  }

  function setFocusedDriver(driverNum) {
    _state.focusedDriver = driverNum;
    emit('change:focusedDriver', driverNum);
  }

  function pushRaceControl(msg) {
    _state.raceControl.unshift(msg);
    if (_state.raceControl.length > 100) _state.raceControl.pop();
    emit('change:raceControl', _state.raceControl);
  }

  return {
    get,
    set,
    merge,
    setDriver,
    setFocusedDriver,
    pushRaceControl,
    getDriversSortedByPosition,
    on,
    emit,
    raw: _state,   // direct access when needed
  };

})();