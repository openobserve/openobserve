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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { toZonedTime } from "date-fns-tz";

let timezone = "Asia/Tokyo";
let mounts = 0;
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vuex")>()),
  useStore: () => ({
    state: {
      get timezone() {
        return timezone;
      },
    },
  }),
}));
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    props: ["panelSchema", "selectedTimeObj", "searchType", "searchResponse"],
    setup() {
      mounts += 1;
    },
    template: "<div />",
  },
}));

import SessionsErrorsChart from "./SessionsErrorsChart.vue";

const MARKER_US = Date.UTC(2026, 0, 15, 12, 0) * 1000;
const HITS = [
  { x_axis_1: "2026-01-15T12:00:00", y_axis_1: 4812, y_axis_2: 3 },
  { x_axis_1: "2026-01-15T13:00:00", y_axis_1: 10, y_axis_2: 0 },
];
const RANGE = { startUs: MARKER_US - 3.6e9 * 12, endUs: MARKER_US + 3.6e9 * 12 };

const mountChart = (over: Record<string, unknown> = {}) =>
  mount(SessionsErrorsChart, {
    props: {
      sql: "SELECT 1",
      interval: "1 hour",
      range: RANGE,
      points: [
        { ts: MARKER_US, sessions: 4812, errors: 3 },
        { ts: MARKER_US + 3.6e9, sessions: 10, errors: 0 },
      ],
      hits: HITS,
      marker: { version: "2.0", ts: MARKER_US },
      ...over,
    },
    global: {
      stubs: {
        OTable: {
          props: ["data"],
          template:
            "<div data-test='tbl'><i v-for='r in data' :key='r.ts'>{{ r.time }}|{{ r.sessions }}</i></div>",
        },
        OSkeleton: true,
        OButton: { template: "<button><slot /></button>" },
      },
    },
  });

describe("SessionsErrorsChart", () => {
  beforeEach(() => {
    timezone = "Asia/Tokyo";
    mounts = 0;
  });

  it("renders the rows it is given instead of letting the renderer query", () => {
    const chart = mountChart().findComponent({ name: "PanelSchemaRenderer" });
    expect(chart.props("searchResponse")).toEqual({ hits: HITS });
  });

  it("keeps the renderer mounted when the release marker arrives late", async () => {
    const w = mountChart({ marker: null });
    expect(mounts).toBe(1);
    await w.setProps({ marker: { version: "2.0", ts: MARKER_US } });
    expect(mounts).toBe(1);
    const schema = w.findComponent({ name: "PanelSchemaRenderer" }).props("panelSchema") as Record<
      string,
      any
    >;
    expect(schema.config.mark_line).toHaveLength(1);
  });

  it("remounts the renderer when new rows arrive, since it does not watch them", async () => {
    const w = mountChart();
    await w.setProps({ hits: [HITS[0]] });
    expect(mounts).toBe(2);
  });

  it("names the bucket interval in the heading", () => {
    expect(mountChart().find('[data-test="rum-overview-chart-interval"]').text()).toBe("per hour");
    expect(
      mountChart({ interval: "1 day" }).find('[data-test="rum-overview-chart-interval"]').text(),
    ).toBe("per day");
    expect(
      mountChart({ interval: "6 hour" }).find('[data-test="rum-overview-chart-interval"]').text(),
    ).toBe("per 6 hours");
  });

  it("hands the engine a time-series panel for the SQL with the range in microseconds", () => {
    const chart = mountChart().findComponent({ name: "PanelSchemaRenderer" });
    const schema = chart.props("panelSchema") as Record<string, any>;
    expect(schema.type).toBe("line");
    expect(schema.queries[0].query).toBe("SELECT 1");
    expect(chart.props("searchType")).toBe("RUM");
    expect((chart.props("selectedTimeObj") as { start_time: Date }).start_time.getTime()).toBe(
      RANGE.startUs,
    );
  });

  it("zone-shifts the release marker to the store timezone, like the engine does for the x values", () => {
    const schema = mountChart()
      .findComponent({ name: "PanelSchemaRenderer" })
      .props("panelSchema") as Record<string, any>;
    const line = schema.config.mark_line[0];
    expect(line.type).toBe("xAxis");
    expect(line.value.getTime()).toBe(
      toZonedTime(new Date(MARKER_US / 1000), "Asia/Tokyo").getTime(),
    );
    expect(line.value.getTime()).not.toBe(MARKER_US / 1000);
  });

  it("draws no mark line without a release marker", () => {
    const schema = mountChart({ marker: null })
      .findComponent({ name: "PanelSchemaRenderer" })
      .props("panelSchema") as Record<string, any>;
    expect(schema.config.mark_line).toEqual([]);
    expect(
      mountChart({ marker: null }).find('[data-test="rum-overview-chart-release"]').exists(),
    ).toBe(false);
  });

  it("formats the caption and the table times in the store timezone", async () => {
    const caption = mountChart().find('[data-test="rum-overview-chart-release"]').text();
    expect(caption).toContain("2.0");
    expect(caption).toContain("9:00");
    const w = mountChart();
    await w.find('[data-test="rum-overview-chart-table-toggle"]').trigger("click");
    expect(w.find('[data-test="rum-overview-chart-table"] i').text()).toContain("9:00");
  });

  it("toggles the accessible data table", async () => {
    const w = mountChart();
    expect(w.find('[data-test="rum-overview-chart-table"]').exists()).toBe(false);
    const toggle = w.find('[data-test="rum-overview-chart-table-toggle"]');
    expect(toggle.attributes("aria-expanded")).toBe("false");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(w.find('[data-test="rum-overview-chart-table"]').text()).toContain(
      (4812).toLocaleString(),
    );
  });
});
