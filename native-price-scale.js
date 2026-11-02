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
    // Lightweight Charts price axis receives the pointer events.
    card.querySelectorAll('.price-axis-control').forEach(node => node.remove());

    const restoreNormalSeriesAutoscale = () => {
      try {
        record.candleSeries.applyOptions({
          autoscaleInfoProvider: original => original(),
        });
      } catch (_) {}
    };
    restoreNormalSeriesAutoscale();

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

    // Render a normal fitted range first, then switch the whole right scale
    // to manual mode. Native right-axis dragging now changes every series on
    // that scale together: candles, EMA, Bollinger Bands and VWAP.
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

    // app-v4 can recreate the custom axis / provider or re-enable autoscale
    // after symbol/timeframe changes. Remove/revert only those items; never
    // touch the user's manual range while autoScale is already false.
    const guard = setInterval(() => {
      if (!document.documentElement.contains(card)) {
        clearInterval(guard);
        return;
      }
      card.querySelectorAll('.price-axis-control').forEach(node => node.remove());
      try {
        const opts = scale.options?.();
        if (opts?.autoScale) {
          restoreNormalSeriesAutoscale();
          freezeManualScale();
        }
      } catch (_) {}
    }, 400);

    card.addEventListener('dblclick', () => {
      // Native double-click resets the price scale. Re-freeze the freshly
      // reset scale shortly after so subsequent drags stay fully manual.
      setTimeout(() => {
        restoreNormalSeriesAutoscale();
        freezeManualScale();
      }, 80);
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
