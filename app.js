import { createChart, CrosshairMode } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm';

const SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT' },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT' },
  { symbol: 'BNBUSDT', name: 'BNB / USDT' },
  { symbol: 'SOLUSDT', name: 'Solana / USDT' },
  { symbol: 'XRPUSDT', name: 'XRP / USDT' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin / USDT' },
  { symbol: 'ADAUSDT', name: 'Cardano / USDT' },
];

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const REST_BASE = 'https://api.binance.com/api/v3/klines';
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const states = [];

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
  };
}

function setStatus(state, mode, text) {
  state.status.textContent = text;
  state.badge.textContent = mode === 'live' ? 'BINANCE LIVE' : mode === 'loading' ? 'CONNECTING' : 'OFFLINE';
  state.badge.dataset.state = mode;
}

function updateMeta(state) {
  if (!state.lastUpdateAt) {
    state.liveMeta.textContent = 'Waiting for live tick…';
    return;
  }
  const time = new Date(state.lastUpdateAt).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  state.liveMeta.textContent = `Last live update: ${time} • ticks: ${state.tickCount}`;
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

function disconnect(state) {
  clearTimeout(state.reconnectTimer);
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
    setStatus(state, 'live', 'LIVE • drag to pan • wheel to zoom');
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
        color: candle.close >= candle.open ? 'rgba(24,185,129,.6)' : 'rgba(239,83,80,.6)'
      });
      state.lastUpdateAt = Date.now();
      state.tickCount += 1;
      updateMeta(state);
      updateHeader(state, candle);
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

async function load(state, resetView = true) {
  disconnect(state);
  state.tickCount = 0;
  state.lastUpdateAt = null;
  updateMeta(state);
  setStatus(state, 'loading', 'Loading Binance candles…');

  try {
    const url = `${REST_BASE}?symbol=${state.symbolInfo.symbol}&interval=${state.timeframe}&limit=500`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Binance REST ${res.status}`);
    const rows = await res.json();
    state.candles = rows.map(normalize);

    state.candleSeries.setData(state.candles.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close
    })));
    state.volumeSeries.setData(state.candles.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(24,185,129,.6)' : 'rgba(239,83,80,.6)'
    })));

    updateHeader(state, state.candles[state.candles.length - 1]);
    if (resetView) state.chart.timeScale().fitContent();
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
    </div>
  `;

  const host = card.querySelector('.chart-host');
  const chart = createChart(host, {
    width: host.clientWidth,
    height: host.clientHeight,
    layout: { background: { color: '#0d1425' }, textColor: '#91a0bd' },
    grid: { vertLines: { color: '#25304a' }, horzLines: { color: '#25304a' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#26324d', scaleMargins: { top: 0.08, bottom: 0.22 } },
    timeScale: { borderColor: '#26324d', timeVisible: true, secondsVisible: false, rightOffset: 6 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
    handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: '#18b981', downColor: '#ef5350', borderVisible: false,
    wickUpColor: '#18b981', wickDownColor: '#ef5350',
    priceLineVisible: true, lastValueVisible: true,
  });

  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  const state = {
    card, chart, host, candleSeries, volumeSeries,
    symbolInfo, timeframe, candles: [], socket: null, reconnectTimer: null,
    tickCount: 0, lastUpdateAt: null,
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
  state.input.addEventListener('click', () => state.menu.classList.toggle('open'));
  card.querySelector('.reset-view').addEventListener('click', () => chart.timeScale().fitContent());
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

document.querySelectorAll('.chart-card').forEach(makeCard);

document.addEventListener('click', event => {
  states.forEach(state => {
    if (!state.card.contains(event.target)) state.menu.classList.remove('open');
  });
});

document.getElementById('resetAll').addEventListener('click', () => {
  states.forEach(state => state.chart.timeScale().fitContent());
});

setInterval(() => states.forEach(updateMeta), 1000);
window.addEventListener('beforeunload', () => states.forEach(state => {
  disconnect(state);
  state.observer?.disconnect();
  state.chart?.remove();
}));
