(() => {
  const installed = new WeakSet();

  function findRecord(card) {
    const host = card.querySelector('.chart-host');
    if (!host) return null;
    return (window.__stockChartRecords || []).find(record => record.container === host) || null;
  }

  function enableNativePriceScale(card) {
    const record = findRecord(card);
    if (!record?.chart || !record?.candleSeries) return false;
    if (installed.has(card)) return true;

    installed.add(card);

    // Remove the custom transparent price-axis overlay so the actual
    // Lightweight Charts price axis receives the mouse/pointer events.
    card.querySelectorAll('.price-axis-control').forEach(node => node.remove());

    try {
      // Restore normal series autoscaling. The PRICE SCALE itself is what
      // should be manually resized, not only the candlestick series.
      record.candleSeries.applyOptions({ autoscaleInfoProvider: undefined });
    } catch (_) {}

    try {
      record.chart.applyOptions({
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
        },
      });
    } catch (_) {}

    const scale = record.chart.priceScale('right');

    // Let the current fitted range render first, then freeze it. From this
    // point the native right-axis drag changes the whole price scale exactly
    // like TradingView (candles + EMA/BB/VWAP together).
    const freezeManualScale = () => {
      try {
        scale.applyOptions({
          autoScale: false,
          scaleMargins: { top: 0.08, bottom: 0.08 },
        });
      } catch (_) {}
    };

    requestAnimationFrame(() => requestAnimationFrame(freezeManualScale));
    setTimeout(freezeManualScale, 150);
    setTimeout(freezeManualScale, 750);

    // app-v4 can turn autoscale back on after symbol/timeframe reloads.
    // Re-freeze only when it has been re-enabled; this does not overwrite
    // the user's manual scale while it is already off.
    const guard = setInterval(() => {
      if (!document.documentElement.contains(card)) {
        clearInterval(guard);
        return;
      }
      try {
        const opts = scale.options?.();
        if (opts?.autoScale) freezeManualScale();
      } catch (_) {}
      card.querySelectorAll('.price-axis-control').forEach(node => node.remove());
    }, 400);

    // Double-clicking the real price scale is handled natively by LWC.
    // After reset it may re-enable autoscale, so freeze the freshly reset
    // range shortly afterward without changing the user's horizontal range.
    card.addEventListener('dblclick', () => {
      setTimeout(freezeManualScale, 80);
    }, true);

    card.__nativePriceScaleGuard = guard;
    return true;
  }

  function installAll() {
    let pending = false;
    document.querySelectorAll('.chart-card').forEach(card => {
      if (!enableNativePriceScale(card)) pending = true;
    });
    if (pending) requestAnimationFrame(installAll);
  }

  const observer = new MutationObserver(installAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installAll();

  window.__nativePriceScale = { installAll };
})();
