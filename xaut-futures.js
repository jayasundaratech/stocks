(() => {
  const XAUT_SYMBOL = 'XAUTUSDT';
  const FUTURES_REST = 'https://fapi.binance.com/fapi/v1/klines';
  const FUTURES_WS_PREFIX = 'wss://fstream.binance.com/market/ws/';
  const VANCOUVER_TZ = 'America/Vancouver';

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

  // Remove any candle that touches the weekly XAUT blackout. Checking both
  // ends handles larger candles (1h/4h/1d) that cross the Friday/Sunday edge.
  function isWeekendBlackoutKline(openTimeMs, closeTimeMs) {
    const open = Number(openTimeMs);
    const close = Number(closeTimeMs);
    if (!Number.isFinite(open)) return false;
    if (isWeekendBlackoutInstant(open)) return true;
    if (Number.isFinite(close) && close > open && isWeekendBlackoutInstant(close - 1)) return true;
    return false;
  }

  function filterKlineRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.filter(row => {
      if (!Array.isArray(row)) return true;
      return !isWeekendBlackoutKline(row[0], row[6]);
    });
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

  function routeRestUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.hostname === 'api.binance.com'
          && url.pathname === '/api/v3/klines'
          && url.searchParams.get('symbol')?.toUpperCase() === XAUT_SYMBOL) {
        const futures = new URL(FUTURES_REST);
        for (const [key, value] of url.searchParams.entries()) {
          futures.searchParams.set(key, value);
        }
        return { url: futures.toString(), xaut: true };
      }
      if (url.hostname === 'fapi.binance.com'
          && url.pathname === '/fapi/v1/klines'
          && url.searchParams.get('symbol')?.toUpperCase() === XAUT_SYMBOL) {
        return { url: url.toString(), xaut: true };
      }
    } catch (_) {}
    return { url: String(rawUrl), xaut: false };
  }

  async function filterXautResponse(response) {
    if (!response?.ok) return response;
    try {
      const payload = await response.clone().json();
      const filtered = filterKlineRows(payload);
      return new Response(JSON.stringify(filtered), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (_) {
      return response;
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function routedFetch(input, init) {
    if (input instanceof Request) {
      const routed = routeRestUrl(input.url);
      const request = routed.url !== input.url ? new Request(routed.url, input) : input;
      const response = await nativeFetch(request, init);
      return routed.xaut ? filterXautResponse(response) : response;
    }

    const routed = routeRestUrl(input);
    const response = await nativeFetch(routed.url, init);
    return routed.xaut ? filterXautResponse(response) : response;
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

  const NativeWebSocket = window.WebSocket;
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

  window.__xautMarketRouter = {
    symbol: XAUT_SYMBOL,
    rest: FUTURES_REST,
    websocket: FUTURES_WS_PREFIX,
    timezone: VANCOUVER_TZ,
    isWeekendBlackoutInstant,
    isWeekendBlackoutKline,
  };
})();
