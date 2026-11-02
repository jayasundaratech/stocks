import { createChart, CrosshairMode, LineStyle } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm';

const SYMBOLS = [
  ['BTCUSDT', 'Bitcoin / USDT'],
  ['ETHUSDT', 'Ethereum / USDT'],
  ['BNBUSDT', 'BNB / USDT'],
  ['SOLUSDT', 'Solana / USDT'],
  ['XRPUSDT', 'XRP / USDT'],
  ['DOGEUSDT', 'Dogecoin / USDT'],
  ['ADAUSDT', 'Cardano / USDT'],
].map(([symbol, name]) => ({ symbol, name }));

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const REST_BASE = 'https://api.binance.com/api/v3/klines';
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const states = [];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const DEFAULT_SETTINGS = {
  inputs: {
    showEMA9: true,
    showEMA20: true,
    showEMA50: true,
    showEMA100: true,
    showEMA200: true,
    showBB: true,
    bbLength: 20,
    bbMaType: 'SMA',
    bbSource: 'close',
    bbMult: 2,
    bbOffset: 0,
    showVWAP: true,
    hideVWAPonDWM: false,
    vwapAnchor: 'Session',
    vwapSource: 'hlc3',
    vwapOffset: 0,
    vwapCalcMode: 'Standard Deviation',
    showVWAPBand1: true,
    vwapBandMult1: 1,
    showVWAPBand2: false,
    vwapBandMult2: 2,
    showVWAPBand3: false,
    vwapBandMult3: 3,
    waitForClose: false,
  },
  style: {
    ema9:   { visible: true, color: '#2962FF', width: 1, lineStyle: 'solid' },
    ema20:  { visible: true, color: '#F23645', width: 1, lineStyle: 'solid' },
    ema50:  { visible: true, color: '#FFB300', width: 1, lineStyle: 'solid' },
    ema100: { visible: true, color: '#00BCD4', width: 1, lineStyle: 'solid' },
    ema200: { visible: true, color: '#7E57C2', width: 2, lineStyle: 'solid' },
    bbBasis:{ visible: true, color: '#2962FF', width: 1, lineStyle: 'solid' },
    bbUpper:{ visible: true, color: '#F23645', width: 1, lineStyle: 'solid' },
    bbLower:{ visible: true, color: '#089981', width: 1, lineStyle: 'solid' },
    bbBackground: { visible: true, color: '#2196F3', opacity: 0.10 },
    vwap: { visible: true, color: '#2962FF', width: 2, lineStyle: 'solid' },
    vwapUpper1: { visible: true, color: '#4CAF50', width: 1, lineStyle: 'solid' },
    vwapLower1: { visible: true, color: '#4CAF50', width: 1, lineStyle: 'solid' },
    vwapUpper2: { visible: true, color: '#9E9D24', width: 1, lineStyle: 'solid' },
    vwapLower2: { visible: true, color: '#9E9D24', width: 1, lineStyle: 'solid' },
    vwapUpper3: { visible: true, color: '#26A69A', width: 1, lineStyle: 'solid' },
    vwapLower3: { visible: true, color: '#26A69A', width: 1, lineStyle: 'solid' },
  },
  visibility: Object.fromEntries(TIMEFRAMES.map(tf => [tf, true])),
};

const STYLE_ROWS = [
  ['ema9', 'EMA 9'],
  ['ema20', 'EMA 20'],
  ['ema50', 'EMA 50'],
  ['ema100', 'EMA 100'],
  ['ema200', 'EMA 200'],
  ['bbBasis', 'BB Basis'],
  ['bbUpper', 'BB Upper'],
  ['bbLower', 'BB Lower'],
  ['vwap', 'VWAP'],
  ['vwapUpper1', 'VWAP Upper Band #1'],
  ['vwapLower1', 'VWAP Lower Band #1'],
  ['vwapUpper2', 'VWAP Upper Band #2'],
  ['vwapLower2', 'VWAP Lower Band #2'],
  ['vwapUpper3', 'VWAP Upper Band #3'],
  ['vwapLower3', 'VWAP Lower Band #3'],
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function settingsKey(index) {
  return `stocks-indicator-settings-v1-${index}`;
}

function loadSavedSettings(index) {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey(index)));
    if (!saved) return clone(DEFAULT_SETTINGS);
    return {
      inputs: { ...clone(DEFAULT_SETTINGS.inputs), ...(saved.inputs || {}) },
      style: { ...clone(DEFAULT_SETTINGS.style), ...(saved.style || {}) },
      visibility: { ...clone(DEFAULT_SETTINGS.visibility), ...(saved.visibility || {}) },
    };
  } catch (_) {
    return clone(DEFAULT_SETTINGS);
  }
}

function saveSettings(state) {
  try {
    localStorage.setItem(settingsKey(state.index), JSON.stringify(state.indicatorSettings));
  } catch (_) {}
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function normalize(row) {
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

function setStatus(state, mode, text) {
  state.status.textContent = text;
  state.badge.textContent = mode === 'live' ? 'BINANCE LIVE' : mode === 'loading' ? 'CONNECTING' : 'OFFLINE';
  state.badge.dataset.state = mode;
}

function updateMeta(state) {
  const zoom = state.priceControl.zoom.toFixed(2);
  if (!state.lastUpdateAt) {
    state.liveMeta.textContent = `Waiting for live tick… • Price zoom ${zoom}×`;
    return;
  }
  const time = new Date(state.lastUpdateAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  state.liveMeta.textContent = `Last live update: ${time} • ticks: ${state.tickCount} • Price zoom ${zoom}×`;
}

function updateHeader(state, latest) {
  if (!latest) return;
  const first = state.candles[0];
  const change = first ? latest.close - first.close : 0;
  const pct = first?.close ? (change / first.close) * 100 : 0;
  state.price.textContent = fmtPrice(latest.close);
  state.change.textContent = `${change >= 0 ? '+' : ''}${fmtPrice(change)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
  state.change.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
}

function expandedAutoscale(state, original) {
  const info = original();
  if (!info?.priceRange) return info;
  const min = info.priceRange.minValue;
  const max = info.priceRange.maxValue;
  const mid = (min + max) / 2;
  const baseHalf = Math.max((max - min) / 2, Math.abs(mid) * 1e-8, 1e-8);
  const half = baseHalf * state.priceControl.zoom;
  return { ...info, priceRange: { minValue: mid - half, maxValue: mid + half } };
}

function applyPriceZoom(state) {
  state.candleSeries.applyOptions({ autoscaleInfoProvider: state.autoscaleProvider });
  state.chart.priceScale('right').applyOptions({ autoScale: true });
  updateMeta(state);
  requestAnimationFrame(() => drawBBFill(state));
}

function resetView(state) {
  state.priceControl.zoom = 1;
  applyPriceZoom(state);
  state.chart.timeScale().fitContent();
}

function disconnect(state) {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (!state.socket) return;
  const old = state.socket;
  state.socket = null;
  try { old.close(); } catch (_) {}
}

function sourceValue(candle, source) {
  switch (source) {
    case 'open': return candle.open;
    case 'high': return candle.high;
    case 'low': return candle.low;
    case 'hl2': return (candle.high + candle.low) / 2;
    case 'hlc3': return (candle.high + candle.low + candle.close) / 3;
    case 'ohlc4': return (candle.open + candle.high + candle.low + candle.close) / 4;
    default: return candle.close;
  }
}

function ema(values, length) {
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

function sma(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

function rma(values, length) {
  const out = new Array(values.length).fill(null);
  if (values.length < length) return out;
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

function wma(values, length) {
  const out = new Array(values.length).fill(null);
  const denom = length * (length + 1) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) sum += values[i - length + 1 + j] * (j + 1);
    out[i] = sum / denom;
  }
  return out;
}

function vwma(values, volumes, length) {
  const out = new Array(values.length).fill(null);
  let pv = 0, vol = 0;
  for (let i = 0; i < values.length; i++) {
    pv += values[i] * volumes[i];
    vol += volumes[i];
    if (i >= length) {
      pv -= values[i - length] * volumes[i - length];
      vol -= volumes[i - length];
    }
    if (i >= length - 1 && vol > 0) out[i] = pv / vol;
  }
  return out;
}

function movingAverage(values, volumes, length, type) {
  switch (type) {
    case 'EMA': return ema(values, length);
    case 'SMMA (RMA)': return rma(values, length);
    case 'WMA': return wma(values, length);
    case 'VWMA': return vwma(values, volumes, length);
    default: return sma(values, length);
  }
}

function rollingStdDev(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += v;
    sumSq += v * v;
    if (i >= length) {
      const old = values[i - length];
      sum -= old;
      sumSq -= old * old;
    }
    if (i >= length - 1) {
      const mean = sum / length;
      out[i] = Math.sqrt(Math.max(0, sumSq / length - mean * mean));
    }
  }
  return out;
}

function intervalSeconds(tf) {
  return ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 })[tf] || 60;
}

function shiftedTime(candles, index, offset, tf) {
  const target = index + Number(offset || 0);
  if (target >= 0 && target < candles.length) return candles[target].time;
  return candles[index].time + Number(offset || 0) * intervalSeconds(tf);
}

function pointsFromValues(candles, values, offset, tf) {
  const points = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    points.push({ time: shiftedTime(candles, i, offset, tf), value: values[i] });
  }
  return points;
}

function anchorKey(candle, anchor) {
  const d = new Date(candle.time * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (anchor === 'Session') return `${y}-${m}-${day}`;
  if (anchor === 'Week') {
    const copy = new Date(Date.UTC(y, m, day));
    const dow = (copy.getUTCDay() + 6) % 7;
    copy.setUTCDate(copy.getUTCDate() - dow);
    return `${copy.getUTCFullYear()}-W-${copy.getUTCMonth()}-${copy.getUTCDate()}`;
  }
  if (anchor === 'Month') return `${y}-${m}`;
  if (anchor === 'Quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
  if (anchor === 'Year') return `${y}`;
  if (anchor === 'Decade') return `${Math.floor(y / 10) * 10}s`;
  if (anchor === 'Century') return `${Math.floor(y / 100) * 100}s`;
  return 'event-anchor';
}

function computeVWAP(candles, settings) {
  const src = candles.map(c => sourceValue(c, settings.vwapSource));
  const result = {
    value: new Array(candles.length).fill(null),
    upper1: new Array(candles.length).fill(null),
    lower1: new Array(candles.length).fill(null),
    upper2: new Array(candles.length).fill(null),
    lower2: new Array(candles.length).fill(null),
    upper3: new Array(candles.length).fill(null),
    lower3: new Array(candles.length).fill(null),
  };
  let lastKey = null;
  let sumV = 0, sumPV = 0, sumPV2 = 0;
  for (let i = 0; i < candles.length; i++) {
    const key = anchorKey(candles[i], settings.vwapAnchor);
    if (i === 0 || key !== lastKey) {
      sumV = 0; sumPV = 0; sumPV2 = 0;
      lastKey = key;
    }
    const vol = Math.max(0, candles[i].volume || 0);
    const value = src[i];
    sumV += vol;
    sumPV += value * vol;
    sumPV2 += value * value * vol;
    if (sumV <= 0) continue;
    const vwap = sumPV / sumV;
    const variance = Math.max(0, sumPV2 / sumV - vwap * vwap);
    const stdev = Math.sqrt(variance);
    const basis = settings.vwapCalcMode === 'Percentage' ? Math.abs(vwap) * 0.01 : stdev;
    result.value[i] = vwap;
    result.upper1[i] = vwap + basis * settings.vwapBandMult1;
    result.lower1[i] = vwap - basis * settings.vwapBandMult1;
    result.upper2[i] = vwap + basis * settings.vwapBandMult2;
    result.lower2[i] = vwap - basis * settings.vwapBandMult2;
    result.upper3[i] = vwap + basis * settings.vwapBandMult3;
    result.lower3[i] = vwap - basis * settings.vwapBandMult3;
  }
  return result;
}

function computeIndicators(state) {
  const inputs = state.indicatorSettings.inputs;
  let candles = state.candles;
  if (inputs.waitForClose && candles.length && !candles[candles.length - 1].closed) {
    candles = candles.slice(0, -1);
  }
  if (!candles.length) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const bbSourceValues = candles.map(c => sourceValue(c, inputs.bbSource));

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);
  const ema200 = ema(closes, 200);

  const bbBasis = movingAverage(bbSourceValues, volumes, inputs.bbLength, inputs.bbMaType);
  const bbDev = rollingStdDev(bbSourceValues, inputs.bbLength);
  const bbUpper = bbBasis.map((v, i) => Number.isFinite(v) && Number.isFinite(bbDev[i]) ? v + inputs.bbMult * bbDev[i] : null);
  const bbLower = bbBasis.map((v, i) => Number.isFinite(v) && Number.isFinite(bbDev[i]) ? v - inputs.bbMult * bbDev[i] : null);

  const vwap = computeVWAP(candles, inputs);

  return {
    candles,
    ema9: pointsFromValues(candles, ema9, 0, state.timeframe),
    ema20: pointsFromValues(candles, ema20, 0, state.timeframe),
    ema50: pointsFromValues(candles, ema50, 0, state.timeframe),
    ema100: pointsFromValues(candles, ema100, 0, state.timeframe),
    ema200: pointsFromValues(candles, ema200, 0, state.timeframe),
    bbBasis: pointsFromValues(candles, bbBasis, inputs.bbOffset, state.timeframe),
    bbUpper: pointsFromValues(candles, bbUpper, inputs.bbOffset, state.timeframe),
    bbLower: pointsFromValues(candles, bbLower, inputs.bbOffset, state.timeframe),
    vwap: pointsFromValues(candles, vwap.value, inputs.vwapOffset, state.timeframe),
    vwapUpper1: pointsFromValues(candles, vwap.upper1, inputs.vwapOffset, state.timeframe),
    vwapLower1: pointsFromValues(candles, vwap.lower1, inputs.vwapOffset, state.timeframe),
    vwapUpper2: pointsFromValues(candles, vwap.upper2, inputs.vwapOffset, state.timeframe),
    vwapLower2: pointsFromValues(candles, vwap.lower2, inputs.vwapOffset, state.timeframe),
    vwapUpper3: pointsFromValues(candles, vwap.upper3, inputs.vwapOffset, state.timeframe),
    vwapLower3: pointsFromValues(candles, vwap.lower3, inputs.vwapOffset, state.timeframe),
  };
}

function lwLineStyle(style) {
  if (style === 'dashed') return LineStyle.Dashed;
  if (style === 'dotted') return LineStyle.Dotted;
  return LineStyle.Solid;
}

function setSeries(state, key, data, visible) {
  const style = state.indicatorSettings.style[key];
  const series = state.indicatorSeries[key];
  if (!series || !style) return;
  series.applyOptions({
    color: style.color,
    lineWidth: Number(style.width || 1),
    lineStyle: lwLineStyle(style.lineStyle),
  });
  series.setData(visible && style.visible ? data : []);
}

function applyIndicators(state) {
  if (!state.indicatorSeries) return;
  const settings = state.indicatorSettings;
  const allowed = settings.visibility[state.timeframe] !== false;
  const inputs = settings.inputs;

  if (!allowed || !state.candles.length) {
    Object.values(state.indicatorSeries).forEach(series => series.setData([]));
    state.indicatorComputed = null;
    drawBBFill(state);
    return;
  }

  const computed = computeIndicators(state);
  if (!computed) return;
  state.indicatorComputed = computed;

  setSeries(state, 'ema9', computed.ema9, inputs.showEMA9);
  setSeries(state, 'ema20', computed.ema20, inputs.showEMA20);
  setSeries(state, 'ema50', computed.ema50, inputs.showEMA50);
  setSeries(state, 'ema100', computed.ema100, inputs.showEMA100);
  setSeries(state, 'ema200', computed.ema200, inputs.showEMA200);

  setSeries(state, 'bbBasis', computed.bbBasis, inputs.showBB);
  setSeries(state, 'bbUpper', computed.bbUpper, inputs.showBB);
  setSeries(state, 'bbLower', computed.bbLower, inputs.showBB);

  const hideVWAPForTF = inputs.hideVWAPonDWM && state.timeframe === '1d';
  const showVWAP = inputs.showVWAP && !hideVWAPForTF;
  setSeries(state, 'vwap', computed.vwap, showVWAP);
  setSeries(state, 'vwapUpper1', computed.vwapUpper1, showVWAP && inputs.showVWAPBand1);
  setSeries(state, 'vwapLower1', computed.vwapLower1, showVWAP && inputs.showVWAPBand1);
  setSeries(state, 'vwapUpper2', computed.vwapUpper2, showVWAP && inputs.showVWAPBand2);
  setSeries(state, 'vwapLower2', computed.vwapLower2, showVWAP && inputs.showVWAPBand2);
  setSeries(state, 'vwapUpper3', computed.vwapUpper3, showVWAP && inputs.showVWAPBand3);
  setSeries(state, 'vwapLower3', computed.vwapLower3, showVWAP && inputs.showVWAPBand3);

  requestAnimationFrame(() => drawBBFill(state));
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || '#2196F3').replace('#', '');
  const normalized = clean.length === 3 ? clean.split('').map(x => x + x).join('') : clean;
  const n = Number.parseInt(normalized, 16);
  if (!Number.isFinite(n)) return `rgba(33,150,243,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawBBFill(state) {
  const path = state.bbFillPath;
  if (!path) return;
  const settings = state.indicatorSettings;
  const style = settings.style.bbBackground;
  const computed = state.indicatorComputed;
  const shouldShow = settings.visibility[state.timeframe] !== false &&
    settings.inputs.showBB && style.visible && computed?.bbUpper?.length && computed?.bbLower?.length;

  if (!shouldShow) {
    path.setAttribute('d', '');
    return;
  }

  const upperByTime = new Map(computed.bbUpper.map(p => [p.time, p.value]));
  const lowerByTime = new Map(computed.bbLower.map(p => [p.time, p.value]));
  const upperPts = [];
  const lowerPts = [];

  for (const [time, upper] of upperByTime.entries()) {
    if (!lowerByTime.has(time)) continue;
    const x = state.chart.timeScale().timeToCoordinate(time);
    const yu = state.candleSeries.priceToCoordinate(upper);
    const yl = state.candleSeries.priceToCoordinate(lowerByTime.get(time));
    if (![x, yu, yl].every(Number.isFinite)) continue;
    upperPts.push([x, yu]);
    lowerPts.push([x, yl]);
  }

  if (upperPts.length < 2) {
    path.setAttribute('d', '');
    return;
  }

  const d = [
    `M ${upperPts[0][0]} ${upperPts[0][1]}`,
    ...upperPts.slice(1).map(p => `L ${p[0]} ${p[1]}`),
    ...lowerPts.reverse().map(p => `L ${p[0]} ${p[1]}`),
    'Z',
  ].join(' ');

  path.setAttribute('d', d);
  path.setAttribute('fill', hexToRgba(style.color, Number(style.opacity ?? 0.10)));
}

function createIndicatorSeries(state) {
  const chart = state.chart;
  const make = key => {
    const style = state.indicatorSettings.style[key];
    return chart.addLineSeries({
      color: style.color,
      lineWidth: style.width,
      lineStyle: lwLineStyle(style.lineStyle),
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
  };
  state.indicatorSeries = {};
  for (const [key] of STYLE_ROWS) state.indicatorSeries[key] = make(key);
}

function setupBBFill(state, wrap) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('indicator-fill-layer');
  const path = document.createElementNS(ns, 'path');
  svg.appendChild(path);
  wrap.appendChild(svg);
  state.bbFillSvg = svg;
  state.bbFillPath = path;

  const resize = () => {
    const rect = state.host.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
    svg.setAttribute('width', String(Math.max(1, rect.width)));
    svg.setAttribute('height', String(Math.max(1, rect.height)));
    drawBBFill(state);
  };
  state.bbFillResize = resize;
  state.chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(() => drawBBFill(state)));
  resize();
}

function connect(state) {
  disconnect(state);
  const stream = `${state.symbolInfo.symbol.toLowerCase()}@kline_${state.timeframe}`;
  const socket = new WebSocket(`${WS_BASE}/${stream}`);
  state.socket = socket;
  setStatus(state, 'loading', 'Connecting to Binance WebSocket…');

  socket.addEventListener('open', () => {
    if (state.socket !== socket) return;
    setStatus(state, 'live', 'LIVE • drag chart to pan • use right price scale to zoom');
  });

  socket.addEventListener('message', event => {
    if (state.socket !== socket) return;
    try {
      const payload = JSON.parse(event.data);
      const k = payload.k;
      if (!k) return;
      const candle = {
        time: Math.floor(Number(k.t) / 1000),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
        closeTime: Number(k.T),
        closed: Boolean(k.x),
      };

      const last = state.candles[state.candles.length - 1];
      if (!last || candle.time > last.time) {
        state.candles.push(candle);
        if (state.candles.length > 500) state.candles.shift();
      } else if (candle.time === last.time) {
        state.candles[state.candles.length - 1] = candle;
      }

      state.candleSeries.update(candle);
      state.volumeSeries.update({
        time: candle.time,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(24,185,129,.55)' : 'rgba(239,83,80,.55)',
      });

      state.lastUpdateAt = Date.now();
      state.tickCount += 1;
      updateMeta(state);
      updateHeader(state, candle);
      applyIndicators(state);
    } catch (error) {
      console.error(error);
    }
  });

  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    setStatus(state, 'offline', 'Disconnected • reconnecting…');
    state.reconnectTimer = setTimeout(() => connect(state), 2500);
  });

  socket.addEventListener('error', () => {
    if (state.socket !== socket) return;
    setStatus(state, 'offline', 'WebSocket error');
  });
}

async function load(state, reset = true) {
  disconnect(state);
  state.tickCount = 0;
  state.lastUpdateAt = null;
  if (reset) state.priceControl.zoom = 1;
  updateMeta(state);
  setStatus(state, 'loading', 'Loading Binance candles…');

  try {
    const url = `${REST_BASE}?symbol=${state.symbolInfo.symbol}&interval=${state.timeframe}&limit=500`;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Binance REST ${response.status}`);
    state.candles = (await response.json()).map(normalize);

    state.candleSeries.setData(state.candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    state.volumeSeries.setData(state.candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(24,185,129,.55)' : 'rgba(239,83,80,.55)',
    })));

    applyPriceZoom(state);
    updateHeader(state, state.candles[state.candles.length - 1]);
    applyIndicators(state);
    if (reset) state.chart.timeScale().fitContent();
    connect(state);
  } catch (error) {
    console.error(error);
    setStatus(state, 'offline', error.message || 'Unable to load Binance data');
  }
}

function fillMenu(state) {
  state.menu.innerHTML = '';
  SYMBOLS.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'symbol-item';
    button.innerHTML = `<strong>${item.symbol}</strong><small>${item.name}</small>`;
    button.addEventListener('click', () => {
      state.symbolInfo = item;
      state.input.value = item.symbol;
      state.ticker.textContent = item.symbol;
      state.name.textContent = item.name;
      state.menu.classList.remove('open');
      load(state, true);
    });
    state.menu.appendChild(button);
  });
}

function installPriceAxisControl(state, wrap) {
  const axis = document.createElement('div');
  axis.className = 'price-axis-control';
  axis.title = 'Drag up/down to zoom price range. Double-click to reset.';
  Object.assign(axis.style, {
    position: 'absolute', right: '0.25rem', top: '0.15rem', bottom: '0.3rem', width: '88px',
    zIndex: '8', cursor: 'ns-resize', background: 'transparent', touchAction: 'none', userSelect: 'none',
  });
  wrap.appendChild(axis);

  let drag = null;
  axis.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { pointerId: event.pointerId, startY: event.clientY, startZoom: state.priceControl.zoom };
    axis.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  axis.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dy = event.clientY - drag.startY;
    state.priceControl.zoom = clamp(drag.startZoom * Math.exp(dy * 0.008), 0.2, 25);
    applyPriceZoom(state);
    event.preventDefault();
  });
  const stop = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    try { axis.releasePointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  };
  axis.addEventListener('pointerup', stop);
  axis.addEventListener('pointercancel', stop);
  axis.addEventListener('dblclick', event => {
    state.priceControl.zoom = 1;
    applyPriceZoom(state);
    event.preventDefault();
  });
  axis.addEventListener('wheel', event => {
    state.priceControl.zoom = clamp(state.priceControl.zoom * Math.exp(event.deltaY * 0.0015), 0.2, 25);
    applyPriceZoom(state);
    event.preventDefault();
  }, { passive: false });
  state.axisControl = axis;
}

function addIndicatorButton(state, toolbar) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'control-button indicator-button';
  button.innerHTML = '<span class="fx-symbol">ƒx</span><span class="indicator-label"> EMA + BB + VWAP</span>';
  button.title = 'EMA + BB + VWAP settings';
  button.addEventListener('click', event => {
    event.stopPropagation();
    openIndicatorSettings(state);
  });
  toolbar.appendChild(button);
}

function makeCard(card, index) {
  const symbolInfo = SYMBOLS[index % SYMBOLS.length];
  const timeframe = TIMEFRAMES[index === 0 ? 0 : index % 4];
  card.innerHTML = `
    <div class="chart-toolbar">
      <div class="symbol-search-wrap">
        <input class="symbol-search" value="${symbolInfo.symbol}" readonly aria-label="Select Binance crypto symbol" />
        <div class="symbol-menu"></div>
      </div>
      <div class="timeframe-buttons"></div>
      <button class="control-button reset-view" type="button" title="Reset chart view">⌂</button>
      <button class="control-button reconnect" type="button" title="Reconnect to Binance">↻</button>
    </div>
    <div class="chart-meta">
      <span class="ticker">${symbolInfo.symbol}</span>
      <span class="name">${symbolInfo.name}</span>
      <span class="price">--</span>
      <span class="change"></span>
    </div>
    <div class="live-meta"></div>
    <div class="chart-canvas-wrap">
      <div class="chart-host"></div>
      <span class="chart-badge">CONNECTING</span>
      <span class="chart-status"></span>
    </div>`;

  const toolbar = card.querySelector('.chart-toolbar');
  const wrap = card.querySelector('.chart-canvas-wrap');
  const host = card.querySelector('.chart-host');
  const chart = createChart(host, {
    width: host.clientWidth,
    height: host.clientHeight,
    layout: { background: { color: '#0d1425' }, textColor: '#91a0bd' },
    grid: { vertLines: { color: '#25304a' }, horzLines: { color: '#25304a' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      visible: true,
      autoScale: true,
      borderVisible: true,
      borderColor: '#26324d',
      ticksVisible: true,
      minimumWidth: 86,
      scaleMargins: { top: 0.08, bottom: 0.28 },
    },
    timeScale: {
      borderColor: '#26324d', timeVisible: true, secondsVisible: false, rightOffset: 6,
    },
    handleScroll: {
      mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: true, pinch: true,
      axisPressedMouseMove: { time: true, price: false },
      axisDoubleClickReset: { time: true, price: false },
    },
  });

  const state = {
    index, card, chart, host, symbolInfo, timeframe,
    candles: [], socket: null, reconnectTimer: null,
    tickCount: 0, lastUpdateAt: null,
    priceControl: { zoom: 1 },
    indicatorSettings: loadSavedSettings(index),
    input: card.querySelector('.symbol-search'),
    menu: card.querySelector('.symbol-menu'),
    ticker: card.querySelector('.ticker'),
    name: card.querySelector('.name'),
    price: card.querySelector('.price'),
    change: card.querySelector('.change'),
    liveMeta: card.querySelector('.live-meta'),
    badge: card.querySelector('.chart-badge'),
    status: card.querySelector('.chart-status'),
    buttons: card.querySelector('.timeframe-buttons'),
  };

  state.autoscaleProvider = original => expandedAutoscale(state, original);
  state.candleSeries = chart.addCandlestickSeries({
    upColor: '#18b981', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#18b981', wickDownColor: '#ef5350',
    priceLineVisible: true, lastValueVisible: true,
    autoscaleInfoProvider: state.autoscaleProvider,
  });

  state.volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    priceLineVisible: false,
    lastValueVisible: false,
  });
  state.volumeSeries.priceScale().applyOptions({
    scaleMargins: { top: 0.80, bottom: 0 },
  });

  createIndicatorSeries(state);
  setupBBFill(state, wrap);

  TIMEFRAMES.forEach(tf => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `control-button ${tf === timeframe ? 'active' : ''}`;
    button.textContent = tf;
    button.addEventListener('click', () => {
      state.timeframe = tf;
      [...state.buttons.children].forEach(item => item.classList.toggle('active', item.textContent === tf));
      load(state, true);
    });
    state.buttons.appendChild(button);
  });

  addIndicatorButton(state, toolbar);
  fillMenu(state);
  installPriceAxisControl(state, wrap);

  state.input.addEventListener('click', () => state.menu.classList.toggle('open'));
  card.querySelector('.reset-view').addEventListener('click', () => resetView(state));
  card.querySelector('.reconnect').addEventListener('click', () => load(state, false));
  card.addEventListener('click', () => {
    document.querySelectorAll('.chart-card').forEach(item => item.classList.remove('active'));
    card.classList.add('active');
  });

  const observer = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    if (rect.width < 2 || rect.height < 2) return;
    chart.applyOptions({ width: rect.width, height: rect.height });
    state.bbFillResize?.();
  });
  observer.observe(host);
  state.observer = observer;

  states.push(state);
  updateMeta(state);
  load(state, true);
}

function resizeVisibleCharts() {
  states.forEach(state => {
    if (state.card.hidden || getComputedStyle(state.card).display === 'none') return;
    const rect = state.host.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    state.chart.applyOptions({ width: rect.width, height: rect.height });
    state.bbFillResize?.();
  });
}

function setLayout(layout) {
  const value = ['1', '2', '3', '4'].includes(String(layout)) ? String(layout) : '4';
  const count = Number(value);
  const grid = document.getElementById('dashboardGrid');

  grid.classList.remove('layout-1', 'layout-2', 'layout-3', 'layout-4');
  grid.classList.add(`layout-${value}`);
  grid.dataset.layout = value;

  states.forEach((state, index) => {
    const visible = index < count;
    state.card.hidden = !visible;
    state.card.style.display = visible ? 'flex' : 'none';
  });

  document.querySelectorAll('.layout-button').forEach(button => {
    const active = button.dataset.layout === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  const triggerIcon = document.querySelector('.layout-trigger .layout-icon');
  if (triggerIcon) triggerIcon.className = `layout-icon icon-${value}`;
  document.querySelector('.layout-dropdown')?.removeAttribute('open');

  requestAnimationFrame(() => {
    resizeVisibleCharts();
    requestAnimationFrame(resizeVisibleCharts);
  });
  setTimeout(resizeVisibleCharts, 120);
}

let settingsState = null;
let settingsDraft = null;
let settingsTab = 'inputs';

function ensureSettingsModal() {
  if (document.getElementById('indicatorSettingsModal')) return;
  const modal = document.createElement('div');
  modal.id = 'indicatorSettingsModal';
  modal.className = 'indicator-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="indicator-modal" role="dialog" aria-modal="true" aria-labelledby="indicatorSettingsTitle">
      <div class="indicator-modal-header">
        <h2 id="indicatorSettingsTitle">EMA + BB + VWAP</h2>
        <button class="indicator-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="indicator-tabs">
        <button type="button" data-tab="inputs" class="active">Inputs</button>
        <button type="button" data-tab="style">Style</button>
        <button type="button" data-tab="visibility">Visibility</button>
      </div>
      <div class="indicator-modal-body"></div>
      <div class="indicator-modal-footer">
        <button class="indicator-defaults" type="button">Defaults</button>
        <span class="indicator-footer-spacer"></span>
        <button class="indicator-cancel" type="button">Cancel</button>
        <button class="indicator-ok" type="button">Ok</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('.indicator-close').addEventListener('click', closeIndicatorSettings);
  modal.querySelector('.indicator-cancel').addEventListener('click', closeIndicatorSettings);
  modal.addEventListener('click', event => {
    if (event.target === modal) closeIndicatorSettings();
  });

  modal.querySelectorAll('.indicator-tabs button').forEach(button => {
    button.addEventListener('click', () => {
      settingsTab = button.dataset.tab;
      modal.querySelectorAll('.indicator-tabs button').forEach(b => b.classList.toggle('active', b === button));
      renderSettingsBody();
    });
  });

  modal.querySelector('.indicator-defaults').addEventListener('click', () => {
    settingsDraft = clone(DEFAULT_SETTINGS);
    renderSettingsBody();
  });

  modal.querySelector('.indicator-ok').addEventListener('click', () => {
    if (!settingsState || !settingsDraft) return;
    settingsState.indicatorSettings = clone(settingsDraft);
    saveSettings(settingsState);
    applyIndicators(settingsState);
    closeIndicatorSettings();
  });
}

function openIndicatorSettings(state) {
  ensureSettingsModal();
  settingsState = state;
  settingsDraft = clone(state.indicatorSettings);
  settingsTab = 'inputs';
  const modal = document.getElementById('indicatorSettingsModal');
  modal.querySelectorAll('.indicator-tabs button').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === 'inputs');
  });
  renderSettingsBody();
  modal.hidden = false;
}

function closeIndicatorSettings() {
  const modal = document.getElementById('indicatorSettingsModal');
  if (modal) modal.hidden = true;
  settingsState = null;
  settingsDraft = null;
}

function fieldRow(label, control, hint = '') {
  return `<label class="settings-row"><span class="settings-label">${label}${hint ? `<small>${hint}</small>` : ''}</span>${control}</label>`;
}

function checkbox(path, checked, label = '') {
  return `<label class="tv-checkbox"><input type="checkbox" data-path="${path}" ${checked ? 'checked' : ''}><span></span>${label}</label>`;
}

function numberInput(path, value, min = '', max = '', step = '1') {
  return `<input class="settings-number" type="number" data-path="${path}" value="${value}" ${min !== '' ? `min="${min}"` : ''} ${max !== '' ? `max="${max}"` : ''} step="${step}">`;
}

function selectInput(path, value, options) {
  return `<select class="settings-select" data-path="${path}">${options.map(option =>
    `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
}

function renderInputs(settings) {
  const i = settings.inputs;
  return `
    <section class="settings-section">
      <h3>EMA Settings</h3>
      ${fieldRow('Show EMA 9', checkbox('inputs.showEMA9', i.showEMA9))}
      ${fieldRow('Show EMA 20', checkbox('inputs.showEMA20', i.showEMA20))}
      ${fieldRow('Show EMA 50', checkbox('inputs.showEMA50', i.showEMA50))}
      ${fieldRow('Show EMA 100', checkbox('inputs.showEMA100', i.showEMA100))}
      ${fieldRow('Show EMA 200', checkbox('inputs.showEMA200', i.showEMA200))}
    </section>
    <section class="settings-section">
      <h3>Bollinger Bands Settings</h3>
      ${fieldRow('Show Bollinger Bands', checkbox('inputs.showBB', i.showBB))}
      ${fieldRow('Length', numberInput('inputs.bbLength', i.bbLength, 1, 500, 1))}
      ${fieldRow('Basis MA Type', selectInput('inputs.bbMaType', i.bbMaType, ['SMA','EMA','SMMA (RMA)','WMA','VWMA']))}
      ${fieldRow('Source', selectInput('inputs.bbSource', i.bbSource, ['close','open','high','low','hl2','hlc3','ohlc4']))}
      ${fieldRow('StdDev', numberInput('inputs.bbMult', i.bbMult, 0.001, 50, 0.1))}
      ${fieldRow('Offset', numberInput('inputs.bbOffset', i.bbOffset, -500, 500, 1))}
    </section>
    <section class="settings-section">
      <h3>VWAP Settings</h3>
      ${fieldRow('Show VWAP', checkbox('inputs.showVWAP', i.showVWAP))}
      ${fieldRow('Hide VWAP on 1D or Above', checkbox('inputs.hideVWAPonDWM', i.hideVWAPonDWM))}
      ${fieldRow('Anchor Period', selectInput('inputs.vwapAnchor', i.vwapAnchor, ['Session','Week','Month','Quarter','Year','Decade','Century','Earnings','Dividends','Splits']))}
      ${fieldRow('Source', selectInput('inputs.vwapSource', i.vwapSource, ['hlc3','close','open','high','low','hl2','ohlc4']))}
      ${fieldRow('Offset', numberInput('inputs.vwapOffset', i.vwapOffset, -500, 500, 1))}
    </section>
    <section class="settings-section">
      <h3>VWAP Bands Settings</h3>
      ${fieldRow('Bands Calculation Mode', selectInput('inputs.vwapCalcMode', i.vwapCalcMode, ['Standard Deviation','Percentage']))}
      ${fieldRow('Show Band #1', checkbox('inputs.showVWAPBand1', i.showVWAPBand1))}
      ${fieldRow('Bands Multiplier #1', numberInput('inputs.vwapBandMult1', i.vwapBandMult1, 0, 100, 0.5))}
      ${fieldRow('Show Band #2', checkbox('inputs.showVWAPBand2', i.showVWAPBand2))}
      ${fieldRow('Bands Multiplier #2', numberInput('inputs.vwapBandMult2', i.vwapBandMult2, 0, 100, 0.5))}
      ${fieldRow('Show Band #3', checkbox('inputs.showVWAPBand3', i.showVWAPBand3))}
      ${fieldRow('Bands Multiplier #3', numberInput('inputs.vwapBandMult3', i.vwapBandMult3, 0, 100, 0.5))}
    </section>
    <section class="settings-section">
      <h3>Calculation</h3>
      ${fieldRow('Timeframe', '<select class="settings-select" disabled><option>Chart</option></select>')}
      ${fieldRow('Wait for timeframe closes', checkbox('inputs.waitForClose', i.waitForClose))}
      <p class="settings-note">Earnings, Dividends and Splits anchors have no corporate-event resets for Binance crypto pairs, so they remain anchored from the first loaded bar.</p>
    </section>`;
}

function renderStyle(settings) {
  const rows = STYLE_ROWS.map(([key, label]) => {
    const s = settings.style[key];
    return `<div class="style-row">
      ${checkbox(`style.${key}.visible`, s.visible)}
      <span class="style-name">${label}</span>
      <input class="style-color" type="color" data-path="style.${key}.color" value="${s.color}">
      ${selectInput(`style.${key}.width`, String(s.width), ['1','2','3','4'])}
      ${selectInput(`style.${key}.lineStyle`, s.lineStyle, ['solid','dashed','dotted'])}
    </div>`;
  }).join('');

  const bg = settings.style.bbBackground;
  return `${rows}
    <div class="style-row">
      ${checkbox('style.bbBackground.visible', bg.visible)}
      <span class="style-name">BB Background</span>
      <input class="style-color" type="color" data-path="style.bbBackground.color" value="${bg.color}">
      <input class="settings-number opacity-input" type="number" data-path="style.bbBackground.opacity" value="${bg.opacity}" min="0" max="0.5" step="0.05" title="Opacity">
    </div>`;
}

function renderVisibility(settings) {
  return `<section class="settings-section visibility-section">
    <h3>Show indicator on</h3>
    ${TIMEFRAMES.map(tf => fieldRow(tf, checkbox(`visibility.${tf}`, settings.visibility[tf] !== false))).join('')}
  </section>`;
}

function setByPath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
  target[parts[parts.length - 1]] = value;
}

function renderSettingsBody() {
  const modal = document.getElementById('indicatorSettingsModal');
  if (!modal || !settingsDraft) return;
  const body = modal.querySelector('.indicator-modal-body');
  body.innerHTML = settingsTab === 'style'
    ? renderStyle(settingsDraft)
    : settingsTab === 'visibility'
      ? renderVisibility(settingsDraft)
      : renderInputs(settingsDraft);

  body.querySelectorAll('[data-path]').forEach(control => {
    const eventName = control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input';
    control.addEventListener(eventName, () => {
      let value;
      if (control.type === 'checkbox') value = control.checked;
      else if (control.type === 'number') value = Number(control.value);
      else value = control.value;
      setByPath(settingsDraft, control.dataset.path, value);
    });
  });
}

document.querySelectorAll('.chart-card').forEach(makeCard);
document.querySelectorAll('.layout-button').forEach(button => {
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setLayout(button.dataset.layout);
  });
});
setLayout(document.getElementById('dashboardGrid')?.dataset.layout || '4');

document.addEventListener('click', event => {
  states.forEach(state => {
    if (!state.card.contains(event.target)) state.menu.classList.remove('open');
  });
});

document.getElementById('resetAll').addEventListener('click', () => states.forEach(resetView));
setInterval(() => states.forEach(updateMeta), 1000);

window.addEventListener('beforeunload', () => states.forEach(state => {
  disconnect(state);
  state.observer?.disconnect();
  state.chart?.remove();
}));
