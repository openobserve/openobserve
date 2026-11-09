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

import type { FooterData } from "@/composables/assistant/pure";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { uiIntlLocale } from "@/utils/formatters";

const LABEL = /([A-Za-z_][\w]*)\s*=~?\s*"((?:[^"\\]|\\.)*)"/g;

const PROMQL_WORDS: ReadonlySet<string> = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "offset",
  "and",
  "or",
  "unless",
  "inf",
  "nan",
]);

/** C4 series as the reducer keeps them on a step or the footer. */
export type ChartSeries = NonNullable<FooterData["chartSeries"]>;

/** The chart of an answer and the step whose result drew it, when the answer still holds that step. */
export interface AnswerChart {
  chart: ChartSeries;
  step: ContentBlock | null;
}

export interface ChartColors {
  /** The series that leads the answer. */
  lead: string;
  /** Every other series. */
  rest: string;
  axis: string;
  grid: string;
}

/** The answer's chart: the last step that drew one, else the one `complete` carried. */
export function chartOf(message: ChatMessage | null | undefined): AnswerChart | null {
  const blocks = message?.contentBlocks ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "tool_call" && block.chartSeries)
      return { chart: block.chartSeries, step: block };
  }
  const footer = blocks.find((block) => block.type === "footer")?.footer;
  return footer?.chartSeries ? { chart: footer.chartSeries, step: null } : null;
}

/** Each series' newest value, for the legend. */
export function latestValues(chart: ChartSeries): { name: string; value: number | null }[] {
  return chart.series.map((line) => ({
    name: seriesLabel(line.name),
    value: line.points.at(-1)?.[1] ?? null,
  }));
}

/** A series as a reader names it: the one label's value, else its labels, else the name as sent. */
export function seriesLabel(name: string): string {
  const open = name.indexOf("{");
  if (open < 0 || !name.trimEnd().endsWith("}")) return name;
  const labels = [...name.slice(open + 1, name.lastIndexOf("}")).matchAll(LABEL)].map(
    ([, key, value]) => [key, value.replace(/\\(.)/g, "$1")] as const,
  );
  if (!labels.length) return name.slice(0, open).trim() || name;
  if (labels.length === 1) return labels[0][1];
  return labels.map(([key, value]) => `${key}=${value}`).join(", ");
}

/** The metric a PromQL query reads, for a chart whose series carry only labels; null when it reads several. */
export function promqlMetric(query: string): string | null {
  const bare = query
    .replace(/\{[^}]*\}|\[[^\]]*\]|"[^"]*"/g, " ")
    .replace(/\b(?:by|without|on|ignoring)\s*\([^)]*\)/g, " ");
  const names = new Set(
    [...bare.matchAll(/(?<![\w.])([A-Za-z_:][\w:]*)\s*(\()?/g)]
      .filter(([, word, call]) => !call && !PROMQL_WORDS.has(word))
      .map(([, word]) => word),
  );
  const [only] = names;
  return names.size === 1 ? only : null;
}

/** The series the answer is about: the highest newest value, so one line carries the colour. */
export function leadSeries(chart: ChartSeries): number {
  let lead = 0;
  let best = -Infinity;
  chart.series.forEach((line, index) => {
    const value = line.points.at(-1)?.[1] ?? -Infinity;
    if (value > best) {
      best = value;
      lead = index;
    }
  });
  return lead;
}

/** The ECharts option for a static series set; nothing in it fetches or runs a query. */
export function chartOption(
  chart: ChartSeries,
  colors: ChartColors,
  label: (ms: number) => string,
): Record<string, unknown> {
  const lead = leadSeries(chart);
  return {
    animation: false,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", confine: true },
    legend: { show: false },
    xAxis: {
      type: "time",
      axisLabel: { color: colors.axis, formatter: (value: number) => label(value) },
      axisLine: { lineStyle: { color: colors.grid } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: colors.axis },
      splitLine: { lineStyle: { color: colors.grid } },
    },
    series: chart.series.map((line, index) => ({
      name: seriesLabel(line.name),
      type: "line",
      showSymbol: false,
      z: index === lead ? 3 : 2,
      lineStyle: { width: index === lead ? 2 : 1 },
      color: index === lead ? colors.lead : colors.rest,
      data: line.points.map(([x, y]) => [x / 1000, y]),
    })),
  };
}

/** The metric every series shares, as the card's title; null when the series name different metrics. */
export function metricOf(chart: ChartSeries): string | null {
  const names = new Set(chart.series.map((line) => line.name.split("{")[0].trim()));
  const [only] = names;
  return names.size === 1 && only && only !== "value" ? only : null;
}

/** A legend value: whole numbers grouped, fractions to two places, `—` when the series has none. */
export function valueText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(uiIntlLocale(), {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}
