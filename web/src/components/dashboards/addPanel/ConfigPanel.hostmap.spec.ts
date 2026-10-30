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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { computed } from "vue";

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(),
  useDashboardPanelData: vi.fn(),
}));

// Sections start collapsed in the app; these assertions need every one open.
vi.mock("@/utils/dashboard/searchLabelsConfig", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const allExpanded = Object.fromEntries(
    Object.keys(actual.DEFAULT_EXPANDED_SECTIONS as Record<string, boolean>).map((k) => [k, true]),
  );
  return { ...actual, DEFAULT_EXPANDED_SECTIONS: allExpanded };
});

import ConfigPanel from "@/components/dashboards/addPanel/ConfigPanel.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";

const mockDashboardPanelData = {
  data: {
    id: "panel-1",
    title: "Test Panel",
    description: "",
    type: "line",
    queries: [
      {
        query: "SELECT * FROM test",
        queryType: "sql",
        fields: {
          breakdown: [],
        },
        config: {
          time_shift: [],
          limit: 1000,
        },
      },
    ],
    config: {
      step_value: 0,
      top_results: 10,
      trellis_layout: "horizontal",
      trellis: {
        layout: "horizontal",
        num_of_columns: 1,
        group_by_y_axis: false,
      },
      legend_width: {
        value: null,
        unit: "px",
      },
      axis_border_show: false,
      connect_nulls: false,
      no_value_replacement: "",
      wrap_table_cells: false,
      table_transpose: false,
      table_dynamic_columns: false,
      top_results_others: false,
      legends_type: null,
      base_map: { type: "osm" },
      map_symbol_style: {
        size: "by Value",
        size_by_value: {
          min: 1,
          max: 100,
        },
        size_fixed: 2,
      },
      label_option: {
        position: null,
        rotate: 0,
      },
      map_type: { type: "world" },
    },
  },
  layout: {
    currentQueryIndex: 0,
  },
  meta: {
    dateTime: {
      start_time: new Date("2023-01-01T00:00:00Z"),
      end_time: new Date("2023-01-01T23:59:59Z"),
    },
    stream: {
      selectedStreamFields: [],
    },
  },
};

describe("ConfigPanel host map options", () => {
  let wrapper: any;

  const defaultProps = {
    dashboardPanelData: mockDashboardPanelData,
    variablesData: { values: [] },
    panelData: {},
    promqlMode: false,
    colorBySeriesData: {},
    panelSchema: {},
    overrideConfig: {},
    valueMappingData: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.selectedOrganization = { identifier: "test-org" };

    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, options = {}) => {
    const pageKey = options.promqlMode ? "promql" : "dashboard";

    vi.mocked(useDashboardPanelData).mockReturnValue({
      dashboardPanelData: props.dashboardPanelData || defaultProps.dashboardPanelData,
      promqlMode: !!options.promqlMode,
      isPivotMode: computed(() => false),
      selectedStreamFields: props.dashboardPanelData?.meta?.stream?.selectedStreamFields || [],
    });

    return mount(ConfigPanel, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        provide: {
          dashboardPanelDataPageKey: pageKey,
        },
        stubs: {
          ColorBySeries: {
            template: '<div data-test="color-by-series-stub"></div>',
            props: ["colorBySeriesData"],
          },
          OverrideConfig: {
            template: '<div data-test="override-config-stub"></div>',
            props: ["panelSchema", "overrideConfig"],
          },
          ValueMapping: {
            template: '<div data-test="value-mapping-stub"></div>',
            props: ["data"],
          },
        },
      },
    });
  };

  const hostmapPanel = (config: any = {}) => ({
    ...mockDashboardPanelData,
    data: {
      ...mockDashboardPanelData.data,
      type: "hostmap",
      config: { ...mockDashboardPanelData.data.config, ...config },
    },
  });

  it("shows the host map section with defaults, and writes each option on change", async () => {
    const panelData = hostmapPanel();
    wrapper = createWrapper({ dashboardPanelData: panelData });
    await wrapper.vm.$nextTick();

    for (const option of ["reduction", "group-sort", "cell-sort", "cell-shape", "cell-label"]) {
      expect(wrapper.find(`[data-test="dashboard-config-hostmap-${option}"]`).exists()).toBe(true);
    }
    expect(
      wrapper
        .find('[data-test="dashboard-config-hostmap-reduction"]')
        .attributes("data-test-selected-value"),
    ).toBe("last");
    expect(
      wrapper
        .find('[data-test="dashboard-config-hostmap-cell-shape"]')
        .attributes("data-test-selected-value"),
    ).toBe("square");
    expect(wrapper.find('[data-test="dashboard-config-hostmap-cell-label-hint"]').text()).toBe(
      "Labels show only when cells are large enough to read.",
    );
    expect("hostmap_reduction" in panelData.data.config).toBe(false);
    // SQL takes the entity and groups from builder fields, so the label inputs are PromQL only.
    expect(wrapper.find('[data-test="dashboard-config-hostmap-entity-label"]').exists()).toBe(
      false,
    );

    wrapper.vm.hostmapReduction = "max";
    wrapper.vm.hostmapGroupSort = "value";
    wrapper.vm.hostmapCellSort = "value";
    wrapper.vm.hostmapCellShape = "hexagon";
    wrapper.vm.hostmapCellLabel = "value";
    expect(panelData.data.config).toMatchObject({
      hostmap_reduction: "max",
      hostmap_group_sort: "value",
      hostmap_cell_sort: "value",
      hostmap_cell_shape: "hexagon",
      hostmap_cell_label: "value",
    });
  });

  it("offers the colour, value mapping and threshold sections a host map reuses", async () => {
    wrapper = createWrapper({ dashboardPanelData: hostmapPanel() });
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[data-test="dashboard-addpanel-config-thresholds-section"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-test="value-mapping-stub"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="dashboard-config-no-value-replacement"]').exists()).toBe(true);
    expect(wrapper.vm.showColorPalette).toBe(true);
    expect(wrapper.find('[data-test="color-by-series-stub"]').exists()).toBe(false);
  });

  it("takes the PromQL entity label and up to two group-by labels", async () => {
    const panelData = hostmapPanel();
    wrapper = createWrapper({ dashboardPanelData: panelData }, { promqlMode: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="dashboard-config-hostmap-entity-label"]').exists()).toBe(true);
    wrapper.vm.hostmapEntityLabelModel = " gpu_uuid ";
    wrapper.vm.hostmapGroupBySecondModel = "host";
    wrapper.vm.hostmapGroupByFirstModel = "rack";
    expect(panelData.data.config.hostmap_entity_label).toBe("gpu_uuid");
    expect(panelData.data.config.hostmap_group_by).toEqual(["rack", "host"]);

    wrapper.vm.hostmapGroupByFirstModel = "";
    wrapper.vm.hostmapGroupBySecondModel = "";
    wrapper.vm.hostmapEntityLabelModel = "";
    expect(panelData.data.config.hostmap_group_by).toBeNull();
    expect(panelData.data.config.hostmap_entity_label).toBeNull();
  });

  it("suggests the stream's labels for the PromQL entity and group-by fields, kept labels first", async () => {
    const panelData: any = hostmapPanel();
    panelData.data.queries = [
      {
        ...panelData.data.queries[0],
        queryType: "promql",
        query: "max by (rack, host) (gpu_power_watts)",
        fields: { ...panelData.data.queries[0].fields, stream: "gpu_power_watts" },
      },
    ];
    panelData.meta = {
      ...panelData.meta,
      streamFields: {
        groupedFields: [
          {
            name: "gpu_power_watts",
            schema: [
              "__hash__",
              "__name__",
              "_timestamp",
              "cdu",
              "gpu_uuid",
              "host",
              "rack",
              "value",
            ].map((name) => ({ name })),
          },
        ],
      },
    };
    wrapper = createWrapper({ dashboardPanelData: panelData }, { promqlMode: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.hostmapLabelOptions.map((option: any) => option.value)).toEqual([
      "rack",
      "host",
      "cdu",
      "gpu_uuid",
    ]);
    for (const field of ["entity-label", "group-by-1", "group-by-2"]) {
      expect(wrapper.find(`[data-test="dashboard-config-hostmap-${field}-input"]`).exists()).toBe(
        true,
      );
    }
  });
});
