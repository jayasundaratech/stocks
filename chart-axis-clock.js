(() => {
  'use strict';

  const CLOCK_CLASS = 'chart-axis-live-clock';
  const FIXED_OFFSET_MS = -7 * 60 * 60 * 1000;
  let timerId = null;
  let observer = null;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function formatUtcMinus7(ms = Date.now()) {
    const shifted = new Date(Number(ms) + FIXED_OFFSET_MS);
    if (Number.isNaN(shifted.getTime())) return '--:--:-- UTC-7';
    return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())} UTC-7`;
  }

  function paneAxisHost(card, selector) {
    const pane = card.querySelector(selector);
    const body = pane?.querySelector('.oscillator-body');
    const expanded = pane && !pane.classList.contains('is-collapsed') &&
      body && getComputedStyle(body).display !== 'none';
    return expanded ? body : null;
  }

  function activeAxisHost(card) {
    return paneAxisHost(card, '.rsi-pane') ||
      paneAxisHost(card, '.stoch-pane') ||
      card.querySelector('.chart-canvas-wrap');
  }

  function ensureClock(card) {
    const host = activeAxisHost(card);
    if (!host) return null;

    let clock = card.querySelector(`.${CLOCK_CLASS}`);
    if (!clock) {
      clock = document.createElement('div');
      clock.className = CLOCK_CLASS;
      clock.setAttribute('role', 'timer');
      clock.setAttribute('aria-label', 'Current time UTC minus 7');
      clock.title = 'Current time UTC-7';
    }

    if (clock.parentElement !== host) host.appendChild(clock);
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

    observer = new MutationObserver(() => requestAnimationFrame(render));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });

    window.addEventListener('resize', render);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') render();
    });
  }

  function stop() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
    observer?.disconnect();
    observer = null;
    document.querySelectorAll(`.${CLOCK_CLASS}`).forEach(node => node.remove());
  }

  globalThis.__chartAxisClock = {
    start,
    stop,
    render,
    formatUtcMinus7,
    offset: 'UTC-7',
    placement: 'lowest-visible-time-axis-bottom-right',
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
