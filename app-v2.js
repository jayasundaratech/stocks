import { createChart, CrosshairMode } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm';

const SYMBOLS = [
  ['BTCUSDT', 'Bitcoin / USDT'], ['ETHUSDT', 'Ethereum / USDT'],
  ['BNBUSDT', 'BNB / USDT'], ['SOLUSDT', 'Solana / USDT'],
  ['XRPUSDT', 'XRP / USDT'], ['DOGEUSDT', 'Dogecoin / USDT'],
  ['ADAUSDT', 'Cardano / USDT'],
].map(([symbol, name]) => ({ symbol, name }));
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const REST_BASE = 'https://api.binance.com/api/v3/klines';
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const states = [];
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function fmtPrice(value) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function normalize(row) {
  return { time: Math.floor(Number(row[0]) / 1000), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) };
}

function setStatus(state, mode, text) {
  state.status.textContent = text;
  state.badge.textContent = mode === 'live' ? 'BINANCE LIVE' : mode === 'loading' ? 'CONNECTING' : 'OFFLINE';
  state.badge.dataset.state = mode;
}

function updateMeta(state) {
  if (!state.lastUpdateAt) {
    state.liveMeta.textContent = `Waiting for live tick… • Price zoom ${state.priceControl.zoom.toFixed(2)}×`;
    return;
  }
  const time = new Date(state.lastUpdateAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.liveMeta.textContent = `Last live update: ${time} • ticks: ${state.tickCount} • Price zoom ${state.priceControl.zoom.toFixed(2)}×`;
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
}

function resetPriceZoom(state) {
  state.priceControl.zoom = 1;
  applyPriceZoom(state);
}

function resetView(state) {
  resetPriceZoom(state);
  state.chart.timeScale().fitContent();
}

function disconnect(state) {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (state.socket) {
    const old = state.socket;
    state.socket = null;
    try { old.close(); } catch (_) {}
  }
}

function connect(state) {
  disconnect(state);
  const stream = `${state.symbolInfo.symbol.toLowerCase()}@kline_${state.timeframe}`;
  const socket = new WebSocket(`${WS_BASE}/${stream}`);
  state.socket = socket;
  setStatus(state, 'loading', 'Connecting to Binance WebSocket…');

  socket.addEventListener('open', () => {
    if (state.socket !== socket) return;
    setStatus(state, 'live', 'LIVE • drag chart to pan • drag RIGHT price scale ↕ to zoom prices');
  });

  socket.addEventListener('message', event => {
    if (state.socket !== socket) return;
    try {
      const payload = JSON.parse(event.data);
      const k = payload.k;
      if (!k) return;
      const candle = { time: Math.floor(Number(k.t) / 1000), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
      const last = state.candles[state.candles.length - 1];
      if (!last || candle.time > last.time) {
        state.candles.push(candle);
        if (state.candles.length > 500) state.candles.shift();
      } else if (candle.time === last.time) {
        state.candles[state.candles.length - 1] = candle;
      }
      state.candleSeries.update(candle);
      state.volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? 'rgba(24,185,129,.6)' : 'rgba(239,83,80,.6)' });
      state.lastUpdateAt = Date.now();
      state.tickCount += 1;
      updateMeta(state);
      updateHeader(state, candle);
    } catch (error) { console.error(error); }
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
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Binance REST ${res.status}`);
    state.candles = (await res.json()).map(normalize);
    state.candleSeries.setData(state.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    state.volumeSeries.setData(state.candles.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(24,185,129,.6)' : 'rgba(239,83,80,.6)' })));
    applyPriceZoom(state);
    updateHeader(state, state.candles[state.candles.length - 1]);
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'symbol-item';
    btn.innerHTML = `<strong>${item.symbol}</strong><small>${item.name}</small>`;
    btn.addEventListener('click', () => {
      state.symbolInfo = item;
      state.input.value = item.symbol;
      state.ticker.textContent = item.symbol;
      state.name.textContent = item.name;
      state.menu.classList.remove('open');
      load(state, true);
    });
    state.menu.appendChild(btn);
  });
}

function installPriceAxisControl(state, wrap) {
  const axis = document.createElement('div');
  axis.className = 'price-axis-control';
  axis.title = 'Drag up/down to zoom the price range. Double-click to reset.';
  Object.assign(axis.style, {
    position: 'absolute', right: '0.3rem', top: '0.2rem', bottom: '0.35rem', width: '92px',
    zIndex: '8', cursor: 'ns-resize', background: 'transparent', touchAction: 'none', userSelect: 'none'
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
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dy = event.clientY - drag.startY;
    state.priceControl.zoom = clamp(drag.startZoom * Math.exp(dy * 0.008), 0.2, 25);
    applyPriceZoom(state);
    event.preventDefault();
  });
  const stopDrag = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    try { axis.releasePointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
  };
  axis.addEventListener('pointerup', stopDrag);
  axis.addEventListener('pointercancel', stopDrag);
  axis.addEventListener('dblclick', event => {
    resetPriceZoom(state);
    event.preventDefault();
  });
  axis.addEventListener('wheel', event => {
    state.priceControl.zoom = clamp(state.priceControl.zoom * Math.exp(event.deltaY * 0.0015), 0.2, 25);
    applyPriceZoom(state);
    event.preventDefault();
  }, { passive: false });
  state.axisControl = axis;
}

function makeCard(card, index) {
  const symbolInfo = SYMBOLS[index % SYMBOLS.length];
  const timeframe = TIMEFRAMES[index === 0 ? 0 : index % 4];
  card.innerHTML = `
    <div class="chart-toolbar">
      <div class="symbol-search-wrap"><input class="symbol-search" value="${symbolInfo.symbol}" readonly aria-label="Select Binance crypto symbol" /><div class="symbol-menu"></div></div>
      <div class="timeframe-buttons"></div>
      <button class="control-button reset-view" type="button" title="Reset chart view">⌂</button>
      <button class="control-button reconnect" type="button" title="Reconnect to Binance">↻</button>
    </div>
    <div class="chart-meta"><span class="ticker">${symbolInfo.symbol}</span><span class="name">${symbolInfo.name}</span><span class="price">--</span><span class="change"></span></div>
    <div class="live-meta"></div>
    <div class="chart-canvas-wrap"><div class="chart-host"></div><span class="chart-badge">CONNECTING</span><span class="chart-status"></span></div>`;

  const wrap = card.querySelector('.chart-canvas-wrap');
  const host = card.querySelector('.chart-host');
  const chart = createChart(host, {
    width: host.clientWidth, height: host.clientHeight,
    layout: { background: { color: '#0d1425' }, textColor: '#91a0bd' },
    grid: { vertLines: { color: '#25304a' }, horzLines: { color: '#25304a' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { visible: true, autoScale: true, borderVisible: true, borderColor: '#26324d', ticksVisible: true, minimumWidth: 86, scaleMargins: { top: 0.08, bottom: 0.22 } },
    timeScale: { borderColor: '#26324d', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: { time: true, price: false } },
  });

  const priceControl = { zoom: 1 };
  const state = {
    card, chart, host, priceControl, symbolInfo, timeframe, candles: [], socket: null, reconnectTimer: null,
    tickCount: 0, lastUpdateAt: null,
    input: card.querySelector('.symbol-search'), menu: card.querySelector('.symbol-menu'), ticker: card.querySelector('.ticker'),
    name: card.querySelector('.name'), price: card.querySelector('.price'), change: card.querySelector('.change'),
    liveMeta: card.querySelector('.live-meta'), badge: card.querySelector('.chart-badge'), status: card.querySelector('.chart-status'),
    buttons: card.querySelector('.timeframe-buttons'),
  };
  state.autoscaleProvider = original => expandedAutoscale(state, original);
  state.candleSeries = chart.addCandlestickSeries({
    upColor: '#18b981', downColor: '#ef5350', borderVisible: false, wickUpColor: '#18b981', wickDownColor: '#ef5350',
    priceLineVisible: true, lastValueVisible: true, autoscaleInfoProvider: state.autoscaleProvider,
  });
  state.volumeSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '', scaleMargins: { top: 0.82, bottom: 0 } });

  TIMEFRAMES.forEach(tf => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `control-button ${tf === timeframe ? 'active' : ''}`;
    btn.textContent = tf;
    btn.addEventListener('click', () => {
      state.timeframe = tf;
      [...state.buttons.children].forEach(b => b.classList.toggle('active', b.textContent === tf));
      load(state, true);
    });
    state.buttons.appendChild(btn);
  });

  fillMenu(state);
  installPriceAxisControl(state, wrap);
  state.input.addEventListener('click', () => state.menu.classList.toggle('open'));
  card.querySelector('.reset-view').addEventListener('click', () => resetView(state));
  card.querySelector('.reconnect').addEventListener('click', () => load(state, false));
  card.addEventListener('click', () => {
    document.querySelectorAll('.chart-card').forEach(el => el.classList.remove('active'));
    card.classList.add('active');
  });

  const observer = new ResizeObserver(entries => {
    const rect = entries[0].contentRect;
    chart.applyOptions({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
  });
  observer.observe(host);
  state.observer = observer;
  states.push(state);
  updateMeta(state);
  load(state, true);
}

function setLayout(layout) {
  const value = ['1', '2', '3', '4'].includes(String(layout)) ? String(layout) : '4';
  const grid = document.getElementById('dashboardGrid');
  grid.classList.remove('layout-1', 'layout-2', 'layout-3', 'layout-4');
  grid.classList.add(`layout-${value}`);
  grid.dataset.layout = value;

  document.querySelectorAll('.layout-button').forEach(button => {
    const active = button.dataset.layout === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  requestAnimationFrame(() => {
    states.forEach(state => {
      if (getComputedStyle(state.card).display === 'none') return;
      const rect = state.host.getBoundingClientRect();
      state.chart.applyOptions({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
  });
}

document.querySelectorAll('.chart-card').forEach(makeCard);
document.querySelectorAll('.layout-button').forEach(button => {
  button.addEventListener('click', () => setLayout(button.dataset.layout));
});
setLayout(document.getElementById('dashboardGrid')?.dataset.layout || '4');

document.addEventListener('click', event => states.forEach(state => { if (!state.card.contains(event.target)) state.menu.classList.remove('open'); }));
document.getElementById('resetAll').addEventListener('click', () => states.forEach(resetView));
setInterval(() => states.forEach(updateMeta), 1000);
window.addEventListener('beforeunload', () => states.forEach(state => { disconnect(state); state.observer?.disconnect(); state.chart?.remove(); }));
