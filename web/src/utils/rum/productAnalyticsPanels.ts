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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import {
  funnelPanelSql,
  trendSql,
  type AnalyticsScope,
  type FunnelDef,
  type IdentitySql,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

interface AxisField {
  alias: string;
  column: string;
  color: null;
  label: I18nText;
}

export const stepLabel = (step: StepRef, events: NamedEvent[]): string =>
  step.kind === "e" ? (events.find((e) => e.id === step.key)?.name ?? step.key) : step.key;

const axis = (alias: string, label: I18nText): AxisField => ({
  alias,
  column: alias,
  color: null,
  label,
});

const sqlPanel = (
  id: string,
  type: "line" | "bar",
  title: I18nText,
  sql: string,
  x: AxisField,
  y: AxisField[],
): Record<string, unknown> => ({
  version: 2,
  id,
  title,
  description: "",
  type,
  config: {
    show_legends: y.length > 1,
    legends_position: "bottom",
    decimals: 0,
    axis_border_show: true,
    connect_nulls: true,
    no_value_replacement: "",
    show_symbol: true,
    base_map: { type: "osm" },
    map_view: { zoom: 1, lat: 0, lng: 0 },
    mark_line: [],
  },
  queryType: "sql",
  queries: [
    {
      query: sql,
      customQuery: true,
      vrlFunctionQuery: "",
      fields: {
        stream: "_rumdata",
        stream_type: "logs",
        x: [x],
        y,
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
        latitude: null,
        longitude: null,
        weight: null,
      },
      config: {
        promql_legend: "",
        layer_type: "scatter",
        weight_fixed: 1,
        limit: 0,
        min: 0,
        max: 100,
        time_shift: [],
      },
    },
  ],
});

export function buildTrendsPanel(
  scope: AnalyticsScope,
  id: IdentitySql | null,
  metric: "sessions" | "users",
  series: StepRef[],
  events: NamedEvent[],
  interval: "1 day" | "1 week",
  t: TranslateFn,
): Record<string, unknown> {
  const sql = trendSql(scope, id, interval, series, events);
  const x = axis("x_axis_1", t("rum.analytics.trends.time"));
  const y = series.length
    ? series.slice(0, 5).map((s, i) => axis(`y_axis_${i + 1}`, raw(stepLabel(s, events))))
    : metric === "users" && id
      ? [axis("y_axis_2", t("rum.analytics.trends.users"))]
      : [axis("y_axis_1", t("rum.analytics.trends.sessions"))];
  return sqlPanel(
    "rum-analytics-trends",
    "line",
    t("rum.analytics.trends.panelTitle", { app: raw(scope.app) }),
    sql,
    x,
    y,
  );
}

export function buildFunnelPanel(
  scope: AnalyticsScope,
  def: FunnelDef,
  events: NamedEvent[],
  t: TranslateFn,
): Record<string, unknown> {
  const sql = funnelPanelSql(scope, def, { events, sample: 1 });
  const first = def.steps[0] ? stepLabel(def.steps[0], events) : "";
  const last = def.steps.length ? stepLabel(def.steps[def.steps.length - 1], events) : "";
  return sqlPanel(
    "rum-analytics-funnel",
    "bar",
    t("rum.analytics.dashboard.funnelTitle", { first: raw(first), last: raw(last) }),
    sql,
    axis("x_axis_1", t("rum.analytics.dashboard.step")),
    [axis("y_axis_1", t("rum.analytics.trends.sessions"))],
  );
}
