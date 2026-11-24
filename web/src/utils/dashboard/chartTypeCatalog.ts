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

import type { I18nKey } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

export interface ChartTypeEntry {
  /** Panel type id saved in the panel JSON (`data.type`). */
  id: string;
  /** Path under the app's public images, resolved with `getImageURL`. */
  icon: string;
  labelKey: I18nKey;
  /** Space-separated words the search matches besides the name. */
  keywordsKey: I18nKey;
  promqlAllowed: boolean;
}

export interface ChartTypeGroup {
  id: string;
  labelKey: I18nKey;
  types: readonly ChartTypeEntry[];
}

const entry = (id: string, icon: string, key: string, promqlAllowed: boolean): ChartTypeEntry => ({
  id,
  icon: `images/dashboard/charts/${icon}`,
  labelKey: `dashboard.chartTypes.names.${key}` as I18nKey,
  keywordsKey: `dashboard.chartTypes.keywords.${key}` as I18nKey,
  promqlAllowed,
});

const group = (id: string, types: ChartTypeEntry[]): ChartTypeGroup => ({
  id,
  labelKey: `dashboard.chartTypes.groups.${id}` as I18nKey,
  types,
});

/** Every panel type the editor offers, in the order and groups the picker shows them. */
export const CHART_TYPE_GROUPS: readonly ChartTypeGroup[] = [
  group("trends", [
    entry("line", "line-chart.svg", "line", true),
    entry("area", "area.svg", "area", true),
    entry("area-stacked", "area-graph.svg", "areaStacked", true),
    entry("scatter", "scatter-graph.svg", "scatter", true),
  ]),
  group("compare", [
    entry("bar", "bar-chart.svg", "bar", true),
    entry("h-bar", "bar-graph.svg", "hBar", true),
    entry("stacked", "stacked.svg", "stacked", true),
    entry("h-stacked", "h-stacked.svg", "hStacked", true),
  ]),
  group("single", [
    entry("metric", "123.svg", "metric", true),
    entry("gauge", "Gauge.svg", "gauge", true),
    entry("bar-gauge", "bar-gauge.svg", "barGauge", true),
  ]),
  group("parts", [
    entry("pie", "pie-chart.svg", "pie", true),
    entry("donut", "donut-chart.svg", "donut", true),
    entry("treemap", "treemap.svg", "treemap", false),
    entry("sunburst", "sunburst.svg", "sunburst", false),
    entry("funnel", "funnel.svg", "funnel", false),
  ]),
  group("distribution", [
    entry("heatmap", "heatmap.svg", "heatmap", true),
    entry("boxplot", "boxplot.svg", "boxplot", false),
    entry("distribution", "distribution.svg", "distribution", false),
  ]),
  group("status", [
    entry("state-timeline", "state-timeline.svg", "stateTimeline", true),
    entry("hostmap", "hostmap.svg", "hostmap", true),
    entry("alert-list", "alert-list.svg", "alertList", false),
  ]),
  group("flow", [
    entry("sankey", "sankey.svg", "sankey", false),
    entry("node-graph", "node-graph.svg", "nodeGraph", false),
    entry("flame-graph", "flame-graph.svg", "flameGraph", false),
  ]),
  group("maps", [
    entry("geomap", "geomap.svg", "geomap", true),
    entry("maps", "world-map.svg", "maps", true),
  ]),
  group("tables", [
    entry("table", "table.svg", "table", true),
    entry("logs", "logs.svg", "logs", false),
  ]),
  group("text", [
    entry("markdown", "Markdown.svg", "markdown", true),
    entry("html", "HTML.svg", "html", true),
    entry("custom_chart", "chart.svg", "customChart", true),
  ]),
];

export const CHART_TYPES: readonly ChartTypeEntry[] = CHART_TYPE_GROUPS.flatMap((g) => g.types);

export const findChartType = (id: unknown): ChartTypeEntry | undefined =>
  CHART_TYPES.find((type) => type.id === id);

export const chartTypeIconUrl = (type: ChartTypeEntry): string => getImageURL(type.icon);

/** A type is offered but not selectable when PromQL cannot draw it or the host editor limits the types. */
export const isChartTypeUnavailable = (
  type: ChartTypeEntry,
  { promqlMode, allowedChartTypes }: { promqlMode: boolean; allowedChartTypes?: readonly string[] },
): boolean => {
  if (promqlMode && !type.promqlAllowed) return true;
  return !!allowedChartTypes?.length && !allowedChartTypes.includes(type.id);
};
