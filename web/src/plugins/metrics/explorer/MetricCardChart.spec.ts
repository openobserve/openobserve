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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";

config.global.plugins = [...(config.global.plugins ?? []), i18n];

// Hoisted: a vi.mock factory runs before module-level consts exist.
const { convertPromQLData } = vi.hoisted(() => ({
  convertPromQLData: vi.fn(async () => ({ options: { series: [{}] } })),
}));

vi.mock("@/utils/dashboard/convertPromQLData", () => ({ convertPromQLData }));
vi.mock("vuex", () => ({ useStore: () => ({ state: { theme: "light" } }) }));
vi.mock("@/components/dashboards/panelSchemaRenderer/ChartRenderer.vue", () => ({
  default: { name: "ChartRenderer", template: "<div data-test='chart-renderer' />" },
}));

import MetricCardChart from "./MetricCardChart.vue";

const RESULTS = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];

const mountChart = (props: Record<string, any> = {}) =>
  mount(MetricCardChart, {
    props: {
      results: RESULTS,
      queries: [{ expr: "up", legendTemplate: "" }],
      chartType: "line",
      unit: "custom",
      unitCustom: "c/s",
      bucketUnit: null,
      bucketUnitCustom: null,
      color: "#60a5fa",
      ...props,
    },
    global: { stubs: { ChartRenderer: true } },
  });

describe("MetricCardChart re-renders when anything it DRAWS WITH changes", () => {
  beforeEach(() => convertPromQLData.mockClear());

  /**
   * The watch used to track only [results, chartType, color, unit]. Two variants can
   * share a chart type AND a canonical unit — `unit` is "custom" for both — and
   * differ only in `unit_custom` ("c/s" vs "s/s"). The chart then kept formatting
   * its cells with the SUPERSEDED unit until something unrelated forced a redraw.
   */
  it("re-renders when unitCustom changes but unit does not", async () => {
    const wrapper = mountChart();
    await nextTick();
    const before = convertPromQLData.mock.calls.length;

    await wrapper.setProps({ unitCustom: "s/s" }); // `unit` stays "custom"
    await nextTick();

    expect(convertPromQLData.mock.calls.length).toBeGreaterThan(before);
    const schema = convertPromQLData.mock.calls.at(-1)![0] as any;
    expect(schema.config.unit_custom).toBe("s/s");
  });

  it("re-renders when the histogram bucket unit changes", async () => {
    const wrapper = mountChart({
      chartType: "heatmap",
      bucketUnit: "seconds",
      bucketUnitCustom: null,
    });
    await nextTick();
    const before = convertPromQLData.mock.calls.length;

    await wrapper.setProps({ bucketUnit: "milliseconds" });
    await nextTick();

    expect(convertPromQLData.mock.calls.length).toBeGreaterThan(before);
    const schema = convertPromQLData.mock.calls.at(-1)![0] as any;
    expect(schema.config.bucket_unit).toBe("milliseconds");
  });

  it("re-renders when the queries change", async () => {
    const wrapper = mountChart();
    await nextTick();
    const before = convertPromQLData.mock.calls.length;

    await wrapper.setProps({
      queries: [{ expr: "sum(rate(up[5m]))", legendTemplate: "{le}" }],
    });
    await nextTick();

    expect(convertPromQLData.mock.calls.length).toBeGreaterThan(before);
    const schema = convertPromQLData.mock.calls.at(-1)![0] as any;
    expect(schema.queries[0].query).toBe("sum(rate(up[5m]))");
  });
});
