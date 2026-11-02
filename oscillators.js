import { createChart, CrosshairMode, LineStyle } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm?oscillator-panes=1';

const REST_BASE = 'https://api.binance.com/api/v3/klines';
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const states = [];
let syncingCrosshair = false;

const DEFAULTS = {
  stoch: {
    smoothK: 3,
    smoothD: 3,
    lengthRSI: 14,
    lengthStoch: 14,
    source: 'close',
    colorK: '#2962FF',
    colorD: '#FF6D00',
    upper: 80,
    middle: 50,
    lower: 20,
    bandColor: '#2196F3',
  },
  rsi: {
    length: 14,
    source: 'close',
    calculateDivergence: false,
    color: '#7E57C2',
    upper: 70,
    middle: 50,
    lower: 30,
    bandColor: '#7E57C2',
    maType: 'SMA',
    maLength: 14,
    bbMult: 2,
    maColor: '#F4D03F',
    bbColor: '#4CAF50',
  },
};

const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => Number.isFinite(value);

function storageKey(index) {
  return `stocks-oscillator-settings-v1-${index}`;
}

function loadSettings(index) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(index)) || 'null');
    if (!saved) return clone(DEFAULTS);
    return {
      stoch: { ...clone(DEFAULTS.stoch), ...(saved.stoch || {}) },
      rsi: { ...clone(DEFAULTS.rsi), ...(saved.rsi || {}) },
    };
  } catch (_) {
    return clone(DEFAULTS);
  }
}

function saveSettings(state) {
  try {
    localStorage.setItem(storageKey(state.index), JSON.stringify(state.settings));
  } catch (_) {}
}

function normalize(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
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

function rma(values, length) {
  const out = new Array(values.length).fill(null);
  if (values.length < length || length < 1) return out;
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

function calcRSI(values, length) {
  const out = new Array(values.length).fill(null);
  if (values.length <= length || length < 1) return out;

  const gains = new Array(values.length - 1);
  const losses = new Array(values.length - 1);
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    gains[i - 1] = Math.max(change, 0);
    losses[i - 1] = Math.max(-change, 0);
  }

  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  for (let i = length; i < values.length; i++) {
    const up = avgGain[i - 1];
    const down = avgLoss[i - 1];
    if (!finite(up) || !finite(down)) continue;
    out[i] = down === 0 ? 100 : up === 0 ? 0 : 100 - (100 / (1 + up / down));
  }
  return out;
}

function smaNullable(values, length) {
  const out = new Array(values.length).fill(null);
  if (length < 1) return out;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      if (!finite(values[j])) { ok = false; break; }
      sum += values[j];
    }
    if (ok) out[i] = sum / length;
  }
  return out;
}

function emaNullable(values, length) {
  const out = new Array(values.length).fill(null);
  const validStart = values.findIndex(finite);
  if (validStart < 0) return out;
  const alpha = 2 / (length + 1);
  let value = values[validStart];
  out[validStart] = value;
  for (let i = validStart + 1; i < values.length; i++) {
    if (!finite(values[i])) continue;
    value = alpha * values[i] + (1 - alpha) * value;
    out[i] = value;
  }
  return out;
}

function rmaNullable(values, length) {
  const out = new Array(values.length).fill(null);
  const start = values.findIndex(finite);
  if (start < 0 || start + length > values.length) return out;
  let seed = 0;
  for (let i = start; i < start + length; i++) {
    if (!finite(values[i])) return out;
    seed += values[i];
  }
  let value = seed / length;
  out[start + length - 1] = value;
  for (let i = start + length; i < values.length; i++) {
    if (!finite(values[i])) continue;
    value = (value * (length - 1) + values[i]) / length;
    out[i] = value;
  }
  return out;
}

function wmaNullable(values, length) {
  const out = new Array(values.length).fill(null);
  const denom = length * (length + 1) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = 0; j < length; j++) {
      const value = values[i - length + 1 + j];
      if (!finite(value)) { ok = false; break; }
      sum += value * (j + 1);
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

function vwmaNullable(values, volumes, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    let pv = 0;
    let vol = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      if (!finite(values[j])) { ok = false; break; }
      pv += values[j] * volumes[j];
      vol += volumes[j];
    }
    if (ok && vol > 0) out[i] = pv / vol;
  }
  return out;
}

function movingAverageNullable(values, volumes, length, type) {
  switch (type) {
    case 'EMA': return emaNullable(values, length);
    case 'SMMA (RMA)': return rmaNullable(values, length);
    case 'WMA': return wmaNullable(values, length);
    case 'VWMA': return vwmaNullable(values, volumes, length);
    default: return smaNullable(values, length);
  }
}

function rollingStdNullable(values, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    let sumSq = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      const value = values[j];
      if (!finite(value)) { ok = false; break; }
      sum += value;
      sumSq += value * value;
    }
    if (!ok) continue;
    const mean = sum / length;
    out[i] = Math.sqrt(Math.max(0, sumSq / length - mean * mean));
  }
  return out;
}

function calcStochRSI(values, settings) {
  const rsi = calcRSI(values, settings.lengthRSI);
  const raw = new Array(values.length).fill(null);
  for (let i = 0; i < rsi.length; i++) {
    const start = i - settings.lengthStoch + 1;
    if (start < 0) continue;
    let low = Infinity;
    let high = -Infinity;
    let ok = true;
    for (let j = start; j <= i; j++) {
      if (!finite(rsi[j])) { ok = false; break; }
      low = Math.min(low, rsi[j]);
      high = Math.max(high, rsi[j]);
    }
    if (!ok) continue;
    raw[i] = high === low ? 0 : 100 * (rsi[i] - low) / (high - low);
  }
  const k = smaNullable(raw, settings.smoothK);
  const d = smaNullable(k, settings.smoothD);
  return { rsi, raw, k, d };
}

function calcDivergence(candles, rsi, enabled) {
  if (!enabled) return [];
  const left = 5;
  const right = 5;
  const minDistance = 5;
  const maxDistance = 60;
  const lows = [];
  const highs = [];
  const markers = [];

  const isPivotLow = p => {
    if (!finite(rsi[p])) return false;
    for (let i = p - left; i <= p + right; i++) {
      if (i === p || i < 0 || i >= rsi.length || !finite(rsi[i])) continue;
      if (rsi[i] < rsi[p]) return false;
    }
    return true;
  };
  const isPivotHigh = p => {
    if (!finite(rsi[p])) return false;
    for (let i = p - left; i <= p + right; i++) {
      if (i === p || i < 0 || i >= rsi.length || !finite(rsi[i])) continue;
      if (rsi[i] > rsi[p]) return false;
    }
    return true;
  };

  for (let p = left; p < rsi.length - right; p++) {
    if (isPivotLow(p)) {
      const previous = lows[lows.length - 1];
      if (previous) {
        const distance = p - previous.index;
        const bull = distance >= minDistance && distance <= maxDistance &&
          rsi[p] > rsi[previous.index] && candles[p].low < candles[previous.index].low;
        if (bull) markers.push({
          time: candles[p].time,
          position: 'belowBar',
          color: '#16a34a',
          shape: 'arrowUp',
          text: 'Bull',
        });
      }
      lows.push({ index: p });
    }
    if (isPivotHigh(p)) {
      const previous = highs[highs.length - 1];
      if (previous) {
        const distance = p - previous.index;
        const bear = distance >= minDistance && distance <= maxDistance &&
          rsi[p] < rsi[previous.index] && candles[p].high > candles[previous.index].high;
        if (bear) markers.push({
          time: candles[p].time,
          position: 'aboveBar',
          color: '#dc2626',
          shape: 'arrowDown',
          text: 'Bear',
        });
      }
      highs.push({ index: p });
    }
  }
  return markers;
}

function toPoints(candles, values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (finite(values[i])) out.push({ time: candles[i].time, value: values[i] });
  }
  return out;
}

function paneChart(host, showTime) {
  return createChart(host, {
    width: host.clientWidth,
    height: host.clientHeight,
    layout: { background: { color: '#0d1425' }, textColor: '#91a0bd' },
    grid: { vertLines: { color: '#202a42' }, horzLines: { color: '#202a42' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: {
      visible: true,
      borderVisible: true,
      borderColor: '#26324d',
      minimumWidth: 52,
      scaleMargins: { top: 0.06, bottom: 0.06 },
    },
    timeScale: {
      visible: showTime,
      timeVisible: true,
      secondsVisible: false,
      borderColor: '#26324d',
      rightOffset: 6,
    },
    handleScroll: false,
    handleScale: false,
    localization: { priceFormatter: price => Number(price).toFixed(2) },
  });
}

function addAnchorSeries(chart) {
  return chart.addLineSeries({
    color: 'rgba(0,0,0,0)',
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

function createHorizontalLines(series, levels) {
  return levels.map(({ price, color, style = LineStyle.Dashed }) => series.createPriceLine({
    price,
    color,
    lineWidth: 1,
    lineStyle: style,
    axisLabelVisible: true,
    title: '',
  }));
}

function mainRecordForCard(card) {
  const host = card.querySelector('.chart-host');
  return (window.__stockChartRecords || []).find(record => record.container === host) || null;
}

function currentSymbol(card) {
  return card.querySelector('.symbol-search')?.value?.trim() || 'BTCUSDT';
}

function currentTimeframe(card) {
  return card.querySelector('.timeframe-buttons .control-button.active')?.textContent?.trim() || '1m';
}

function updatePaneBand(state, kind) {
  const pane = kind === 'stoch' ? state.stoch : state.rsi;
  const settings = state.settings[kind];
  if (!pane?.band || !pane?.primarySeries) return;
  const top = pane.primarySeries.priceToCoordinate(settings.upper);
  const bottom = pane.primarySeries.priceToCoordinate(settings.lower);
  if (!finite(top) || !finite(bottom)) return;
  pane.band.style.top = `${Math.min(top, bottom)}px`;
  pane.band.style.height = `${Math.abs(bottom - top)}px`;
  pane.band.style.background = kind === 'stoch'
    ? 'rgba(33,150,243,.10)'
    : 'rgba(126,87,194,.11)';

  if (kind === 'rsi') {
    const overTop = pane.primarySeries.priceToCoordinate(100);
    const overBottom = pane.primarySeries.priceToCoordinate(settings.upper);
    const underTop = pane.primarySeries.priceToCoordinate(settings.lower);
    const underBottom = pane.primarySeries.priceToCoordinate(0);
    if ([overTop, overBottom].every(finite)) {
      pane.over.style.top = `${Math.min(overTop, overBottom)}px`;
      pane.over.style.height = `${Math.abs(overBottom - overTop)}px`;
    }
    if ([underTop, underBottom].every(finite)) {
      pane.under.style.top = `${Math.min(underTop, underBottom)}px`;
      pane.under.style.height = `${Math.abs(underBottom - underTop)}px`;
    }
  }
}

function applyStoch(state) {
  const values = state.candles.map(c => sourceValue(c, state.settings.stoch.source));
  const result = calcStochRSI(values, state.settings.stoch);
  state.computed.stoch = result;
  state.stoch.kSeries.setData(toPoints(state.candles, result.k));
  state.stoch.dSeries.setData(toPoints(state.candles, result.d));
  if (state.candles.length) {
    const first = state.candles[0].time;
    const last = state.candles[state.candles.length - 1].time;
    state.stoch.anchor.setData([{ time: first, value: 0 }, { time: last, value: 100 }]);
  }
  state.stoch.kSeries.applyOptions({ color: state.settings.stoch.colorK });
  state.stoch.dSeries.applyOptions({ color: state.settings.stoch.colorD });
  const latestK = [...result.k].reverse().find(finite);
  const latestD = [...result.d].reverse().find(finite);
  state.stoch.value.textContent = `K ${finite(latestK) ? latestK.toFixed(2) : '--'}  D ${finite(latestD) ? latestD.toFixed(2) : '--'}`;
  requestAnimationFrame(() => updatePaneBand(state, 'stoch'));
}

function applyRSI(state) {
  const settings = state.settings.rsi;
  const source = state.candles.map(c => sourceValue(c, settings.source));
  const volumes = state.candles.map(c => c.volume);
  const rsi = calcRSI(source, settings.length);
  state.computed.rsi = rsi;
  state.rsi.rsiSeries.setData(toPoints(state.candles, rsi));
  state.rsi.rsiSeries.applyOptions({ color: settings.color });

  let smoothing = new Array(rsi.length).fill(null);
  let upper = new Array(rsi.length).fill(null);
  let lower = new Array(rsi.length).fill(null);
  if (settings.maType !== 'None') {
    const actualType = settings.maType === 'SMA + Bollinger Bands' ? 'SMA' : settings.maType;
    smoothing = movingAverageNullable(rsi, volumes, settings.maLength, actualType);
    if (settings.maType === 'SMA + Bollinger Bands') {
      const dev = rollingStdNullable(rsi, settings.maLength);
      upper = smoothing.map((value, i) => finite(value) && finite(dev[i]) ? value + dev[i] * settings.bbMult : null);
      lower = smoothing.map((value, i) => finite(value) && finite(dev[i]) ? value - dev[i] * settings.bbMult : null);
    }
  }

  state.computed.rsiMA = smoothing;
  state.rsi.maSeries.setData(toPoints(state.candles, smoothing));
  state.rsi.bbUpperSeries.setData(toPoints(state.candles, upper));
  state.rsi.bbLowerSeries.setData(toPoints(state.candles, lower));
  state.rsi.maSeries.applyOptions({ color: settings.maColor, visible: settings.maType !== 'None' });
  state.rsi.bbUpperSeries.applyOptions({ color: settings.bbColor, visible: settings.maType === 'SMA + Bollinger Bands' });
  state.rsi.bbLowerSeries.applyOptions({ color: settings.bbColor, visible: settings.maType === 'SMA + Bollinger Bands' });
  state.rsi.rsiSeries.setMarkers(calcDivergence(state.candles, rsi, settings.calculateDivergence));

  if (state.candles.length) {
    const first = state.candles[0].time;
    const last = state.candles[state.candles.length - 1].time;
    state.rsi.anchor.setData([{ time: first, value: 0 }, { time: last, value: 100 }]);
  }

  const latest = [...rsi].reverse().find(finite);
  const latestMA = [...smoothing].reverse().find(finite);
  state.rsi.value.textContent = `RSI ${finite(latest) ? latest.toFixed(2) : '--'}${finite(latestMA) ? `  MA ${latestMA.toFixed(2)}` : ''}`;
  requestAnimationFrame(() => updatePaneBand(state, 'rsi'));
}

function applyAll(state) {
  applyStoch(state);
  applyRSI(state);
  syncTimeRangeFromMain(state);
}

function syncTimeRangeFromMain(state) {
  const range = state.main?.chart?.timeScale().getVisibleLogicalRange?.();
  if (!range) return;
  try { state.stoch.chart.timeScale().setVisibleLogicalRange(range); } catch (_) {}
  try { state.rsi.chart.timeScale().setVisibleLogicalRange(range); } catch (_) {}
}

function nearestIndex(candles, time) {
  if (!candles.length || time == null) return -1;
  const target = typeof time === 'number' ? time : Number(time.timestamp || 0);
  if (!finite(target)) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time === target) return mid;
    if (candles[mid].time < target) lo = mid + 1;
    else hi = mid - 1;
  }
  if (lo >= candles.length) return candles.length - 1;
  if (hi < 0) return 0;
  return Math.abs(candles[lo].time - target) < Math.abs(candles[hi].time - target) ? lo : hi;
}

function visibleStates() {
  return states.filter(state => !state.card.hidden && getComputedStyle(state.card).display !== 'none');
}

function clearAllCrosshairs() {
  syncingCrosshair = true;
  try {
    for (const state of visibleStates()) {
      try { state.main?.chart?.clearCrosshairPosition(); } catch (_) {}
      try { state.stoch.chart.clearCrosshairPosition(); } catch (_) {}
      try { state.rsi.chart.clearCrosshairPosition(); } catch (_) {}
    }
  } finally {
    syncingCrosshair = false;
  }
}

function broadcastCrosshair(sourceState, sourceKind, time) {
  if (syncingCrosshair || time == null) return;
  syncingCrosshair = true;
  try {
    for (const target of visibleStates()) {
      const index = nearestIndex(target.candles, time);
      if (index < 0) continue;
      const candle = target.candles[index];
      const targetTime = candle.time;
      const k = target.computed.stoch?.k?.[index];
      const rsi = target.computed.rsi?.[index];

      if (!(target === sourceState && sourceKind === 'main') && target.main?.candleSeries) {
        try { target.main.chart.setCrosshairPosition(candle.close, targetTime, target.main.candleSeries); } catch (_) {}
      }
      if (!(target === sourceState && sourceKind === 'stoch') && finite(k)) {
        try { target.stoch.chart.setCrosshairPosition(k, targetTime, target.stoch.kSeries); } catch (_) {}
      }
      if (!(target === sourceState && sourceKind === 'rsi') && finite(rsi)) {
        try { target.rsi.chart.setCrosshairPosition(rsi, targetTime, target.rsi.rsiSeries); } catch (_) {}
      }
    }
  } finally {
    syncingCrosshair = false;
  }
}

function subscribeCrosshairs(state) {
  state.main?.chart?.subscribeCrosshairMove(param => {
    if (syncingCrosshair) return;
    if (!param?.time) return clearAllCrosshairs();
    broadcastCrosshair(state, 'main', param.time);
  });
  state.stoch.chart.subscribeCrosshairMove(param => {
    if (syncingCrosshair) return;
    if (!param?.time) return clearAllCrosshairs();
    broadcastCrosshair(state, 'stoch', param.time);
  });
  state.rsi.chart.subscribeCrosshairMove(param => {
    if (syncingCrosshair) return;
    if (!param?.time) return clearAllCrosshairs();
    broadcastCrosshair(state, 'rsi', param.time);
  });
}

function connect(state) {
  disconnect(state);
  const symbol = currentSymbol(state.card);
  const timeframe = currentTimeframe(state.card);
  state.symbol = symbol;
  state.timeframe = timeframe;
  const socket = new WebSocket(`${WS_BASE}/${symbol.toLowerCase()}@kline_${timeframe}`);
  state.socket = socket;
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
      };
      const last = state.candles[state.candles.length - 1];
      if (!last || candle.time > last.time) {
        state.candles.push(candle);
        if (state.candles.length > 500) state.candles.shift();
      } else if (candle.time === last.time) {
        state.candles[state.candles.length - 1] = candle;
      }
      applyAll(state);
    } catch (error) {
      console.error('Oscillator WebSocket update failed', error);
    }
  });
  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    state.reconnectTimer = setTimeout(() => connect(state), 2500);
  });
}

function disconnect(state) {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (!state.socket) return;
  const old = state.socket;
  state.socket = null;
  try { old.close(); } catch (_) {}
}

async function load(state) {
  const symbol = currentSymbol(state.card);
  const timeframe = currentTimeframe(state.card);
  state.symbol = symbol;
  state.timeframe = timeframe;
  disconnect(state);
  try {
    const response = await fetch(`${REST_BASE}?symbol=${symbol}&interval=${timeframe}&limit=500`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Binance REST ${response.status}`);
    state.candles = (await response.json()).map(normalize);
    applyAll(state);
    state.stoch.chart.timeScale().fitContent();
    state.rsi.chart.timeScale().fitContent();
    syncTimeRangeFromMain(state);
    connect(state);
  } catch (error) {
    console.error('Oscillator load failed', error);
  }
}

function createPane(card, className, title, showTime) {
  const pane = document.createElement('section');
  pane.className = `oscillator-pane ${className}`;
  pane.innerHTML = `
    <div class="oscillator-header">
      <strong>${title}</strong>
      <span class="oscillator-value">--</span>
      <button type="button" class="osc-settings-button" title="${title} settings">⚙</button>
    </div>
    <div class="oscillator-body">
      <div class="osc-band"></div>
      <div class="osc-extra-zone osc-over-zone"></div>
      <div class="osc-extra-zone osc-under-zone"></div>
      <div class="osc-chart-host"></div>
    </div>`;
  const host = pane.querySelector('.osc-chart-host');
  const chart = paneChart(host, showTime);
  return {
    pane,
    host,
    chart,
    value: pane.querySelector('.oscillator-value'),
    band: pane.querySelector('.osc-band'),
    over: pane.querySelector('.osc-over-zone'),
    under: pane.querySelector('.osc-under-zone'),
    settingsButton: pane.querySelector('.osc-settings-button'),
  };
}

function buildCard(card, index) {
  card.classList.add('has-oscillators');
  const stack = document.createElement('div');
  stack.className = 'oscillators-stack';
  const stoch = createPane(card, 'stoch-pane', 'Stochastic RSI', false);
  const rsi = createPane(card, 'rsi-pane', 'RSI', true);
  stack.append(stoch.pane, rsi.pane);
  card.appendChild(stack);

  const state = {
    index,
    card,
    stack,
    stoch,
    rsi,
    main: mainRecordForCard(card),
    settings: loadSettings(index),
    candles: [],
    computed: { stoch: null, rsi: null, rsiMA: null },
    socket: null,
    reconnectTimer: null,
    symbol: currentSymbol(card),
    timeframe: currentTimeframe(card),
  };

  stoch.kSeries = stoch.chart.addLineSeries({ color: state.settings.stoch.colorK, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  stoch.dSeries = stoch.chart.addLineSeries({ color: state.settings.stoch.colorD, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  stoch.primarySeries = stoch.kSeries;
  stoch.anchor = addAnchorSeries(stoch.chart);
  stoch.lines = createHorizontalLines(stoch.kSeries, [
    { price: state.settings.stoch.upper, color: '#787B86' },
    { price: state.settings.stoch.middle, color: 'rgba(120,123,134,.5)', style: LineStyle.Dotted },
    { price: state.settings.stoch.lower, color: '#787B86' },
  ]);

  rsi.rsiSeries = rsi.chart.addLineSeries({ color: state.settings.rsi.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  rsi.primarySeries = rsi.rsiSeries;
  rsi.maSeries = rsi.chart.addLineSeries({ color: state.settings.rsi.maColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: true });
  rsi.bbUpperSeries = rsi.chart.addLineSeries({ color: state.settings.rsi.bbColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  rsi.bbLowerSeries = rsi.chart.addLineSeries({ color: state.settings.rsi.bbColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  rsi.anchor = addAnchorSeries(rsi.chart);
  rsi.lines = createHorizontalLines(rsi.rsiSeries, [
    { price: state.settings.rsi.upper, color: '#787B86' },
    { price: state.settings.rsi.middle, color: 'rgba(120,123,134,.5)', style: LineStyle.Dotted },
    { price: state.settings.rsi.lower, color: '#787B86' },
  ]);

  rsi.over.style.background = 'linear-gradient(to bottom, rgba(22,163,74,.24), rgba(22,163,74,0))';
  rsi.under.style.background = 'linear-gradient(to bottom, rgba(220,38,38,0), rgba(220,38,38,.24))';

  state.main?.chart?.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (!range) return;
    try { stoch.chart.timeScale().setVisibleLogicalRange(range); } catch (_) {}
    try { rsi.chart.timeScale().setVisibleLogicalRange(range); } catch (_) {}
  });

  const resize = () => {
    for (const pane of [stoch, rsi]) {
      const rect = pane.host.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) pane.chart.applyOptions({ width: rect.width, height: rect.height });
    }
    updatePaneBand(state, 'stoch');
    updatePaneBand(state, 'rsi');
  };
  state.resizeObserver = new ResizeObserver(resize);
  state.resizeObserver.observe(stack);

  stoch.settingsButton.addEventListener('click', event => {
    event.stopPropagation();
    openSettings(state, 'stoch');
  });
  rsi.settingsButton.addEventListener('click', event => {
    event.stopPropagation();
    openSettings(state, 'rsi');
  });

  card.addEventListener('click', () => setTimeout(() => checkContext(state), 20));
  subscribeCrosshairs(state);
  states.push(state);
  load(state);
  resize();
}

function checkContext(state) {
  const symbol = currentSymbol(state.card);
  const timeframe = currentTimeframe(state.card);
  if (symbol !== state.symbol || timeframe !== state.timeframe) load(state);
}

let modalState = null;
let modalKind = null;
let modalDraft = null;

function ensureModal() {
  if (document.getElementById('oscillatorSettingsModal')) return;
  const modal = document.createElement('div');
  modal.id = 'oscillatorSettingsModal';
  modal.className = 'osc-modal-backdrop';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="osc-modal" role="dialog" aria-modal="true">
      <div class="osc-modal-header">
        <h2 class="osc-modal-title"></h2>
        <button type="button" class="osc-modal-close">×</button>
      </div>
      <div class="osc-modal-tabs">
        <button type="button" data-tab="inputs" class="active">Inputs</button>
        <button type="button" data-tab="style">Style</button>
      </div>
      <div class="osc-modal-body"></div>
      <div class="osc-modal-footer">
        <button type="button" class="osc-defaults">Defaults</button>
        <span></span>
        <button type="button" class="osc-cancel">Cancel</button>
        <button type="button" class="osc-ok">Ok</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.dataset.tab = 'inputs';
  modal.querySelector('.osc-modal-close').addEventListener('click', closeModal);
  modal.querySelector('.osc-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  modal.querySelectorAll('.osc-modal-tabs button').forEach(button => button.addEventListener('click', () => {
    modal.dataset.tab = button.dataset.tab;
    modal.querySelectorAll('.osc-modal-tabs button').forEach(item => item.classList.toggle('active', item === button));
    renderModal();
  }));
  modal.querySelector('.osc-defaults').addEventListener('click', () => {
    modalDraft = clone(DEFAULTS[modalKind]);
    renderModal();
  });
  modal.querySelector('.osc-ok').addEventListener('click', () => {
    if (!modalState || !modalKind || !modalDraft) return;
    modalState.settings[modalKind] = clone(modalDraft);
    saveSettings(modalState);
    rebuildPaneLines(modalState, modalKind);
    applyAll(modalState);
    closeModal();
  });
}

function openSettings(state, kind) {
  ensureModal();
  modalState = state;
  modalKind = kind;
  modalDraft = clone(state.settings[kind]);
  const modal = document.getElementById('oscillatorSettingsModal');
  modal.dataset.tab = 'inputs';
  modal.querySelector('.osc-modal-title').textContent = kind === 'stoch' ? 'Stochastic RSI' : 'Relative Strength Index';
  modal.querySelectorAll('.osc-modal-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'inputs'));
  renderModal();
  modal.hidden = false;
}

function closeModal() {
  const modal = document.getElementById('oscillatorSettingsModal');
  if (modal) modal.hidden = true;
  modalState = null;
  modalKind = null;
  modalDraft = null;
}

function row(label, control) {
  return `<label class="osc-setting-row"><span>${label}</span>${control}</label>`;
}
function num(path, value, min = 1, max = 500, step = 1) {
  return `<input type="number" data-path="${path}" value="${value}" min="${min}" max="${max}" step="${step}">`;
}
function sel(path, value, options) {
  return `<select data-path="${path}">${options.map(option => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select>`;
}
function chk(path, value) {
  return `<input type="checkbox" data-path="${path}" ${value ? 'checked' : ''}>`;
}
function color(path, value) {
  return `<input type="color" data-path="${path}" value="${value}">`;
}

function renderModal() {
  const modal = document.getElementById('oscillatorSettingsModal');
  if (!modal || !modalDraft) return;
  const tab = modal.dataset.tab;
  const body = modal.querySelector('.osc-modal-body');
  const sources = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

  if (modalKind === 'stoch') {
    body.innerHTML = tab === 'style'
      ? `${row('K color', color('colorK', modalDraft.colorK))}${row('D color', color('colorD', modalDraft.colorD))}${row('Band color', color('bandColor', modalDraft.bandColor))}`
      : `${row('K', num('smoothK', modalDraft.smoothK))}${row('D', num('smoothD', modalDraft.smoothD))}${row('RSI Length', num('lengthRSI', modalDraft.lengthRSI))}${row('Stochastic Length', num('lengthStoch', modalDraft.lengthStoch))}${row('RSI Source', sel('source', modalDraft.source, sources))}${row('Upper Band', num('upper', modalDraft.upper, 0, 100, 1))}${row('Middle Band', num('middle', modalDraft.middle, 0, 100, 1))}${row('Lower Band', num('lower', modalDraft.lower, 0, 100, 1))}`;
  } else {
    body.innerHTML = tab === 'style'
      ? `${row('RSI color', color('color', modalDraft.color))}${row('RSI MA color', color('maColor', modalDraft.maColor))}${row('MA Bollinger color', color('bbColor', modalDraft.bbColor))}${row('Band color', color('bandColor', modalDraft.bandColor))}`
      : `${row('RSI Length', num('length', modalDraft.length))}${row('Source', sel('source', modalDraft.source, sources))}${row('Calculate Divergence', chk('calculateDivergence', modalDraft.calculateDivergence))}<h3>Smoothing</h3>${row('Type', sel('maType', modalDraft.maType, ['None','SMA','SMA + Bollinger Bands','EMA','SMMA (RMA)','WMA','VWMA']))}${row('Length', num('maLength', modalDraft.maLength))}${row('BB StdDev', num('bbMult', modalDraft.bbMult, 0.001, 50, 0.5))}${row('Upper Band', num('upper', modalDraft.upper, 0, 100, 1))}${row('Middle Band', num('middle', modalDraft.middle, 0, 100, 1))}${row('Lower Band', num('lower', modalDraft.lower, 0, 100, 1))}`;
  }

  body.querySelectorAll('[data-path]').forEach(control => {
    const event = control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input';
    control.addEventListener(event, () => {
      modalDraft[control.dataset.path] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
    });
  });
}

function rebuildPaneLines(state, kind) {
  const pane = kind === 'stoch' ? state.stoch : state.rsi;
  const settings = state.settings[kind];
  for (const line of pane.lines || []) {
    try { pane.primarySeries.removePriceLine(line); } catch (_) {}
  }
  pane.lines = createHorizontalLines(pane.primarySeries, [
    { price: settings.upper, color: '#787B86' },
    { price: settings.middle, color: 'rgba(120,123,134,.5)', style: LineStyle.Dotted },
    { price: settings.lower, color: '#787B86' },
  ]);
  pane.band.style.background = kind === 'stoch'
    ? `${settings.bandColor}1A`
    : `${settings.bandColor}1C`;
  updatePaneBand(state, kind);
}

function waitForMainCharts() {
  const cards = [...document.querySelectorAll('.chart-card')];
  const ready = cards.length && (window.__stockChartRecords || []).length >= cards.length;
  if (!ready) return setTimeout(waitForMainCharts, 80);
  cards.forEach(buildCard);
  setInterval(() => states.forEach(checkContext), 800);
}

waitForMainCharts();

window.addEventListener('beforeunload', () => {
  for (const state of states) {
    disconnect(state);
    state.resizeObserver?.disconnect();
    try { state.stoch.chart.remove(); } catch (_) {}
    try { state.rsi.chart.remove(); } catch (_) {}
  }
});
