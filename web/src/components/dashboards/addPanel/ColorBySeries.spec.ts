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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { defineComponent, h } from "vue";
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

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
  }),
}));

// Stub the popup child so we don't render real ODialog teleport in unit tests.
// Exposes [data-test="color-by-series-popup-stub"] and allows tests to drive
// the @close / @save emits the parent listens to.
const ColorBySeriesPopUpStub = defineComponent({
  name: "ColorBySeriesPopUp",
  props: {
    open: { type: Boolean, default: false },
    seriesOptions: { type: Array, default: () => [] },
    colorBySeries: { type: Array, default: () => [] },
  },
  emits: ["close", "save"],
  setup(props) {
    return () =>
      h("div", {
        "data-test": "color-by-series-popup-stub",
        "data-open": String(props.open),
      });
  },
});

// Generic ODialog/ODrawer stubs (defensive — in case the migrated component
// or its children render them directly inside this view).
const ODialogStub = defineComponent({
  name: "ODialog",
  props: ["open", "persistent", "size", "title", "subTitle", "showClose", "width"],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  setup(_, { slots }) {
    return () => h("div", { "data-test": "o-dialog-stub" }, slots.default?.());
  },
});

const ODrawerStub = defineComponent({
  name: "ODrawer",
  props: ["open", "persistent", "size", "title", "subTitle", "showClose", "width"],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  setup(_, { slots }) {
    return () => h("div", { "data-test": "o-drawer-stub" }, slots.default?.());
  },
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

const mountOptionsBase = () => ({
  attachTo: "#app",
  global: {
    plugins: [i18n, router],
    provide: {
      store,
      dashboardPanelDataPageKey: "dashboard",
    },
    stubs: {
      ColorBySeriesPopUp: ColorBySeriesPopUpStub,
      ODialog: ODialogStub,
      ODrawer: ODrawerStub,
    },
  },
});

describe("ColorBySeries", () => {
  let wrapper: any;

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
    mockDashboardPanelData.data.config.color.colorBySeries = [];

    wrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: {
        colorBySeriesData: mockColorBySeriesData,
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should render color by series section", () => {
    expect(wrapper.text()).toContain("Color by series");
  });

  it("should show info tooltip button", () => {
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
    mockDashboardPanelData.data.config.color.colorBySeries = [
      { series: "series1", color: "#FF0000" },
    ];

    const wrapperWithColors = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: {
        colorBySeriesData: mockColorBySeriesData,
      },
    });
    await flushPromises();

    const btn = wrapperWithColors.find(
      "[data-test='dashboard-addpanel-config-colorBySeries-add-btn']",
    );
    expect(btn.text()).toContain("Edit color by series");

    wrapperWithColors.unmount();
  });

  it("should open color by series popup when button is clicked", async () => {
    const btn = wrapper.find(
      "[data-test='dashboard-addpanel-config-colorBySeries-add-btn']",
    );
    await btn.trigger("click");

    expect(wrapper.vm.showColorBySeriesPopUp).toBe(true);

    // Stub reflects the open prop being passed through.
    const popupStub = wrapper.find(
      "[data-test='color-by-series-popup-stub']",
    );
    expect(popupStub.attributes("data-open")).toBe("true");
  });

  it("should pass open=false to popup by default", () => {
    const popupStub = wrapper.find(
      "[data-test='color-by-series-popup-stub']",
    );
    expect(popupStub.exists()).toBe(true);
    expect(popupStub.attributes("data-open")).toBe("false");
  });

  it("should close popup when popup emits @close", async () => {
    // Open first
    await wrapper
      .find("[data-test='dashboard-addpanel-config-colorBySeries-add-btn']")
      .trigger("click");
    expect(wrapper.vm.showColorBySeriesPopUp).toBe(true);

    // Drive the close emit from the popup child
    const popup = wrapper.findComponent(ColorBySeriesPopUpStub);
    popup.vm.$emit("close");
    await flushPromises();

    expect(wrapper.vm.showColorBySeriesPopUp).toBe(false);
  });

  it("should save color by series when popup emits @save", async () => {
    const newConfig = [
      { series: "series1", color: "#FF0000" },
      { series: "series2", color: "#00FF00" },
    ];

    // Open the popup first
    await wrapper
      .find("[data-test='dashboard-addpanel-config-colorBySeries-add-btn']")
      .trigger("click");

    const popup = wrapper.findComponent(ColorBySeriesPopUpStub);
    popup.vm.$emit("save", newConfig);
    await flushPromises();

    expect(
      wrapper.vm.dashboardPanelData.data.config.color.colorBySeries,
    ).toEqual(newConfig);
    expect(wrapper.vm.showColorBySeriesPopUp).toBe(false);
  });

  it("should initialize empty colorBySeries array if not present", () => {
    expect(
      wrapper.vm.dashboardPanelData.data.config.color.colorBySeries,
    ).toEqual([]);
  });

  it("should save color by series configuration via exposed method", async () => {
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
    wrapper.unmount();
    wrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: {
        colorBySeriesData: {},
      },
    });
    await flushPromises();

    expect(wrapper.vm.seriesOptions).toEqual({ series: [] });
  });

  it("should compute series options for pie chart from data[].name", async () => {
    mockDashboardPanelData.data.type = "pie";
    const pieData = {
      options: {
        series: [
          {
            data: [
              { name: "Slice A", value: 1 },
              { name: "Slice B", value: 2 },
              { value: 3 }, // invalid, filtered out
              null, // invalid, filtered out
            ],
          },
        ],
      },
    };

    wrapper.unmount();
    wrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: { colorBySeriesData: pieData },
    });
    await flushPromises();

    expect(wrapper.vm.seriesOptions).toEqual({
      series: [{ name: "Slice A" }, { name: "Slice B" }],
    });

    delete (mockDashboardPanelData.data as any).type;
  });

  it("should compute series options for donut chart from data[].name", async () => {
    mockDashboardPanelData.data.type = "donut";
    const donutData = {
      options: {
        series: [
          {
            data: [{ name: "Ring A" }, { name: "Ring B" }],
          },
        ],
      },
    };

    wrapper.unmount();
    wrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: { colorBySeriesData: donutData },
    });
    await flushPromises();

    expect(wrapper.vm.seriesOptions).toEqual({
      series: [{ name: "Ring A" }, { name: "Ring B" }],
    });

    delete (mockDashboardPanelData.data as any).type;
  });

  it("should compute series options for gauge chart from each series data[0].name", async () => {
    mockDashboardPanelData.data.type = "gauge";
    const gaugeData = {
      options: {
        series: [
          { data: [{ name: "Gauge A" }] },
          { data: [{ name: "Gauge B" }] },
          { data: [] }, // invalid, filtered out
          { data: [{}] }, // invalid (no name), filtered out
          null, // invalid, filtered out
        ],
      },
    };

    wrapper.unmount();
    wrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: { colorBySeriesData: gaugeData },
    });
    await flushPromises();

    expect(wrapper.vm.seriesOptions).toEqual({
      series: [{ name: "Gauge A" }, { name: "Gauge B" }],
    });

    delete (mockDashboardPanelData.data as any).type;
  });

  it("should work with dark theme", async () => {
    store.state.theme = "dark";

    const darkWrapper = mount(ColorBySeries, {
      ...mountOptionsBase(),
      props: {
        colorBySeriesData: mockColorBySeriesData,
      },
    });
    await flushPromises();

    expect(darkWrapper.exists()).toBe(true);
    expect(darkWrapper.text()).toContain("Color by series");

    darkWrapper.unmount();
  });
});
