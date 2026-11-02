(() => {
  const installed = new WeakSet();

  function findRecord(card) {
    const host = card.querySelector('.chart-host');
    if (!host) return null;
    return (window.__stockChartRecords || []).find(record => record.container === host) || null;
  }

  function stripLegacyZoomText(card) {
    const meta = card.querySelector('.live-meta');
    if (!meta) return;
    const clean = () => {
      const current = meta.textContent || '';
      const next = current
        .replace(/\s*•\s*Price zoom\s+[0-9.]+×/g, '')
        .replace(/Price zoom\s+[0-9.]+×\s*•\s*/g, '')
        .trim();
      if (next !== current) meta.textContent = next;
    };
    clean();
    const observer = new MutationObserver(clean);
    observer.observe(meta, { childList: true, characterData: true, subtree: true });
    card.__priceMetaObserver = observer;
  }

  function enableNativePriceScale(card) {
    const record = findRecord(card);
    if (!record?.chart || !record?.candleSeries) return false;
    if (installed.has(card)) return true;

    installed.add(card);

    // The old app placed a transparent element over the real right price
    // axis. Remove it so Lightweight Charts receives the pointer events.
    card.querySelectorAll('.price-axis-control').forEach(node => node.remove());

    // app-v4 re-applies its old candle-only autoscale provider on loads/resets.
    // Neutralize only that legacy provider. All future series options are kept.
    const nativeApplySeriesOptions = record.candleSeries.applyOptions.bind(record.candleSeries);
    record.candleSeries.applyOptions = options => {
      if (options && Object.prototype.hasOwnProperty.call(options, 'autoscaleInfoProvider')) {
        options = { ...options, autoscaleInfoProvider: null };
      }
      return nativeApplySeriesOptions(options);
    };
    nativeApplySeriesOptions({ autoscaleInfoProvider: null });

    // Enable the library's native price-axis interaction. IMPORTANT: keep
    // autoscale enabled initially. Lightweight Charts itself leaves autoscale
    // when the user starts dragging the price axis; forcing autoScale=false
    // beforehand is what broke the interaction in the previous build.
    record.chart.applyOptions({
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
    });

    const scale = record.chart.priceScale('right');
    scale.applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    });

    stripLegacyZoomText(card);

    // Do not force manual mode and do not poll/re-write the scale. We only
    // keep removing the legacy overlay in case app-v4 recreates the card.
    const observer = new MutationObserver(() => {
      card.querySelectorAll('.price-axis-control').forEach(node => node.remove());
    });
    observer.observe(card, { childList: true, subtree: true });
    card.__nativePriceScaleObserver = observer;

    return true;
  }

  function installAll() {
    let pending = false;
    document.querySelectorAll('.chart-card').forEach(card => {
      if (!enableNativePriceScale(card)) pending = true;
    });
    if (pending) requestAnimationFrame(installAll);
  }

  const rootObserver = new MutationObserver(installAll);
  rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  installAll();

  window.__nativePriceScale = { installAll };
})();
