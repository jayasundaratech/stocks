(() => {
  'use strict';

  const UTC_MINUS_7_MS = 7 * 60 * 60 * 1000;
  const CLOCK_CLASS = 'sol-chart-vancouver-clock';
  let timerId = null;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatUtcMinus7(ms = Date.now()) {
    const shifted = new Date(Number(ms) - UTC_MINUS_7_MS);
    if (Number.isNaN(shifted.getTime())) return '--:--:-- UTC-7';

    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} UTC-7`;
  }

  function ensureClock(card) {
    const wrap = card?.querySelector('.chart-canvas-wrap');
    if (!wrap) return null;

    let clock = card.querySelector(`.${CLOCK_CLASS}`);
    if (!clock) {
      clock = document.createElement('div');
      clock.className = CLOCK_CLASS;
      clock.setAttribute('role', 'timer');
      clock.setAttribute('aria-label', 'Vancouver time UTC minus 7');
      clock.title = 'Vancouver Time (UTC-7)';
      wrap.appendChild(clock);
    }

    return clock;
  }

  function render() {
    const text = formatUtcMinus7();

    document.querySelectorAll('.chart-card').forEach(card => {
      const clock = ensureClock(card);
      if (clock && clock.textContent !== text) clock.textContent = text;
    });
  }

  function start() {
    if (timerId) return;

    render();
    timerId = window.setInterval(render, 1000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') render();
    });

    const observer = new MutationObserver(render);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });
    globalThis.__chartClockObserver = observer;
  }

  function stop() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
    globalThis.__chartClockObserver?.disconnect?.();
    globalThis.__chartClockObserver = null;
    document.querySelectorAll(`.${CLOCK_CLASS}`).forEach(node => node.remove());
  }

  globalThis.__solChartClock = {
    start,
    stop,
    render,
    formatUtcMinus7,
    offset: 'UTC-7',
    scope: 'all-charts',
  };

  globalThis.__chartClock = globalThis.__solChartClock;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
