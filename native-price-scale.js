(() => {
  const controllers = new WeakMap();
  const MIN_ZOOM = 0.0025;   // very tall candles
  const MAX_ZOOM = 1000;     // very short candles
  const DRAG_SENSITIVITY = 0.010;
  const WHEEL_SENSITIVITY = 0.0018;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function findRecord(card) {
    const host = card.querySelector('.chart-host');
    if (!host) return null;
    return (window.__stockChartRecords || []).find(record => record.container === host) || null;
  }

  function stripLegacyZoomText(card) {
    const meta = card.querySelector('.live-meta');
    if (!meta || meta.__scaleTextCleaner) return;

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
    meta.__scaleTextCleaner = observer;
  }

  function makeScaledProvider(controller) {
    return original => {
      const info = original();
      if (!info?.priceRange) return info;

      const min = Number(info.priceRange.minValue);
      const max = Number(info.priceRange.maxValue);
      if (!Number.isFinite(min) || !Number.isFinite(max)) return info;

      const center = (min + max) / 2;
      const baseHalf = Math.max((max - min) / 2, Math.abs(center) * 1e-9, 1e-9);
      const half = baseHalf * controller.zoom;

      return {
        ...info,
        priceRange: {
          minValue: center - half,
          maxValue: center + half,
        },
      };
    };
  }

  function suppressOverlayAutoscale(series) {
    if (!series || series.__priceScaleAutoscaleSuppressed) return;
    series.__priceScaleAutoscaleSuppressed = true;

    const nativeApplyOptions = series.applyOptions.bind(series);
    series.applyOptions = options => {
      if (options && Object.prototype.hasOwnProperty.call(options, 'autoscaleInfoProvider')) {
        options = { ...options, autoscaleInfoProvider: () => null };
      }
      return nativeApplyOptions(options);
    };

    nativeApplyOptions({ autoscaleInfoProvider: () => null });
  }

  function refreshScale(controller) {
    const { record, provider } = controller;
    try {
      record.candleSeries.__nativeApplyOptions({ autoscaleInfoProvider: provider });
      record.chart.priceScale('right').applyOptions({ autoScale: true });
    } catch (_) {}

    controller.card.dataset.priceScaleZoom = controller.zoom.toFixed(4);
  }

  function setZoom(controller, zoom) {
    controller.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    refreshScale(controller);
  }

  function reset(controller) {
    setZoom(controller, 1);
  }

  function installController(card) {
    const record = findRecord(card);
    if (!record?.chart || !record?.candleSeries) return false;
    if (controllers.has(card)) return true;

    // Remove every older price-axis implementation. Only this controller
    // receives pointer events on the right price scale.
    card.querySelectorAll('.price-axis-control, .price-axis-control-v2').forEach(node => node.remove());

    const controller = {
      card,
      record,
      zoom: 1,
      drag: null,
      provider: null,
      axis: null,
    };
    controller.provider = makeScaledProvider(controller);

    // app-v4 still tries to restore its old candle-only provider on load/reset.
    // Keep all normal series options, but permanently substitute the stable
    // controller provider whenever that legacy option is supplied.
    const nativeApplyOptions = record.candleSeries.applyOptions.bind(record.candleSeries);
    record.candleSeries.__nativeApplyOptions = nativeApplyOptions;
    record.candleSeries.applyOptions = options => {
      if (options && Object.prototype.hasOwnProperty.call(options, 'autoscaleInfoProvider')) {
        options = { ...options, autoscaleInfoProvider: controller.provider };
      }
      return nativeApplyOptions(options);
    };

    // EMA / BB / VWAP remain attached to the same visible right scale, but
    // they no longer force its autoscale range. This is equivalent to
    // TradingView's "Scale price chart only" behavior.
    (record.lineSeries || []).forEach(suppressOverlayAutoscale);

    // Disable the library's built-in price-axis scaling so it cannot compete
    // with the unrestricted controller below. Time-axis scaling stays native.
    try {
      record.chart.applyOptions({
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: false },
          axisDoubleClickReset: { time: true, price: false },
        },
      });
      record.chart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      });
    } catch (_) {}

    nativeApplyOptions({ autoscaleInfoProvider: controller.provider });

    const axis = document.createElement('div');
    axis.className = 'price-axis-control-v2';
    axis.title = 'Drag up to make candles taller; drag down to make candles shorter. Double-click to reset.';
    axis.setAttribute('aria-label', 'Price scale zoom control');
    Object.assign(axis.style, {
      position: 'absolute',
      right: '0',
      top: '0',
      bottom: '0',
      width: '92px',
      zIndex: '12',
      cursor: 'ns-resize',
      background: 'transparent',
      touchAction: 'none',
      userSelect: 'none',
    });

    const wrap = card.querySelector('.chart-canvas-wrap');
    if (!wrap) return false;
    wrap.appendChild(axis);
    controller.axis = axis;

    axis.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      controller.drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startZoom: controller.zoom,
      };
      try { axis.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    });

    axis.addEventListener('pointermove', event => {
      const drag = controller.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dy = event.clientY - drag.startY;
      // Down = wider price range = shorter candles.
      // Up   = narrower price range = taller candles.
      setZoom(controller, drag.startZoom * Math.exp(dy * DRAG_SENSITIVITY));
      event.preventDefault();
      event.stopPropagation();
    });

    const stopDrag = event => {
      const drag = controller.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      controller.drag = null;
      try { axis.releasePointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    };
    axis.addEventListener('pointerup', stopDrag);
    axis.addEventListener('pointercancel', stopDrag);

    axis.addEventListener('wheel', event => {
      setZoom(controller, controller.zoom * Math.exp(event.deltaY * WHEEL_SENSITIVITY));
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });

    axis.addEventListener('dblclick', event => {
      reset(controller);
      event.preventDefault();
      event.stopPropagation();
    });

    // The toolbar reset must reset vertical price scale as well as time scale.
    card.querySelector('.reset-view')?.addEventListener('click', () => {
      setTimeout(() => reset(controller), 0);
    });

    stripLegacyZoomText(card);
    refreshScale(controller);
    controllers.set(card, controller);
    return true;
  }

  function installAll() {
    let pending = false;
    document.querySelectorAll('.chart-card').forEach(card => {
      if (!installController(card)) pending = true;
    });
    if (pending) requestAnimationFrame(installAll);
  }

  // Keep old app code from re-inserting its transparent axis overlay.
  const rootObserver = new MutationObserver(() => {
    document.querySelectorAll('.price-axis-control').forEach(node => node.remove());
    installAll();
  });
  rootObserver.observe(document.documentElement, { childList: true, subtree: true });

  document.getElementById('resetAll')?.addEventListener('click', () => {
    setTimeout(() => {
      document.querySelectorAll('.chart-card').forEach(card => {
        const controller = controllers.get(card);
        if (controller) reset(controller);
      });
    }, 0);
  });

  installAll();

  window.__priceScaleController = {
    installAll,
    getZoom(card) { return controllers.get(card)?.zoom ?? null; },
    reset(card) {
      const controller = controllers.get(card);
      if (controller) reset(controller);
    },
  };
})();
