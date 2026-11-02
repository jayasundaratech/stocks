(() => {
  'use strict';

  const XAUT_SYMBOL = 'XAUTUSDT';
  const FUTURES_REST = 'https://fapi.binance.com/fapi/v1/klines';
  const FUTURES_WS_PREFIX = 'wss://fstream.binance.com/ws/';
  const VANCOUVER_TZ = 'America/Vancouver';
  const MAX_BACKFILL_PAGES = 16;
  const INTERVAL_MS = Object.freeze({
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
  });

  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;

  const vancouverClock = new Intl.DateTimeFormat('en-CA', {
    timeZone: VANCOUVER_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  function isWeekendBlackoutInstant(timeMs) {
    const date = new Date(Number(timeMs));
    if (Number.isNaN(date.getTime())) return false;

    const parts = Object.fromEntries(
      vancouverClock.formatToParts(date)
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value])
    );

    const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
    if (parts.weekday === 'Fri') return minutes >= 14 * 60;
    if (parts.weekday === 'Sat') return true;
    if (parts.weekday === 'Sun') return minutes < 15 * 60;
    return false;
  }

  function isWeekendBlackoutKline(openTimeMs, closeTimeMs) {
    const open = Number(openTimeMs);
    const close = Number(closeTimeMs);
    if (!Number.isFinite(open)) return false;
    if (isWeekendBlackoutInstant(open)) return true;
    if (Number.isFinite(close) && close > open && isWeekendBlackoutInstant(close - 1)) return true;
    return false;
  }

  function filterKlineRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(row => Array.isArray(row) && !isWeekendBlackoutKline(row[0], row[6]));
  }

  function dedupeAndTrim(rows, limit) {
    const byTime = new Map();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const openTime = Number(row[0]);
      if (!Number.isFinite(openTime)) continue;
      byTime.set(openTime, Array.from(row));
    }
    return [...byTime.values()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(-limit);
  }

  // Inject XAUTUSDT into the app's existing symbol list without changing the
  // rest of the chart application. Restore Array#map immediately after the
  // symbol list is detected.
  const nativeMap = Array.prototype.map;
  Array.prototype.map = function patchedMap(callback, thisArg) {
    const looksLikeSymbolSeed = Array.isArray(this)
      && this.some(item => Array.isArray(item) && item[0] === 'BTCUSDT')
      && this.some(item => Array.isArray(item) && item[0] === 'ADAUSDT');

    const result = nativeMap.call(this, callback, thisArg);

    if (looksLikeSymbolSeed) {
      if (!result.some(item => item?.symbol === XAUT_SYMBOL)) {
        result.push({
          symbol: XAUT_SYMBOL,
          name: 'Tether Gold / USDT · Futures',
          market: 'futures',
        });
      }
      Array.prototype.map = nativeMap;
    }

    return result;
  };

  function parseXautRestRequest(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      const isSpotKlines = url.hostname === 'api.binance.com' && url.pathname === '/api/v3/klines';
      const isFuturesKlines = url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/klines';
      if (!isSpotKlines && !isFuturesKlines) return null;
      if (url.searchParams.get('symbol')?.toUpperCase() !== XAUT_SYMBOL) return null;

      const interval = url.searchParams.get('interval') || '';
      const intervalMs = INTERVAL_MS[interval];
      if (!intervalMs) return null;

      const requested = Number(url.searchParams.get('limit'));
      const limit = Number.isFinite(requested)
        ? Math.max(1, Math.min(1500, Math.trunc(requested)))
        : 500;

      return { url, interval, intervalMs, limit };
    } catch (_) {
      return null;
    }
  }

  function buildFuturesPageUrl(meta, endTime) {
    const url = new URL(FUTURES_REST);
    url.searchParams.set('symbol', XAUT_SYMBOL);
    url.searchParams.set('interval', meta.interval);
    url.searchParams.set('limit', String(meta.limit));
    url.searchParams.set('endTime', String(endTime));
    return url;
  }

  async function fetchXautHistory(meta, init = {}) {
    const collected = [];
    let endTime = Number(meta.url.searchParams.get('endTime'));
    if (!Number.isFinite(endTime)) endTime = Date.now();
    let lastResponse = null;

    for (let page = 0; page < MAX_BACKFILL_PAGES && collected.length < meta.limit; page += 1) {
      const pageUrl = buildFuturesPageUrl(meta, endTime);
      const response = await nativeFetch(pageUrl.toString(), { ...init, cache: 'no-store' });
      lastResponse = response;
      if (!response.ok) return response;

      let rawRows;
      try {
        rawRows = await response.json();
      } catch (_) {
        return response;
      }
      if (!Array.isArray(rawRows)) rawRows = [];

      const filtered = filterKlineRows(rawRows);
      if (filtered.length) collected.unshift(...filtered);

      if (rawRows.length) {
        const earliestRaw = Number(rawRows[0]?.[0]);
        if (!Number.isFinite(earliestRaw)) break;
        endTime = earliestRaw - 1;
      } else {
        // No exchange rows at all (for example before listing). Move backward
        // once more; repeated empty pages will naturally hit the page guard.
        endTime -= meta.limit * meta.intervalMs;
      }
    }

    const rows = dedupeAndTrim(collected, meta.limit);
    const headers = new Headers(lastResponse?.headers || {});
    headers.set('content-type', 'application/json');
    headers.set('x-stocks-market', 'binance-usdm-xaut');
    headers.set('x-stocks-weekend-blackout', 'America/Vancouver Fri14:00-Sun15:00');

    return new Response(JSON.stringify(rows), {
      status: 200,
      statusText: 'OK',
      headers,
    });
  }

  window.fetch = async function routedFetch(input, init) {
    const meta = parseXautRestRequest(input);
    if (!meta) return nativeFetch(input, init);
    return fetchXautHistory(meta, init);
  };

  function routeWebSocketUrl(rawUrl) {
    const text = String(rawUrl);
    const lower = text.toLowerCase();
    if (!lower.includes('xautusdt@kline_')) return { url: text, xaut: false };

    const match = lower.match(/xautusdt@kline_[a-z0-9]+/);
    if (!match) return { url: text, xaut: false };
    return { url: `${FUTURES_WS_PREFIX}${match[0]}`, xaut: true };
  }

  function isBlockedMessage(event) {
    try {
      const payload = JSON.parse(event.data);
      const kline = payload?.k;
      if (!kline) return false;
      return isWeekendBlackoutKline(kline.t, kline.T);
    } catch (_) {
      return false;
    }
  }

  if (NativeWebSocket) {
    class RoutedWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        const routed = routeWebSocketUrl(url);
        if (protocols === undefined) super(routed.url);
        else super(routed.url, protocols);
        this.__xautFiltered = routed.xaut;
        this.__messageListenerMap = new WeakMap();
      }

      addEventListener(type, listener, options) {
        if (type !== 'message' || !this.__xautFiltered || typeof listener !== 'function') {
          return super.addEventListener(type, listener, options);
        }
        const wrapped = event => {
          if (isBlockedMessage(event)) return;
          listener.call(this, event);
        };
        this.__messageListenerMap.set(listener, wrapped);
        return super.addEventListener(type, wrapped, options);
      }

      removeEventListener(type, listener, options) {
        if (type === 'message' && this.__xautFiltered && typeof listener === 'function') {
          const wrapped = this.__messageListenerMap.get(listener);
          if (wrapped) {
            this.__messageListenerMap.delete(listener);
            return super.removeEventListener(type, wrapped, options);
          }
        }
        return super.removeEventListener(type, listener, options);
      }
    }
    window.WebSocket = RoutedWebSocket;
  }

  window.__xautMarketRouter = Object.freeze({
    symbol: XAUT_SYMBOL,
    rest: FUTURES_REST,
    websocket: FUTURES_WS_PREFIX,
    timezone: VANCOUVER_TZ,
    maxBackfillPages: MAX_BACKFILL_PAGES,
    isWeekendBlackoutInstant,
    isWeekendBlackoutKline,
  });
})();
