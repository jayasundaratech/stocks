const SYMBOLS = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT' },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT' },
  { symbol: 'BNBUSDT', name: 'BNB / USDT' },
  { symbol: 'SOLUSDT', name: 'Solana / USDT' },
  { symbol: 'XRPUSDT', name: 'XRP / USDT' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin / USDT' },
  { symbol: 'ADAUSDT', name: 'Cardano / USDT' },
];

const TIMEFRAMES = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
  { label: '1d', seconds: 86400 },
];

const REST_BASE = 'https://api.binance.com/api/v3/klines';
const WS_BASE = 'wss://stream.binance.com:9443/ws';
const chartStates = [];

function fmtPrice(value) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

function fmtTime(timestamp, timeframe) {
  const date = new Date(timestamp * 1000);
  if (timeframe.seconds >= 86400) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function normalizeKline(row) {
  return {
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

async function loadHistorical(state) {
  state.loadingToken += 1;
  const token = state.loadingToken;
  setConnectionState(state, 'loading', 'Loading Binance data…');

  const url = `${REST_BASE}?symbol=${encodeURIComponent(state.symbolInfo.symbol)}&interval=${encodeURIComponent(state.timeframe.label)}&limit=120`;
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.msg ? `: ${body.msg}` : '';
    } catch (_) {}
    throw new Error(`Binance REST ${response.status}${detail}`);
  }

  const rows = await response.json();
  if (token !== state.loadingToken) return;
  if (!Array.isArray(rows) || !rows.length) throw new Error('No candle data returned');

  state.candles = rows.map(normalizeKline);
  render(state);
  connectWebSocket(state);
}

function connectWebSocket(state) {
  disconnectWebSocket(state);
  const stream = `${state.symbolInfo.symbol.toLowerCase()}@kline_${state.timeframe.label}`;
  const socket = new WebSocket(`${WS_BASE}/${stream}`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    if (state.socket !== socket) return;
    setConnectionState(state, 'live', 'LIVE • Binance WebSocket');
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
        if (state.candles.length > 120) state.candles.shift();
      } else if (candle.time === last.time) {
        state.candles[state.candles.length - 1] = candle;
      }

      render(state);
    } catch (error) {
      console.error('WebSocket parse error', error);
    }
  });

  socket.addEventListener('close', () => {
    if (state.socket !== socket) return;
    setConnectionState(state, 'offline', 'Disconnected • reconnecting…');
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => connectWebSocket(state), 2500);
  });

  socket.addEventListener('error', () => {
    if (state.socket !== socket) return;
    setConnectionState(state, 'offline', 'WebSocket error');
  });
}

function disconnectWebSocket(state) {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    try { socket.close(); } catch (_) {}
  }
}

function setConnectionState(state, mode, text) {
  state.status.textContent = text;
  state.status.dataset.state = mode;
  const badge = state.card.querySelector('.chart-badge');
  badge.textContent = mode === 'live' ? 'BINANCE LIVE' : mode === 'loading' ? 'CONNECTING' : 'OFFLINE';
}

async function refreshState(state) {
  disconnectWebSocket(state);
  state.candles = [];
  render(state);
  try {
    await loadHistorical(state);
  } catch (error) {
    console.error(error);
    setConnectionState(state, 'offline', error.message || 'Unable to load Binance data');
    state.price.textContent = '--';
    state.change.textContent = 'Check symbol / network';
    state.change.className = 'change negative';
  }
}

function makeCard(card, index) {
  const startingSymbol = SYMBOLS[index % SYMBOLS.length];
  const startingTf = TIMEFRAMES[index === 0 ? 0 : index % 4];

  card.innerHTML = `
    <div class="chart-toolbar">
      <div class="symbol-search-wrap">
        <input class="symbol-search" value="${startingSymbol.symbol}" aria-label="Search Binance symbol" autocomplete="off" />
        <div class="symbol-menu"></div>
      </div>
      <div class="timeframe-buttons"></div>
      <button class="control-button refresh-button" type="button" title="Reload from Binance">↻</button>
    </div>
    <div class="chart-meta">
      <span class="ticker"></span>
      <span class="name"></span>
      <span class="price"></span>
      <span class="change"></span>
    </div>
    <div class="chart-canvas-wrap">
      <canvas class="chart-canvas"></canvas>
      <span class="chart-badge">CONNECTING</span>
      <span class="chart-status"></span>
    </div>
  `;

  const state = {
    card,
    index,
    symbolInfo: startingSymbol,
    timeframe: startingTf,
    candles: [],
    socket: null,
    reconnectTimer: null,
    loadingToken: 0,
    canvas: card.querySelector('.chart-canvas'),
    ctx: card.querySelector('.chart-canvas').getContext('2d'),
    input: card.querySelector('.symbol-search'),
    menu: card.querySelector('.symbol-menu'),
    ticker: card.querySelector('.ticker'),
    name: card.querySelector('.name'),
    price: card.querySelector('.price'),
    change: card.querySelector('.change'),
    status: card.querySelector('.chart-status'),
    buttons: card.querySelector('.timeframe-buttons'),
  };

  TIMEFRAMES.forEach(tf => {
    const btn = document.createElement('button');
    btn.className = `control-button ${tf.label === startingTf.label ? 'active' : ''}`;
    btn.textContent = tf.label;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      state.timeframe = tf;
      [...state.buttons.children].forEach(b => b.classList.toggle('active', b.textContent === tf.label));
      refreshState(state);
    });
    state.buttons.appendChild(btn);
  });

  fillMenu(state, SYMBOLS);

  state.input.addEventListener('focus', () => state.menu.classList.add('open'));
  state.input.addEventListener('input', () => {
    const q = state.input.value.trim().toUpperCase();
    fillMenu(state, SYMBOLS.filter(s => s.symbol.includes(q) || s.name.toUpperCase().includes(q)));
    state.menu.classList.add('open');
  });

  state.input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const symbol = state.input.value.trim().toUpperCase();
    if (!symbol) return;
    const known = SYMBOLS.find(item => item.symbol === symbol);
    state.symbolInfo = known || { symbol, name: 'Binance Spot Pair' };
    state.input.value = symbol;
    state.menu.classList.remove('open');
    refreshState(state);
  });

  card.querySelector('.refresh-button').addEventListener('click', () => refreshState(state));

  card.addEventListener('click', () => {
    document.querySelectorAll('.chart-card').forEach(el => el.classList.remove('active'));
    card.classList.add('active');
  });

  chartStates.push(state);
  render(state);
  refreshState(state);
}

function fillMenu(state, list) {
  state.menu.innerHTML = '';
  list.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'symbol-item';
    btn.innerHTML = `<strong>${item.symbol}</strong><small>${item.name}</small>`;
    btn.addEventListener('click', () => {
      state.symbolInfo = item;
      state.input.value = item.symbol;
      state.menu.classList.remove('open');
      refreshState(state);
    });
    state.menu.appendChild(btn);
  });
}

function resizeCanvas(state) {
  const rect = state.canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(260, Math.floor(rect.height));
  const targetW = Math.floor(width * dpr);
  const targetH = Math.floor(height * dpr);

  if (state.canvas.width !== targetW || state.canvas.height !== targetH) {
    state.canvas.width = targetW;
    state.canvas.height = targetH;
  }

  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function render(state) {
  const { width, height } = resizeCanvas(state);
  const ctx = state.ctx;
  const candles = state.candles;
  const pad = { left: 12, right: 78, top: 16, bottom: 42 };
  const volumeHeight = Math.max(52, height * .17);
  const priceBottom = height - pad.bottom - volumeHeight - 10;
  const plotWidth = width - pad.left - pad.right;
  const priceHeight = priceBottom - pad.top;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1425';
  ctx.fillRect(0, 0, width, height);

  state.ticker.textContent = state.symbolInfo.symbol;
  state.name.textContent = state.symbolInfo.name;

  if (!candles.length) {
    ctx.fillStyle = '#8796b4';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Loading market data…', width / 2, height / 2);
    ctx.textAlign = 'start';
    state.price.textContent = '--';
    state.change.textContent = '';
    return;
  }

  const minPrice = Math.min(...candles.map(c => c.low));
  const maxPrice = Math.max(...candles.map(c => c.high));
  const priceSpan = Math.max(.00000001, maxPrice - minPrice);
  const maxVolume = Math.max(...candles.map(c => c.volume), 1);
  const xStep = plotWidth / candles.length;
  const candleWidth = Math.max(1.5, Math.min(8, xStep * .68));

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#25304a';
  ctx.fillStyle = '#8796b4';
  ctx.font = '11px system-ui';

  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (priceHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    const price = maxPrice - (priceSpan / 5) * i;
    ctx.fillText(fmtPrice(price), width - pad.right + 7, y + 4);
  }

  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (plotWidth / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();
  }

  candles.forEach((candle, i) => {
    const x = pad.left + i * xStep + xStep / 2;
    const toY = value => pad.top + ((maxPrice - value) / priceSpan) * priceHeight;
    const openY = toY(candle.open);
    const closeY = toY(candle.close);
    const highY = toY(candle.high);
    const lowY = toY(candle.low);
    const up = candle.close >= candle.open;
    const color = up ? '#18b981' : '#ef5350';

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);

    const volH = (candle.volume / maxVolume) * volumeHeight;
    ctx.globalAlpha = .72;
    ctx.fillRect(x - candleWidth / 2, height - pad.bottom - volH, candleWidth, volH);
    ctx.globalAlpha = 1;
  });

  const latest = candles[candles.length - 1];
  const first = candles[0];
  const change = latest.close - first.close;
  const pct = first.close ? change / first.close * 100 : 0;
  const latestY = pad.top + ((maxPrice - latest.close) / priceSpan) * priceHeight;

  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = latest.close >= first.close ? '#18b981' : '#ef5350';
  ctx.beginPath();
  ctx.moveTo(pad.left, latestY);
  ctx.lineTo(width - pad.right, latestY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#8796b4';
  [0, Math.floor(candles.length / 2), candles.length - 1].forEach(idx => {
    const x = pad.left + idx * xStep;
    ctx.fillText(fmtTime(candles[idx].time, state.timeframe), x, height - 16);
  });

  state.price.textContent = fmtPrice(latest.close);
  state.change.textContent = `${change >= 0 ? '+' : ''}${fmtPrice(change)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
  state.change.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
}

document.querySelectorAll('.chart-card').forEach(makeCard);

document.addEventListener('click', event => {
  chartStates.forEach(state => {
    if (!state.card.contains(event.target)) state.menu.classList.remove('open');
  });
});

window.addEventListener('resize', () => chartStates.forEach(render));

document.getElementById('resetAll').addEventListener('click', () => {
  chartStates.forEach(state => refreshState(state));
});

window.addEventListener('beforeunload', () => chartStates.forEach(disconnectWebSocket));
