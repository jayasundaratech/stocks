import * as LWC from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm?stocks-wrapper=1';

export const CrosshairMode = LWC.CrosshairMode;
export const LineStyle = LWC.LineStyle;

const VANCOUVER_TZ = 'America/Vancouver';
const vancouverClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: VANCOUVER_TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function pointDate(time) {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(time);
  if (time && typeof time === 'object' && 'year' in time) {
    return new Date(Date.UTC(time.year, (time.month || 1) - 1, time.day || 1));
  }
  return null;
}

function isXautWeekendBreak(time) {
  const date = pointDate(time);
  if (!date || Number.isNaN(date.getTime())) return false;

  const parts = Object.fromEntries(
    vancouverClock.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  const minutes = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
  if (parts.weekday === 'Fri') return minutes >= 14 * 60;
  if (parts.weekday === 'Sat') return true;
  if (parts.weekday === 'Sun') return minutes < 15 * 60;
  return false;
}

function chartSymbol(container) {
  return container.closest('.chart-card')?.querySelector('.symbol-search')?.value?.trim().toUpperCase() || '';
}

function filterVolumePoint(container, point) {
  if (!point || chartSymbol(container) !== 'XAUTUSDT' || !isXautWeekendBreak(point.time)) return point;
  return { ...point, value: 0 };
}

export function createChart(container, options) {
  const chart = LWC.createChart(container, options);
  const record = { chart, container, candleSeries: null, volumeSeries: null };

  const originalAddCandlestickSeries = chart.addCandlestickSeries.bind(chart);
  chart.addCandlestickSeries = (...args) => {
    const series = originalAddCandlestickSeries(...args);
    if (!record.candleSeries) record.candleSeries = series;
    return series;
  };

  const originalAddHistogramSeries = chart.addHistogramSeries.bind(chart);
  chart.addHistogramSeries = (...args) => {
    const series = originalAddHistogramSeries(...args);
    if (!record.volumeSeries) record.volumeSeries = series;

    const originalSetData = series.setData.bind(series);
    const originalUpdate = series.update.bind(series);

    series.setData = data => originalSetData(
      Array.isArray(data) ? data.map(point => filterVolumePoint(container, point)) : data
    );
    series.update = point => originalUpdate(filterVolumePoint(container, point));

    return series;
  };

  window.__stockChartRecords ||= [];
  window.__stockChartRecords.push(record);
  window.__isXautWeekendBreak = isXautWeekendBreak;
  return chart;
}
