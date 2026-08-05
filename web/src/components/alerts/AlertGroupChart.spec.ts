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

    const query = wrapper
      .findComponent({ name: "PanelSchemaRenderer" })
      .props("panelSchema").queries[0];

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
