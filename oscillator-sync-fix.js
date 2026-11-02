const mainRecords = () => Array.isArray(window.__stockChartRecords) ? window.__stockChartRecords : [];
const oscRecords = () => Array.isArray(window.__oscillatorChartRecords) ? window.__oscillatorChartRecords : [];

const nearlyEqual = (a, b) => Math.abs(Number(a) - Number(b)) < 0.5;

function sameRange(a, b) {
  if (!a || !b) return false;
  return nearlyEqual(a.from, b.from) && nearlyEqual(a.to, b.to);
}

function recordsForCard(card) {
  const mainHost = card.querySelector('.chart-host');
  const main = mainRecords().find(record => record.container === mainHost) || null;
  const hosts = [...card.querySelectorAll('.osc-chart-host')];
  const lower = hosts.map(host => oscRecords().find(record => record.container === host)).filter(Boolean);
  return { main, lower };
}

function exactSync(set) {
  if (!set.main || set.lower.length < 2 || set.syncing) return;
  const range = set.main.chart.timeScale().getVisibleRange?.();
  if (!range) return;
  set.syncing = true;
  try {
    for (const record of set.lower) {
      const scale = record.chart.timeScale();
      const current = scale.getVisibleRange?.();
      if (!sameRange(current, range)) scale.setVisibleRange(range);
    }
  } catch (_) {
  } finally {
    set.syncing = false;
  }
}

function configureAxes(set) {
  if (!set.main) return;
  try { set.main.chart.timeScale().applyOptions({ visible: false }); } catch (_) {}
  set.lower.forEach((record, index) => {
    try { record.chart.priceScale('right').applyOptions({ minimumWidth: 86 }); } catch (_) {}
    try { record.chart.timeScale().applyOptions({ visible: index === set.lower.length - 1 }); } catch (_) {}
  });
}

function installCard(card) {
  if (card.__exactOscSyncInstalled) return true;
  const set = recordsForCard(card);
  if (!set.main || set.lower.length < 2) return false;
  card.__exactOscSyncInstalled = true;
  set.syncing = false;
  card.__oscSyncSet = set;
  configureAxes(set);

  const sync = () => requestAnimationFrame(() => exactSync(set));
  const mainScale = set.main.chart.timeScale();
  if (mainScale.subscribeVisibleTimeRangeChange) mainScale.subscribeVisibleTimeRangeChange(sync);
  if (mainScale.subscribeVisibleLogicalRangeChange) mainScale.subscribeVisibleLogicalRangeChange(sync);

  for (const record of set.lower) {
    const scale = record.chart.timeScale();
    if (scale.subscribeVisibleTimeRangeChange) scale.subscribeVisibleTimeRangeChange(sync);
    if (scale.subscribeVisibleLogicalRangeChange) scale.subscribeVisibleLogicalRangeChange(sync);
  }

  exactSync(set);
  setTimeout(() => exactSync(set), 250);
  setTimeout(() => exactSync(set), 1000);
  return true;
}

function installAll() {
  let ready = true;
  document.querySelectorAll('.chart-card').forEach(card => {
    if (!installCard(card)) ready = false;
  });
  if (!ready) requestAnimationFrame(installAll);
}

installAll();

setInterval(() => {
  document.querySelectorAll('.chart-card').forEach(card => {
    const set = card.__oscSyncSet;
    if (set) exactSync(set);
  });
}, 750);
