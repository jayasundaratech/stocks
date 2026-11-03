(() => {
  'use strict';

  const SYMBOL = 'SOLUSDT';
  const REST = 'https://api.binance.com/api/v3/klines';
  const WATCH = Object.freeze({
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
  });
  const SCAN_GRACE_MS = 3500;
  const HISTORY_KEY = 'stocks-sol-pattern-alerts-v1';
  const MAX_ALERTS = 30;
  const DISPLAY_ALERTS = 8;
  const timers = new Map();
  const scanState = new Map(Object.keys(WATCH).map(tf => [tf, { status: 'waiting', at: 0, error: '' }]));
  let alerts = loadAlerts();
  let started = false;

  function detector() { return globalThis.CandlestickPatternDetector; }

  function loadAlerts() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value.slice(0, MAX_ALERTS) : [];
    } catch (_) { return []; }
  }
  function saveAlerts() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS))); } catch (_) {}
  }
  function parseRows(rows) {
    const now = Date.now();
    return (Array.isArray(rows) ? rows : []).map(row => ({
      openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]),
      volume: Number(row[5]), closeTime: Number(row[6]),
    })).filter(c => [c.openTime,c.open,c.high,c.low,c.close,c.closeTime].every(Number.isFinite) && c.closeTime < now - 250);
  }
  function VancouverTime(ms, includeDate = false) {
    const options = includeDate
      ? { timeZone:'America/Vancouver', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }
      : { timeZone:'America/Vancouver', hour:'2-digit', minute:'2-digit', second:'2-digit' };
    return new Intl.DateTimeFormat('en-CA', options).format(new Date(ms));
  }
  async function fetchClosedCandles(tf) {
    const url = `${REST}?symbol=${SYMBOL}&interval=${encodeURIComponent(tf)}&limit=120`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Binance REST ${response.status}`);
    const candles = parseRows(await response.json());
    if (candles.length < 25) throw new Error(`Only ${candles.length} closed candles returned`);
    return candles;
  }
  function alertKey(a) { return `${a.timeframe}|${a.candleCloseTime}|${a.patternId}`; }
  function addDetections(tf, candle, detections) {
    const existing = new Set(alerts.map(alertKey));
    const added = [];
    for (const hit of detections) {
      const alert = {
        symbol: SYMBOL, patternId: hit.id, pattern: hit.name, category: hit.category, timeframe: tf,
        candleCloseTime: candle.closeTime, detectedAt: Date.now(),
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
    const state = scanState.get(tf) || {};
    state.status = 'scanning'; state.error = '';
    scanState.set(tf, state);
    renderAll();
    try {
      const candles = await fetchClosedCandles(tf);
      const latest = candles[candles.length - 1];
      const hits = detector()?.detectLatest(candles) || [];
      const added = addDetections(tf, latest, hits);
      state.status = hits.length ? 'detected' : 'clear';
      state.at = Date.now(); state.error = '';
      scanState.set(tf, state);
      renderAll(added);
      document.dispatchEvent(new CustomEvent('sol-pattern-scan', {
        detail: { timeframe: tf, reason, candle: latest, detections: hits, newAlerts: added }
      }));
      return { timeframe: tf, candles: candles.length, detections: hits, added };
    } catch (error) {
      state.status = 'error'; state.at = Date.now(); state.error = error?.message || String(error);
      scanState.set(tf, state);
      renderAll();
      console.error(`[SOL pattern monitor] ${tf}`, error);
      return { timeframe: tf, error: state.error, detections: [], added: [] };
    }
  }
  function delayToNextClose(intervalMs) {
    const now = Date.now();
    const nextBoundary = (Math.floor(now / intervalMs) + 1) * intervalMs;
    return Math.max(1000, nextBoundary + SCAN_GRACE_MS - now);
  }
  function schedule(tf) {
    clearTimeout(timers.get(tf));
    timers.set(tf, setTimeout(async () => {
      await scan(tf, 'candle-close');
      schedule(tf);
    }, delayToNextClose(WATCH[tf])));
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
  function statusText(tf) {
    const s = scanState.get(tf);
    if (!s) return 'waiting';
    if (s.status === 'scanning') return 'scanning…';
    if (s.status === 'error') return 'error';
    if (!s.at) return 'waiting';
    return `${s.status} ${VancouverTime(s.at)}`;
  }
  function renderPanel(card, newAlerts = []) {
    const panel = ensurePanel(card);
    if (!panel) return;
    const visible = isSolCard(card);
    panel.hidden = !visible;
    if (!visible) return;
    const latest = alerts.slice(0, DISPLAY_ALERTS);
    const flashKeys = new Set(newAlerts.map(alertKey));
    const alertHtml = latest.length
      ? latest.map(a => `
        <div class="sol-pattern-alert ${a.category} ${flashKeys.has(alertKey(a)) ? 'is-new' : ''}">
          <div class="sol-pattern-alert-main">
            <strong>${escapeHtml(a.pattern)}</strong>
            <span class="sol-pattern-tf">${escapeHtml(a.timeframe)}</span>
          </div>
          <div class="sol-pattern-alert-time">SOLUSDT • candle closed ${escapeHtml(VancouverTime(a.candleCloseTime, true))} Vancouver</div>
        </div>`).join('')
      : '<div class="sol-pattern-empty">No candlestick pattern detected on the latest closed 5m / 15m / 1h / 4h candles.</div>';
    panel.innerHTML = `
      <div class="sol-pattern-head">
        <div><strong>SOLUSDT • 38 Pattern Monitor</strong><span>Closed candles only</span></div>
        <button type="button" class="sol-pattern-scan-now" title="Scan all monitored timeframes now">Scan</button>
      </div>
      <div class="sol-pattern-statuses">
        ${Object.keys(WATCH).map(tf => `<span data-state="${escapeHtml(scanState.get(tf)?.status || 'waiting')}"><b>${tf}</b> ${escapeHtml(statusText(tf))}</span>`).join('')}
      </div>
      <div class="sol-pattern-alerts">${alertHtml}</div>`;
    panel.querySelector('.sol-pattern-scan-now')?.addEventListener('click', async event => {
      event.stopPropagation();
      await scanAll('manual');
    });
  }
  function renderAll(newAlerts = []) {
    document.querySelectorAll('.chart-card').forEach(card => renderPanel(card, newAlerts));
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  async function scanAll(reason = 'initial') {
    if (!detector()?.detectLatest || detector()?.detectorCount !== 38 || detector()?.ruleCount !== 38) {
      console.error('[SOL pattern monitor] 38-pattern detector unavailable');
      return [];
    }
    return Promise.all(Object.keys(WATCH).map(tf => scan(tf, reason)));
  }
  function watchCards() {
    const observers = [];
    document.querySelectorAll('.chart-card .ticker').forEach(ticker => {
      const observer = new MutationObserver(() => requestAnimationFrame(() => renderAll()));
      observer.observe(ticker, { subtree: true, childList: true, characterData: true });
      observers.push(observer);
    });
    globalThis.__solPatternMonitorObservers = observers;
  }
  async function start() {
    if (started) return;
    started = true;
    watchCards();
    renderAll();
    Object.keys(WATCH).forEach(schedule);
    await scanAll('initial');
  }
  function stop() {
    timers.forEach(id => clearTimeout(id));
    timers.clear();
    (globalThis.__solPatternMonitorObservers || []).forEach(observer => observer.disconnect?.());
    started = false;
  }
  globalThis.__solPatternMonitor = {
    symbol: SYMBOL,
    timeframes: Object.keys(WATCH),
    scan, scanAll, schedule, stop,
    getAlerts: () => alerts.slice(),
    getScanState: () => Object.fromEntries([...scanState.entries()].map(([k,v]) => [k,{...v}])),
    delayToNextClose,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
