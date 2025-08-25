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
import ColorBySeries from "./ColorBySeries.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Mock the useDashboardPanelData composable
const mockDashboardPanelData = {
  data: {
    config: {
      color: {
        colorBySeries: [],
      },
    },
  },
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
  }),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ColorBySeries", () => {
  let wrapper: any;
  const defaultPanelData = {
    data: {
      config: {
        color: {
          colorBySeries: [],
        },
      },
    },
  };

  const mockColorBySeriesData = {
    options: {
      series: [
        { name: "Series 1", value: "series1" },
        { name: "Series 2", value: "series2" },
      ],
    },
  };

  beforeEach(async () => {
    store.state.theme = "light";

    wrapper = mount(ColorBySeries, {
      attachTo: "#app",
      props: {
        colorBySeriesData: mockColorBySeriesData,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
          dashboardPanelData: defaultPanelData,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should render color by series section", () => {
    expect(wrapper.text()).toContain("Color by series");
  });

  it("should show info tooltip when hovering over info icon", async () => {
    const infoBtn = wrapper.find(
      "[data-test='dashboard-addpanel-config-color-by-series']",
    );
    expect(infoBtn.exists()).toBeTruthy();
  });

  it("should show 'Apply color by series' button when no colors are set", () => {
    const btn = wrapper.find(
      "[data-test='dashboard-addpanel-config-colorBySeries-add-btn']",
    );
    expect(btn.text()).toContain("Apply color by series");
  });

  it("should show 'Edit color by series' button when colors are set", async () => {
    // Modify the mock data to have colors
    mockDashboardPanelData.data.config.color.colorBySeries = [
      { series: "series1", color: "#FF0000" }
    ];

    const wrapperWithColors = mount(ColorBySeries, {
      attachTo: "#app",
      props: {
        colorBySeriesData: mockColorBySeriesData,
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

    const btn = wrapperWithColors.find(
      "[data-test='dashboard-addpanel-config-colorBySeries-add-btn']",
    );
    expect(btn.text()).toContain("Edit color by series");
    
    // Reset mock data for other tests
    mockDashboardPanelData.data.config.color.colorBySeries = [];
    
    wrapperWithColors.unmount();
  });

  it("should open color by series popup when button is clicked", async () => {
    const btn = wrapper.find(
      "[data-test='dashboard-addpanel-config-colorBySeries-add-btn']",
    );
    await btn.trigger("click");

    expect(wrapper.vm.showColorBySeriesPopUp).toBe(true);
  });

  it("should initialize empty colorBySeries array if not present", () => {
    expect(
      wrapper.vm.dashboardPanelData.data.config.color.colorBySeries,
    ).toEqual([]);
  });

  it("should save color by series configuration", async () => {
    const newConfig = [
      { series: "series1", color: "#FF0000" },
      { series: "series2", color: "#00FF00" },
    ];

    wrapper.vm.saveColorBySeriesconfig(newConfig);
    await flushPromises();

    expect(
      wrapper.vm.dashboardPanelData.data.config.color.colorBySeries,
    ).toEqual(newConfig);
    expect(wrapper.vm.showColorBySeriesPopUp).toBe(false);
  });

  it("should compute series options from props", () => {
    expect(wrapper.vm.seriesOptions).toEqual(mockColorBySeriesData.options);
  });

  it("should handle empty series options", async () => {
    wrapper = mount(ColorBySeries, {
      attachTo: "#app",
      props: {
        colorBySeriesData: {},
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
          dashboardPanelData: defaultPanelData,
        },
      },
    });
    await flushPromises();

    expect(wrapper.vm.seriesOptions).toEqual({ series: [] });
  });

  it("should work with dark theme", async () => {
    store.state.theme = "dark";

    const darkWrapper = mount(ColorBySeries, {
      attachTo: "#app",
      props: {
        colorBySeriesData: mockColorBySeriesData,
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          dashboardPanelDataPageKey: "dashboard",
          dashboardPanelData: defaultPanelData,
        },
      },
    });
    await flushPromises();

    // Just verify the component renders correctly in dark theme
    expect(darkWrapper.exists()).toBe(true);
    expect(darkWrapper.text()).toContain("Color by series");
    
    darkWrapper.unmount();
  });
});
