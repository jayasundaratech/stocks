import * as LWC from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm?stocks-osc-wrapper=3';

export const CrosshairMode = LWC.CrosshairMode;
export const LineStyle = LWC.LineStyle;

function numericTime(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && Number.isFinite(value.timestamp)) return Number(value.timestamp);
  return null;
}

function detectInterval(data) {
  if (!Array.isArray(data) || data.length < 2) return null;
  for (let i = data.length - 1; i > 0; i--) {
    const a = numericTime(data[i - 1]?.time);
    const b = numericTime(data[i]?.time);
    const diff = a != null && b != null ? b - a : 0;
    if (diff > 0) return diff;
  }
  return null;
}

function expandAnchorData(data, intervalSec) {
  if (!Array.isArray(data) || data.length !== 2 || !intervalSec) return data;
  const first = numericTime(data[0]?.time);
  const last = numericTime(data[1]?.time);
  if (first == null || last == null || last <= first) return data;

  const count = Math.round((last - first) / intervalSec) + 1;
  if (!Number.isFinite(count) || count < 2 || count > 2000) return data;

  const value = Number.isFinite(data[0]?.value) ? data[0].value : 50;
  return Array.from({ length: count }, (_, index) => ({
    time: first + index * intervalSec,
    value,
  }));
}

export function createChart(container, options) {
  const chart = LWC.createChart(container, options);
  const record = { chart, container, lineSeries: [], intervalSec: null, anchorSeries: null };

  const originalAddLineSeries = chart.addLineSeries.bind(chart);
  chart.addLineSeries = (seriesOptions = {}, ...rest) => {
    const series = originalAddLineSeries(seriesOptions, ...rest);
    const isAnchor = String(seriesOptions?.color || '').replace(/\s/g, '') === 'rgba(0,0,0,0)';
    const seriesRecord = { series, options: seriesOptions, isAnchor };
    record.lineSeries.push(seriesRecord);
    if (isAnchor) record.anchorSeries = series;

    const originalSetData = series.setData.bind(series);
    series.setData = data => {
      if (!isAnchor) {
        const detected = detectInterval(data);
        if (detected) record.intervalSec = detected;
        originalSetData(data);
        return;
      }

      const expanded = expandAnchorData(data, record.intervalSec);
      seriesRecord.lastData = expanded;
      originalSetData(expanded);
    };

    return series;
  };

  window.__oscillatorChartRecords ||= [];
  window.__oscillatorChartRecords.push(record);
  return chart;
}
