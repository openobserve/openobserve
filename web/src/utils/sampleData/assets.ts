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

import { CURRENT_DASHBOARD_SCHEMA_VERSION } from "@/utils/dashboard/convertDashboardSchemaVersion";
import {
  SAMPLE_ALERT_DESTINATION,
  SAMPLE_ALERT_TEMPLATE,
  SAMPLE_FUNCTIONS,
  SAMPLE_METRICS,
  SAMPLE_DASHBOARD_TITLES,
  SAMPLE_OVERVIEW_TITLE,
  SAMPLE_PIPELINE,
  SAMPLE_SERVICES,
  SAMPLE_STREAMS,
} from "./catalog";

type Layout = { x: number; y: number; w: number; h: number };
type StreamType = "logs" | "metrics" | "traces";

interface AxisSpec {
  alias: string;
  label: string;
  color?: string;
}

interface SqlPanelSpec {
  id: string;
  type: string;
  title: string;
  description?: string;
  stream: string;
  streamType?: StreamType;
  sql: string;
  x?: AxisSpec[];
  y: AxisSpec[];
  breakdown?: AxisSpec[];
  unit?: string;
  layout: Layout;
}

interface PromPanelSpec {
  id: string;
  type: string;
  title: string;
  description?: string;
  metric: string;
  queries: { query: string; legend: string }[];
  unit?: string;
  layout: Layout;
}

const filterGroup = () => ({ filterType: "group", logicalOperator: "AND", conditions: [] });

const axis = (spec: AxisSpec, isTime = false) => ({
  label: spec.label,
  alias: spec.alias,
  column: spec.alias,
  color: spec.color ?? null,
  type: "build",
  functionName: null,
  args: [{ type: "field", value: { field: spec.alias } }],
  isDerived: false,
  havingConditions: [],
  treatAsNonTimestamp: !isTime,
});

const panelConfig = (unit: string | undefined, type: string) => ({
  show_legends: !["metric", "table", "gauge"].includes(type),
  legends_position: "bottom",
  unit: unit ?? "default",
  unit_custom: null,
  // counts read as whole numbers; tables keep the precision their SQL rounds to
  ...(type === "table" ? {} : { decimals: unit === "numbers" ? 0 : 2 }),
  axis_border_show: false,
  connect_nulls: true,
  table_dynamic_columns: false,
  drilldown: [],
  mark_line: [],
  override_config: [],
});

let panelIndex = 0;

const sqlPanel = (spec: SqlPanelSpec) => ({
  id: spec.id,
  type: spec.type,
  title: spec.title,
  description: spec.description ?? "",
  config: panelConfig(spec.unit, spec.type),
  queryType: "sql",
  queries: [
    {
      query: spec.sql,
      vrlFunctionQuery: "",
      customQuery: true,
      fields: {
        stream: spec.stream,
        stream_type: spec.streamType ?? "logs",
        x: (spec.x ?? []).map((a) => axis(a, a.alias === "x_axis_1" && spec.type !== "table")),
        y: spec.y.map((a) => axis(a)),
        z: [],
        breakdown: (spec.breakdown ?? []).map((a) => axis(a)),
        filter: filterGroup(),
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
  layout: { ...spec.layout, i: panelIndex++ },
  htmlContent: "",
  markdownContent: "",
});

const promPanel = (spec: PromPanelSpec) => ({
  id: spec.id,
  type: spec.type,
  title: spec.title,
  description: spec.description ?? "",
  config: panelConfig(spec.unit, spec.type),
  queryType: "promql",
  queries: spec.queries.map((q) => ({
    query: q.query,
    vrlFunctionQuery: "",
    customQuery: true,
    fields: {
      stream: spec.metric,
      stream_type: "metrics",
      x: [],
      y: [],
      z: [],
      breakdown: [],
      filter: filterGroup(),
    },
    config: {
      promql_legend: q.legend,
      layer_type: "scatter",
      weight_fixed: 1,
      limit: 0,
      min: 0,
      max: 100,
      time_shift: [],
    },
  })),
  layout: { ...spec.layout, i: panelIndex++ },
  htmlContent: "",
  markdownContent: "",
});

const markdownPanel = (id: string, title: string, markdown: string, layout: Layout) => ({
  id,
  type: "markdown",
  title,
  description: "",
  config: panelConfig(undefined, "markdown"),
  queryType: "sql",
  queries: [
    {
      query: "",
      vrlFunctionQuery: "",
      customQuery: false,
      fields: {
        stream: "",
        stream_type: "logs",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: filterGroup(),
      },
      config: { promql_legend: "" },
    },
  ],
  layout: { ...layout, i: panelIndex++ },
  htmlContent: "",
  markdownContent: markdown,
});

const dashboard = (title: string, description: string, panels: unknown[]) => ({
  version: CURRENT_DASHBOARD_SCHEMA_VERSION,
  title,
  description,
  role: "",
  owner: "",
  created: new Date().toISOString(),
  tabs: [{ tabId: "default", name: "Default", panels }],
  variables: { list: [], showDynamicFilters: true },
  defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "3h", startTime: 0, endTime: 0 },
});

const ACCESS = `"${SAMPLE_STREAMS.accessLogs}"`;
const APP = `"${SAMPLE_STREAMS.appLogs}"`;
const TRACES = `"${SAMPLE_STREAMS.traces}"`;
const NOT_STATIC = `route <> '/static/{asset}'`;
const T = { alias: "x_axis_1", label: "Time" };
const kpi = (alias = "y_axis_1", label = "Value") => [{ alias, label }];

const overviewDashboard = () =>
  dashboard(
    SAMPLE_OVERVIEW_TITLE,
    "Golden signals for the sample storefront: traffic, errors, latency and the incident in progress.",
    [
      markdownPanel(
        "ov_readme",
        "Start here",
        "**Something is wrong with checkout.** Error rate jumped about 35 minutes ago. Follow the trail: the error panels below, then the *Payment errors* search in Logs, then a failed trace in Traces. Hint: compare `service_version` before and after.",
        { x: 0, y: 0, w: 192, h: 5 },
      ),
      sqlPanel({
        id: "ov_requests",
        type: "metric",
        title: "Requests",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT count(*) AS "y_axis_1" FROM ${ACCESS}`,
        y: kpi(),
        unit: "numbers",
        layout: { x: 0, y: 5, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "ov_error_rate",
        type: "metric",
        title: "Error rate (5xx)",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT round(100.0 * sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / count(*), 2) AS "y_axis_1" FROM ${ACCESS} WHERE ${NOT_STATIC}`,
        y: kpi(),
        unit: "percent",
        layout: { x: 48, y: 5, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "ov_p95",
        type: "metric",
        title: "p95 latency",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT approx_percentile_cont(request_time * 1000, 0.95) AS "y_axis_1" FROM ${ACCESS} WHERE ${NOT_STATIC}`,
        y: kpi(),
        unit: "milliseconds",
        layout: { x: 96, y: 5, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "ov_orders",
        type: "metric",
        title: "Orders placed",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT count(*) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed'`,
        y: kpi(),
        unit: "numbers",
        layout: { x: 144, y: 5, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "ov_requests_by_route",
        type: "line",
        title: "Requests by route",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT histogram(_timestamp, '5 minute') AS "x_axis_1", route AS "breakdown_1", count(*) AS "y_axis_1" FROM ${ACCESS} GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        breakdown: [{ alias: "breakdown_1", label: "Route" }],
        y: kpi("y_axis_1", "Requests"),
        layout: { x: 0, y: 12, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "ov_errors_by_service",
        type: "stacked",
        title: "Errors and warnings by service",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT histogram(_timestamp, '5 minute') AS "x_axis_1", service_name AS "breakdown_1", count(*) AS "y_axis_1" FROM ${APP} WHERE level IN ('error', 'warn') GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        breakdown: [{ alias: "breakdown_1", label: "Service" }],
        y: kpi("y_axis_1", "Log lines"),
        layout: { x: 96, y: 12, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "ov_latency_by_route",
        type: "line",
        title: "p95 latency by route",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT histogram(_timestamp, '5 minute') AS "x_axis_1", route AS "breakdown_1", approx_percentile_cont(request_time * 1000, 0.95) AS "y_axis_1" FROM ${ACCESS} WHERE ${NOT_STATIC} GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        breakdown: [{ alias: "breakdown_1", label: "Route" }],
        y: kpi("y_axis_1", "p95 (ms)"),
        unit: "milliseconds",
        layout: { x: 0, y: 28, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "ov_span_errors",
        type: "bar",
        title: "Error spans by service",
        stream: SAMPLE_STREAMS.traces,
        streamType: "traces",
        sql: `SELECT service_name AS "x_axis_1", count(*) AS "y_axis_1" FROM ${TRACES} WHERE span_status = 'ERROR' GROUP BY x_axis_1 ORDER BY y_axis_1 DESC`,
        x: [{ alias: "x_axis_1", label: "Service" }],
        y: kpi("y_axis_1", "Error spans"),
        layout: { x: 96, y: 28, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "ov_endpoints",
        type: "table",
        title: "Endpoints",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT method AS "x_axis_1", route AS "x_axis_2", count(*) AS "y_axis_1", round(100.0 * sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / count(*), 2) AS "y_axis_2", round(approx_percentile_cont(request_time * 1000, 0.95), 1) AS "y_axis_3" FROM ${ACCESS} GROUP BY x_axis_1, x_axis_2 ORDER BY y_axis_1 DESC`,
        x: [
          { alias: "x_axis_1", label: "Method" },
          { alias: "x_axis_2", label: "Route" },
        ],
        y: [
          { alias: "y_axis_1", label: "Requests" },
          { alias: "y_axis_2", label: "Error %" },
          { alias: "y_axis_3", label: "p95 ms" },
        ],
        layout: { x: 0, y: 44, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "ov_top_errors",
        type: "table",
        title: "Top error messages",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT service_name AS "x_axis_1", message AS "x_axis_2", count(*) AS "y_axis_1" FROM ${APP} WHERE level = 'error' GROUP BY x_axis_1, x_axis_2 ORDER BY y_axis_1 DESC LIMIT 20`,
        x: [
          { alias: "x_axis_1", label: "Service" },
          { alias: "x_axis_2", label: "Message" },
        ],
        y: [{ alias: "y_axis_1", label: "Count" }],
        layout: { x: 96, y: 44, w: 96, h: 16 },
      }),
    ],
  );

const businessDashboard = () =>
  dashboard(
    SAMPLE_DASHBOARD_TITLES.business,
    "Orders, revenue and conversion, computed from checkout and payment logs.",
    [
      sqlPanel({
        id: "biz_revenue",
        type: "metric",
        title: "Revenue",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT round(sum(amount), 2) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed'`,
        y: kpi(),
        unit: "currency-dollar",
        layout: { x: 0, y: 0, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "biz_orders",
        type: "metric",
        title: "Orders",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT count(*) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed'`,
        y: kpi(),
        unit: "numbers",
        layout: { x: 48, y: 0, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "biz_aov",
        type: "metric",
        title: "Average order value",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT round(avg(amount), 2) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed'`,
        y: kpi(),
        unit: "currency-dollar",
        layout: { x: 96, y: 0, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "biz_failed",
        type: "metric",
        title: "Failed checkouts",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT count(*) AS "y_axis_1" FROM ${APP} WHERE service_name = 'checkout' AND level = 'error'`,
        y: kpi(),
        unit: "numbers",
        layout: { x: 144, y: 0, w: 48, h: 7 },
      }),
      sqlPanel({
        id: "biz_orders_over_time",
        type: "area-stacked",
        title: "Checkouts by outcome",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT histogram(_timestamp, '5 minute') AS "x_axis_1", CASE WHEN level = 'error' THEN 'failed' ELSE 'placed' END AS "breakdown_1", count(*) AS "y_axis_1" FROM ${APP} WHERE service_name = 'checkout' AND (event = 'order_placed' OR level = 'error') GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        breakdown: [{ alias: "breakdown_1", label: "Outcome" }],
        y: kpi("y_axis_1", "Checkouts"),
        layout: { x: 0, y: 7, w: 128, h: 16 },
      }),
      sqlPanel({
        id: "biz_by_method",
        type: "donut",
        title: "Revenue by payment method",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT payment_method AS "x_axis_1", round(sum(amount), 2) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed' GROUP BY x_axis_1 ORDER BY y_axis_1 DESC`,
        x: [{ alias: "x_axis_1", label: "Payment method" }],
        y: kpi("y_axis_1", "Revenue"),
        unit: "currency-dollar",
        layout: { x: 128, y: 7, w: 64, h: 16 },
      }),
      sqlPanel({
        id: "biz_by_country",
        type: "h-bar",
        title: "Revenue by country",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT client_country AS "x_axis_1", round(sum(amount), 2) AS "y_axis_1" FROM ${APP} WHERE event = 'order_placed' GROUP BY x_axis_1 ORDER BY y_axis_1 DESC`,
        x: [{ alias: "x_axis_1", label: "Country" }],
        y: kpi("y_axis_1", "Revenue"),
        unit: "currency-dollar",
        layout: { x: 0, y: 23, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "biz_top_products",
        type: "table",
        title: "Top products",
        stream: SAMPLE_STREAMS.appLogs,
        sql: `SELECT top_product AS "x_axis_1", count(*) AS "y_axis_1", round(sum(amount), 2) AS "y_axis_2" FROM ${APP} WHERE event = 'order_placed' GROUP BY x_axis_1 ORDER BY y_axis_1 DESC`,
        x: [{ alias: "x_axis_1", label: "Product" }],
        y: [
          { alias: "y_axis_1", label: "Orders" },
          { alias: "y_axis_2", label: "Revenue" },
        ],
        layout: { x: 96, y: 23, w: 96, h: 16 },
      }),
    ],
  );

const webTrafficDashboard = () =>
  dashboard(
    SAMPLE_DASHBOARD_TITLES.traffic,
    "Edge traffic from the nginx access logs: status codes, geography, clients and bandwidth.",
    [
      sqlPanel({
        id: "web_status",
        type: "donut",
        title: "Responses by status class",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT CASE WHEN status >= 500 THEN '5xx' WHEN status >= 400 THEN '4xx' ELSE '2xx' END AS "x_axis_1", count(*) AS "y_axis_1" FROM ${ACCESS} GROUP BY x_axis_1`,
        x: [{ alias: "x_axis_1", label: "Status" }],
        y: kpi("y_axis_1", "Requests"),
        layout: { x: 0, y: 0, w: 64, h: 16 },
      }),
      sqlPanel({
        id: "web_country",
        type: "h-bar",
        title: "Requests by country",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT client_country AS "x_axis_1", count(*) AS "y_axis_1" FROM ${ACCESS} GROUP BY x_axis_1 ORDER BY y_axis_1 DESC`,
        x: [{ alias: "x_axis_1", label: "Country" }],
        y: kpi("y_axis_1", "Requests"),
        layout: { x: 64, y: 0, w: 64, h: 16 },
      }),
      sqlPanel({
        id: "web_clients",
        type: "pie",
        title: "Clients",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT CASE WHEN http_user_agent LIKE '%bot%' THEN 'Bot' WHEN http_user_agent LIKE '%iPhone%' THEN 'iOS' WHEN http_user_agent LIKE '%Android%' THEN 'Android' WHEN http_user_agent LIKE '%Macintosh%' THEN 'macOS' WHEN http_user_agent LIKE '%Windows%' THEN 'Windows' ELSE 'Linux' END AS "x_axis_1", count(*) AS "y_axis_1" FROM ${ACCESS} GROUP BY x_axis_1`,
        x: [{ alias: "x_axis_1", label: "Client" }],
        y: kpi("y_axis_1", "Requests"),
        layout: { x: 128, y: 0, w: 64, h: 16 },
      }),
      sqlPanel({
        id: "web_bandwidth",
        type: "area",
        title: "Bandwidth served",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT histogram(_timestamp) AS "x_axis_1", sum(body_bytes_sent) AS "y_axis_1" FROM ${ACCESS} GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        y: kpi("y_axis_1", "Bytes"),
        unit: "bytes",
        layout: { x: 0, y: 16, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "web_status_over_time",
        type: "stacked",
        title: "Status codes over time",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT histogram(_timestamp, '5 minute') AS "x_axis_1", CAST(status AS VARCHAR) AS "breakdown_1", count(*) AS "y_axis_1" FROM ${ACCESS} WHERE status >= 400 GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC`,
        x: [T],
        breakdown: [{ alias: "breakdown_1", label: "Status" }],
        y: kpi("y_axis_1", "Requests"),
        layout: { x: 96, y: 16, w: 96, h: 16 },
      }),
      sqlPanel({
        id: "web_top_paths",
        type: "table",
        title: "Top paths",
        stream: SAMPLE_STREAMS.accessLogs,
        sql: `SELECT path AS "x_axis_1", count(*) AS "y_axis_1", round(avg(request_time) * 1000, 1) AS "y_axis_2" FROM ${ACCESS} GROUP BY x_axis_1 ORDER BY y_axis_1 DESC LIMIT 25`,
        x: [{ alias: "x_axis_1", label: "Path" }],
        y: [
          { alias: "y_axis_1", label: "Requests" },
          { alias: "y_axis_2", label: "Avg ms" },
        ],
        layout: { x: 0, y: 32, w: 192, h: 16 },
      }),
    ],
  );

const infraDashboard = () =>
  dashboard(
    SAMPLE_DASHBOARD_TITLES.infra,
    "Kubernetes workload metrics queried with PromQL: saturation, throughput and queue lag.",
    [
      promPanel({
        id: "inf_pods",
        type: "metric",
        title: "Pods reporting",
        metric: SAMPLE_METRICS.cpu,
        queries: [{ query: `count(count by (pod) (${SAMPLE_METRICS.cpu}))`, legend: "" }],
        unit: "numbers",
        layout: { x: 0, y: 0, w: 48, h: 7 },
      }),
      promPanel({
        id: "inf_rps",
        type: "metric",
        title: "Requests per second",
        metric: SAMPLE_METRICS.requests,
        queries: [{ query: `sum(rate(${SAMPLE_METRICS.requests}[5m]))`, legend: "" }],
        unit: "numbers",
        layout: { x: 48, y: 0, w: 48, h: 7 },
      }),
      promPanel({
        id: "inf_cpu_max",
        type: "metric",
        title: "Hottest pod CPU",
        metric: SAMPLE_METRICS.cpu,
        queries: [{ query: `max(${SAMPLE_METRICS.cpu})`, legend: "" }],
        unit: "percent",
        layout: { x: 96, y: 0, w: 48, h: 7 },
      }),
      promPanel({
        id: "inf_lag_max",
        type: "metric",
        title: "Max consumer lag",
        metric: SAMPLE_METRICS.kafkaLag,
        queries: [{ query: `max(${SAMPLE_METRICS.kafkaLag})`, legend: "" }],
        unit: "numbers",
        layout: { x: 144, y: 0, w: 48, h: 7 },
      }),
      promPanel({
        id: "inf_rate",
        type: "line",
        title: "Request rate by service",
        metric: SAMPLE_METRICS.requests,
        queries: [
          { query: `sum by (service) (rate(${SAMPLE_METRICS.requests}[5m]))`, legend: "{service}" },
        ],
        unit: "numbers",
        layout: { x: 0, y: 7, w: 96, h: 16 },
      }),
      promPanel({
        id: "inf_5xx",
        type: "line",
        title: "5xx rate by service",
        metric: SAMPLE_METRICS.requests,
        queries: [
          {
            query: `sum by (service) (rate(${SAMPLE_METRICS.requests}{status_class="5xx"}[5m]))`,
            legend: "{service}",
          },
        ],
        unit: "numbers",
        layout: { x: 96, y: 7, w: 96, h: 16 },
      }),
      promPanel({
        id: "inf_p95",
        type: "line",
        title: "p95 latency by service",
        metric: SAMPLE_METRICS.latencyP95,
        queries: [
          { query: `max by (service) (${SAMPLE_METRICS.latencyP95})`, legend: "{service}" },
        ],
        unit: "milliseconds",
        layout: { x: 0, y: 23, w: 96, h: 16 },
      }),
      promPanel({
        id: "inf_cpu",
        type: "line",
        title: "CPU by pod",
        metric: SAMPLE_METRICS.cpu,
        queries: [{ query: `avg by (pod) (${SAMPLE_METRICS.cpu})`, legend: "{pod}" }],
        unit: "percent",
        layout: { x: 96, y: 23, w: 96, h: 16 },
      }),
      promPanel({
        id: "inf_mem",
        type: "area-stacked",
        title: "Memory by service",
        metric: SAMPLE_METRICS.memory,
        queries: [{ query: `sum by (service) (${SAMPLE_METRICS.memory})`, legend: "{service}" }],
        unit: "bytes",
        layout: { x: 0, y: 39, w: 96, h: 16 },
      }),
      promPanel({
        id: "inf_lag",
        type: "line",
        title: "Kafka consumer lag",
        metric: SAMPLE_METRICS.kafkaLag,
        queries: [{ query: `max by (topic) (${SAMPLE_METRICS.kafkaLag})`, legend: "{topic}" }],
        unit: "numbers",
        layout: { x: 96, y: 39, w: 96, h: 16 },
      }),
    ],
  );

export const sampleDashboards = () => {
  panelIndex = 0;
  return [overviewDashboard(), businessDashboard(), webTrafficDashboard(), infraDashboard()];
};

interface SqlAlertSpec {
  name: string;
  description: string;
  stream: string;
  sql: string;
  period: number;
  frequency: number;
  threshold: number;
  enabled?: boolean;
}

const sqlAlert = (spec: SqlAlertSpec, folderId: string) => ({
  name: spec.name,
  stream_type: "logs",
  stream_name: spec.stream,
  is_real_time: false,
  query_condition: {
    conditions: null,
    sql: spec.sql,
    promql: null,
    type: "sql",
    aggregation: null,
    promql_condition: null,
    vrl_function: null,
    multi_time_range: [],
  },
  trigger_condition: {
    period: spec.period,
    operator: ">=",
    frequency: spec.frequency,
    cron: "",
    threshold: spec.threshold,
    silence: 30,
    frequency_type: "minutes",
    timezone: "UTC",
  },
  destinations: [SAMPLE_ALERT_DESTINATION],
  context_attributes: {},
  enabled: spec.enabled ?? true,
  description: spec.description,
  folder_id: folderId,
});

export const sampleAlertTemplate = () => ({
  name: SAMPLE_ALERT_TEMPLATE,
  body: JSON.stringify({
    alert: "{alert_name}",
    stream: "{stream_name}",
    rows: "{rows}",
    url: "{alert_url}",
  }),
  type: "http",
  title: "",
});

// The SSRF guard rejects private and unresolvable hosts, so the placeholder uses the IANA documentation domain.
export const sampleAlertDestination = () => ({
  name: SAMPLE_ALERT_DESTINATION,
  url: "https://example.com/openobserve-sample-webhook",
  method: "post",
  skip_tls_verify: false,
  template: SAMPLE_ALERT_TEMPLATE,
  headers: {},
});

export const sampleAlerts = (folderId: string) => [
  sqlAlert(
    {
      name: "sample_payment_errors_spike",
      description:
        "Payment service is logging failed charges. Fires while the sample incident is in progress.",
      stream: SAMPLE_STREAMS.appLogs,
      sql: `SELECT service_name, count(*) AS errors FROM ${APP} WHERE service_name = 'payment' AND level = 'error' GROUP BY service_name HAVING count(*) >= 5`,
      period: 15,
      frequency: 5,
      threshold: 1,
    },
    folderId,
  ),
  sqlAlert(
    {
      name: "sample_checkout_p95_latency",
      description: "p95 latency of POST /api/checkout is above 1.5 seconds.",
      stream: SAMPLE_STREAMS.accessLogs,
      sql: `SELECT route, approx_percentile_cont(request_time * 1000, 0.95) AS p95_ms FROM ${ACCESS} WHERE route = '/api/checkout' GROUP BY route HAVING approx_percentile_cont(request_time * 1000, 0.95) > 1500`,
      period: 15,
      frequency: 5,
      threshold: 1,
    },
    folderId,
  ),
  sqlAlert(
    {
      name: "sample_edge_5xx_rate",
      description: "More than 2% of storefront API requests are failing with a 5xx response.",
      stream: SAMPLE_STREAMS.accessLogs,
      sql: `SELECT round(100.0 * sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / count(*), 2) AS error_pct FROM ${ACCESS} WHERE ${NOT_STATIC} HAVING round(100.0 * sum(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / count(*), 2) > 2`,
      period: 10,
      frequency: 5,
      threshold: 1,
    },
    folderId,
  ),
  sqlAlert(
    {
      name: "sample_login_failures",
      description: "Possible credential stuffing: an unusual number of failed logins.",
      stream: SAMPLE_STREAMS.appLogs,
      sql: `SELECT count(*) AS failures FROM ${APP} WHERE service_name = 'auth' AND message = 'Login failed: invalid credentials' HAVING count(*) > 50`,
      period: 30,
      frequency: 10,
      threshold: 1,
    },
    folderId,
  ),
  sqlAlert(
    {
      name: "sample_recommendation_timeouts",
      description:
        "Recommendation model is exceeding its latency budget. Disabled to show a paused alert.",
      stream: SAMPLE_STREAMS.appLogs,
      sql: `SELECT count(*) AS timeouts FROM ${APP} WHERE service_name = 'recommendation' AND level = 'warn' HAVING count(*) > 10`,
      period: 15,
      frequency: 5,
      threshold: 1,
      enabled: false,
    },
    folderId,
  ),
];

export const sampleFunctions = () => [
  {
    name: SAMPLE_FUNCTIONS[0],
    function: [
      "ms = to_float(.duration_ms) ?? 0.0",
      'if ms >= 1000.0 { .latency_class = "slow" } else if ms >= 300.0 { .latency_class = "degraded" } else { .latency_class = "fast" }',
      ".",
    ].join("\n"),
    params: "row",
    transType: 0,
  },
  {
    name: SAMPLE_FUNCTIONS[1],
    function: [
      'ua = to_string(.http_user_agent) ?? ""',
      'if contains(ua, "bot") { .client_os = "bot" } else if contains(ua, "iPhone") { .client_os = "iOS" } else if contains(ua, "Android") { .client_os = "Android" } else if contains(ua, "Windows") { .client_os = "Windows" } else if contains(ua, "Mac OS") { .client_os = "macOS" } else { .client_os = "Linux" }',
      '.is_mobile = contains(ua, "Mobile")',
      ".",
    ].join("\n"),
    params: "row",
    transType: 0,
  },
];

const PIPELINE_NODE_IDS = {
  source: "5a3e1c20-0b6f-4d8e-9c41-000000000001",
  fn: "5a3e1c20-0b6f-4d8e-9c41-000000000002",
  sink: "5a3e1c20-0b6f-4d8e-9c41-000000000003",
};

/** Real-time pipeline that tags every access log with its client OS before it is stored. */
export const sampleAccessLogPipeline = (org: string) => {
  const stream = {
    node_type: "stream",
    stream_name: SAMPLE_STREAMS.accessLogs,
    stream_type: "logs",
    org_id: org,
  };
  const edge = (source: string, target: string) => ({ id: `e${source}-${target}`, source, target });
  return {
    name: SAMPLE_PIPELINE,
    description: "Parses the user agent of every storefront access log at ingest time",
    source: { source_type: "realtime" },
    nodes: [
      {
        id: PIPELINE_NODE_IDS.source,
        type: "input",
        io_type: "input",
        data: stream,
        position: { x: 160, y: 40 },
      },
      {
        id: PIPELINE_NODE_IDS.fn,
        type: "default",
        io_type: "default",
        data: { node_type: "function", name: SAMPLE_FUNCTIONS[1], after_flatten: true },
        position: { x: 160, y: 180 },
      },
      {
        id: PIPELINE_NODE_IDS.sink,
        type: "output",
        io_type: "output",
        data: stream,
        position: { x: 160, y: 320 },
      },
    ],
    edges: [
      edge(PIPELINE_NODE_IDS.source, PIPELINE_NODE_IDS.fn),
      edge(PIPELINE_NODE_IDS.fn, PIPELINE_NODE_IDS.sink),
    ],
    org,
  };
};

export const sampleServiceOwnersCsv = () =>
  [
    "service_name,team,owner,tier,language,slack_channel,runbook",
    ...SAMPLE_SERVICES.map(
      (s) =>
        `${s.name},${s.team},${s.owner},${s.tier},${s.language},#team-${s.team},https://runbooks.example.com/${s.name}`,
    ),
  ].join("\n");
