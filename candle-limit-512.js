(() => {
  'use strict';

  const CANDLE_LIMIT = 512;
  const MAX_XAUT_PAGES = 16;
  const INTERVAL_MS = Object.freeze({
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
  });

  const baseFetch = window.fetch.bind(window);

  function parseKlineRequest(input) {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, window.location.href);
      const isSpot = url.hostname === 'api.binance.com' && url.pathname === '/api/v3/klines';
      const isFutures = url.hostname === 'fapi.binance.com' && url.pathname === '/fapi/v1/klines';
      if (!isSpot && !isFutures) return null;

      const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
      const interval = url.searchParams.get('interval') || '';
      if (!symbol || !INTERVAL_MS[interval]) return null;

      return {
        url,
        symbol,
        interval,
        intervalMs: INTERVAL_MS[interval],
      };
    } catch (_) {
      return null;
    }
  }

  function dedupeAndTrim(rows) {
    const byTime = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(row)) continue;
      const openTime = Number(row[0]);
      if (!Number.isFinite(openTime)) continue;
      byTime.set(openTime, Array.from(row));
    }
    return [...byTime.values()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .slice(-CANDLE_LIMIT);
  }

  class FixedCandleArray extends Array {
    static get [Symbol.species]() { return Array; }

    // app-v4.js and oscillators.js still contain their old >500 trim check.
    // Keep those files untouched and only allow a shift when the array is
    // actually above the new 512-candle cap.
    shift() {
      if (this.length > CANDLE_LIMIT) {
        return Array.prototype.shift.call(this);
      }
      return undefined;
    }
  }

  class FixedRows extends Array {
    static get [Symbol.species]() { return Array; }

    map(callback, thisArg) {
      const mapped = Array.prototype.map.call(this, callback, thisArg);
      const out = new FixedCandleArray();
      for (const item of mapped.slice(-CANDLE_LIMIT)) {
        Array.prototype.push.call(out, item);
      }
      return out;
    }
  }

  function asFixedRows(rows) {
    const out = new FixedRows();
    for (const row of dedupeAndTrim(rows)) {
      Array.prototype.push.call(out, Array.from(row));
    }
    return out;
  }

  class FixedResponse {
    constructor(response, rows, sourceUrl) {
      this.ok = response.ok;
      this.status = response.status;
      this.statusText = response.statusText;
      this.url = sourceUrl || response.url;
      this.redirected = response.redirected;
      this.type = response.type;
      this.headers = response.headers;
      this._response = response;
      this._rows = rows;
    }

    async json() { return asFixedRows(this._rows); }
    async text() { return JSON.stringify(dedupeAndTrim(this._rows)); }
    clone() { return new FixedResponse(this._response, this._rows, this.url); }
  }

  async function fetchPage(url, init) {
    const response = await baseFetch(url.toString(), init);
    if (!response.ok) return { response, rows: null };
    const rows = await response.json();
    return { response, rows: Array.isArray(rows) ? rows : [] };
  }

  async function fetchXaut(meta, init) {
    const collected = [];
    let endTime = Number(meta.url.searchParams.get('endTime'));
    if (!Number.isFinite(endTime)) endTime = Date.now();
    let lastResponse = null;

    for (let page = 0; page < MAX_XAUT_PAGES && collected.length < CANDLE_LIMIT; page += 1) {
      const pageUrl = new URL(meta.url.toString());
      pageUrl.searchParams.delete('startTime');
      pageUrl.searchParams.set('endTime', String(endTime));
      pageUrl.searchParams.set('limit', String(CANDLE_LIMIT));

      const { response, rows } = await fetchPage(pageUrl, init);
      lastResponse = response;
      if (!response.ok || rows === null) return response;

      if (rows.length) {
        collected.unshift(...rows);
        const earliest = Number(rows[0][0]);
        endTime = Number.isFinite(earliest)
          ? earliest - 1
          : endTime - CANDLE_LIMIT * meta.intervalMs;
      } else {
        // XAUT's recurring weekend blackout can produce a completely empty
        // filtered page. Step backward and keep looking for the previous
        // real candles instead of stopping early.
        endTime -= CANDLE_LIMIT * meta.intervalMs;
      }
    }

    return new FixedResponse(lastResponse || new Response('[]'), collected, meta.url.toString());
  }

  window.fetch = async function fixed512Fetch(input, init = {}) {
    const meta = parseKlineRequest(input);
    if (!meta) return baseFetch(input, init);

    if (meta.symbol === 'XAUTUSDT') {
      return fetchXaut(meta, { ...init, cache: 'no-store' });
    }

    const url = new URL(meta.url.toString());
    url.searchParams.delete('startTime');
    url.searchParams.delete('endTime');
    url.searchParams.set('limit', String(CANDLE_LIMIT));

    const { response, rows } = await fetchPage(url, { ...init, cache: 'no-store' });
    if (!response.ok || rows === null) return response;
    return new FixedResponse(response, rows, url.toString());
  };

  window.__candleHistoryLimit = Object.freeze({
    candles: CANDLE_LIMIT,
    xautMaxPages: MAX_XAUT_PAGES,
    intervalMs: INTERVAL_MS,
  });
})();
