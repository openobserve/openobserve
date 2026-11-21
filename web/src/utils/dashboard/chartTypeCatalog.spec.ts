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

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import enUS from "@/locales/languages/en-US.json";
import {
  CHART_TYPE_GROUPS,
  CHART_TYPES,
  findChartType,
  isChartTypeUnavailable,
} from "./chartTypeCatalog";

// Every panel type id the editor offered before the catalogue existed; saved panels use these.
const PANEL_TYPE_IDS = [
  "area",
  "area-stacked",
  "bar",
  "h-bar",
  "line",
  "scatter",
  "stacked",
  "h-stacked",
  "geomap",
  "maps",
  "pie",
  "donut",
  "treemap",
  "sunburst",
  "heatmap",
  "boxplot",
  "distribution",
  "state-timeline",
  "hostmap",
  "table",
  "metric",
  "gauge",
  "logs",
  "bar-gauge",
  "funnel",
  "alert-list",
  "flame-graph",
  "html",
  "markdown",
  "sankey",
  "node-graph",
  "custom_chart",
];

const PROMQL_TYPES = [
  "line",
  "area",
  "bar",
  "scatter",
  "area-stacked",
  "metric",
  "gauge",
  "bar-gauge",
  "pie",
  "donut",
  "table",
  "heatmap",
  "state-timeline",
  "hostmap",
  "h-bar",
  "stacked",
  "h-stacked",
  "geomap",
  "maps",
  "html",
  "markdown",
  "custom_chart",
];

const LOCALES_DIR = path.resolve(__dirname, "../../locales/languages");

const lookup = (messages: unknown, key: string): unknown =>
  key.split(".").reduce<any>((node, part) => node?.[part], messages);

const label = (key: string) => lookup(enUS, key) as string;

describe("chartTypeCatalog", () => {
  it("lists every panel type id exactly once", () => {
    const ids = CHART_TYPES.map((type) => type.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...PANEL_TYPE_IDS].sort());
  });

  it("groups and orders the types as the design table does", () => {
    expect(
      CHART_TYPE_GROUPS.map((group) => [
        label(group.labelKey),
        group.types.map((type) => label(type.labelKey)),
      ]),
    ).toEqual([
      ["Trends over time", ["Line", "Area", "Stacked area", "Scatter"]],
      ["Compare values", ["Bar", "Horizontal bar", "Stacked bar", "Horizontal stacked bar"]],
      ["Single value", ["Metric", "Gauge", "Bar gauge"]],
      ["Part of a whole", ["Pie", "Donut", "Treemap", "Sunburst", "Funnel"]],
      ["Distribution", ["Heatmap", "Box plot", "Distribution"]],
      ["Status", ["State timeline", "Host map", "Alert list"]],
      ["Flow and relationships", ["Sankey", "Node graph", "Flame graph"]],
      ["Maps", ["Geo map", "World map"]],
      ["Tables and logs", ["Table", "Logs"]],
      ["Text and custom", ["Markdown", "HTML", "Custom chart"]],
    ]);
  });

  it("has every name, group and keyword key in all locales", () => {
    const keys = [
      ...CHART_TYPE_GROUPS.map((group) => group.labelKey),
      ...CHART_TYPES.flatMap((type) => [type.labelKey, type.keywordsKey]),
    ];
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const messages = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
      for (const key of keys) {
        expect(typeof lookup(messages, key), `${file} ${key}`).toBe("string");
      }
    }
  });

  it("gives the intent keywords the design names", () => {
    const keywords = (id: string) => label(findChartType(id)!.keywordsKey);
    expect(keywords("metric")).toContain("kpi");
    expect(keywords("maps")).toContain("country");
    expect(keywords("gauge")).toContain("percent");
    expect(keywords("pie")).toContain("percent");
  });

  it("keeps the PromQL allow-list", () => {
    const allowed = CHART_TYPES.filter(
      (type) => !isChartTypeUnavailable(type, { promqlMode: true }),
    ).map((type) => type.id);
    expect(allowed.sort()).toEqual([...PROMQL_TYPES].sort());
  });

  it("limits the types to a host's allowed list, and an empty list limits nothing", () => {
    const line = findChartType("line")!;
    const bar = findChartType("bar")!;
    const options = { promqlMode: false, allowedChartTypes: ["line"] };
    expect(isChartTypeUnavailable(line, options)).toBe(false);
    expect(isChartTypeUnavailable(bar, options)).toBe(true);
    expect(isChartTypeUnavailable(bar, { promqlMode: false, allowedChartTypes: [] })).toBe(false);
  });
});
