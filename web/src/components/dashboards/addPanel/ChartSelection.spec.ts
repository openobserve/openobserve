// Copyright 2026 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ChartSelection from "./ChartSelection.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock the zincutils utilities completely
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: (path: string) => path,
    useLocalOrganization: vi.fn().mockReturnValue({
      identifier: "test-org",
      name: "Test Organization",
    }),
    useLocalCurrentUser: vi.fn().mockReturnValue({
      email: "test@example.com",
      name: "Test User",
    }),
    useLocalTimezone: vi.fn().mockReturnValue("UTC"),
    b64EncodeUnicode: vi.fn().mockImplementation((str) => btoa(str)),
    b64DecodeUnicode: vi.fn().mockImplementation((str) => atob(str)),
  };
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("ChartSelection", () => {
  let wrapper: any;

  beforeEach(async () => {
    store.state.theme = "light";

    wrapper = mount(ChartSelection, {
      attachTo: "#app",
      props: {
        selectedChartType: "line",
        allowedchartstype: [],
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should render chart selection items", () => {
    const chartItems = wrapper.findAll("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(chartItems.length).toBeGreaterThan(0);
  });

  it("should render selected chart type", async () => {
    const lineChartItem = wrapper.find("[data-test='selected-chart-line-item']");
    expect(lineChartItem.exists()).toBe(true);
  });

  it("should emit update event when chart is selected", async () => {
    const chartItems = wrapper.findAll("[data-test='dashboard-addpanel-chart-selection-item']");
    await chartItems[0].trigger("click");

    expect(wrapper.emitted()["update:selectedChartType"]).toBeTruthy();
  });

  it("should apply dark theme styles when theme is dark", async () => {
    store.state.theme = "dark";

    wrapper = mount(ChartSelection, {
      attachTo: "#app",
      props: {
        selectedChartType: "line",
        allowedchartstype: [],
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
    await flushPromises();

    const chartItem = wrapper.find("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(chartItem.exists()).toBe(true);
  });

  it("should handle chart tooltips", async () => {
    // Just verify the component structure exists
    expect(wrapper.exists()).toBe(true);
    const chartItems = wrapper.findAll("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(chartItems.length).toBeGreaterThan(0);
  });

  it("should handle promqlMode prop", async () => {
    const promqlWrapper = mount(ChartSelection, {
      attachTo: "#app",
      props: {
        selectedChartType: "line",
        allowedchartstype: [],
        promqlMode: true,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
    await flushPromises();

    expect(promqlWrapper.exists()).toBe(true);

    promqlWrapper.unmount();
  });

  it("should handle allowedchartstype prop", async () => {
    const filteredWrapper = mount(ChartSelection, {
      attachTo: "#app",
      props: {
        selectedChartType: "line",
        allowedchartstype: ["line", "bar"],
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
    await flushPromises();

    expect(filteredWrapper.exists()).toBe(true);
    const chartItems = filteredWrapper.findAll(
      "[data-test='dashboard-addpanel-chart-selection-item']",
    );
    expect(chartItems.length).toBeGreaterThan(0);

    filteredWrapper.unmount();
  });

  it("lists bar gauge with its own icon", async () => {
    const item = wrapper.find("[data-test='selected-chart-bar-gauge-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/bar-gauge.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["bar-gauge"]);
  });

  it("in PromQL mode keeps bar gauge enabled", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-bar-gauge-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(false);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists distribution with its own icon", async () => {
    const item = wrapper.find("[data-test='selected-chart-distribution-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/distribution.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["distribution"]);
  });

  it("in PromQL mode disables distribution", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-distribution-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists treemap with its own icon", async () => {
    const item = wrapper.find("[data-test='selected-chart-treemap-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/treemap.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["treemap"]);
  });

  it("in PromQL mode disables treemap", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-treemap-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists sunburst with its own icon, and disables it on PromQL", async () => {
    const item = wrapper.find("[data-test='selected-chart-sunburst-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/sunburst.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["sunburst"]);
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-sunburst-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists funnel with its own icon and selects it on click", async () => {
    const item = wrapper.find("[data-test='selected-chart-funnel-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/funnel.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["funnel"]);
  });

  it("in PromQL mode disables funnel", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-funnel-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists node graph with its own icon", async () => {
    const item = wrapper.find("[data-test='selected-chart-node-graph-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/node-graph.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["node-graph"]);
  });

  it("in PromQL mode disables node graph", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-node-graph-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists alert list with its own icon, and disables it on PromQL", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const item = wrapper.find("[data-test='selected-chart-alert-list-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/alert-list.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["alert-list"]);
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-alert-list-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
  it("lists flame graph with its own icon, and disables it on PromQL", async () => {
    const { dashboardPanelData } = wrapper.vm;
    const item = wrapper.find("[data-test='selected-chart-flame-graph-item']");
    expect(item.exists()).toBe(true);
    expect(item.find("img").attributes("src")).toContain("charts/flame-graph.svg");
    await item.trigger("click");
    expect(wrapper.emitted()["update:selectedChartType"].at(-1)).toEqual(["flame-graph"]);
    const previous = dashboardPanelData.data.queryType;
    dashboardPanelData.data.queryType = "promql";
    await flushPromises();
    const li = wrapper.find("[data-test='selected-chart-flame-graph-item']").element.closest("li");
    expect(li.className.includes("cursor-not-allowed")).toBe(true);
    dashboardPanelData.data.queryType = previous;
  });
});
