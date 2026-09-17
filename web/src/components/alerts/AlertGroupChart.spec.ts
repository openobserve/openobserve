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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/alerts", () => ({
  default: {
    generate_sql: vi.fn(),
  },
}));

import AlertGroupChart from "@/components/alerts/AlertGroupChart.vue";
import alertsService from "@/services/alerts";

const stubs = {
  // The renderer runs a real query pipeline; the panel CONFIG handed to it is
  // what this spec is about.
  PanelSchemaRenderer: {
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "height", "width", "variablesData", "searchType"],
    template: '<div class="panel-stub" />',
  },
};

const mountChart = async (alert: Record<string, any>) => {
  const wrapper = mount(AlertGroupChart, {
    props: { alert },
    global: { plugins: [i18n, store], stubs },
  });
  await flushPromises();
  return wrapper;
};

/** The config the chart hands the renderer. */
const panelConfig = (wrapper: any) =>
  wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("panelSchema")?.config;

let wrapper: any = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(alertsService.generate_sql).mockResolvedValue({
    data: { sql: 'SELECT count(*) as cnt, _timestamp FROM "logs" GROUP BY _timestamp' },
  } as any);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AlertGroupChart — threshold visibility", () => {
  it("widens the y-axis past a count threshold so the line is on screen", async () => {
    // The reported bug: with every value below the threshold the chart scaled
    // to the data, and the threshold line fell outside the plot area — so an
    // alert that had not fired showed no threshold at all.
    wrapper = await mountChart({
      stream_name: "logs",
      stream_type: "logs",
      query_condition: { type: "sql", sql: "SELECT 1" },
      trigger_condition: { threshold: 500 },
    });

    const config = panelConfig(wrapper);
    expect(config.mark_line).toHaveLength(1);
    expect(config.y_axis_max).toBeGreaterThan(500);
  });

  it("spans both the critical and warning levels", async () => {
    wrapper = await mountChart({
      stream_name: "logs",
      stream_type: "logs",
      query_condition: { type: "sql", sql: "SELECT 1" },
      trigger_condition: { threshold: 500, warning_threshold: 200 },
    });

    const config = panelConfig(wrapper);
    expect(config.mark_line).toHaveLength(2);
    expect(config.y_axis_max).toBeGreaterThan(500);
    expect(config.y_axis_min).toBeLessThan(200);
  });

  it("does the same on the PromQL path", async () => {
    wrapper = await mountChart({
      stream_name: "metrics",
      stream_type: "metrics",
      query_condition: {
        type: "promql",
        promql: "rate(errors[5m])",
        promql_condition: { value: 0.9 },
      },
    });

    const config = panelConfig(wrapper);
    expect(config.mark_line).toHaveLength(1);
    expect(config.y_axis_max).toBeGreaterThan(0.9);
  });

  it("names a label-less PromQL series instead of legending it '{}'", async () => {
    // An alert's PromQL usually aggregates, which strips every label — the
    // legend then rendered the empty label set as "{}".
    wrapper = await mountChart({
      stream_name: "http_requests",
      stream_type: "metrics",
      query_condition: {
        type: "promql",
        promql: "count(rate(errors[5m]))",
        promql_condition: { value: 0.9 },
      },
    });

    const query = wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("panelSchema")
      .queries[0];

    expect(query.config.promql_legend_fallback).toBe("http_requests");
  });

  it("leaves the axis alone when the alert has no threshold", async () => {
    // Nothing to keep in view — the chart should scale to its data as before.
    wrapper = await mountChart({
      stream_name: "logs",
      stream_type: "logs",
      query_condition: { type: "sql", sql: "SELECT 1" },
      trigger_condition: {},
    });

    const config = panelConfig(wrapper);
    expect(config.mark_line).toEqual([]);
    expect(config.y_axis_max).toBeUndefined();
    expect(config.y_axis_min).toBeUndefined();
  });
});

describe("AlertGroupChart — stream deleted after the alert was created", () => {
  it("shows the backend's error instead of a blank 'chart unavailable' state", async () => {
    // generate_sql validates the stream up front, so a deleted stream 400s
    // here rather than reaching PanelSchemaRenderer with a doomed query.
    vi.mocked(alertsService.generate_sql).mockRejectedValue({
      response: {
        status: 400,
        data: { code: 400, message: "Stream 'logs' of type 'logs' does not exist" },
      },
    });

    wrapper = await mountChart({
      stream_name: "logs",
      stream_type: "logs",
      query_condition: { type: "sql", sql: "SELECT 1" },
      trigger_condition: { threshold: 500 },
    });

    expect(wrapper.findComponent({ name: "PanelSchemaRenderer" }).exists()).toBe(false);
    expect(wrapper.find('[data-test="alerts-alertgroupchart-error"]').text()).toContain(
      "Stream 'logs' of type 'logs' does not exist",
    );
    expect(wrapper.find('[data-test="alerts-alertgroupchart-empty"]').exists()).toBe(false);
  });
});

/** The SQL the chart hands the renderer. */
const chartQuery = (wrapper: any) =>
  wrapper.findComponent({ name: "PanelSchemaRenderer" }).props("panelSchema")?.queries?.[0]?.query;

describe("AlertGroupChart — the query handed to the renderer", () => {
  const mountWith = (sql: string, extra: Record<string, any> = {}) => {
    vi.mocked(alertsService.generate_sql).mockResolvedValue({ data: { sql } } as any);
    return mountChart({
      stream_name: "logs",
      stream_type: "logs",
      query_condition: { type: "sql", sql, aggregation: null, ...extra },
      trigger_condition: { threshold: 3 },
    });
  };

  // A count alert has no aggregation, so the chart must take the count-rewrite
  // path. Using the aggregation rewrite here yields a query with no value column.
  it("takes the count path when the alert has no aggregation", async () => {
    wrapper = await mountWith("SELECT _timestamp, log FROM \"logs\" WHERE svc = 'api'");
    expect(chartQuery(wrapper)).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "logs" ' +
        "WHERE svc = 'api' GROUP BY zo_sql_key",
    );
  });

  // #14514 end to end through the component: a literal or a function call that
  // merely contains a SQL keyword must not corrupt the rewritten query.
  it.each([
    [
      "literal containing 'from'",
      `SELECT 'data selected from openobserve' AS d, _timestamp FROM "logs"`,
    ],
    ["EXTRACT(EPOCH FROM now())", `SELECT EXTRACT(EPOCH FROM now()) AS e, _timestamp FROM "logs"`],
    [
      "the issue's reported query",
      `SELECT 'test data selected from openobserve to keep' as description, count(*) as total_count FROM "logs" WHERE k8s_cluster = 'production'`,
    ],
  ])("survives a keyword lookalike: %s (#14514)", async (_name, sql) => {
    wrapper = await mountWith(sql);
    const q = chartQuery(wrapper) as string;
    expect(q).toMatch(/count\(\*\) AS zo_sql_num FROM "logs"/);
    expect((q.match(/'/g) || []).length % 2).toBe(0);
    expect([...q].reduce((d, c) => d + (c === "(" ? 1 : c === ")" ? -1 : 0), 0)).toBe(0);
  });

  it("preserves a WHERE-clause literal that contains a SQL keyword", async () => {
    wrapper = await mountWith(`SELECT _timestamp FROM "logs" WHERE msg = 'rate limit exceeded'`);
    expect(chartQuery(wrapper)).toContain("'rate limit exceeded'");
  });

  // With an aggregation configured the chart must use the aggregation rewrite,
  // which charts the aggregate per group rather than a row count.
  it("takes the aggregation path when the alert aggregates", async () => {
    wrapper = await mountWith(
      'SELECT svc, count(*) AS alert_agg_value FROM "logs" GROUP BY svc HAVING alert_agg_value > 0',
      { aggregation: { group_by: ["svc"], function: "count" } },
    );
    const q = chartQuery(wrapper) as string;
    expect(q).toContain("zo_sql_num");
    expect(q).not.toMatch(/HAVING/i);
    expect(q).toMatch(/histogram\(_timestamp\) AS zo_sql_key/);
  });

  // Two group-by columns are ONE group, so the series needs the whole
  // combination as its name — otherwise two groups draw as indistinguishable lines.
  it("collapses a multi-column group-by into one composite label", async () => {
    wrapper = await mountWith(
      'SELECT svc, region, count(*) AS alert_agg_value FROM "logs" GROUP BY svc, region',
      { aggregation: { group_by: ["svc", "region"], function: "count" } },
    );
    const q = chartQuery(wrapper) as string;
    expect(q).toContain("zo_group_label");
    expect(q).toMatch(/GROUP BY zo_sql_key, zo_group_label/i);
  });

  it("renders no panel when the rewrite cannot produce a chart query", async () => {
    wrapper = await mountWith("SELECT 1");
    expect(wrapper.findComponent({ name: "PanelSchemaRenderer" }).exists()).toBe(false);
  });
});
