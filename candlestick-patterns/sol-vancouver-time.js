(() => {
  'use strict';

  const UTC_MINUS_7_MS = 7 * 60 * 60 * 1000;
  const LABEL = 'Vancouver Time (UTC−7)';
  let renderQueued = false;

  function formatUtcMinus7(ms) {
    const timestamp = Number(ms);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';

    const shifted = new Date(timestamp - UTC_MINUS_7_MS);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(shifted);
  }

  function ensureFooter(container, timestamp) {
    if (!container || !Number.isFinite(Number(timestamp))) return;

    let footer = container.querySelector(':scope > .sol-vancouver-time');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'sol-vancouver-time';
      container.appendChild(footer);
    }

    const nextText = `${LABEL}: ${formatUtcMinus7(timestamp)}`;
    if (footer.textContent !== nextText) footer.textContent = nextText;
  }

  function renderToastTimes() {
    document.querySelectorAll('.sol-pattern-toast[data-key]').forEach(toast => {
      const parts = String(toast.dataset.key || '').split('|');
      const candleCloseTime = Number(parts[1]);
      ensureFooter(toast, candleCloseTime);
    });
  }

  function renderHistoryTimes() {
    const monitor = globalThis.__solPatternMonitor;
    if (!monitor?.getAlerts) return;

    const alerts = monitor.getAlerts();
    document.querySelectorAll('.chart-card').forEach(card => {
      const ticker = card.querySelector('.ticker')?.textContent?.trim().toUpperCase();
      if (ticker !== 'SOLUSDT') return;

      card.querySelectorAll('.sol-pattern-alert').forEach((alertNode, index) => {
        const alert = alerts[index];
        if (alert) ensureFooter(alertNode, alert.candleCloseTime);
      });
    });
  }

  function render() {
    renderQueued = false;
    renderToastTimes();
    renderHistoryTimes();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function start() {
    queueRender();

    const observer = new MutationObserver(queueRender);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });

    document.addEventListener('sol-pattern-scan', queueRender);
    globalThis.__solVancouverTimeObserver = observer;
    globalThis.__solVancouverTime = {
      render: queueRender,
      formatUtcMinus7,
      offset: 'UTC−7',
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
