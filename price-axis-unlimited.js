(() => {
  const MIN_ZOOM = 0.01;
  const MAX_ZOOM = 100;
  const DRAG_SENSITIVITY = 0.01;
  const WHEEL_SENSITIVITY = 0.002;
  const controllers = new Set();

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function recordForCard(card) {
    const host = card.querySelector('.chart-host');
    if (!host) return null;
    return (window.__stockChartRecords || []).find(record => record.container === host) || null;
  }

  function formatZoom(value) {
    if (value < 0.1) return value.toFixed(3);
    if (value < 10) return value.toFixed(2);
    return value.toFixed(1);
  }

  function install(card) {
    if (card.__unlimitedPriceScaleInstalled) return true;

    const oldAxis = card.querySelector('.price-axis-control');
    const record = recordForCard(card);
    if (!oldAxis || !record?.chart || !record?.candleSeries) return false;

    card.__unlimitedPriceScaleInstalled = true;

    const axis = oldAxis.cloneNode(true);
    oldAxis.replaceWith(axis);
    axis.title = 'Drag up/down to continuously scale price range. Double-click to reset.';
    axis.style.cursor = 'ns-resize';
    axis.style.touchAction = 'none';

    const meta = card.querySelector('.live-meta');
    let zoom = 1;
    let drag = null;
    let updatingMeta = false;

    function rewriteMeta() {
      if (!meta || updatingMeta) return;
      const text = meta.textContent || '';
      const replacement = `Price zoom ${formatZoom(zoom)}×`;
      const next = /Price zoom\s+[0-9.]+×/.test(text)
        ? text.replace(/Price zoom\s+[0-9.]+×/, replacement)
        : `${text}${text ? ' • ' : ''}${replacement}`;
      if (next !== text) {
        updatingMeta = true;
        meta.textContent = next;
        updatingMeta = false;
      }
    }

    const metaObserver = meta ? new MutationObserver(rewriteMeta) : null;
    metaObserver?.observe(meta, { childList: true, characterData: true, subtree: true });

    function apply() {
      const currentZoom = zoom;
      record.candleSeries.applyOptions({
        autoscaleInfoProvider: original => {
          const info = original();
          if (!info?.priceRange) return info;
          const min = Number(info.priceRange.minValue);
          const max = Number(info.priceRange.maxValue);
          if (!Number.isFinite(min) || !Number.isFinite(max)) return info;
          const mid = (min + max) / 2;
          const baseHalf = Math.max((max - min) / 2, Math.abs(mid) * 1e-10, 1e-10);
          const half = baseHalf * currentZoom;
          return {
            ...info,
            priceRange: {
              minValue: mid - half,
              maxValue: mid + half,
            },
          };
        },
      });
      record.chart.priceScale('right').applyOptions({ autoScale: true });
      rewriteMeta();
    }

    function setZoom(value) {
      zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
      apply();
    }

    function reset() {
      zoom = 1;
      apply();
    }

    axis.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { pointerId: event.pointerId, startY: event.clientY, startZoom: zoom };
      try { axis.setPointerCapture(event.pointerId); } catch (_) {}
      event.preventDefault();
      event.stopPropagation();
    });

    axis.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dy = event.clientY - drag.startY;
      setZoom(drag.startZoom * Math.exp(dy * DRAG_SENSITIVITY));
      event.preventDefault();
      event.stopPropagation();
    });

    const stopDrag = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      try { axis.releasePointerCapture(event.pointerId); } catch (_) {}
      drag = null;
      event.preventDefault();
      event.stopPropagation();
    };
    axis.addEventListener('pointerup', stopDrag);
    axis.addEventListener('pointercancel', stopDrag);

    axis.addEventListener('dblclick', event => {
      reset();
      event.preventDefault();
      event.stopPropagation();
    });

    axis.addEventListener('wheel', event => {
      setZoom(zoom * Math.exp(event.deltaY * WHEEL_SENSITIVITY));
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false });

    const controller = { card, reset, getZoom: () => zoom, observer: metaObserver };
    card.__unlimitedPriceScaleController = controller;
    controllers.add(controller);
    apply();
    return true;
  }

  function installAll() {
    let pending = false;
    document.querySelectorAll('.chart-card').forEach(card => {
      if (!install(card)) pending = true;
    });
    if (pending) requestAnimationFrame(installAll);
  }

  document.getElementById('resetAll')?.addEventListener('click', () => {
    setTimeout(() => controllers.forEach(controller => controller.reset()), 0);
  });

  const observer = new MutationObserver(installAll);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installAll();

  window.__unlimitedPriceScale = {
    min: MIN_ZOOM,
    max: MAX_ZOOM,
    controllers,
  };
})();
