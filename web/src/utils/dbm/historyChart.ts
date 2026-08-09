// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * The ONE query-detail chart that is still a hand-built ECharts option.
 *
 * The latency and volume charts moved to the app's panel-schema convention
 * (`historyPanelSchema.ts` → `PanelSchemaRenderer`), which is where a
 * percentile line and a calls/errors bar belong. This scatter did not, for one
 * concrete reason: `PanelSchemaRenderer` does not re-emit chart clicks. It
 * binds `ChartRenderer`'s `@click` to its internal drilldown handler and its
 * `emits` list carries no `click`, so a point click never reaches the caller.
 *
 * That matters here and nowhere else: every dot is one real execution and
 * clicking it pivots to that execution's trace, which is the panel's entire
 * purpose. Expressing it as a dashboard drilldown would mean configuring a URL
 * template rather than calling the page's own `openSampleTrace`, and would lose
 * the sample lookup that maps a datum back to its trace id.
 *
 * Convert this to a schema panel the moment `PanelSchemaRenderer` forwards
 * `click` to its parent.
 */

/** Colours resolved from `--color-*` tokens by the view; never literals here. */
export interface DbmChartTheme {
  calls: string;
  errors: string;
  axisLabel: string;
  splitLine: string;
}

/**
 * The slow-sample scatter — Sentry's pattern: samples spread across BOTH time
 * and duration, so the shape of the distribution is visible rather than only
 * its tail. A tail-only table answers "what is the worst?"; the scatter also
 * answers "is the whole population slow, or is this a bimodal outlier?", which
 * is the question that decides whether to tune a query or chase a lock.
 *
 * Errored samples are marked so a cluster of failures is visible as a group.
 */
export const buildSamplesOption = (
  samples: { timestamp: number; durationNs: number; isError: boolean }[],
  theme: DbmChartTheme,
  formatNs: (value: number | null | undefined) => string,
  formatTime: (micros: number) => string,
  names: { ok: string; error: string },
): Record<string, unknown> => {
  const toPoint = (sample: { timestamp: number; durationNs: number }) => [
    sample.timestamp,
    sample.durationNs,
  ];

  return {
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    legend: { top: 0, textStyle: { color: theme.axisLabel }, icon: "circle" },
    tooltip: {
      trigger: "item",
      formatter: (params: { value: [number, number] }) =>
        `${formatTime(params.value[0])}<br/>${formatNs(params.value[1])}`,
    },
    xAxis: {
      type: "time",
      axisLabel: { hideOverlap: true, color: theme.axisLabel, formatter: formatTime },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitNumber: 3,
      axisLabel: { color: theme.axisLabel, formatter: (v: number) => formatNs(v) },
      splitLine: { lineStyle: { color: theme.splitLine } },
    },
    series: [
      {
        name: names.ok,
        type: "scatter",
        symbolSize: 7,
        itemStyle: { color: theme.calls, opacity: 0.7 },
        data: samples.filter((s) => !s.isError).map(toPoint),
      },
      {
        name: names.error,
        type: "scatter",
        symbolSize: 8,
        itemStyle: { color: theme.errors, opacity: 0.85 },
        data: samples.filter((s) => s.isError).map(toPoint),
      },
    ],
  };
};
