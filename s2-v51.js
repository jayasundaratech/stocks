const S2_DEFAULTS = {
  enabled: true,
  leftBars: 3,
  rightBars: 3,
  showStructureLabels: true,
  showSwingLevels: false,
  enableWickFilter: true,
  wickBodyRatio: 1.0,
  atrLength: 14,
  zoneATRSize: 0.25,
  showSRZones: true,
  volumeLookback: 10,
  controlThreshold: 55,
  usePressureFilter: true,
  showDashboard: true,
  showS2Labels: true,
  minimumBarsBetweenSetups: 3,
  requireStructureDirection: false,
};

const S2_REST_BASE = 'https://api.binance.com/api/v3/klines';
const S2_WS_BASE = 'wss://stream.binance.com:9443/ws';
const S2_INSTANCES = [];
const S2_MAX_MARKERS = 500;

function s2Clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function s2Key(index) {
  return `stocks-s2-v51-settings-${index}`;
}

function loadS2Settings(index) {
  try {
    const saved = JSON.parse(localStorage.getItem(s2Key(index)) || 'null');
    return { ...s2Clone(S2_DEFAULTS), ...(saved || {}) };
  } catch (_) {
    return s2Clone(S2_DEFAULTS);
  }
}

function saveS2Settings(instance) {
  try {
    localStorage.setItem(s2Key(instance.index), JSON.stringify(instance.settings));
  } catch (_) {}
}

function s2Timeframe(instance) {
  return instance.card.querySelector('.timeframe-buttons .active')?.textContent?.trim() || '1m';
}

function s2Symbol(instance) {
  return instance.card.querySelector('.symbol-search')?.value?.trim().toUpperCase() || 'BTCUSDT';
}

function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
    closeTime: Number(row[6]),
    closed: Number(row[6]) <= Date.now(),
  };
}

function blackoutKline(candle) {
  const router = window.__xautMarketRouter;
  if (!router?.isWeekendBlackoutKline) return false;
  try {
    return router.isWeekendBlackoutKline(candle.time * 1000, candle.closeTime);
  } catch (_) {
    return false;
  }
}

function emaS2(values, length) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const alpha = 2 / (length + 1);
  let value = values[0];
  out[0] = value;
  for (let i = 1; i < values.length; i++) {
    value = alpha * values[i] + (1 - alpha) * value;
    out[i] = value;
  }
  return out;
}

function smaS2(values, length) {
  const out = new Array(values.length).fill(null);
  if (length <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function rmaS2(values, length) {
  const out = new Array(values.length).fill(null);
  if (length <= 0 || values.length < length) return out;
  let seed = 0;
  for (let i = 0; i < length; i++) seed += values[i];
  let value = seed / length;
  out[length - 1] = value;
  for (let i = length; i < values.length; i++) {
    value = (value * (length - 1) + values[i]) / length;
    out[i] = value;
  }
  return out;
}

function atrS2(candles, length) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  return rmaS2(tr, length);
}

function isUniquePivotLow(candles, index, left, right) {
  if (index - left < 0 || index + right >= candles.length) return false;
  const value = candles[index].low;
  let count = 0;
  for (let i = index - left; i <= index + right; i++) {
    if (candles[i].low < value) return false;
    if (candles[i].low === value) count++;
  }
  return count === 1;
}

function isUniquePivotHigh(candles, index, left, right) {
  if (index - left < 0 || index + right >= candles.length) return false;
  const value = candles[index].high;
  let count = 0;
  for (let i = index - left; i <= index + right; i++) {
    if (candles[i].high > value) return false;
    if (candles[i].high === value) count++;
  }
  return count === 1;
}

function computeS2(candles, settings) {
  const n = candles.length;
  if (!n) return null;

  const closes = candles.map(c => c.close);
  const ema9 = emaS2(closes, 9);
  const ema20 = emaS2(closes, 20);
  const ema50 = emaS2(closes, 50);
  const atr = atrS2(candles, Math.max(1, Number(settings.atrLength) || 14));

  const estimatedBuy = candles.map(c => {
    const range = Math.max(c.high - c.low, Math.max(Math.abs(c.close) * 1e-10, 1e-10));
    return Math.max(0, c.volume || 0) * (c.close - c.low) / range;
  });
  const estimatedSell = candles.map(c => {
    const range = Math.max(c.high - c.low, Math.max(Math.abs(c.close) * 1e-10, 1e-10));
    return Math.max(0, c.volume || 0) * (c.high - c.close) / range;
  });
  const lookback = Math.max(2, Number(settings.volumeLookback) || 10);
  const avgBuy = smaS2(estimatedBuy, lookback);
  const avgSell = smaS2(estimatedSell, lookback);

  const left = Math.max(1, Number(settings.leftBars) || 3);
  const right = Math.max(1, Number(settings.rightBars) || 3);
  const wickRatio = Math.max(0.1, Number(settings.wickBodyRatio) || 1);
  const zoneSize = Math.max(0.05, Number(settings.zoneATRSize) || 0.25);
  const threshold = Math.min(100, Math.max(50, Number(settings.controlThreshold) || 55));
  const cooldown = Math.max(0, Number(settings.minimumBarsBetweenSetups) || 0);

  let lastSwingHigh = null;
  let lastSwingLow = null;
  let structureDirection = 0;
  let lastBuySignalBar = null;
  let lastSellSignalBar = null;
  let supportZone = null;
  let resistanceZone = null;

  const swingHighValues = new Array(n).fill(null);
  const swingLowValues = new Array(n).fill(null);
  const markers = [];
  let latestBuyerPercent = 50;
  let latestSellerPercent = 50;
  let latestBullTrend = false;
  let latestBearTrend = false;
  let latestBuyersInControl = false;
  let latestSellersInControl = false;

  for (let i = 0; i < n; i++) {
    const candle = candles[i];
    const pivotIndex = i - right;
    const hasPivotWindow = pivotIndex >= left && pivotIndex + right < n;
    const pivotLowOK = hasPivotWindow && isUniquePivotLow(candles, pivotIndex, left, right);
    const pivotHighOK = hasPivotWindow && isUniquePivotHigh(candles, pivotIndex, left, right);
    const pivotLow = pivotLowOK ? candles[pivotIndex].low : null;
    const pivotHigh = pivotHighOK ? candles[pivotIndex].high : null;

    const prevClose = i > 0 ? candles[i - 1].close : candle.close;
    const bullBreak = Number.isFinite(lastSwingHigh) && candle.close > lastSwingHigh && prevClose <= lastSwingHigh;
    const bearBreak = Number.isFinite(lastSwingLow) && candle.close < lastSwingLow && prevClose >= lastSwingLow;
    const bullCH = bullBreak && structureDirection === -1;
    const bearCH = bearBreak && structureDirection === 1;

    if (bullBreak) {
      if (settings.showStructureLabels) {
        markers.push({
          time: candle.time,
          position: 'aboveBar',
          color: bullCH ? '#00BCD4' : '#22c55e',
          shape: 'arrowDown',
          text: bullCH ? 'CH' : 'BOS',
          size: 0.7,
        });
      }
      structureDirection = 1;
    }

    if (bearBreak) {
      if (settings.showStructureLabels) {
        markers.push({
          time: candle.time,
          position: 'belowBar',
          color: bearCH ? '#ff9800' : '#ef4444',
          shape: 'arrowUp',
          text: bearCH ? 'CH' : 'BOS',
          size: 0.7,
        });
      }
      structureDirection = -1;
    }

    let bullWickOK = true;
    let bearWickOK = true;
    if (hasPivotWindow) {
      const p = candles[pivotIndex];
      const body = Math.max(Math.abs(p.close - p.open), Math.max(Math.abs(p.close) * 1e-10, 1e-10));
      const lowerWick = Math.min(p.open, p.close) - p.low;
      const upperWick = p.high - Math.max(p.open, p.close);
      const bullWick = pivotLowOK && lowerWick >= body * wickRatio;
      const bearWick = pivotHighOK && upperWick >= body * wickRatio;
      bullWickOK = !settings.enableWickFilter || bullWick;
      bearWickOK = !settings.enableWickFilter || bearWick;

      const pivotAtr = atr[pivotIndex];
      if (pivotLowOK && bullWickOK && Number.isFinite(pivotAtr)) {
        supportZone = {
          startTime: p.time,
          bottom: pivotLow,
          top: pivotLow + pivotAtr * zoneSize,
        };
      }
      if (pivotHighOK && bearWickOK && Number.isFinite(pivotAtr)) {
        resistanceZone = {
          startTime: p.time,
          top: pivotHigh,
          bottom: pivotHigh - pivotAtr * zoneSize,
        };
      }
    }

    const buyVol = avgBuy[i];
    const sellVol = avgSell[i];
    const total = Number.isFinite(buyVol) && Number.isFinite(sellVol) ? buyVol + sellVol : 0;
    const buyerPercent = total > 0 ? (buyVol / total) * 100 : 50;
    const sellerPercent = 100 - buyerPercent;
    const buyersInControl = buyerPercent >= threshold;
    const sellersInControl = sellerPercent >= threshold;

    const bullTrend = Number.isFinite(ema9[i]) && Number.isFinite(ema20[i]) && Number.isFinite(ema50[i]) && ema9[i] > ema20[i] && ema20[i] > ema50[i];
    const bearTrend = Number.isFinite(ema9[i]) && Number.isFinite(ema20[i]) && Number.isFinite(ema50[i]) && ema9[i] < ema20[i] && ema20[i] < ema50[i];
    const buyerFilterOK = !settings.usePressureFilter || buyersInControl;
    const sellerFilterOK = !settings.usePressureFilter || sellersInControl;
    const bullStructureOK = !settings.requireStructureDirection || structureDirection === 1;
    const bearStructureOK = !settings.requireStructureDirection || structureDirection === -1;
    const buyCooldownOK = lastBuySignalBar == null || i - lastBuySignalBar >= cooldown;
    const sellCooldownOK = lastSellSignalBar == null || i - lastSellSignalBar >= cooldown;

    const buyS2 = pivotLowOK && bullTrend && bullWickOK && buyerFilterOK && bullStructureOK && buyCooldownOK;
    const sellS2 = pivotHighOK && bearTrend && bearWickOK && sellerFilterOK && bearStructureOK && sellCooldownOK;

    if (buyS2) {
      lastBuySignalBar = i;
      if (settings.showS2Labels) {
        markers.push({
          time: candles[pivotIndex].time,
          position: 'belowBar',
          color: '#84ff00',
          shape: 'arrowUp',
          text: 'BUY S2',
          size: 1,
        });
      }
    }

    if (sellS2) {
      lastSellSignalBar = i;
      if (settings.showS2Labels) {
        markers.push({
          time: candles[pivotIndex].time,
          position: 'aboveBar',
          color: '#ef4444',
          shape: 'arrowDown',
          text: 'SELL S2',
          size: 1,
        });
      }
    }

    // Match the Pine order: confirmed pivots replace prior swing levels after
    // BOS/CH and S2 logic for the current confirmation bar has run.
    if (pivotHighOK) lastSwingHigh = pivotHigh;
    if (pivotLowOK) lastSwingLow = pivotLow;

    swingHighValues[i] = Number.isFinite(lastSwingHigh) ? lastSwingHigh : null;
    swingLowValues[i] = Number.isFinite(lastSwingLow) ? lastSwingLow : null;

    if (i === n - 1) {
      latestBuyerPercent = buyerPercent;
      latestSellerPercent = sellerPercent;
      latestBullTrend = bullTrend;
      latestBearTrend = bearTrend;
      latestBuyersInControl = buyersInControl;
      latestSellersInControl = sellersInControl;
    }
  }

  markers.sort((a, b) => a.time - b.time);

  return {
    markers: markers.slice(-S2_MAX_MARKERS),
    supportZone,
    resistanceZone,
    swingHigh: candles.flatMap((c, i) => Number.isFinite(swingHighValues[i]) ? [{ time: c.time, value: swingHighValues[i] }] : []),
    swingLow: candles.flatMap((c, i) => Number.isFinite(swingLowValues[i]) ? [{ time: c.time, value: swingLowValues[i] }] : []),
    buyerPercent: latestBuyerPercent,
    sellerPercent: latestSellerPercent,
    buyersInControl: latestBuyersInControl,
    sellersInControl: latestSellersInControl,
    bullTrend: latestBullTrend,
    bearTrend: latestBearTrend,
    structureDirection,
  };
}

function setupS2Series(instance) {
  if (instance.swingHighSeries) return;
  instance.swingHighSeries = instance.record.chart.addLineSeries({
    color: 'rgba(239,68,68,.45)',
    lineWidth: 1,
    lineType: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
  instance.swingLowSeries = instance.record.chart.addLineSeries({
    color: 'rgba(34,197,94,.45)',
    lineWidth: 1,
    lineType: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

function setupS2Overlay(instance) {
  if (instance.overlay) return;
  const ns = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(ns, 'svg');
  overlay.classList.add('s2-zone-layer');
  const supportRect = document.createElementNS(ns, 'rect');
  supportRect.classList.add('s2-support-zone');
  const resistanceRect = document.createElementNS(ns, 'rect');
  resistanceRect.classList.add('s2-resistance-zone');
  overlay.append(supportRect, resistanceRect);
  instance.wrap.appendChild(overlay);
  instance.overlay = overlay;
  instance.supportRect = supportRect;
  instance.resistanceRect = resistanceRect;

  const dashboard = document.createElement('div');
  dashboard.className = 's2-pressure-dashboard';
  dashboard.innerHTML = `
    <div class="s2-pressure-row s2-pressure-head">
      <span>BUYERS</span><strong class="s2-buy-pct">50.0%</strong>
      <span>SELLERS</span><strong class="s2-sell-pct">50.0%</strong>
    </div>
    <div class="s2-control-row">BALANCED</div>
    <div class="s2-status-row"><span class="s2-tf">USE 2 MIN</span><span class="s2-trend">NEUTRAL</span><span>S/R</span><span class="s2-wick">ON</span></div>`;
  instance.wrap.appendChild(dashboard);
  instance.dashboard = dashboard;

  const redraw = () => drawS2Zones(instance);
  instance.record.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  instance.resizeObserver = new ResizeObserver(redraw);
  instance.resizeObserver.observe(instance.record.container);
}

function setRectFromZone(instance, rect, zone, kind) {
  if (!rect || !zone || !instance.settings.showSRZones || !instance.settings.enabled) {
    rect?.setAttribute('visibility', 'hidden');
    return;
  }

  const chart = instance.record.chart;
  const candleSeries = instance.record.candleSeries;
  let x = chart.timeScale().timeToCoordinate(zone.startTime);
  const yTop = candleSeries.priceToCoordinate(zone.top);
  const yBottom = candleSeries.priceToCoordinate(zone.bottom);
  const width = Math.max(1, instance.record.container.clientWidth);
  const plotRight = Math.max(0, width - 88);

  if (!Number.isFinite(yTop) || !Number.isFinite(yBottom)) {
    rect.setAttribute('visibility', 'hidden');
    return;
  }
  if (!Number.isFinite(x)) x = 0;
  x = Math.max(0, Math.min(plotRight, x));
  const y = Math.min(yTop, yBottom);
  const h = Math.max(1, Math.abs(yBottom - yTop));
  const w = Math.max(0, plotRight - x);
  if (w <= 0) {
    rect.setAttribute('visibility', 'hidden');
    return;
  }

  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('visibility', 'visible');
  rect.dataset.kind = kind;
}

function drawS2Zones(instance) {
  if (!instance.overlay) return;
  const width = Math.max(1, instance.record.container.clientWidth);
  const height = Math.max(1, instance.record.container.clientHeight);
  instance.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  instance.overlay.setAttribute('width', String(width));
  instance.overlay.setAttribute('height', String(height));
  setRectFromZone(instance, instance.supportRect, instance.computed?.supportZone, 'support');
  setRectFromZone(instance, instance.resistanceRect, instance.computed?.resistanceZone, 'resistance');
}

function updateDashboard(instance) {
  const d = instance.dashboard;
  if (!d) return;
  const c = instance.computed;
  const s = instance.settings;
  d.hidden = !s.enabled || !s.showDashboard || !c;
  if (d.hidden || !c) return;

  d.querySelector('.s2-buy-pct').textContent = `${c.buyerPercent.toFixed(1)}%`;
  d.querySelector('.s2-sell-pct').textContent = `${c.sellerPercent.toFixed(1)}%`;

  const control = d.querySelector('.s2-control-row');
  control.classList.remove('buyers', 'sellers', 'balanced');
  if (c.buyersInControl) {
    control.textContent = 'BUYERS IN CONTROL';
    control.classList.add('buyers');
  } else if (c.sellersInControl) {
    control.textContent = 'SELLERS IN CONTROL';
    control.classList.add('sellers');
  } else {
    control.textContent = 'BALANCED';
    control.classList.add('balanced');
  }

  const tf = d.querySelector('.s2-tf');
  const is2m = instance.timeframe === '2m';
  tf.textContent = is2m ? '2 MIN' : 'USE 2 MIN';
  tf.classList.toggle('ok', is2m);

  const trend = d.querySelector('.s2-trend');
  trend.classList.remove('up', 'down', 'neutral');
  if (c.bullTrend) {
    trend.textContent = 'UP';
    trend.classList.add('up');
  } else if (c.bearTrend) {
    trend.textContent = 'DOWN';
    trend.classList.add('down');
  } else {
    trend.textContent = 'NEUTRAL';
    trend.classList.add('neutral');
  }
  const wick = d.querySelector('.s2-wick');
  wick.textContent = s.enableWickFilter ? 'ON' : 'OFF';
  wick.classList.toggle('ok', s.enableWickFilter);
}

function clearS2(instance) {
  try { instance.record.candleSeries.setMarkers([]); } catch (_) {}
  try { instance.swingHighSeries?.setData([]); } catch (_) {}
  try { instance.swingLowSeries?.setData([]); } catch (_) {}
  instance.computed = null;
  drawS2Zones(instance);
  updateDashboard(instance);
}

function applyS2(instance) {
  if (!instance.settings.enabled || !instance.candles.length) {
    clearS2(instance);
    return;
  }
  instance.computed = computeS2(instance.candles, instance.settings);
  if (!instance.computed) {
    clearS2(instance);
    return;
  }

  try { instance.record.candleSeries.setMarkers(instance.computed.markers); } catch (error) { console.error('S2 markers', error); }
  try { instance.swingHighSeries.setData(instance.settings.showSwingLevels ? instance.computed.swingHigh : []); } catch (_) {}
  try { instance.swingLowSeries.setData(instance.settings.showSwingLevels ? instance.computed.swingLow : []); } catch (_) {}
  drawS2Zones(instance);
  updateDashboard(instance);
}

function scheduleS2(instance) {
  if (instance.computeTimer) return;
  instance.computeTimer = setTimeout(() => {
    instance.computeTimer = null;
    applyS2(instance);
  }, 120);
}

function disconnectS2(instance) {
  if (!instance.socket) return;
  const socket = instance.socket;
  instance.socket = null;
  try { socket.close(); } catch (_) {}
}

function connectS2(instance) {
  disconnectS2(instance);
  if (!instance.settings.enabled) return;
  const symbol = instance.symbol.toLowerCase();
  const stream = `${symbol}@kline_${instance.timeframe}`;
  const socket = new WebSocket(`${S2_WS_BASE}/${stream}`);
  instance.socket = socket;

  socket.addEventListener('message', event => {
    if (instance.socket !== socket) return;
    try {
      const payload = JSON.parse(event.data);
      const k = payload.k;
      if (!k) return;
      const candle = {
        time: Math.floor(Number(k.t) / 1000),
        open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c),
        volume: Number(k.v), closeTime: Number(k.T), closed: Boolean(k.x),
      };
      if (instance.symbol === 'XAUTUSDT' && blackoutKline(candle)) return;

      const last = instance.candles[instance.candles.length - 1];
      if (!last || candle.time > last.time) {
        instance.candles.push(candle);
        if (instance.candles.length > 512) instance.candles.shift();
      } else if (candle.time === last.time) {
        instance.candles[instance.candles.length - 1] = candle;
      }
      scheduleS2(instance);
    } catch (_) {}
  });

  socket.addEventListener('close', () => {
    if (instance.socket !== socket || instance.destroyed) return;
    instance.reconnectTimer = setTimeout(() => connectS2(instance), 2500);
  });
}

async function reloadS2(instance) {
  clearTimeout(instance.reconnectTimer);
  instance.reconnectTimer = null;
  disconnectS2(instance);

  instance.symbol = s2Symbol(instance);
  instance.timeframe = s2Timeframe(instance);
  instance.signature = `${instance.symbol}|${instance.timeframe}`;

  if (!instance.settings.enabled) {
    clearS2(instance);
    return;
  }

  try {
    const url = `${S2_REST_BASE}?symbol=${encodeURIComponent(instance.symbol)}&interval=${encodeURIComponent(instance.timeframe)}&limit=512`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`S2 Binance REST ${response.status}`);
    let candles = (await response.json()).map(normalizeKline);
    if (instance.symbol === 'XAUTUSDT') candles = candles.filter(c => !blackoutKline(c));
    instance.candles = candles;
    applyS2(instance);
    connectS2(instance);
  } catch (error) {
    console.error('S2 V5.1 load failed', instance.symbol, instance.timeframe, error);
    clearS2(instance);
  }
}

function addS2Button(instance) {
  if (instance.card.querySelector('.s2-settings-button')) return;
  const toolbar = instance.card.querySelector('.chart-toolbar');
  if (!toolbar) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-button s2-settings-button';
  button.innerHTML = '<span class="fx-symbol">S2</span><span class="indicator-label"> V5.1</span>';
  button.title = 'S2 market structure / S/R / buyer-seller settings';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openS2Settings(instance);
  });
  toolbar.appendChild(button);
  instance.settingsButton = button;
}

let s2SettingsInstance = null;
let s2SettingsDraft = null;

function s2Checkbox(path, checked) {
  return `<label class="tv-checkbox"><input type="checkbox" data-s2-path="${path}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function s2Number(path, value, min, max, step) {
  return `<input class="settings-number" type="number" data-s2-path="${path}" value="${value}" min="${min}" max="${max}" step="${step}">`;
}

function s2Row(label, control, hint = '') {
  return `<label class="settings-row"><span class="settings-label">${label}${hint ? `<small>${hint}</small>` : ''}</span>${control}</label>`;
}

function ensureS2Modal() {
  if (document.getElementById('s2SettingsModal')) return;
  const modal = document.createElement('div');
  modal.id = 's2SettingsModal';
  modal.className = 'indicator-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="indicator-modal s2-settings-modal" role="dialog" aria-modal="true" aria-labelledby="s2SettingsTitle">
      <div class="indicator-modal-header">
        <h2 id="s2SettingsTitle">S2 + Market Structure V5.1</h2>
        <button class="indicator-close s2-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="indicator-modal-body s2-settings-body"></div>
      <div class="indicator-modal-footer">
        <button class="s2-defaults" type="button">Defaults</button>
        <span class="indicator-footer-spacer"></span>
        <button class="s2-cancel" type="button">Cancel</button>
        <button class="indicator-ok s2-ok" type="button">Ok</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.s2-close').addEventListener('click', closeS2Settings);
  modal.querySelector('.s2-cancel').addEventListener('click', closeS2Settings);
  modal.addEventListener('click', e => { if (e.target === modal) closeS2Settings(); });
  modal.querySelector('.s2-defaults').addEventListener('click', () => {
    s2SettingsDraft = s2Clone(S2_DEFAULTS);
    renderS2Settings();
  });
  modal.querySelector('.s2-ok').addEventListener('click', () => {
    if (!s2SettingsInstance || !s2SettingsDraft) return;
    s2SettingsInstance.settings = s2Clone(s2SettingsDraft);
    saveS2Settings(s2SettingsInstance);
    if (s2SettingsInstance.settings.enabled) {
      applyS2(s2SettingsInstance);
      if (!s2SettingsInstance.socket) connectS2(s2SettingsInstance);
    } else {
      disconnectS2(s2SettingsInstance);
      clearS2(s2SettingsInstance);
    }
    closeS2Settings();
  });
}

function renderS2Settings() {
  const body = document.querySelector('#s2SettingsModal .s2-settings-body');
  if (!body || !s2SettingsDraft) return;
  const s = s2SettingsDraft;
  body.innerHTML = `
    <section class="settings-section">
      <h3>S2 Indicator</h3>
      ${s2Row('Enable S2 V5.1', s2Checkbox('enabled', s.enabled))}
    </section>
    <section class="settings-section">
      <h3>4. Market Structure</h3>
      ${s2Row('Pivot Left', s2Number('leftBars', s.leftBars, 1, 50, 1))}
      ${s2Row('Pivot Right', s2Number('rightBars', s.rightBars, 1, 50, 1))}
      ${s2Row('Show BOS / CH', s2Checkbox('showStructureLabels', s.showStructureLabels))}
      ${s2Row('Show Last Swing High / Low', s2Checkbox('showSwingLevels', s.showSwingLevels))}
    </section>
    <section class="settings-section">
      <h3>5. S/R Wick Filter</h3>
      ${s2Row('Enable S/R Wick Filter', s2Checkbox('enableWickFilter', s.enableWickFilter))}
      ${s2Row('Minimum Wick / Body Ratio', s2Number('wickBodyRatio', s.wickBodyRatio, 0.1, 20, 0.1))}
      ${s2Row('ATR Length', s2Number('atrLength', s.atrLength, 1, 500, 1))}
      ${s2Row('S/R Zone Size × ATR', s2Number('zoneATRSize', s.zoneATRSize, 0.05, 10, 0.05))}
      ${s2Row('Show S/R Zones', s2Checkbox('showSRZones', s.showSRZones))}
    </section>
    <section class="settings-section">
      <h3>6. Buyer / Seller Pressure</h3>
      ${s2Row('Pressure Lookback', s2Number('volumeLookback', s.volumeLookback, 2, 500, 1))}
      ${s2Row('Control Threshold %', s2Number('controlThreshold', s.controlThreshold, 50, 100, 1))}
      ${s2Row('Use Buyer / Seller Filter', s2Checkbox('usePressureFilter', s.usePressureFilter))}
      ${s2Row('Show Buyer / Seller Dashboard', s2Checkbox('showDashboard', s.showDashboard))}
    </section>
    <section class="settings-section">
      <h3>7. S2 Signals</h3>
      ${s2Row('Show BUY S2 / SELL S2', s2Checkbox('showS2Labels', s.showS2Labels))}
      ${s2Row('Minimum Bars Between Signals', s2Number('minimumBarsBetweenSetups', s.minimumBarsBetweenSetups, 0, 500, 1))}
      ${s2Row('Require Matching Structure Direction', s2Checkbox('requireStructureDirection', s.requireStructureDirection))}
      <p class="settings-note">The supplied Pine model is optimized for 2-minute charts. This dashboard currently keeps its existing Binance-supported timeframe buttons; on other timeframes the model still calculates, while the dashboard shows “USE 2 MIN”.</p>
    </section>`;

  body.querySelectorAll('[data-s2-path]').forEach(control => {
    const eventName = control.type === 'checkbox' ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      s2SettingsDraft[control.dataset.s2Path] = control.type === 'checkbox' ? control.checked : Number(control.value);
    });
  });
}

function openS2Settings(instance) {
  ensureS2Modal();
  s2SettingsInstance = instance;
  s2SettingsDraft = s2Clone(instance.settings);
  renderS2Settings();
  document.getElementById('s2SettingsModal').hidden = false;
}

function closeS2Settings() {
  const modal = document.getElementById('s2SettingsModal');
  if (modal) modal.hidden = true;
  s2SettingsInstance = null;
  s2SettingsDraft = null;
}

function initializeS2Record(record, index) {
  if (!record?.chart || !record?.candleSeries || !record?.container) return null;
  const card = record.container.closest('.chart-card');
  const wrap = record.container.closest('.chart-canvas-wrap');
  if (!card || !wrap) return null;

  const instance = {
    index,
    record,
    card,
    wrap,
    settings: loadS2Settings(index),
    candles: [],
    symbol: '',
    timeframe: '',
    signature: '',
    socket: null,
    reconnectTimer: null,
    computeTimer: null,
    destroyed: false,
  };
  setupS2Series(instance);
  setupS2Overlay(instance);
  addS2Button(instance);
  S2_INSTANCES.push(instance);
  reloadS2(instance);
  return instance;
}

function startS2() {
  const initialized = new WeakSet();

  const scan = () => {
    const records = window.__stockChartRecords || [];
    records.forEach((record, index) => {
      if (initialized.has(record)) return;
      const instance = initializeS2Record(record, index);
      if (instance) initialized.add(record);
    });
  };

  scan();
  const scanTimer = setInterval(scan, 500);
  const signatureTimer = setInterval(() => {
    for (const instance of S2_INSTANCES) {
      const signature = `${s2Symbol(instance)}|${s2Timeframe(instance)}`;
      if (signature !== instance.signature) reloadS2(instance);
    }
  }, 500);

  window.addEventListener('beforeunload', () => {
    clearInterval(scanTimer);
    clearInterval(signatureTimer);
    for (const instance of S2_INSTANCES) {
      instance.destroyed = true;
      clearTimeout(instance.reconnectTimer);
      clearTimeout(instance.computeTimer);
      disconnectS2(instance);
      instance.resizeObserver?.disconnect();
    }
  });
}

startS2();
