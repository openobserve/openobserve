// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import metrics from "./metrics.json";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import { SERIES_OVERRIDE_MATCH_BY } from "@/utils/dashboard/seriesOverrides";
import { deepCopy } from "@/utils/zincutils";

export type TracesRedChart = "rate" | "errors" | "duration";

export interface TracesRedPanelInput {
  streamName: string;
  /** WHERE fragment already resolved by resolveTracesFilter. */
  filter: string;
  /** The editor text the title shows; falls back to the stream when blank. */
  filterText: string;
  view: "traces" | "spans";
  /** The bucket the charts use now; a dashboard variable cannot be divided by in Rate. */
  interval: { sql: string; seconds: number };
  rateUnit: string;
}

const TITLE_MAX = 60;
const CHART_TITLES: Record<TracesRedChart, string> = {
  rate: "Rate",
  errors: "Errors",
  duration: "Duration",
};
const PERCENTILES = [0.5, 0.95, 0.99];
const ERROR_ONLY = "span_status = 'ERROR'";

export const tracesPanelTitle = (chart: string, filterText: string, streamName: string): string =>
  `${chart} · ${filterText.trim() || streamName}`.slice(0, TITLE_MAX);

const sourcePanel = (title: "Rate" | "Errors"): any =>
  convertDashboardSchemaVersion(deepCopy(metrics)).tabs[0].panels.find(
    (panel: { title: string }) => panel.title === title,
  );

const whereClause = (terms: string[]): string => {
  const kept = terms.filter(Boolean);
  return kept.length ? `WHERE ${kept.join(" AND ")}` : "";
};

const swapPlaceholders = (query: string, input: TracesRedPanelInput, where: string): string =>
  query
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ ?\[WHERE_CLAUSE\]/, () => (where ? ` ${where}` : ""))
    .replace("[STREAM_NAME]", () => `"${input.streamName}"`)
    .replace("[INTERVAL]", input.interval.sql)
    .replace("[INTERVAL_SECONDS]", String(input.interval.seconds));

const toSpanCounts = (query: string): string =>
  query
    .replace(
      /approx_distinct\(trace_id\)\s+filter\s*\(where\s+span_status\s*=\s*'ERROR'\)/gi,
      "count(*) FILTER (WHERE span_status = 'ERROR')",
    )
    .replace(/approx_distinct\(trace_id\)/gi, "count(*)");

const rateOrErrorsPanel = (chart: "rate" | "errors", input: TracesRedPanelInput): any => {
  const panel = sourcePanel(chart === "rate" ? "Rate" : "Errors");
  const filter = input.filter.trim();
  const where =
    chart === "errors" ? whereClause([ERROR_ONLY, filter && `(${filter})`]) : whereClause([filter]);
  let query = swapPlaceholders(panel.queries[0].query, input, where);
  if (input.view === "spans") query = toSpanCounts(query);
  panel.queries[0].query = query;
  panel.queries[0].fields.stream = input.streamName;
  if (chart === "rate") {
    panel.config.title_meta = input.rateUnit;
    panel.config.override_config = [
      {
        field: { matchBy: SERIES_OVERRIDE_MATCH_BY.REGEX, value: ".*" },
        config: [{ type: "unit", value: { unit: "custom", customUnit: input.rateUnit } }],
      },
    ];
  }
  return panel;
};

const durationPanel = (input: TracesRedPanelInput): any => {
  const panel = sourcePanel("Rate");
  const aliases = PERCENTILES.map((p) => `p${Math.round(p * 100)}`);
  const selects = PERCENTILES.map(
    (p, i) => `approx_percentile_cont(duration, ${p}) AS ${aliases[i]}`,
  ).join(", ");
  const template = `SELECT histogram(_timestamp, '[INTERVAL]') AS time_bucket, ${selects} FROM [STREAM_NAME] [WHERE_CLAUSE] GROUP BY time_bucket ORDER BY time_bucket ASC`;
  const query = panel.queries[0];
  query.query = swapPlaceholders(template, input, whereClause([input.filter.trim()]));
  query.fields.stream = input.streamName;
  query.fields.y = aliases.map((alias) => ({
    ...query.fields.y[0],
    alias,
    column: alias,
    color: null,
    aggregationFunction: null,
  }));
  panel.config = {
    ...panel.config,
    unit: "microseconds",
    unit_custom: "",
    show_legends: true,
    override_config: [],
    color: {
      mode: "palette-classic-by-series",
      fixedColor: [],
      seriesBy: "last",
      colorBySeries: [],
    },
  };
  delete panel.config.title_meta;
  return panel;
};

export const buildTracesRedPanel = (chart: TracesRedChart, input: TracesRedPanelInput): any => {
  const panel = chart === "duration" ? durationPanel(input) : rateOrErrorsPanel(chart, input);
  panel.title = tracesPanelTitle(CHART_TITLES[chart], input.filterText, input.streamName);
  return panel;
};

export const buildTracesRedPanels = (input: TracesRedPanelInput): any[] =>
  (["rate", "errors", "duration"] as const).map((chart) => buildTracesRedPanel(chart, input));

const BUCKET_UNITS = [
  ["days", 86_400],
  ["hours", 3_600],
  ["minutes", 60],
] as const;

/** The bucket in the largest unit it divides into, for the dialog notice. */
export const tracesBucketNotice = (
  seconds: number,
): { unit: "seconds" | "minutes" | "hours" | "days"; count: number } => {
  const match = BUCKET_UNITS.find(([, size]) => seconds >= size && seconds % size === 0);
  return match
    ? { unit: match[0], count: seconds / match[1] }
    : { unit: "seconds", count: seconds };
};
