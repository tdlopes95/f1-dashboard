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
  async function loadMeetings(year) {
    meetingsList.innerHTML = '<div class="sp-loading">Loading...</div>';
    sessionsList.innerHTML = '<div class="sp-hint">← Select a Grand Prix</div>';
    _selectedMeetingKey = null;

    const data = await API.fetchJSON('meetings', { year });
    if (!data?.length) {
      meetingsList.innerHTML = '<div class="sp-empty">No meetings found</div>';
      return;
    }

    // Sort chronologically (most recent first)
    const sorted = [...data].sort((a, b) =>
      new Date(b.date_start) - new Date(a.date_start)
    );

    meetingsList.innerHTML = '';
    sorted.forEach(m => {
      const isUpcoming = new Date(m.date_start) > new Date();
      const item = document.createElement('div');
      item.className = 'sp-meeting-item' + (isUpcoming ? ' sp-upcoming' : '');
      item.dataset.meetingKey = m.meeting_key;

      const dateStr = new Date(m.date_start).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short'
      });

      item.innerHTML = `
        <span class="sp-meeting-flag">
          ${m.country_code ? `<img src="https://flagcdn.com/16x12/${m.country_code.toLowerCase().slice(0,2)}.png"
            onerror="this.style.display='none'" alt="" />` : ''}
        </span>
        <span class="sp-meeting-info">
          <span class="sp-meeting-name">${m.meeting_name.replace(' Grand Prix','').replace('Grand Prix','').trim()}</span>
          <span class="sp-meeting-circuit">${m.circuit_short_name}</span>
        </span>
        <span class="sp-meeting-date">${dateStr}</span>
        ${isUpcoming ? '<span class="sp-upcoming-badge">UPCOMING</span>' : ''}
      `;

      item.addEventListener('click', () => {
        document.querySelectorAll('.sp-meeting-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        loadSessionsForMeeting(m.meeting_key, m.meeting_name);
      });

      meetingsList.appendChild(item);
    });
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

      if (isPast || isLive) {
        item.addEventListener('click', () => loadSession(s));
      }

      sessionsList.appendChild(item);
    });
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

    State.set('sessionKey',  session.session_key);
    State.set('meetingKey',  session.meeting_key);
    State.set('sessionType', session.session_type);
    State.set('sessionName', `${session.location} — ${session.session_name}`);
    State.set('circuitName', session.circuit_short_name);
    State.set('sessionStartTime', session.date_start);

    // Update header display
    document.getElementById('session-name').textContent = `${session.location} — ${session.session_name}`;
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

    liveIndicator.classList.remove('live-indicator--replay');
    liveIndicator.innerHTML = '<span class="live-dot"></span>LIVE';
    currentLabel.textContent = 'LIVE — latest session';

    API.start();
    close();
  }

  // ── Reset all data state ─────────────────────────────
  function resetState() {
    State.set('drivers',    {});
    State.set('positions',  {});
    State.set('intervals',  {});
    State.set('lastLaps',   {});
    State.set('allLaps',    {});
    State.set('stints',     {});
    State.set('pitStops',   {});
    State.set('carData',    {});
    State.set('locations',  {});
    State.set('raceControl',[]);
    State.set('weather',    null);
    State.set('trackStatus','GREEN');
    State.set('focusedDriver', null);
    State.set('currentLap', null);
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