// ═══════════════════════════════════════════════════════
// sessionpicker.js — Browse and load past F1 sessions
// Fetches meetings/sessions from OpenF1, lets user switch
// away from 'latest' without breaking the live flow.
// ═══════════════════════════════════════════════════════

const SessionPicker = (() => {

  // ── DOM refs ─────────────────────────────────────────
  const modal        = document.getElementById('session-picker-modal');
  const backdrop     = modal.querySelector('.sp-backdrop');
  const openBtn      = document.getElementById('session-picker-btn');
  const closeBtn     = document.getElementById('sp-close-btn');
  const liveBtn      = document.getElementById('sp-live-btn');
  const yearSelect   = document.getElementById('sp-year-select');
  const meetingsList = document.getElementById('sp-meetings-list');
  const sessionsList = document.getElementById('sp-sessions-list');
  const currentLabel = document.getElementById('sp-current-label');
  const liveIndicator= document.getElementById('live-indicator');

  let _selectedMeetingKey = null;
  let _isLive = true;


  // ── ISO 3→2 country code map ─────────────────────────
  const ISO3TO2 = {
    ABH:'ab',ARG:'ar',AUS:'au',AUT:'at',AZE:'az',
    BAH:'bh',BEL:'be',BRA:'br',CAN:'ca',CHN:'cn',
    ESP:'es',FRA:'fr',GBR:'gb',HUN:'hu',ITA:'it',
    JPN:'jp',KSA:'sa',MEX:'mx',MON:'mc',NED:'nl',
    POR:'pt',QAT:'qa',RSM:'sm',SGP:'sg',SUI:'ch',
    TUR:'tr',UAE:'ae',USA:'us',VIE:'vn',ZAF:'za',
  };
  function iso2(code3) {
    return (ISO3TO2[code3?.toUpperCase()] || code3?.toLowerCase().slice(0,2) || 'un');
  }


  // ── Jolpica API (historical data) ───────────────────
  const JOLPICA = 'https://api.jolpi.ca/ergast/f1';

  async function jolpikaFetch(path) {
    try {
      const res = await fetch(`${JOLPICA}${path}.json?limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json?.MRData || null;
    } catch (e) {
      console.warn('[Jolpica]', path, e.message);
      return null;
    }
  }

  // Fetch last N completed race rounds for a year
  async function jolpikaRaces(year) {
    const data = await jolpikaFetch(`/${year}/races`);
    if (!data?.RaceTable?.Races) return [];
    return data.RaceTable.Races;
  }

  // ── Open / close ─────────────────────────────────────
  function open() {
    modal.classList.remove('sp-modal--hidden');
    document.body.classList.add('sp-open');
    loadMeetings(yearSelect.value);
  }

  function close() {
    modal.classList.add('sp-modal--hidden');
    document.body.classList.remove('sp-open');
  }

  // ── Fetch meetings for a year ────────────────────────
  // Uses Jolpica for completed past sessions (richer/faster)
  // Falls back to OpenF1 for current year upcoming rounds
  const MAX_PAST_SESSIONS = 10;

  async function loadMeetings(year) {
    meetingsList.innerHTML = '<div class="sp-loading">Loading...</div>';
    sessionsList.innerHTML = '<div class="sp-hint">← Select a Grand Prix</div>';
    _selectedMeetingKey = null;

    const currentYear = new Date().getFullYear();
    const isPastYear  = parseInt(year) < currentYear;

    // For past years — use Jolpica, limit to 10 most recent
    if (isPastYear) {
      const races = await jolpikaRaces(year);
      if (!races.length) {
        meetingsList.innerHTML = '<div class="sp-empty">No data for this year</div>';
        return;
      }
      // Jolpica is chronological, we want most recent first, last 10 only
      const recent = [...races].reverse().slice(0, MAX_PAST_SESSIONS);
      meetingsList.innerHTML = '';
      renderMeetingItems(recent.map(r => ({
        key:      r.round,
        name:     r.raceName.replace(' Grand Prix','').replace('Grand Prix','').trim(),
        fullName: r.raceName,
        circuit:  r.Circuit.circuitName,
        country:  r.Circuit.Location.country,
        date:     r.date,
        round:    r.round,
        season:   r.season,
        isJolpika: true,
        jolpikaRound: r.round,
      })));
      return;
    }

    // Current year — use OpenF1 (has upcoming rounds too)
    const data = await API.fetchJSON('meetings', { year });
    if (!data?.length) {
      meetingsList.innerHTML = '<div class="sp-empty">No data available yet</div>';
      return;
    }

    const sorted = [...data].sort((a, b) => new Date(b.date_start) - new Date(a.date_start));
    // Past meetings: last 10 + upcoming ones
    const past     = sorted.filter(m => new Date(m.date_start) <= new Date()).slice(0, MAX_PAST_SESSIONS);
    const upcoming = sorted.filter(m => new Date(m.date_start) > new Date());
    const display  = [...upcoming, ...past];

    meetingsList.innerHTML = '';
    renderMeetingItems(display.map(m => ({
      key:          m.meeting_key,
      name:         m.meeting_name.replace(' Grand Prix','').replace('Grand Prix','').trim(),
      fullName:     m.meeting_name,
      circuit:      m.circuit_short_name,
      country:      m.country_code,
      date:         m.date_start,
      isUpcoming:   new Date(m.date_start) > new Date(),
      isJolpika:    false,
      openf1Key:    m.meeting_key,
    })));
  }

  function renderMeetingItems(meetings) {
    meetings.forEach(m => {
      const isUpcoming = m.isUpcoming || false;
      const item = document.createElement('div');
      item.className = 'sp-meeting-item' + (isUpcoming ? ' sp-upcoming' : '');
      item.dataset.meetingKey = m.key;

      const dateStr = new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const flagCode = m.isJolpika
        ? countryNameToIso2(m.country)
        : iso2(m.country);

      item.innerHTML = `
        <span class="sp-meeting-flag">
          <img src="https://flagcdn.com/16x12/${flagCode}.png"
            onerror="this.style.display='none'" alt="" />
        </span>
        <span class="sp-meeting-info">
          <span class="sp-meeting-name">${m.name}</span>
          <span class="sp-meeting-circuit">${m.circuit}</span>
        </span>
        <span class="sp-meeting-date">${dateStr}</span>
        ${isUpcoming ? '<span class="sp-upcoming-badge">UPCOMING</span>' : ''}
        ${m.isJolpika ? '<span class="sp-source-badge">HIS</span>' : ''}
      `;

      if (!isUpcoming) {
        item.addEventListener('click', () => {
          document.querySelectorAll('.sp-meeting-item').forEach(el => el.classList.remove('active'));
          item.classList.add('active');
          if (m.isJolpika) {
            loadSessionsJolpika(m.season, m.jolpikaRound, m.fullName);
          } else {
            loadSessionsForMeeting(m.openf1Key, m.fullName);
          }
        });
      }
      meetingsList.appendChild(item);
    });
  }

  // Country name → 2-letter ISO (for Jolpika which gives full country name)
  const COUNTRY_NAME_TO_ISO2 = {
    'Australia':'au','Bahrain':'bh','Saudi Arabia':'sa','Japan':'jp',
    'China':'cn','United States':'us','USA':'us','Miami':'us',
    'Italy':'it','Monaco':'mc','Canada':'ca','Spain':'es',
    'Austria':'at','Great Britain':'gb','United Kingdom':'gb',
    'Hungary':'hu','Belgium':'be','Netherlands':'nl','Singapore':'sg',
    'Mexico':'mx','Brazil':'br','Las Vegas':'us','Qatar':'qa',
    'Abu Dhabi':'ae','Azerbaijan':'az','France':'fr','Portugal':'pt',
    'Turkey':'tr','Russia':'ru','Germany':'de','Argentina':'ar',
  };
  function countryNameToIso2(name) {
    return COUNTRY_NAME_TO_ISO2[name] || name?.toLowerCase().slice(0,2) || 'un';
  }

  // ── Fetch sessions for a meeting ─────────────────────
  async function loadSessionsForMeeting(meetingKey, meetingName) {
    _selectedMeetingKey = meetingKey;
    sessionsList.innerHTML = '<div class="sp-loading">Loading sessions...</div>';

    const data = await API.fetchJSON('sessions', { meeting_key: meetingKey });
    if (!data?.length) {
      sessionsList.innerHTML = '<div class="sp-empty">No sessions found</div>';
      return;
    }

    const sorted = [...data].sort((a, b) =>
      new Date(a.date_start) - new Date(b.date_start)
    );

    sessionsList.innerHTML = `<div class="sp-sessions-gp-name">${meetingName}</div>`;

    sorted.forEach(s => {
      const isLiveSession = s.session_key === State.get('sessionKey');
      const isPast = new Date(s.date_end) < new Date();
      const isLive = new Date(s.date_start) <= new Date() && new Date(s.date_end) >= new Date();

      const item = document.createElement('div');
      item.className = 'sp-session-item'
        + (isLiveSession ? ' sp-session-item--active' : '')
        + (!isPast && !isLive ? ' sp-session-item--upcoming' : '');
      item.dataset.sessionKey = s.session_key;

      const sessionDate = new Date(s.date_start).toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short'
      });
      const sessionTime = new Date(s.date_start).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });

      const typeBadgeClass = getTypeBadgeClass(s.session_type);
      const statusTag = isLive
        ? '<span class="sp-session-live">● LIVE</span>'
        : !isPast
          ? '<span class="sp-session-upcoming">UPCOMING</span>'
          : '';

      item.innerHTML = `
        <span class="sp-session-type-badge ${typeBadgeClass}">${s.session_name}</span>
        <span class="sp-session-meta">
          <span class="sp-session-date">${sessionDate} · ${sessionTime}</span>
          ${statusTag}
        </span>
        ${isLiveSession ? '<span class="sp-session-check">✓ LOADED</span>' : ''}
      `;

      if (isLive) {
        // Actually live — load into dashboard normally
        item.addEventListener('click', () => loadSession(s));
      } else if (isPast) {
        // Past session — navigate to replay page
        item.addEventListener('click', () => {
          const meetingName = encodeURIComponent(
            document.querySelector('.sp-sessions-gp-name')?.textContent || ''
          );
          const sessionLabel = encodeURIComponent(s.session_name || '');
          window.location.href =
            `replay.html?season=${s.year || new Date(s.date_start).getFullYear()}` +
            `&round=${s.meeting_key}` +
            `&session_key=${s.session_key}` +
            `&name=${meetingName}` +
            `&session=${sessionLabel}` +
            `&source=openf1`;
        });
      }

      sessionsList.appendChild(item);
    });
  }


  // ── Load sessions for a Jolpika (past) meeting ──────
  async function loadSessionsJolpika(season, round, meetingName) {
    sessionsList.innerHTML = '<div class="sp-loading">Loading sessions...</div>';

    // Jolpika: we know the structure — each race weekend has fixed sessions
    // Fetch race result to confirm it exists, then build session list
    const raceData = await jolpikaFetch(`/${season}/${round}/results`);
    const qualData = await jolpikaFetch(`/${season}/${round}/qualifying`);

    sessionsList.innerHTML = `<div class="sp-sessions-gp-name">${meetingName}</div>`;

    // Build synthetic session list from known weekend structure
    // We'll load them via OpenF1 when clicked (using meeting lookup)
    // But display via Jolpika data availability
    const race = raceData?.RaceTable?.Races?.[0];
    const qual  = qualData?.RaceTable?.Races?.[0];

    if (!race) {
      sessionsList.innerHTML += '<div class="sp-empty">Session data unavailable</div>';
      return;
    }

    // Find the OpenF1 meeting key for this race to load actual data
    const openf1Meetings = await API.fetchJSON('meetings', { year: season, meeting_name: race.raceName }) ||
                           await API.fetchJSON('meetings', { year: season });

    const matched = openf1Meetings?.find(m =>
      m.meeting_name?.toLowerCase().includes(race.Circuit?.Location?.country?.toLowerCase()) ||
      m.location?.toLowerCase().includes(race.Circuit?.Location?.locality?.toLowerCase())
    );

    const sessions = [
      { name: 'Practice 1',   type: 'Practice',    available: true },
      { name: 'Practice 2',   type: 'Practice',    available: true },
      { name: 'Practice 3',   type: 'Practice',    available: true },
      { name: 'Qualifying',   type: 'Qualifying',  available: !!qual },
      { name: 'Race',         type: 'Race',        available: !!race },
    ];

    // Build session items — clicking navigates to replay.html
    // Jolpica sessions always use season/round params
    sessions.forEach(s => {
      if (!s.available) return; // skip unavailable

      const item = document.createElement('div');
      item.className = 'sp-session-item';
      item.innerHTML = `
        <span class="sp-session-type-badge ${getTypeBadgeClass(s.type)}">${s.name}</span>
        <span class="sp-session-meta">
          <span class="sp-session-date">${race.date}</span>
        </span>
        <span class="sp-source-badge">HIS</span>
      `;

      item.addEventListener('click', () => {
        const meetingName = encodeURIComponent(race.raceName || meetingName);
        const sessionLabel = encodeURIComponent(s.name);
        window.location.href =
          `replay.html?season=${season}` +
          `&round=${round}` +
          `&name=${meetingName}` +
          `&session=${sessionLabel}` +
          `&source=jolpika`;
      });

      sessionsList.appendChild(item);
    });

    // If we also have an OpenF1 match, still use Jolpika as primary
    // (OpenF1 historical data is unreliable for older sessions)
    if (matched) {
      const note = document.createElement('div');
      note.style.cssText = 'padding:6px 12px;font-size:9px;color:var(--text-dim);font-family:var(--font-display);letter-spacing:1px';
      note.textContent = 'DATA: JOLPICA ERGAST';
      sessionsList.appendChild(note);
    }
  }

  function getTypeBadgeClass(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('race'))     return 'badge--race';
    if (t.includes('quali'))    return 'badge--quali';
    if (t.includes('sprint'))   return 'badge--sprint';
    return 'badge--practice';
  }

  // ── Load a selected session into the dashboard ───────
  async function loadSession(session) {
    // Mark all session items
    document.querySelectorAll('.sp-session-item').forEach(el => {
      el.classList.remove('sp-session-item--active');
      el.querySelector('.sp-session-check')?.remove();
    });

    const clickedItem = document.querySelector(`[data-session-key="${session.session_key}"]`);
    if (clickedItem) {
      clickedItem.classList.add('sp-session-item--active');
      if (!clickedItem.querySelector('.sp-session-check')) {
        clickedItem.insertAdjacentHTML('beforeend', '<span class="sp-session-check">✓ LOADED</span>');
      }
    }

    // Stop live polling, reset state, load new session
    API.stop();
    resetState();

    // Mark as historical — prevents EventTimer from re-activating
    State.set('sessionIsLive', 'historical');

    State.set('sessionKey',  session.session_key);
    State.set('meetingKey',  session.meeting_key);
    State.set('sessionType', session.session_type);
    State.set('sessionName', `${session.location} — ${session.session_name}`);
    State.set('circuitName', session.circuit_short_name);
    State.set('sessionStartTime', session.date_start);

    // Update header display
    document.getElementById('session-name').textContent = `${session.location || session.circuit_short_name} — ${session.session_name}`;
    document.getElementById('circuit-name').textContent = session.circuit_short_name;

    const badge = document.getElementById('session-type-badge');
    badge.textContent = session.session_name?.toUpperCase() || '';
    badge.className   = 'badge ' + getTypeBadgeClass(session.session_type);

    // Switch LIVE indicator to REPLAY
    _isLive = false;
    liveIndicator.classList.add('live-indicator--replay');
    liveIndicator.innerHTML = '<span class="replay-icon">▶</span> REPLAY';

    // Update footer label
    currentLabel.textContent = `${session.location} — ${session.session_name}`;

    // Start historical load (no polling for past sessions — just fetch once)
    await API.loadHistorical(session.session_key);

    close();
  }

  // ── Back to live ─────────────────────────────────────
  async function backToLive() {
    API.stop();
    resetState();
    _isLive = true;

    // Clear historical flag so EventTimer can re-evaluate properly
    State.set('sessionIsLive', null);

    liveIndicator.classList.remove('live-indicator--replay');
    liveIndicator.innerHTML = '<span class="live-dot"></span>LIVE';
    currentLabel.textContent = 'LIVE — latest session';

    API.start(); // will set sessionIsLive=true or false after loadSession
    close();
  }

  // ── Reset all data state ─────────────────────────────
  function resetState() {
    // Note: do NOT reset sessionIsLive here — callers set it explicitly
    // to avoid triggering the EventTimer overlay incorrectly
    State.raw.drivers   = {};
    State.raw.positions = {};
    State.raw.intervals = {};
    State.raw.lastLaps  = {};
    State.raw.allLaps   = {};
    State.raw.stints    = {};
    State.raw.pitStops  = {};
    State.raw.carData   = {};
    State.raw.locations = {};
    State.set('raceControl',  []);
    State.set('weather',      null);
    State.set('trackStatus',  'GREEN');
    State.set('focusedDriver',null);
    State.set('currentLap',   null);
  }

  // ── Init ─────────────────────────────────────────────
  function init() {
    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    liveBtn.addEventListener('click', backToLive);

    yearSelect.addEventListener('change', () => {
      loadMeetings(yearSelect.value);
    });

    // Set current year as default
    const currentYear = new Date().getFullYear();
    yearSelect.value = currentYear;

    // Keyboard close
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });

    console.log('[SessionPicker] Initialized');
  }

  return { init };

})();