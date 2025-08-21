// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import ChartSelection from "./ChartSelection.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock getImageURL
vi.mock("@/utils/zincutils", () => ({
  getImageURL: (path: string) => path,
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

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

  it("should render all chart types", () => {
    const chartItems = wrapper.findAll(
      "[data-test='dashboard-addpanel-chart-selection-item']",
    );
    expect(chartItems.length).toBe(20); // Total number of charts defined in the component
  });

  it("should highlight selected chart type", async () => {
    const lineChartItem = wrapper
      .find("[data-test='selected-chart-line-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(lineChartItem.classes()).toContain("bg-grey-3");
  });

  it("should emit update event when chart is selected", async () => {
    const barChartItem = wrapper
      .find("[data-test='selected-chart-bar-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    await barChartItem.trigger("click");

    expect(wrapper.emitted()["update:selectedChartType"]).toBeTruthy();
    expect(wrapper.emitted()["update:selectedChartType"][0]).toEqual(["bar"]);
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

    const chartItem = wrapper.find(
      "[data-test='dashboard-addpanel-chart-selection-item']",
    );
    expect(chartItem.classes()).toContain("darkModeBorder");
  });

  it("should display tooltips with chart titles", async () => {
    const tooltips = wrapper.findAll(
      "[data-test='dashboard-addpanel-chart-selection-tooltip']",
    );
    expect(tooltips.length).toBeGreaterThan(0);

    // Check specific chart tooltips
    const titles = tooltips.map((tooltip: any) => tooltip.text());
    expect(titles).toContain(i18n.global.t("dashboard.lineLabel"));
    expect(titles).toContain(i18n.global.t("dashboard.barLabel"));
    expect(titles).toContain(i18n.global.t("dashboard.pieLabel"));
  });

  it("should disable charts based on promqlMode", async () => {
    // Mount with promqlMode true
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
          promqlMode: true,
        },
      },
    });
    await flushPromises();

    const pieChartItem = wrapper
      .find("[data-test='selected-chart-pie-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(pieChartItem.attributes("disabled")).toBeTruthy();

    // Line chart should still be enabled
    const lineChartItem = wrapper
      .find("[data-test='selected-chart-line-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(lineChartItem.attributes("disabled")).toBeFalsy();
  });

  it("should filter charts based on allowedchartstype prop", async () => {
    wrapper = mount(ChartSelection, {
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

    // Line and bar charts should be enabled
    const lineChartItem = wrapper
      .find("[data-test='selected-chart-line-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    const barChartItem = wrapper
      .find("[data-test='selected-chart-bar-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(lineChartItem.attributes("disabled")).toBeFalsy();
    expect(barChartItem.attributes("disabled")).toBeFalsy();

    // Pie chart should be disabled
    const pieChartItem = wrapper
      .find("[data-test='selected-chart-pie-item']")
      .closest("[data-test='dashboard-addpanel-chart-selection-item']");
    expect(pieChartItem.attributes("disabled")).toBeTruthy();
  });
});
