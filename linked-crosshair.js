const records = () => Array.isArray(window.__stockChartRecords) ? window.__stockChartRecords : [];
let syncing = false;

function visibleRecords() {
  const layout = Number(document.getElementById('dashboardGrid')?.dataset.layout || '1');
  if (layout <= 1) return [];
  return records().filter(record => {
    const card = record.container?.closest('.chart-card');
    return card && !card.hidden && getComputedStyle(card).display !== 'none';
  });
}

function clearOthers(source) {
  if (syncing) return;
  syncing = true;
  try {
    for (const record of visibleRecords()) {
      if (record === source) continue;
      record.chart.clearCrosshairPosition();
    }
  } finally {
    syncing = false;
  }
}

function targetHorizontalPosition(source, target, param) {
  if (param.time != null) {
    try {
      const exact = target.chart.timeScale().timeToCoordinate(param.time);
      if (exact != null) return param.time;
    } catch (_) {}
  }

  if (!param.point) return null;
  try {
    const sourcePane = source.chart.paneSize();
    const targetPane = target.chart.paneSize();
    if (!sourcePane?.width || !targetPane?.width) return null;
    const ratio = Math.max(0, Math.min(1, param.point.x / sourcePane.width));
    return target.chart.timeScale().coordinateToTime(ratio * targetPane.width);
  } catch (_) {
    return null;
  }
}

function targetPriceAtPointer(source, target, param) {
  if (!param.point || !target.candleSeries) return null;
  try {
    const sourcePane = source.chart.paneSize();
    const targetPane = target.chart.paneSize();
    if (!sourcePane?.height || !targetPane?.height) return null;
    const ratio = Math.max(0, Math.min(1, param.point.y / sourcePane.height));
    const y = ratio * targetPane.height;
    const price = target.candleSeries.coordinateToPrice(y);
    return Number.isFinite(price) ? price : null;
  } catch (_) {
    return null;
  }
}

function syncFrom(source, param) {
  if (syncing) return;
  const targets = visibleRecords();
  if (targets.length < 2) return;

  if (!param?.point) {
    clearOthers(source);
    return;
  }

  syncing = true;
  try {
    for (const target of targets) {
      if (target === source || !target.candleSeries) continue;
      const time = targetHorizontalPosition(source, target, param);
      const price = targetPriceAtPointer(source, target, param);
      if (time == null || price == null) {
        target.chart.clearCrosshairPosition();
        continue;
      }
      target.chart.setCrosshairPosition(price, time, target.candleSeries);
    }
  } finally {
    syncing = false;
  }
}

function install() {
  const chartRecords = records();
  if (!chartRecords.length) {
    requestAnimationFrame(install);
    return;
  }

  chartRecords.forEach(record => {
    if (record.__linkedCrosshairInstalled) return;
    record.__linkedCrosshairInstalled = true;
    record.chart.subscribeCrosshairMove(param => syncFrom(record, param));
  });

  const observer = new MutationObserver(() => {
    const layout = Number(document.getElementById('dashboardGrid')?.dataset.layout || '1');
    if (layout <= 1) {
      syncing = true;
      try { chartRecords.forEach(record => record.chart.clearCrosshairPosition()); }
      finally { syncing = false; }
    }
  });
  const grid = document.getElementById('dashboardGrid');
  if (grid) observer.observe(grid, { attributes: true, attributeFilter: ['class', 'data-layout'] });
}

install();
