const SYMBOLS = [
  { symbol: 'XAUTUSDT', name: 'Gold Tether / USDT', base: 4157.52, volatility: 8.2 },
  { symbol: 'BTCUSDT', name: 'Bitcoin / USDT', base: 69420.18, volatility: 180 },
  { symbol: 'ETHUSDT', name: 'Ethereum / USDT', base: 3825.74, volatility: 28 },
  { symbol: 'QQQM', name: 'Invesco NASDAQ 100 ETF', base: 195.02, volatility: 1.1 },
  { symbol: 'VFV.TO', name: 'Vanguard S&P 500 Index ETF', base: 151.68, volatility: .75 },
  { symbol: 'RY.TO', name: 'Royal Bank of Canada', base: 208.31, volatility: 1.0 },
];

const TIMEFRAMES = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
  { label: '1d', seconds: 86400 },
];

const chartStates = [];

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = value * 16807 % 2147483647) / 2147483647;
}

function hashString(value) {
  return [...value].reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 17) >>> 0;
}

function generateCandles(symbolInfo, timeframe, count = 90) {
  const seed = hashString(`${symbolInfo.symbol}-${timeframe.label}`);
  const random = seededRandom(seed);
  const now = Math.floor(Date.now() / timeframe.seconds) * timeframe.seconds;
  let lastClose = symbolInfo.base * (0.94 + random() * 0.10);
  const candles = [];

  for (let i = count - 1; i >= 0; i--) {
    const time = now - i * timeframe.seconds;
    const wave = Math.sin((count - i) / 7) * symbolInfo.volatility * .22;
    const shock = (random() - .5) * symbolInfo.volatility;
    const open = lastClose;
    const close = Math.max(.01, open + wave * .2 + shock);
    const high = Math.max(open, close) + random() * symbolInfo.volatility * .55;
    const low = Math.max(.01, Math.min(open, close) - random() * symbolInfo.volatility * .55);
    const volume = Math.round((250 + random() * 1750) * (1 + Math.abs(close - open) / Math.max(1, symbolInfo.volatility)));
    candles.push({ time, open, high, low, close, volume });
    lastClose = close;
  }

  return candles;
}

function fmtPrice(value) {
  if (value >= 10000) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (value >= 100) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtTime(timestamp, timeframe) {
  const date = new Date(timestamp * 1000);
  if (timeframe.seconds >= 86400) return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function makeCard(card, index) {
  const startingSymbol = SYMBOLS[index === 0 ? 0 : index % SYMBOLS.length];
  const startingTf = TIMEFRAMES[index === 0 ? 3 : index % 4];

  card.innerHTML = `
    <div class="chart-toolbar">
      <div class="symbol-search-wrap">
        <input class="symbol-search" value="${startingSymbol.symbol}" aria-label="Search symbol" />
        <div class="symbol-menu"></div>
      </div>
      <div class="timeframe-buttons"></div>
      <button class="control-button simulate-button" type="button" title="Generate a new demo pattern">⚡</button>
    </div>
    <div class="chart-meta">
      <span class="ticker"></span>
      <span class="name"></span>
      <span class="price"></span>
      <span class="change"></span>
    </div>
    <div class="chart-canvas-wrap">
      <canvas class="chart-canvas"></canvas>
      <span class="chart-badge">SIMULATED</span>
      <span class="chart-status"></span>
    </div>
  `;

  const state = {
    card,
    index,
    symbolInfo: startingSymbol,
    timeframe: startingTf,
    candles: generateCandles(startingSymbol, startingTf),
    liveOffset: 0,
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
      state.candles = generateCandles(state.symbolInfo, tf);
      state.liveOffset = 0;
      [...state.buttons.children].forEach(b => b.classList.toggle('active', b.textContent === tf.label));
      render(state);
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

  card.querySelector('.simulate-button').addEventListener('click', () => {
    const bump = (Math.random() - .5) * state.symbolInfo.volatility * 5;
    state.symbolInfo = { ...state.symbolInfo, base: Math.max(.01, state.symbolInfo.base + bump) };
    state.candles = generateCandles(state.symbolInfo, state.timeframe);
    render(state);
  });

  card.addEventListener('click', () => {
    document.querySelectorAll('.chart-card').forEach(el => el.classList.remove('active'));
    card.classList.add('active');
  });

  chartStates.push(state);
  render(state);
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
      state.candles = generateCandles(item, state.timeframe);
      state.liveOffset = 0;
      state.menu.classList.remove('open');
      render(state);
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
  const pad = { left: 12, right: 68, top: 16, bottom: 42 };
  const volumeHeight = Math.max(52, height * .17);
  const priceBottom = height - pad.bottom - volumeHeight - 10;
  const plotWidth = width - pad.left - pad.right;
  const priceHeight = priceBottom - pad.top;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0d1425';
  ctx.fillRect(0, 0, width, height);

  const minPrice = Math.min(...candles.map(c => c.low));
  const maxPrice = Math.max(...candles.map(c => c.high));
  const priceSpan = Math.max(.0001, maxPrice - minPrice);
  const maxVolume = Math.max(...candles.map(c => c.volume));
  const xStep = plotWidth / candles.length;
  const candleWidth = Math.max(2, Math.min(9, xStep * .62));

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
  const labelIndexes = [0, Math.floor(candles.length / 2), candles.length - 1];
  labelIndexes.forEach(idx => {
    const x = pad.left + idx * xStep;
    ctx.fillText(fmtTime(candles[idx].time, state.timeframe), x, height - 16);
  });

  state.ticker.textContent = state.symbolInfo.symbol;
  state.name.textContent = state.symbolInfo.name;
  state.price.textContent = fmtPrice(latest.close);
  state.change.textContent = `${change >= 0 ? '+' : ''}${fmtPrice(change)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
  state.change.className = `change ${change >= 0 ? 'positive' : 'negative'}`;
  state.status.textContent = `${state.timeframe.label} • ${candles.length} bars • volume enabled`;
}

function tick(state) {
  const candles = state.candles;
  const last = candles[candles.length - 1];
  const drift = (Math.random() - .48) * state.symbolInfo.volatility * .13;
  const newClose = Math.max(.01, last.close + drift);
  const updated = {
    ...last,
    close: newClose,
    high: Math.max(last.high, newClose),
    low: Math.min(last.low, newClose),
    volume: last.volume + Math.round(20 + Math.random() * 80),
  };
  candles[candles.length - 1] = updated;

  if (Math.random() > .82) {
    const newTime = last.time + state.timeframe.seconds;
    candles.push({
      time: newTime,
      open: newClose,
      high: newClose + Math.random() * state.symbolInfo.volatility * .25,
      low: Math.max(.01, newClose - Math.random() * state.symbolInfo.volatility * .25),
      close: newClose,
      volume: Math.round(220 + Math.random() * 900),
    });
    if (candles.length > 90) candles.shift();
  }

  render(state);
}

document.querySelectorAll('.chart-card').forEach(makeCard);

document.addEventListener('click', event => {
  chartStates.forEach(state => {
    if (!state.card.contains(event.target)) state.menu.classList.remove('open');
  });
});

window.addEventListener('resize', () => chartStates.forEach(render));

document.getElementById('resetAll').addEventListener('click', () => {
  chartStates.forEach(state => {
    state.candles = generateCandles(state.symbolInfo, state.timeframe);
    render(state);
  });
});

setInterval(() => chartStates.forEach(tick), 1800);
