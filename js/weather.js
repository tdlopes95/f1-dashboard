// ═══════════════════════════════════════════════════════
// weather.js — Weather strip component
// ═══════════════════════════════════════════════════════

const Weather = (() => {

  const els = {
    trackTemp: document.getElementById('wx-track-temp'),
    airTemp:   document.getElementById('wx-air-temp'),
    humidity:  document.getElementById('wx-humidity'),
    wind:      document.getElementById('wx-wind'),
    rain:      document.getElementById('wx-rain'),
  };

  function render(wx) {
    if (!wx) return;
    els.trackTemp.textContent = wx.track_temperature != null ? `${wx.track_temperature}°C` : '--°C';
    els.airTemp.textContent   = wx.air_temperature   != null ? `${wx.air_temperature}°C`   : '--°C';
    els.humidity.textContent  = wx.humidity          != null ? `${wx.humidity}%`            : '--%';
    els.wind.textContent      = wx.wind_speed        != null ? `${wx.wind_speed} m/s`       : '-- m/s';

    const isRain = !!wx.rainfall;
    els.rain.textContent  = isRain ? 'YES' : 'NO';
    els.rain.className    = `wx-value ${isRain ? 'wx-rain--yes' : 'wx-rain--no'}`;
  }

  function init() {
    State.on('change:weather', render);
    console.log('[Weather] Initialized');
  }

  return { init };

})();