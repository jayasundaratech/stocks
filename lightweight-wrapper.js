import * as LWC from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm?stocks-wrapper=1';

export const CrosshairMode = LWC.CrosshairMode;
export const LineStyle = LWC.LineStyle;

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
    return series;
  };

  window.__stockChartRecords ||= [];
  window.__stockChartRecords.push(record);
  return chart;
}
