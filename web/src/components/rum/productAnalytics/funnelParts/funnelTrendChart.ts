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

import { chartAxisLine, chartColor, chartGridLine, chartTextColor } from "@/utils/chartTheme";
import { getColorPalette } from "@/utils/dashboard/colorPalette";
import { escapeHtml } from "@/utils/html";
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { TrendBucket, TrendPrevious, TrendSeries } from "@/utils/rum/funnelTrend";

const LINE_WIDTH = 1.5;
const SYMBOL_SIZE = 6;

/** Everything the trend chart draws; labels arrive already formatted for the viewer's zone. */
export interface TrendChartInput {
  labels: string[];
  series: { name: string; data: TrendSeries }[];
  previous: { name: string; buckets: (TrendPrevious | null)[]; labels: string[] } | null;
  stillConvertingName: I18nText;
  bandLabel: (b: TrendBucket) => I18nText | null;
  unitNoun: I18nText;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const toPct = (rate: number) => Math.round(rate * 1000) / 10;

const point = (b: TrendBucket): number | null =>
  b.rate === null || b.stillConverting || b.beforeData ? null : toPct(b.rate);

// The hollow point sits apart; the dashed series joins it to the last closed bucket before it.
const stillConvertingData = (
  buckets: TrendBucket[],
): ({ value: [number, number | null]; symbol?: string } | null)[] =>
  buckets.map((b, i) => {
    if (b.stillConverting && b.rate !== null && !b.beforeData) return { value: [i, toPct(b.rate)] };
    const next = buckets[i + 1];
    const v = point(b);
    return next?.stillConverting && next.rate !== null && v !== null
      ? { value: [i, v], symbol: "none" }
      : null;
  });

// Buckets sit on whole numbers of a value axis, so a band can span a bucket's full width.
const bands = (input: TrendChartInput, buckets: TrendBucket[]) =>
  buckets.flatMap((b, i) => {
    const label = input.bandLabel(b);
    return label ? [[{ name: label, xAxis: i - 0.5 }, { xAxis: i + 0.5 }]] : [];
  });

const tooltipFor = (input: TrendChartInput, t: TranslateFn) => (raw: unknown) => {
  const params = (Array.isArray(raw) ? raw : [raw]) as { dataIndex: number }[];
  const i = params[0]?.dataIndex ?? 0;
  const lines = [`<strong>${escapeHtml(input.labels[i] ?? "")}</strong>`];
  for (const s of input.series) {
    const b = s.data.buckets[i];
    if (!b) continue;
    const text =
      b.rate === null
        ? (input.bandLabel(b) ?? t("rum.analytics.funnel.trendNoUnits", { unit: input.unitNoun }))
        : t("rum.analytics.funnel.trendTooltipRate", {
            rate: pct(b.rate),
            reached: b.reached,
            entered: b.entered,
          });
    lines.push(`${escapeHtml(s.name)}: ${escapeHtml(String(text))}`);
  }
  const p = input.previous?.buckets[i];
  if (input.previous && p) {
    const rate =
      p.rate === null
        ? t("rum.analytics.funnel.trendNoUnits", { unit: input.unitNoun })
        : pct(p.rate);
    lines.push(
      escapeHtml(
        String(
          t("rum.analytics.funnel.trendTooltipPrev", {
            date: input.previous.labels[i] ?? "",
            rate,
          }),
        ),
      ),
    );
  }
  return lines.join("<br/>");
};

/** ECharts options drawn like the dashboard line panel, plus the gap bands and the still-converting segment. */
export function trendChartOptions(input: TrendChartInput, t: TranslateFn): Record<string, unknown> {
  const palette = getColorPalette();
  const grey = chartColor("--color-text-secondary");
  const band = chartColor("--color-surface-subtle");
  const anyRunning = input.series.some((s) => s.data.buckets.some((b) => b.stillConverting));
  const series: Record<string, unknown>[] = input.series.flatMap((s, k) => {
    const color = palette[k % palette.length];
    const main = {
      name: s.name,
      type: "line",
      smooth: true,
      connectNulls: false,
      symbol: "circle",
      symbolSize: SYMBOL_SIZE,
      color,
      lineStyle: { width: LINE_WIDTH },
      data: s.data.buckets.map((b, i) => [i, point(b)]),
      ...(k === 0
        ? {
            markArea: {
              silent: true,
              itemStyle: { color: band },
              label: { color: grey, position: "insideTop" },
              data: bands(input, s.data.buckets),
            },
          }
        : {}),
    };
    if (!anyRunning) return [main];
    return [
      main,
      {
        name: input.stillConvertingName,
        type: "line",
        connectNulls: false,
        symbol: "emptyCircle",
        symbolSize: SYMBOL_SIZE,
        color,
        lineStyle: { width: LINE_WIDTH, type: "dashed" },
        data: stillConvertingData(s.data.buckets),
      },
    ];
  });
  if (input.previous) {
    series.push({
      name: input.previous.name,
      type: "line",
      smooth: true,
      connectNulls: false,
      symbol: "emptyCircle",
      symbolSize: SYMBOL_SIZE,
      color: grey,
      lineStyle: { width: LINE_WIDTH, type: "dashed" },
      data: input.previous.buckets.map((p, i) => [i, p && p.rate !== null ? toPct(p.rate) : null]),
    });
  }
  const still = String(input.stillConvertingName);
  const names = [...new Set(series.map((s) => String(s.name)))];
  const prev = input.previous?.name ?? null;
  const legend = [
    ...names.filter((n) => n !== still && n !== prev),
    ...names.filter((n) => n === still),
    ...(prev ? [prev] : []),
  ];
  const n = input.labels.length;
  return {
    animation: false,
    grid: { left: 28, right: 16, top: 16, bottom: 32, containLabel: true },
    tooltip: { trigger: "axis", formatter: tooltipFor(input, t) },
    legend: {
      show: true,
      bottom: 0,
      type: "scroll",
      data: legend.map((name) => (name === still ? { name, icon: "emptyCircle" } : { name })),
      textStyle: { color: chartTextColor() },
    },
    xAxis: {
      type: "value",
      min: -0.5,
      max: n - 0.5,
      splitLine: { show: false },
      axisLine: { onZero: false, lineStyle: { color: chartAxisLine() } },
      axisTick: { show: false },
      axisLabel: {
        color: chartTextColor(),
        hideOverlap: true,
        customValues: input.labels.map((_, i) => i),
        formatter: (v: number) => input.labels[v] ?? "",
      },
      axisPointer: { snap: true },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: t("rum.analytics.funnel.trendAxis"),
      nameLocation: "middle",
      nameGap: 36,
      axisLine: { show: false, onZero: false },
      axisTick: { show: false },
      axisLabel: { color: chartTextColor() },
      splitLine: { lineStyle: { type: "dashed", color: chartGridLine() } },
    },
    series,
  };
}
