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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import FlameGraphPanelRenderer from "@/components/dashboards/panels/FlameGraphPanelRenderer.vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
import i18n from "@/locales";
import { convertFlameGraphPanelData } from "@/utils/dashboard/convertFlameGraphPanelData";

const ChartRendererStub = {
  name: "ChartRenderer",
  props: ["data", "label"],
  template: '<div class="chart-renderer-stub"></div>',
};

const schema = { queries: [{ config: {} }], config: {} };
const data = convertFlameGraphPanelData(schema, [
  [
    { stack: "main;http;handler", samples: 3 },
    { stack: "main;gc", samples: 1 },
  ],
]);

const mountPanel = (props: Record<string, unknown>) =>
  mount(FlameGraphPanelRenderer, {
    props: props as any,
    global: { plugins: [i18n], stubs: { ChartRenderer: ChartRendererStub, OTooltip: true } },
  });

describe("FlameGraphPanelRenderer", () => {
  it("draws the converted tree with the real FlameGraphView, labelled by the value column", async () => {
    const wrapper = mountPanel({ data, config: { unit: "default", decimals: 0 } });
    await flushPromises();
    const view = wrapper.findComponent(FlameGraphView);
    expect(view.exists()).toBe(true);
    expect(view.props("root")).toEqual(data.root);
    expect(view.props("unitLabel")).toBe("samples");
    expect(view.props("summaryValue")).toBe("4");
    expect(view.props("hideProfileActions")).toBe(true);
  });

  it("names the chart a flame graph instead of letting ECharts call it a custom chart", async () => {
    const wrapper = mountPanel({ data, config: {} });
    await flushPromises();
    expect(wrapper.findComponent(ChartRendererStub).props("label")).toBe("Flame graph");
  });

  it("hides the align and root-at-bottom controls, which the panel cannot save", async () => {
    const wrapper = mountPanel({ data, config: {} });
    await flushPromises();
    expect(wrapper.findComponent(FlameGraphView).props("hideViewOptions")).toBe(true);
    expect(wrapper.find('[data-test="flame-graph-align-left"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="flame-graph-root-at-bottom"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="flame-graph-plot"]').exists()).toBe(true);
  });

  it("grows the rows to fill the panel height and keeps the zoom hint off the graph", async () => {
    localStorage.removeItem("o2_flame_zoom_hint_hidden");
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const wrapper = mountPanel({ data, config: {} });
    await flushPromises();
    // Root, main, http and handler: four rows sharing the 400 px the panel gives the graph.
    expect(wrapper.get('[data-test="flame-graph-plot"]').attributes("style")).toContain(
      "height: 400px",
    );
    expect(wrapper.find('[data-test="flame-graph-zoom-hint"]').exists()).toBe(false);
    height.mockRestore();
    const fixed = mount(FlameGraphView, {
      props: { root: data.root, summaryLabel: "Total", summaryValue: "4", unitLabel: "samples" },
      global: { plugins: [i18n], stubs: { ChartRenderer: ChartRendererStub, OTooltip: true } },
    });
    await flushPromises();
    expect(fixed.get('[data-test="flame-graph-plot"]').attributes("style")).toContain(
      "height: 124px",
    );
    expect(fixed.find('[data-test="flame-graph-zoom-hint"]').exists()).toBe(true);
  });

  it("highlights the searched frame and clears it on a second search", async () => {
    const wrapper = mountPanel({ data, config: {} });
    await flushPromises();
    const view = wrapper.findComponent(FlameGraphView);
    view.vm.$emit("search", "gc");
    await nextTick();
    expect(view.props("searchQuery")).toBe("gc");
    view.vm.$emit("search", "gc");
    await nextTick();
    expect(view.props("searchQuery")).toBe("");
  });

  it("renders nothing of its own without a tree, leaving the panel's no-data state", async () => {
    const wrapper = mountPanel({
      data: { root: null, stackField: null, valueField: null, skipped: 0 },
    });
    await flushPromises();
    expect(wrapper.findComponent(FlameGraphView).exists()).toBe(false);
  });
});
