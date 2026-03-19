// ═══════════════════════════════════════════════════════
// debug.js — Shared debug panel
// Press backtick ` to toggle visibility
// Auto-hides 3s after successful boot
// ═══════════════════════════════════════════════════════

const DBG = (() => {

  let _visible = true;
  let _panel   = null;

  function _getPanel() {
    if (_panel) return _panel;
    _panel = document.createElement('div');
    _panel.id = 'api-debug-panel';
    _panel.style.cssText = [
      'position:fixed','bottom:0','left:0','right:0',
      'max-height:180px','overflow-y:auto',
      'background:rgba(0,0,0,0.93)',
      'border-top:1px solid #2a2a2a',
      'font:11px "Share Tech Mono",monospace',
      'z-index:9999','padding:6px 12px',
      'transition:transform 0.2s ease',
    ].join(';');

    // Toggle hint
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;right:10px;top:4px;font-size:9px;color:#444;letter-spacing:1px';
    hint.textContent = '` TO TOGGLE';
    _panel.appendChild(hint);

    document.body.appendChild(_panel);
    return _panel;
  }

  function log(prefix, msg, level = 'info') {
    const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const panel = _getPanel();
    const colors = { info: '#39ff6f', warn: '#ffe600', error: '#ff4444' };
    const prefixColors = { MV: '#39ff6f', API: '#4af', DBG: '#888' };

    const line = document.createElement('div');
    line.style.cssText = `color:${colors[level] || '#39ff6f'};line-height:1.6`;
    line.innerHTML =
      `<span style="color:#444">[${ts}]</span> ` +
      `<span style="color:${prefixColors[prefix] || '#888'}">[${prefix}]</span> ` +
      `<span>${escHtml(msg)}</span>`;

    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
    while (panel.children.length > 50) panel.removeChild(panel.children[1]); // keep hint
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function show() {
    _visible = true;
    const p = _getPanel();
    p.style.transform = 'translateY(0)';
    p.style.opacity   = '1';
    p.style.pointerEvents = 'auto';
  }

  function hide() {
    _visible = false;
    const p = _getPanel();
    p.style.transform = 'translateY(100%)';
    p.style.opacity   = '0';
    p.style.pointerEvents = 'none';
  }

  function toggle() {
    _visible ? hide() : show();
  }

  // Called after successful boot — hides panel after delay
  function autoHide() {
    hide();
    log('DBG', 'boot complete — press ` to show debug panel', 'info');
  }

  // Update the data source badge in the header
  function setSource(source) {
    const badge = document.getElementById('data-source-badge');
    const label = document.getElementById('data-source-label');
    if (!badge || !label) return;

    badge.classList.add('visible');
    badge.classList.remove('source--mv', 'source--openf1');

    if (source === 'mv') {
      badge.classList.add('source--mv');
      label.textContent = 'MULTIVIEWER';
    } else if (source === 'openf1') {
      badge.classList.add('source--openf1');
      label.textContent = 'OPENF1';
    } else {
      label.textContent = source.toUpperCase();
    }
  }

  // Bind backtick toggle
  document.addEventListener('keydown', e => {
    if (e.key === '`' && !e.ctrlKey && !e.metaKey) toggle();
  });

  return { log, show, hide, toggle, autoHide, setSource };

})();