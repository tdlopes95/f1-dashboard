// ═══════════════════════════════════════════════════════
// racecontrol.js — Race Control feed + track status
// ═══════════════════════════════════════════════════════

const RaceControl = (() => {

  const feedEl     = document.getElementById('rc-messages');
  const statusEl   = document.getElementById('track-status');
  const statusText = document.getElementById('track-status-text');
  const lapCurEl   = document.getElementById('current-lap');
  const lapTotEl   = document.getElementById('total-laps');
  const overlayEl  = document.getElementById('flag-overlay');
  const overlayTxt = document.getElementById('flag-overlay-text');

  let _overlayTimer = null;

  function msgClass(msg) {
    const flag = (msg.flag    || '').toUpperCase();
    const cat  = (msg.category|| '').toLowerCase();
    const txt  = (msg.message || '').toUpperCase();

    if (flag === 'RED'   || txt.includes('RED FLAG'))            return 'rc-msg--red';
    if (txt.includes('SAFETY CAR') && txt.includes('DEPLOYED'))  return 'rc-msg--sc';
    if (txt.includes('VIRTUAL SAFETY CAR'))                       return 'rc-msg--sc';
    if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW')            return 'rc-msg--flag';
    if (cat === 'drs')                                            return 'rc-msg--drs';
    if (cat === 'carevent' || txt.includes('INCIDENT'))           return 'rc-msg--incident';
    return 'rc-msg--system';
  }

  function formatTime(isoDate) {
    if (!isoDate) return '--:--';
    const d = new Date(isoDate);
    return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function addMessage(msg) {
    const el = document.createElement('div');
    el.className = `rc-msg ${msgClass(msg)}`;
    el.innerHTML = `
      <span class="rc-time">${formatTime(msg.date)}</span>
      <span class="rc-text">${msg.message || '–'}</span>
    `;
    // Prepend (newest on top)
    feedEl.prepend(el);

    // Keep only last 30 DOM nodes
    while (feedEl.children.length > 30) {
      feedEl.removeChild(feedEl.lastChild);
    }
  }

  function renderAll() {
    feedEl.innerHTML = '';
    const msgs = State.get('raceControl');
    if (!msgs?.length) return;
    // newest first (already ordered by pushRaceControl)
    msgs.slice(0, 30).forEach(m => addMessage(m));
  }

  function updateTrackStatus(status) {
    // Remove all status-- classes
    statusEl.className = 'track-status';

    let label = 'GREEN FLAG';
    let cssClass = 'status--green';
    let showOverlay = false;
    let overlayClass = '';
    let overlayLabel = '';

    switch (status) {
      case 'SC':
        label = 'SAFETY CAR'; cssClass = 'status--sc';
        showOverlay = true; overlayClass = 'flag-overlay--sc'; overlayLabel = 'SAFETY CAR';
        break;
      case 'VSC':
        label = 'VIRTUAL SC'; cssClass = 'status--sc';
        showOverlay = true; overlayClass = 'flag-overlay--vsc'; overlayLabel = 'VIRTUAL SC';
        break;
      case 'RED':
        label = 'RED FLAG'; cssClass = 'status--red';
        showOverlay = true; overlayClass = 'flag-overlay--red'; overlayLabel = 'RED FLAG';
        break;
      case 'YELLOW':
        label = 'YELLOW'; cssClass = 'status--yellow';
        break;
      case 'CHEQUERED':
        label = 'CHEQUERED'; cssClass = 'status--green';
        break;
      default:
        label = 'GREEN FLAG'; cssClass = 'status--green';
    }

    statusEl.classList.add(cssClass);
    statusText.textContent = label;

    if (showOverlay) {
      overlayEl.className = `flag-overlay ${overlayClass}`;
      overlayTxt.textContent = overlayLabel;

      clearTimeout(_overlayTimer);
      _overlayTimer = setTimeout(() => {
        overlayEl.className = 'flag-overlay flag-overlay--hidden';
      }, 8000);
    }
  }

  function updateLapCounter() {
    const cur = State.raw.currentLap;
    const tot = State.get('totalLaps');
    lapCurEl.textContent = cur ?? '–';
    lapTotEl.textContent = tot ?? '–';
  }

  function init() {
    // New RC messages come one at a time via pushRaceControl
    State.on('change:raceControl', (msgs) => {
      if (msgs.length === 0) return;
      // Only render the newest one (prepend)
      addMessage(msgs[0]);
    });

    State.on('change:trackStatus', updateTrackStatus);
    State.on('change:currentLap',  updateLapCounter);

    console.log('[RaceControl] Initialized');
  }

  return { init };

})();