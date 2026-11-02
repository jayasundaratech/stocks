(() => {
  'use strict';

  const CANDLE_LIMIT = 512;
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
      if (!symbol || !interval) return null;
      return { url, symbol, interval };
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

    // app-v4.js and oscillators.js still contain the legacy >500 trim check.
    // Keep exactly 512 candles by allowing their shift only after a new bar
    // temporarily grows the array to 513.
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

  window.fetch = async function fixed512Fetch(input, init = {}) {
    const meta = parseKlineRequest(input);
    if (!meta) return baseFetch(input, init);

    // One fixed-count policy for every market. XAUT routing/backfill is owned
    // entirely by xaut-futures.js; this layer only asks it for 512 candles.
    const url = new URL(meta.url.toString());
    url.searchParams.delete('startTime');
    url.searchParams.delete('endTime');
    url.searchParams.set('limit', String(CANDLE_LIMIT));

    const response = await baseFetch(url.toString(), { ...init, cache: 'no-store' });
    if (!response.ok) return response;

    let rows;
    try {
      rows = await response.json();
    } catch (_) {
      return response;
    }
    if (!Array.isArray(rows)) rows = [];

    return new FixedResponse(response, rows, url.toString());
  };

  window.__candleHistoryLimit = Object.freeze({
    candles: CANDLE_LIMIT,
  });
})();
