(() => {
  'use strict';

  const HISTORY_CONFIG = window.__STOCKS_HISTORY_CONFIG || {};
  const HISTORY_DAYS = Math.max(1, Number(HISTORY_CONFIG.days) || 7);
  const HISTORY_WINDOW_MS = Number(HISTORY_CONFIG.windowMs) || HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const PAGE_LIMIT = 1000;
  const MAX_PAGES = Math.max(1, Number(HISTORY_CONFIG.maxPages) || 24);
  const DB_NAME = 'stocks-history-v1';
  const DB_VERSION = 1;
  const STORE_NAME = 'series';
  const CACHE_MAX_AGE_MS = Number(HISTORY_CONFIG.cacheMaxAgeMs) || 14 * 24 * 60 * 60 * 1000;
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
  const memoryCache = new Map();
  const inflight = new Map();
  const livePending = new Map();
  let liveFlushTimer = null;
  let dbPromise = null;

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
        key: `${symbol}:${interval}`,
      };
    } catch (_) {
      return null;
    }
  }

  function parseKlineStream(rawUrl) {
    const text = String(rawUrl || '').toLowerCase();
    const match = text.match(/([a-z0-9]+)@kline_(1m|5m|15m|1h|4h|1d)/i);
    if (!match) return null;
    const symbol = match[1].toUpperCase();
    const interval = match[2];
    return {
      symbol,
      interval,
      intervalMs: INTERVAL_MS[interval],
      key: `${symbol}:${interval}`,
    };
  }

  function dedupeAndPruneRows(rows, nowMs = Date.now()) {
    const cutoff = nowMs - HISTORY_WINDOW_MS;
    const byTime = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(row)) continue;
      const openTime = Number(row[0]);
      if (!Number.isFinite(openTime) || openTime < cutoff || openTime > nowMs + 86_400_000) continue;
      byTime.set(openTime, Array.from(row));
    }

    return [...byTime.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }

  function mergeRows(...groups) {
    return dedupeAndPruneRows(groups.flat(), Date.now());
  }

  class RollingHistoryCandleArray extends Array {
    static get [Symbol.species]() { return Array; }

    push(...items) {
      const result = Array.prototype.push.apply(this, items);
      const cutoffSeconds = (Date.now() - HISTORY_WINDOW_MS) / 1000;
      while (this.length && Number(this[0]?.time) < cutoffSeconds) {
        Array.prototype.shift.call(this);
      }
      return result;
    }

    // app-v4 still contains the legacy fixed-500 trim. The history array
    // already prunes by age, so neutralize that one old shift call.
    shift() {
      return undefined;
    }
  }

  class RollingHistoryRows extends Array {
    static get [Symbol.species]() { return Array; }

    map(callback, thisArg) {
      const mapped = Array.prototype.map.call(this, callback, thisArg);
      const rolling = new RollingHistoryCandleArray();
      for (const item of mapped) Array.prototype.push.call(rolling, item);
      return rolling;
    }
  }

  function asHistoryRows(rows) {
    const out = new RollingHistoryRows();
    for (const row of rows) Array.prototype.push.call(out, Array.from(row));
    return out;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in window)) {
      dbPromise = Promise.resolve(null);
      return dbPromise;
    }

    dbPromise = new Promise(resolve => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });

    return dbPromise;
  }

  async function readCache(key) {
    const memory = memoryCache.get(key);
    if (memory) return dedupeAndPruneRows(memory.rows, Date.now());

    const db = await openDb();
    if (!db) return [];

    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => {
          const record = request.result;
          if (!record?.rows) return resolve([]);
          const rows = dedupeAndPruneRows(record.rows, Date.now());
          memoryCache.set(key, { rows, updatedAt: Number(record.updatedAt || 0) });
          resolve(rows);
        };
        request.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function writeCache(key, rows) {
    const clean = dedupeAndPruneRows(rows, Date.now());
    const record = { key, rows: clean, updatedAt: Date.now() };
    memoryCache.set(key, record);

    const db = await openDb();
    if (!db) return;

    await new Promise(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch (_) {
        resolve();
      }
    });
  }

  async function cleanupCache() {
    const db = await openDb();
    if (!db) return;
    const staleBefore = Date.now() - CACHE_MAX_AGE_MS;

    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (Number(cursor.value?.updatedAt || 0) < staleBefore) cursor.delete();
        cursor.continue();
      };
    } catch (_) {}
  }

  function buildPageUrl(meta, cursorMs, endMs) {
    const url = new URL(meta.url.toString());
    url.searchParams.set('startTime', String(cursorMs));
    url.searchParams.set('endTime', String(endMs));
    url.searchParams.set('limit', String(PAGE_LIMIT));
    return url.toString();
  }

  async function fetchPage(meta, cursorMs, endMs) {
    const response = await nativeFetch(buildPageUrl(meta, cursorMs, endMs), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Binance REST ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  }

  async function fetchHistoryWindow(meta) {
    const nowMs = Date.now();
    const cutoffMs = nowMs - HISTORY_WINDOW_MS;
    const alignedStart = Math.floor(cutoffMs / meta.intervalMs) * meta.intervalMs;
    const cached = await readCache(meta.key);

    let fetchStart = alignedStart;
    if (cached.length) {
      const first = Number(cached[0][0]);
      const last = Number(cached[cached.length - 1][0]);
      const coversStart = first <= alignedStart + meta.intervalMs;
      if (coversStart && Number.isFinite(last)) {
        // Re-fetch two bars to repair the still-open candle and any missed tick.
        fetchStart = Math.max(alignedStart, last - 2 * meta.intervalMs);
      }
    }

    const fetched = [];
    let cursor = fetchStart;
    let pages = 0;

    while (cursor <= nowMs && pages < MAX_PAGES) {
      const rows = await fetchPage(meta, cursor, nowMs);
      fetched.push(...rows);

      // Advance by a complete Binance page width even when another wrapper
      // (XAUT weekend blackout) filters every row out of a page.
      cursor += PAGE_LIMIT * meta.intervalMs;
      pages += 1;
    }

    const merged = mergeRows(cached, fetched);
    await writeCache(meta.key, merged);
    return merged;
  }

  class HistoryResponse {
    constructor(rows, sourceUrl) {
      this.ok = true;
      this.status = 200;
      this.statusText = 'OK';
      this.url = sourceUrl;
      this.redirected = false;
      this.type = 'basic';
      this.headers = new Headers({
        'content-type': 'application/json',
        'x-stocks-history-window': `${HISTORY_DAYS}d`,
      });
      this._rows = rows;
    }

    async json() { return asHistoryRows(this._rows); }
    async text() { return JSON.stringify(this._rows); }
    clone() { return new HistoryResponse(this._rows, this.url); }
  }

  async function historyFetch(input, init) {
    const meta = parseKlineRequest(input);
    if (!meta) return nativeFetch(input, init);

    let promise = inflight.get(meta.key);
    if (!promise) {
      promise = fetchHistoryWindow(meta)
        .catch(async error => {
          const cached = await readCache(meta.key);
          if (cached.length) return cached;
          throw error;
        })
        .finally(() => inflight.delete(meta.key));
      inflight.set(meta.key, promise);
    }

    const rows = await promise;
    return new HistoryResponse(rows, meta.url.toString());
  }

  window.fetch = historyFetch;

  function rowFromKline(kline) {
    return [
      Number(kline.t), String(kline.o), String(kline.h), String(kline.l), String(kline.c), String(kline.v),
      Number(kline.T), String(kline.q ?? '0'), Number(kline.n ?? 0), String(kline.V ?? '0'), String(kline.Q ?? '0'), String(kline.B ?? '0'),
    ];
  }

  function scheduleLiveCache(meta, row) {
    livePending.set(meta.key, { meta, row });
    if (liveFlushTimer) return;

    liveFlushTimer = setTimeout(async () => {
      liveFlushTimer = null;
      const pending = [...livePending.values()];
      livePending.clear();

      for (const item of pending) {
        const current = await readCache(item.meta.key);
        await writeCache(item.meta.key, mergeRows(current, [item.row]));
      }
    }, 1000);
  }

  if (NativeWebSocket) {
    class HistoryWebSocket extends NativeWebSocket {
      constructor(url, protocols) {
        if (protocols === undefined) super(url);
        else super(url, protocols);

        const meta = parseKlineStream(url);
        if (!meta) return;

        this.addEventListener('message', event => {
          try {
            const payload = JSON.parse(event.data);
            const kline = payload?.k;
            if (!kline || !Number.isFinite(Number(kline.t))) return;
            scheduleLiveCache(meta, rowFromKline(kline));
          } catch (_) {}
        });
      }
    }

    window.WebSocket = HistoryWebSocket;
  }

  cleanupCache();

  window.__historyStore = Object.freeze({
    days: HISTORY_DAYS,
    windowMs: HISTORY_WINDOW_MS,
    pageLimit: PAGE_LIMIT,
    maxPages: MAX_PAGES,
    intervalMs: INTERVAL_MS,
    async get(symbol, interval) {
      return readCache(`${String(symbol).toUpperCase()}:${interval}`);
    },
    async stats(symbol, interval) {
      const rows = await readCache(`${String(symbol).toUpperCase()}:${interval}`);
      return {
        symbol: String(symbol).toUpperCase(),
        interval,
        days: HISTORY_DAYS,
        candles: rows.length,
        firstOpenTime: rows.length ? Number(rows[0][0]) : null,
        lastOpenTime: rows.length ? Number(rows[rows.length - 1][0]) : null,
      };
    },
  });
})();
