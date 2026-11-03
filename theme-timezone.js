(() => {
  const FIXED_OFFSET_HOURS = -7;
  const FIXED_OFFSET_MS = FIXED_OFFSET_HOURS * 60 * 60 * 1000;
  const FIXED_OFFSET_LABEL = 'UTC-7';
  const STORAGE_KEY = 'stocks-dashboard-theme';
  const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;

  function shiftedDate(date) {
    return new Date(date.getTime() + FIXED_OFFSET_MS);
  }

  Date.prototype.toLocaleTimeString = function(locale, options = {}) {
    const merged = { ...options };
    if (merged.timeZone) return originalToLocaleTimeString.call(this, locale, merged);
    merged.timeZone = 'UTC';
    return originalToLocaleTimeString.call(shiftedDate(this), locale, merged);
  };

  function asDate(time) {
    if (typeof time === 'number') return new Date(time * 1000);
    if (typeof time === 'string') return new Date(time);
    if (time && typeof time === 'object' && Number.isFinite(time.timestamp)) {
      return new Date(Number(time.timestamp) * 1000);
    }
    if (time && typeof time === 'object' && 'year' in time) {
      return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1));
    }
    return new Date();
  }

  function fixedOffsetDate(time) {
    return shiftedDate(asDate(time));
  }

  function formatTick(time, tickMarkType) {
    const date = fixedOffsetDate(time);

    if (tickMarkType === 0) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
      }).format(date);
    }

    if (tickMarkType === 1) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'UTC',
        month: 'short',
      }).format(date);
    }

    if (tickMarkType === 2) {
      return String(date.getUTCDate());
    }

    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function formatCrosshairTime(time) {
    const date = fixedOffsetDate(time);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function palette(theme) {
    return theme === 'light'
      ? { background: '#ffffff', text: '#475569', grid: '#e5e7eb', border: '#d1d5db', crosshair: '#64748b' }
      : { background: '#0d1425', text: '#91a0bd', grid: '#25304a', border: '#26324d', crosshair: '#94a3b8' };
  }

  function applyChartTheme(chart, theme) {
    if (!chart?.applyOptions) return;
    const p = palette(theme);
    try {
      chart.applyOptions({
        layout: { background: { color: p.background }, textColor: p.text },
        grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
        rightPriceScale: { borderColor: p.border },
        timeScale: {
          borderColor: p.border,
          tickMarkFormatter: (time, tickMarkType) => formatTick(time, tickMarkType),
        },
        crosshair: {
          vertLine: { color: p.crosshair },
          horzLine: { color: p.crosshair },
        },
        localization: { timeFormatter: time => formatCrosshairTime(time) },
      });
    } catch (error) {
      console.debug('Theme/timezone apply skipped', error);
    }
  }

  function allChartRecords() {
    return [
      ...(window.__stockChartRecords || []),
      ...(window.__oscillatorChartRecords || []),
    ];
  }

  function applyToAllCharts(theme) {
    allChartRecords().forEach(record => applyChartTheme(record.chart, theme));
  }

  function updateToggle(theme) {
    const button = document.getElementById('themeToggle');
    if (!button) return;
    const light = theme === 'light';
    button.innerHTML = `<span aria-hidden="true">${light ? '☀' : '☾'}</span><span class="theme-label">${light ? 'Light' : 'Dark'}</span>`;
    button.title = `Switch to ${light ? 'dark' : 'light'} mode`;
    button.setAttribute('aria-label', button.title);
  }

  function setTheme(theme, persist = true) {
    const safe = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = safe;
    document.documentElement.dataset.theme = safe;
    if (persist) localStorage.setItem(STORAGE_KEY, safe);
    updateToggle(safe);
    applyToAllCharts(safe);
    window.dispatchEvent(new CustomEvent('dashboard-theme-change', { detail: { theme: safe } }));
  }

  function installHeaderControls() {
    const actions = document.querySelector('.header-actions');
    if (!actions || document.getElementById('themeToggle')) return;

    const timezone = document.createElement('span');
    timezone.className = 'timezone-badge';
    timezone.textContent = 'Vancouver time';
    timezone.title = `Chart timeline uses fixed ${FIXED_OFFSET_LABEL}`;

    const button = document.createElement('button');
    button.id = 'themeToggle';
    button.type = 'button';
    button.className = 'theme-toggle';
    button.addEventListener('click', () => {
      const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      setTheme(next, true);
    });

    const reset = document.getElementById('resetAll');
    if (reset) {
      actions.insertBefore(timezone, reset);
      actions.insertBefore(button, reset);
    } else {
      actions.append(timezone, button);
    }
  }

  function boot() {
    installHeaderControls();
    const saved = localStorage.getItem(STORAGE_KEY);
    setTheme(saved === 'light' ? 'light' : 'dark', false);

    let checks = 0;
    const timer = setInterval(() => {
      applyToAllCharts(document.body.dataset.theme || 'dark');
      checks += 1;
      if (checks > 40) clearInterval(timer);
    }, 250);
  }

  window.__dashboardTimezone = FIXED_OFFSET_LABEL;
  window.__dashboardTimezoneOffsetHours = FIXED_OFFSET_HOURS;
  window.__setDashboardTheme = setTheme;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
