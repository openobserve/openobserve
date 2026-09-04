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
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  crosshairBg: string;
}

/**
 * The slow-sample scatter — samples spread across BOTH time
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
  names: { ok: string; error: string },
): Record<string, unknown> => {
  // Sample timestamps are microseconds; a `time` axis wants epoch milliseconds.
  const toPoint = (sample: { timestamp: number; durationNs: number }) => [
    Math.floor(sample.timestamp / 1000),
    sample.durationNs,
  ];

  const formatDateTime = (ms: number): string => {
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  return {
    grid: { left: 8, right: 8, top: 16, bottom: 28, containLabel: true },
    legend: {
      bottom: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 24,
      itemHeight: 14,
      textStyle: { color: theme.axisLabel },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        label: {
          fontSize: 12,
          backgroundColor: theme.crosshairBg,
          formatter: (params: { value: number; axisDimension: string }) =>
            params.axisDimension === "y" ? formatNs(params.value) : formatDateTime(params.value),
        },
      },
      appendToBody: true,
      className: "o2-echarts-tooltip",
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: theme.tooltipText, fontSize: 12 },
      extraCssText:
        // eslint-disable-next-line local/no-hardcoded-px -- ECharts serialises this into its own container — no CSS cascade resolves rem
        "border-radius: 8px !important; box-shadow: var(--shadow-md) !important;",
      formatter: (params: { value: [number, number]; marker?: string }[]) => {
        const points = Array.isArray(params) ? params : [params];
        if (!points.length) return "";
        const rows = points
          .map((point) => `${point.marker ?? ""}${formatNs(point.value[1])}`)
          .join("<br/>");
        return `${formatDateTime(points[0].value[0])}<br/>${rows}`;
      },
    },
    xAxis: {
      type: "time",
      axisLabel: { hideOverlap: true, color: theme.axisLabel },
      splitLine: { show: true, lineStyle: { type: "dashed", width: 1, color: theme.splitLine } },
    },
    yAxis: {
      type: "value",
      splitNumber: 3,
      axisLabel: { color: theme.axisLabel, formatter: (v: number) => formatNs(v) },
      splitLine: { lineStyle: { type: "dashed", width: 1, color: theme.splitLine } },
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
