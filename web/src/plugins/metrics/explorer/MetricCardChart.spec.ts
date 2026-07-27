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

import { describe, it, expect } from "vitest";
import { mount, config } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";

config.global.plugins = [...(config.global.plugins ?? []), i18n];

import MetricCardChart from "./MetricCardChart.vue";

const RESULTS = [{ resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] }];

// Records the props the card hands to the panel. The card is now a thin adapter
// over PanelSchemaRenderer — its job is to translate the queue's fetched results
// into a panel schema + injected data — so that translation is what we assert.
const PanelSchemaRendererStub = {
  name: "PanelSchemaRenderer",
  props: [
    "panelSchema",
    "selectedTimeObj",
    "variablesData",
    "injectedPromqlData",
    "allowAlertCreation",
    "allowAnnotationsAdd",
    "allowAnnotationsAPI",
  ],
  template: "<div data-test='panel-schema-renderer' />",
};

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
      timeRange: { start_time: 1_000_000, end_time: 2_000_000 },
      ...props,
    },
    global: { stubs: { PanelSchemaRenderer: PanelSchemaRendererStub } },
  });

const panelProp = (wrapper: any, name: string) =>
  wrapper.findComponent(PanelSchemaRendererStub).props(name);

describe("MetricCardChart builds the panel schema from its props", () => {
  it("renders through PanelSchemaRenderer, not a bespoke chart", () => {
    const wrapper = mountChart();
    expect(wrapper.findComponent(PanelSchemaRendererStub).exists()).toBe(true);
  });

  /**
   * Two variants can share a chart type AND a canonical unit — `unit` is
   * "custom" for both — and differ only in `unit_custom` ("c/s" vs "s/s"). The
   * schema must track the live value so the axis is not formatted with a
   * superseded unit.
   */
  it("reflects unitCustom in the schema config and updates when it changes", async () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.unit_custom).toBe("c/s");

    await wrapper.setProps({ unitCustom: "s/s" }); // `unit` stays "custom"
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").config.unit_custom).toBe("s/s");
  });

  it("carries the histogram bucket unit for a heatmap and updates it", async () => {
    const wrapper = mountChart({
      chartType: "heatmap",
      bucketUnit: "seconds",
      bucketUnitCustom: null,
    });
    expect(panelProp(wrapper, "panelSchema").config.bucket_unit).toBe("seconds");

    await wrapper.setProps({ bucketUnit: "milliseconds" });
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").config.bucket_unit).toBe("milliseconds");
  });

  it("puts the queries into the schema and updates them", async () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").queries[0].query).toBe("up");

    await wrapper.setProps({
      queries: [{ expr: "sum(rate(up[5m]))", legendTemplate: "{le}" }],
    });
    await nextTick();

    expect(panelProp(wrapper, "panelSchema").queries[0].query).toBe("sum(rate(up[5m]))");
  });

  it("pins the x-axis to the queried range (injected, non-streaming data)", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.pin_x_axis_to_range).toBe(true);
  });

  it("connects across null gaps so a sparse line is not fragmented", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "panelSchema").config.connect_nulls).toBe(true);
  });
});

describe("MetricCardChart feeds the queue's results in as injected data", () => {
  it("hands the results and the queried window (µs) to the panel", () => {
    const wrapper = mountChart();
    const injected = panelProp(wrapper, "injectedPromqlData");

    expect(injected.data).toEqual(RESULTS);
    expect(injected.metadata.queries[0]).toEqual({
      startTime: 1_000_000,
      endTime: 2_000_000,
    });
  });

  it("converts the µs window into the Date pair the panel expects", () => {
    const wrapper = mountChart();
    const time = panelProp(wrapper, "selectedTimeObj");

    // 1_000_000 µs = 1000 ms, 2_000_000 µs = 2000 ms.
    expect((time.start_time as Date).getTime()).toBe(1000);
    expect((time.end_time as Date).getTime()).toBe(2000);
  });
});

describe("MetricCardChart forwards alert-creation opt-in", () => {
  it("defaults alert creation off (function-preview tiles)", () => {
    const wrapper = mountChart();
    expect(panelProp(wrapper, "allowAlertCreation")).toBe(false);
  });

  it("passes allowAlertCreation through to the panel when set", () => {
    const wrapper = mountChart({ allowAlertCreation: true });
    expect(panelProp(wrapper, "allowAlertCreation")).toBe(true);
  });
});
