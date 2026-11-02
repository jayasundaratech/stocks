(() => {
  'use strict';

  const DAYS = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;

  window.__STOCKS_HISTORY_CONFIG = Object.freeze({
    days: DAYS,
    windowMs: DAYS * DAY_MS,
    maxPages: 64,
    cacheMaxAgeMs: 60 * DAY_MS,
  });
})();
