(() => {
  const controllers = new WeakMap();
  const MIN_ZOOM = 0.0025;
  const MAX_ZOOM = 1000;
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

      const baseCenter = (min + max) / 2;
      const baseHalf = Math.max((max - min) / 2, Math.abs(baseCenter) * 1e-9, 1e-9);
      const half = baseHalf * controller.zoom;
      const center = baseCenter + controller.offset;

      controller.lastBaseCenter = baseCenter;
      controller.lastBaseHalf = baseHalf;
      controller.lastRenderedHalf = half;

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
    controller.card.dataset.priceScaleOffset = controller.offset.toFixed(8);
  }

  function setZoom(controller, zoom) {
    controller.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    refreshScale(controller);
  }

  function setOffset(controller, offset) {
    controller.offset = Number.isFinite(offset) ? offset : 0;
    refreshScale(controller);
  }

  function reset(controller) {
    controller.zoom = 1;
    controller.offset = 0;
    refreshScale(controller);
  }

  function installChartBodyPan(controller) {
    const host = controller.record.container;
    if (!host || host.__priceBodyPanInstalled) return;
    host.__priceBodyPanInstalled = true;

    const startBodyDrag = event => {
      if (event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      controller.bodyDrag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startOffset: controller.offset,
        height: rect.height,
        renderedHalf: Math.max(controller.lastRenderedHalf || 0, 1e-9),
      };

      // IMPORTANT: do not preventDefault or stopPropagation here.
      // Lightweight Charts still receives the same pointer event and keeps
      // its normal left/right time panning while this controller adds only
      // vertical price-range translation.
    };

    const moveBodyDrag = event => {
      const drag = controller.bodyDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if ((event.buttons & 1) !== 1) return;

      const dy = event.clientY - drag.startY;
      const fullRange = drag.renderedHalf * 2;
      const priceDelta = (dy / Math.max(1, drag.height)) * fullRange;

      // Drag chart downward -> candles move downward on screen.
      // That requires moving the visible price range upward.
      setOffset(controller, drag.startOffset + priceDelta);

      // Deliberately do not cancel/stop the event: horizontal pan remains
      // handled by Lightweight Charts in the same gesture.
    };

    const stopBodyDrag = event => {
      const drag = controller.bodyDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      controller.bodyDrag = null;
    };

    host.addEventListener('pointerdown', startBodyDrag, true);
    window.addEventListener('pointermove', moveBodyDrag, true);
    window.addEventListener('pointerup', stopBodyDrag, true);
    window.addEventListener('pointercancel', stopBodyDrag, true);

    controller.bodyPanCleanup = () => {
      host.removeEventListener('pointerdown', startBodyDrag, true);
      window.removeEventListener('pointermove', moveBodyDrag, true);
      window.removeEventListener('pointerup', stopBodyDrag, true);
      window.removeEventListener('pointercancel', stopBodyDrag, true);
      delete host.__priceBodyPanInstalled;
    };
  }

  function installController(card) {
    const record = findRecord(card);
    if (!record?.chart || !record?.candleSeries) return false;
    if (controllers.has(card)) return true;

    card.querySelectorAll('.price-axis-control, .price-axis-control-v2').forEach(node => node.remove());

    const controller = {
      card,
      record,
      zoom: 1,
      offset: 0,
      drag: null,
      bodyDrag: null,
      provider: null,
      axis: null,
      lastBaseCenter: 0,
      lastBaseHalf: 1,
      lastRenderedHalf: 1,
    };
    controller.provider = makeScaledProvider(controller);

    const nativeApplyOptions = record.candleSeries.applyOptions.bind(record.candleSeries);
    record.candleSeries.__nativeApplyOptions = nativeApplyOptions;
    record.candleSeries.applyOptions = options => {
      if (options && Object.prototype.hasOwnProperty.call(options, 'autoscaleInfoProvider')) {
        options = { ...options, autoscaleInfoProvider: controller.provider };
      }
      return nativeApplyOptions(options);
    };

    (record.lineSeries || []).forEach(suppressOverlayAutoscale);
    record.onLineSeriesAdded = suppressOverlayAutoscale;

    try {
      record.chart.applyOptions({
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: false,
        },
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

    installChartBodyPan(controller);

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
    getOffset(card) { return controllers.get(card)?.offset ?? null; },
    reset(card) {
      const controller = controllers.get(card);
      if (controller) reset(controller);
    },
  };
})();
