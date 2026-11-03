(() => {
  'use strict';

  const SYMBOL = 'SOLUSDT';
  const REST = 'https://api.binance.com/api/v3/klines';
  const WATCH = Object.freeze({
    '5m':  { intervalMs: 5 * 60 * 1000,  label: '5 min' },
    '15m': { intervalMs: 15 * 60 * 1000, label: '15 min' },
    '1h':  { intervalMs: 60 * 60 * 1000, label: '1 hour' },
    '4h':  { intervalMs: 4 * 60 * 60 * 1000, label: '4 hour' },
  });

  const SCAN_GRACE_MS = 3500;
  const FETCH_LIMIT = 200;
  const HISTORY_KEY = 'stocks-sol-pattern-alerts-v1';
  const MAX_ALERTS = 50;
  const DISPLAY_ALERTS = 10;
  const TOAST_LIFETIME_MS = 12000;
  const timers = new Map();
  const nextRuns = new Map();
  const scanState = new Map(
    Object.keys(WATCH).map(tf => [tf, {
      status: 'waiting',
      at: 0,
      error: '',
      candleCloseTime: 0,
      detectionCount: 0,
    }])
  );

  let alerts = loadAlerts();
  let started = false;
  let scanAllPromise = null;

  function detector() {
    return globalThis.CandlestickPatternDetector;
  }

  function detectorReady() {
    const d = detector();
    return Boolean(d?.detectLatest && d?.detectorCount === 38 && d?.ruleCount === 38);
  }

  function loadAlerts() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_ALERTS) : [];
    } catch (_) {
      return [];
    }
  }

  function saveAlerts() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)));
    } catch (_) {}
  }

  function parseRows(rows) {
    const now = Date.now();
    return (Array.isArray(rows) ? rows : [])
      .map(row => ({
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
      }))
      .filter(candle =>
        [
          candle.openTime,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.closeTime,
        ].every(Number.isFinite) && candle.closeTime < now - 250
      );
  }

  function VancouverTime(ms, includeDate = false) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const options = includeDate
      ? {
          timeZone: 'America/Vancouver',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }
      : {
          timeZone: 'America/Vancouver',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        };
    return new Intl.DateTimeFormat('en-CA', options).format(new Date(ms));
  }

  async function fetchClosedCandles(tf) {
    const url = `${REST}?symbol=${SYMBOL}&interval=${encodeURIComponent(tf)}&limit=${FETCH_LIMIT}`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Binance REST ${response.status}`);

    const candles = parseRows(await response.json());
    if (candles.length < 25) {
      throw new Error(`Only ${candles.length} closed candles returned`);
    }
    return candles;
  }

  function alertKey(alert) {
    return `${alert.timeframe}|${alert.candleCloseTime}|${alert.patternId}`;
  }

  function addDetections(tf, candle, detections) {
    const existing = new Set(alerts.map(alertKey));
    const added = [];

    for (const hit of detections) {
      const alert = {
        symbol: SYMBOL,
        patternId: hit.id,
        pattern: hit.name,
        category: hit.category,
        timeframe: tf,
        candleCloseTime: candle.closeTime,
        detectedAt: Date.now(),
      };

      if (existing.has(alertKey(alert))) continue;
      alerts.unshift(alert);
      existing.add(alertKey(alert));
      added.push(alert);
    }

    alerts = alerts.slice(0, MAX_ALERTS);
    if (added.length) saveAlerts();
    return added;
  }

  async function scan(tf, reason = 'scheduled') {
    if (!WATCH[tf]) {
      return { timeframe: tf, error: `Unsupported timeframe: ${tf}`, detections: [], added: [] };
    }

    const state = scanState.get(tf);
    state.status = 'scanning';
    state.error = '';
    scanState.set(tf, state);
    renderAll();

    try {
      if (!detectorReady()) throw new Error('38-pattern detector unavailable');

      const candles = await fetchClosedCandles(tf);
      const latest = candles[candles.length - 1];
      const hits = detector().detectLatest(candles) || [];
      const added = addDetections(tf, latest, hits);

      state.status = hits.length ? 'detected' : 'clear';
      state.at = Date.now();
      state.error = '';
      state.candleCloseTime = latest.closeTime;
      state.detectionCount = hits.length;
      scanState.set(tf, state);

      renderAll(added);
      document.dispatchEvent(new CustomEvent('sol-pattern-scan', {
        detail: {
          symbol: SYMBOL,
          timeframe: tf,
          reason,
          candle: latest,
          detections: hits,
          newAlerts: added,
        },
      }));

      return {
        timeframe: tf,
        reason,
        candles: candles.length,
        candleCloseTime: latest.closeTime,
        detections: hits,
        added,
      };
    } catch (error) {
      state.status = 'error';
      state.at = Date.now();
      state.error = error?.message || String(error);
      state.detectionCount = 0;
      scanState.set(tf, state);
      renderAll();
      console.error(`[SOL pattern monitor] ${tf}`, error);
      return { timeframe: tf, reason, error: state.error, detections: [], added: [] };
    }
  }

  function nextBoundary(intervalMs, now = Date.now()) {
    return (Math.floor(now / intervalMs) + 1) * intervalMs;
  }

  function delayToNextClose(intervalMs, now = Date.now()) {
    return Math.max(1000, nextBoundary(intervalMs, now) + SCAN_GRACE_MS - now);
  }

  function schedule(tf) {
    const config = WATCH[tf];
    if (!config) return;

    clearTimeout(timers.get(tf));
    const now = Date.now();
    const nextRun = nextBoundary(config.intervalMs, now) + SCAN_GRACE_MS;
    nextRuns.set(tf, nextRun);

    timers.set(tf, setTimeout(async () => {
      await scan(tf, 'candle-close');
      schedule(tf);
    }, Math.max(1000, nextRun - now)));

    renderAll();
  }

  function isSolCard(card) {
    return card?.querySelector('.ticker')?.textContent?.trim().toUpperCase() === SYMBOL;
  }

  function ensurePanel(card) {
    let panel = card.querySelector('.sol-pattern-monitor');
    if (panel) return panel;

    const wrap = card.querySelector('.chart-canvas-wrap');
    if (!wrap) return null;

    panel = document.createElement('section');
    panel.className = 'sol-pattern-monitor';
    panel.setAttribute('aria-live', 'polite');
    wrap.appendChild(panel);
    return panel;
  }

  function ensureToastStack(card) {
    let stack = card.querySelector('.sol-pattern-toast-stack');
    if (stack) return stack;

    const wrap = card.querySelector('.chart-canvas-wrap');
    if (!wrap) return null;

    stack = document.createElement('div');
    stack.className = 'sol-pattern-toast-stack';
    stack.setAttribute('aria-live', 'assertive');
    wrap.appendChild(stack);
    return stack;
  }

  function statusText(tf) {
    const state = scanState.get(tf);
    if (!state) return 'waiting';
    if (state.status === 'scanning') return 'scanning…';
    if (state.status === 'error') return 'error';
    if (!state.at) return 'waiting';
    if (state.status === 'detected') return `${state.detectionCount} hit${state.detectionCount === 1 ? '' : 's'} • ${VancouverTime(state.at)}`;
    return `clear • ${VancouverTime(state.at)}`;
  }

  function nextText(tf) {
    const next = nextRuns.get(tf);
    return next ? `next ${VancouverTime(next)}` : 'not scheduled';
  }

  function renderToasts(card, newAlerts = []) {
    const stack = ensureToastStack(card);
    if (!stack) return;

    const visible = isSolCard(card);
    stack.hidden = !visible;
    if (!visible || !newAlerts.length) return;

    for (const alert of newAlerts) {
      const toast = document.createElement('div');
      toast.className = `sol-pattern-toast ${alert.category}`;
      toast.dataset.key = alertKey(alert);
      toast.innerHTML = `
        <div class="sol-pattern-toast-title">Pattern detected</div>
        <div class="sol-pattern-toast-pattern">${escapeHtml(alert.pattern)}</div>
        <div class="sol-pattern-toast-meta">
          <span>${escapeHtml(alert.timeframe)}</span>
          <span>${escapeHtml(alert.category)}</span>
          <span>${escapeHtml(VancouverTime(alert.candleCloseTime, true))}</span>
        </div>`;
      stack.prepend(toast);
      while (stack.children.length > 4) stack.lastElementChild?.remove();
      setTimeout(() => toast.remove(), TOAST_LIFETIME_MS);
    }
  }

  function renderPanel(card) {
    const panel = ensurePanel(card);
    if (!panel) return;

    const visible = isSolCard(card);
    panel.hidden = !visible;
    if (!visible) return;

    const latest = alerts.slice(0, DISPLAY_ALERTS);
    const alertHtml = latest.length
      ? latest.map(alert => `
        <div class="sol-pattern-alert ${escapeHtml(alert.category)}">
          <div class="sol-pattern-alert-main">
            <strong>${escapeHtml(alert.pattern)}</strong>
            <span class="sol-pattern-tf">${escapeHtml(alert.timeframe)}</span>
          </div>
          <div class="sol-pattern-alert-time">
            ${escapeHtml(alert.category)} • candle closed ${escapeHtml(VancouverTime(alert.candleCloseTime, true))} Vancouver
          </div>
        </div>`).join('')
      : '<div class="sol-pattern-empty">No pattern detected yet on the latest closed 5m / 15m / 1h / 4h candles.</div>';

    panel.innerHTML = `
      <div class="sol-pattern-head">
        <div>
          <strong>SOLUSDT • 38 Pattern Scanner</strong>
          <span>5m / 15m / 1h / 4h • closed candles only</span>
        </div>
        <button type="button" class="sol-pattern-scan-now" title="Scan all monitored timeframes now">Scan now</button>
      </div>
      <div class="sol-pattern-statuses">
        ${Object.keys(WATCH).map(tf => {
          const state = scanState.get(tf)?.status || 'waiting';
          return `<span data-state="${escapeHtml(state)}"><b>${escapeHtml(tf)}</b> ${escapeHtml(statusText(tf))}<small>${escapeHtml(nextText(tf))}</small></span>`;
        }).join('')}
      </div>
      <div class="sol-pattern-alerts">${alertHtml}</div>`;

    panel.querySelector('.sol-pattern-scan-now')?.addEventListener('click', async event => {
      event.stopPropagation();
      await scanAll('manual');
    });
  }

  function renderAll(newAlerts = []) {
    document.querySelectorAll('.chart-card').forEach(card => {
      renderPanel(card);
      renderToasts(card, newAlerts);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[character]));
  }

  async function scanAll(reason = 'initial') {
    if (scanAllPromise) return scanAllPromise;

    if (!detectorReady()) {
      console.error('[SOL pattern monitor] 38-pattern detector unavailable');
      return [];
    }

    scanAllPromise = Promise.all(Object.keys(WATCH).map(tf => scan(tf, reason)))
      .finally(() => {
        scanAllPromise = null;
      });
    return scanAllPromise;
  }

  function watchCards() {
    const observers = [];

    document.querySelectorAll('.chart-card').forEach(card => {
      let tickerObserver = null;
      let discoveryObserver = null;

      const bindTicker = () => {
        const ticker = card.querySelector('.ticker');
        if (!ticker || tickerObserver) return false;

        discoveryObserver?.disconnect();
        tickerObserver = new MutationObserver(() => requestAnimationFrame(() => renderAll()));
        tickerObserver.observe(ticker, { subtree: true, childList: true, characterData: true });
        observers.push(tickerObserver);
        requestAnimationFrame(() => renderAll());
        return true;
      };

      if (!bindTicker()) {
        discoveryObserver = new MutationObserver(() => bindTicker());
        discoveryObserver.observe(card, { subtree: true, childList: true });
        observers.push(discoveryObserver);
      }
    });

    globalThis.__solPatternMonitorObservers = observers;
  }

  function recoverMissedScans(reason) {
    if (document.visibilityState === 'hidden') return;
    scanAll(reason).catch(error => console.error('[SOL pattern monitor] recovery scan', error));
    Object.keys(WATCH).forEach(schedule);
  }

  async function start() {
    if (started) return;
    started = true;

    watchCards();
    Object.keys(WATCH).forEach(schedule);
    renderAll();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recoverMissedScans('tab-visible');
    });
    window.addEventListener('online', () => recoverMissedScans('network-online'));

    await scanAll('initial');
  }

  function stop() {
    timers.forEach(id => clearTimeout(id));
    timers.clear();
    nextRuns.clear();
    (globalThis.__solPatternMonitorObservers || []).forEach(observer => observer.disconnect?.());
    started = false;
  }

  globalThis.__solPatternMonitor = {
    symbol: SYMBOL,
    timeframes: Object.keys(WATCH),
    watch: WATCH,
    scan,
    scanAll,
    schedule,
    stop,
    start,
    getAlerts: () => alerts.slice(),
    getScanState: () => Object.fromEntries(
      [...scanState.entries()].map(([key, value]) => [key, { ...value, nextRun: nextRuns.get(key) || 0 }])
    ),
    delayToNextClose,
    nextBoundary,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();