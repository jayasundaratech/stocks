import * as LWC from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/+esm?stocks-osc-wrapper=2';

export const CrosshairMode = LWC.CrosshairMode;
export const LineStyle = LWC.LineStyle;

export function createChart(container, options) {
  const chart = LWC.createChart(container, options);
  const record = { chart, container };
  window.__oscillatorChartRecords ||= [];
  window.__oscillatorChartRecords.push(record);
  return chart;
}
