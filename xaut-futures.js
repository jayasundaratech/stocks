(() => {
  const XAUT_SYMBOL = 'XAUTUSDT';
  const FUTURES_REST = 'https://fapi.binance.com/fapi/v1/klines';
  const FUTURES_WS_PREFIX = 'wss://fstream.binance.com/market/ws/';

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
        return futures.toString();
      }
    } catch (_) {}
    return String(rawUrl);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function routedFetch(input, init) {
    if (input instanceof Request) {
      const routed = routeRestUrl(input.url);
      if (routed !== input.url) {
        return nativeFetch(new Request(routed, input), init);
      }
      return nativeFetch(input, init);
    }
    return nativeFetch(routeRestUrl(input), init);
  };

  function routeWebSocketUrl(rawUrl) {
    const text = String(rawUrl);
    const lower = text.toLowerCase();
    if (!lower.includes('xautusdt@kline_')) return text;

    const match = lower.match(/xautusdt@kline_[a-z0-9]+/);
    if (!match) return text;
    return `${FUTURES_WS_PREFIX}${match[0]}`;
  }

  const NativeWebSocket = window.WebSocket;
  class RoutedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      const routedUrl = routeWebSocketUrl(url);
      if (protocols === undefined) super(routedUrl);
      else super(routedUrl, protocols);
    }
  }
  window.WebSocket = RoutedWebSocket;

  window.__xautMarketRouter = {
    symbol: XAUT_SYMBOL,
    rest: FUTURES_REST,
    websocket: FUTURES_WS_PREFIX,
  };
})();
