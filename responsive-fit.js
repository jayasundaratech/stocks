(() => {
  const root = document.documentElement;
  const desktopQuery = window.matchMedia('(min-width: 981px)');
  let rafId = 0;

  function viewportHeight() {
    const visualHeight = window.visualViewport?.height;
    const height = Number.isFinite(visualHeight) && visualHeight > 0
      ? visualHeight
      : window.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(320, Math.round(height));
  }

  function viewportWidth() {
    const visualWidth = window.visualViewport?.width;
    const width = Number.isFinite(visualWidth) && visualWidth > 0
      ? visualWidth
      : window.innerWidth || document.documentElement.clientWidth || 0;
    return Math.max(280, Math.round(width));
  }

  function visibleElementHeight(element) {
    if (!element) return 0;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return 0;
    return Math.max(0, Math.ceil(element.getBoundingClientRect().height));
  }

  function applyScreenFit() {
    rafId = 0;

    const vh = viewportHeight();
    const vw = viewportWidth();
    const header = document.querySelector('.app-header');
    const footer = document.querySelector('.app-footer');
    const headerHeight = visibleElementHeight(header);
    const desktop = desktopQuery.matches;
    const footerHeight = desktop ? visibleElementHeight(footer) : 0;
    const contentHeight = Math.max(260, vh - headerHeight - footerHeight);

    // On stacked tablet/mobile layouts each selected chart receives roughly one
    // usable viewport. This keeps its main chart + oscillator panes readable
    // while allowing the page to scroll to the next selected chart.
    const minimumCardHeight = vw <= 460 ? 560 : 600;
    const cardHeight = Math.max(minimumCardHeight, contentHeight);

    root.style.setProperty('--app-vh', `${vh}px`);
    root.style.setProperty('--app-vw', `${vw}px`);
    root.style.setProperty('--app-header-h', `${headerHeight}px`);
    root.style.setProperty('--app-content-h', `${contentHeight}px`);
    root.style.setProperty('--responsive-card-h', `${Math.round(cardHeight)}px`);

    document.body?.setAttribute(
      'data-screen-fit',
      desktop ? 'desktop' : vw <= 460 ? 'phone' : 'tablet'
    );
  }

  function scheduleScreenFit() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(applyScreenFit);
  }

  window.addEventListener('resize', scheduleScreenFit, { passive: true });
  window.addEventListener('orientationchange', scheduleScreenFit, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleScreenFit, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleScreenFit, { passive: true });

  try {
    const resizeObserver = new ResizeObserver(scheduleScreenFit);
    const header = document.querySelector('.app-header');
    const footer = document.querySelector('.app-footer');
    if (header) resizeObserver.observe(header);
    if (footer) resizeObserver.observe(footer);
    window.__responsiveScreenFitResizeObserver = resizeObserver;
  } catch (_) {}

  try {
    document.fonts?.ready?.then(scheduleScreenFit);
  } catch (_) {}

  document.addEventListener('DOMContentLoaded', scheduleScreenFit, { once: true });
  scheduleScreenFit();

  window.__responsiveScreenFit = {
    refresh: scheduleScreenFit,
    applyNow: applyScreenFit,
  };
})();
