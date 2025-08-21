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
import ConfigPanel from "./ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("ConfigPanel", () => {
  let wrapper: any;
  const defaultPanelData = {
    data: {
      type: "line",
      description: "",
      config: {
        show_legends: true,
        legends_position: null,
        legend_width: {
          value: null,
          unit: "px",
        },
        unit: null,
        decimals: 2,
        connect_nulls: false,
        show_symbol: false,
        line_interpolation: "smooth",
        top_results: null,
        top_results_others: false,
        trellis: {
          layout: null,
          num_of_columns: 1,
          group_by_y_axis: false,
        },
        y_axis_min: null,
        y_axis_max: null,
        label_option: {
          position: null,
          rotate: 0,
        },
      },
      queries: [
        {
          fields: {
            breakdown: [],
          },
          config: {
            time_shift: [],
            limit: 0,
          },
        },
      ],
      layout: {
        currentQueryIndex: 0,
      },
    },
  };

  beforeEach(async () => {
    store.state.zoConfig = {
      dashboard_show_symbol_enabled: false,
    };

    wrapper = mount(ConfigPanel, {
      attachTo: "#app",
      props: {
        dashboardPanelData: defaultPanelData,
        variablesData: [],
        panelData: {},
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

  it("should render description input", () => {
    const descInput = wrapper.find(
      "[data-test='dashboard-config-description']",
    );
    expect(descInput.exists()).toBeTruthy();
  });

  it("should render legends toggle for line chart", () => {
    const legendsToggle = wrapper.find(
      "[data-test='dashboard-config-show-legend']",
    );
    expect(legendsToggle.exists()).toBeTruthy();
  });

  it("should render legends position select when legends are shown", async () => {
    await wrapper.setData({
      dashboardPanelData: {
        ...defaultPanelData,
        data: {
          ...defaultPanelData.data,
          config: {
            ...defaultPanelData.data.config,
            show_legends: true,
          },
        },
      },
    });

    const legendsPosition = wrapper.find(
      "[data-test='dashboard-config-legend-position']",
    );
    expect(legendsPosition.exists()).toBeTruthy();
  });

  it("should update legend width when unit is changed", async () => {
    // First show legends and set position to right
    await wrapper.setData({
      dashboardPanelData: {
        ...defaultPanelData,
        data: {
          ...defaultPanelData.data,
          config: {
            ...defaultPanelData.data.config,
            show_legends: true,
            legends_position: "right",
          },
        },
      },
    });

    // Find unit buttons
    const pxButton = wrapper.find(
      "[data-test='dashboard-config-legend-width-unit-active']",
    );
    const percentButton = wrapper.find(
      "[data-test='dashboard-config-legend-width-unit-inactive']",
    );

    expect(pxButton.exists()).toBeTruthy();
    expect(percentButton.exists()).toBeTruthy();

    // Click percent button
    await percentButton.trigger("click");
    expect(wrapper.vm.dashboardPanelData.data.config.legend_width.unit).toBe(
      "%",
    );
  });

  it("should render unit selection", () => {
    const unitSelect = wrapper.find("[data-test='dashboard-config-unit']");
    expect(unitSelect.exists()).toBeTruthy();
  });

  it("should show custom unit input when custom unit is selected", async () => {
    await wrapper.setData({
      dashboardPanelData: {
        ...defaultPanelData,
        data: {
          ...defaultPanelData.data,
          config: {
            ...defaultPanelData.data.config,
            unit: "custom",
          },
        },
      },
    });

    const customUnitInput = wrapper.find(
      "[data-test='dashboard-config-custom-unit']",
    );
    expect(customUnitInput.exists()).toBeTruthy();
  });

  it("should render and update decimals input", async () => {
    const decimalsInput = wrapper.find(
      "[data-test='dashboard-config-decimals']",
    );
    expect(decimalsInput.exists()).toBeTruthy();

    await decimalsInput.setValue(5);
    expect(wrapper.vm.dashboardPanelData.data.config.decimals).toBe(5);

    // Test invalid value
    await decimalsInput.setValue(-1);
    expect(wrapper.vm.dashboardPanelData.data.config.decimals).toBe(2); // Should reset to default
  });

  it("should render Y axis min/max inputs for line chart", () => {
    const yAxisMin = wrapper.find("[data-test='dashboard-config-y_axis_min']");
    const yAxisMax = wrapper.find("[data-test='dashboard-config-y_axis_max']");

    expect(yAxisMin.exists()).toBeTruthy();
    expect(yAxisMax.exists()).toBeTruthy();
  });

  it("should show time shift controls for line chart", () => {
    const addTimeShiftBtn = wrapper.find(
      "[data-test='dashboard-addpanel-config-time-shift-add-btn']",
    );
    expect(addTimeShiftBtn.exists()).toBeTruthy();
  });

  it("should render label position options", () => {
    const labelPosition = wrapper.find(
      "[data-test='dashboard-config-label-position']",
    );
    expect(labelPosition.exists()).toBeTruthy();
  });

  it("should render line style options for line chart", () => {
    const lineInterpolation = wrapper.find(
      "[data-test='dashboard-config-line_interpolation']",
    );
    const showSymbol = wrapper.find(
      "[data-test='dashboard-config-show_symbol']",
    );

    expect(lineInterpolation.exists()).toBeTruthy();
    expect(showSymbol.exists()).toBeTruthy();
  });

  it("should handle table-specific options when type is table", async () => {
    await wrapper.setData({
      dashboardPanelData: {
        ...defaultPanelData,
        data: {
          ...defaultPanelData.data,
          type: "table",
        },
      },
    });

    const wrapCells = wrapper.find(
      "[data-test='dashboard-config-wrap-table-cells']",
    );
    const transpose = wrapper.find(
      "[data-test='dashboard-config-table_transpose']",
    );
    const dynamicColumns = wrapper.find(
      "[data-test='dashboard-config-table_dynamic_columns']",
    );

    expect(wrapCells.exists()).toBeTruthy();
    expect(transpose.exists()).toBeTruthy();
    expect(dynamicColumns.exists()).toBeTruthy();
  });

  it("should show trellis layout options", () => {
    const trellisLayout = wrapper.find("[data-test='dashboard-trellis-chart']");
    expect(trellisLayout.exists()).toBeTruthy();
  });

  it("should update trellis columns when custom layout is selected", async () => {
    await wrapper.setData({
      dashboardPanelData: {
        ...defaultPanelData,
        data: {
          ...defaultPanelData.data,
          config: {
            ...defaultPanelData.data.config,
            trellis: {
              layout: "custom",
              num_of_columns: 1,
              group_by_y_axis: false,
            },
          },
        },
      },
    });

    const columnsInput = wrapper.find(
      "[data-test='trellis-chart-num-of-columns']",
    );
    expect(columnsInput.exists()).toBeTruthy();

    await columnsInput.setValue(4);
    expect(
      wrapper.vm.dashboardPanelData.data.config.trellis.num_of_columns,
    ).toBe(4);

    // Test max value constraint
    await columnsInput.setValue(20);
    expect(
      wrapper.vm.dashboardPanelData.data.config.trellis.num_of_columns,
    ).toBe(16); // Should be capped at 16
  });
});
