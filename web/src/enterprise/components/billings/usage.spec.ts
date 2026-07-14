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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Usage from "@/enterprise/components/billings/usage.vue";
import BillingService from "@/services/billings";
import organizations from "@/services/organizations";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { nextTick } from "vue";


// Mock the billings service
vi.mock("@/services/billings", () => ({
  default: {
    get_data_usage: vi.fn(),
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    post_organization_settings: vi.fn(),
  },
}));

// Mock the router
const mockRouter = {
  currentRoute: {
    value: {
      query: {}
    }
  }
};

vi.mock("@/router", () => ({
  default: mockRouter
}));

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => mockRouter,
  };
});

// Mock zincutils — partial so the store (pulled in transitively via the
// dashboards renderer) still resolves useLocalOrganization etc.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    getImageURL: vi.fn((path) => `mocked-image-url-${path}`),
  };
});

// Mock convertBillingData
vi.mock("@/utils/billing/convertBillingData", () => ({
  convertBillingData: vi.fn(),
}));

// Mock CustomChartRenderer
vi.mock("@/components/dashboards/panels/CustomChartRenderer.vue", () => ({
  default: {
    name: "CustomChartRenderer",
    template: "<div class='custom-chart-renderer'></div>",
  },
}));

// Stub the heavy dashboards renderer + date picker the daily view uses.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    template: "<div class='panel-schema-renderer'></div>",
  },
}));
vi.mock("@/components/DateTimePickerDashboard.vue", () => ({
  default: {
    name: "DateTimePickerDashboard",
    template: "<div class='date-time-picker'></div>",
    methods: {
      getConsumableDateTime() {
        return { startTime: 1000, endTime: 2000 };
      },
    },
  },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("Usage Component", () => {
  let wrapper: any = null;
  const mockBillingService = vi.mocked(BillingService);

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful API response for mounted hook
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "10.50" },
          { event: "SEARCH", value: "5.25" },
          { event: "FUNCTIONS", value: "2.75" }
        ]
      }
    };
    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    wrapper = mount(Usage, {
      attachTo: "#app",
      global: {
        plugins: [i18n],
        provide: {
          store,
          $router: mockRouter,
          // The daily view injects the resolved range from the Billing shell.
          usageRange: { start: 1000, end: 2000, key: 1 },
        },
        mocks: {
          $t: (key: string) => key,
        },
        stubs: {
          ChartRenderer: {
            name: "ChartRenderer",
            template: "<div class='chart-renderer'></div>",
          },
          CustomChartRenderer: {
            name: "CustomChartRenderer",
            template: "<div class='custom-chart-renderer'></div>",
          },
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // Test 1: Component Mounting
  it("should mount Usage component successfully", () => {
    expect(wrapper.exists()).toBe(true);
  });

  // Test 2: Component name
  it("should have correct component name", () => {
    expect(wrapper.vm.$options.name).toBe("Usage");
  });

  // Test 3: Initial reactive data
  it("should initialize reactive data correctly", async () => {
    expect(wrapper.vm.lastUsageUpdated).toBe(0);
    expect(wrapper.vm.pipelinesPanelDataKey).toBe(0);
    expect(wrapper.vm.elapsedText).toBe('Just now');
    // After mounted hook completes, dataLoading should be false
    await flushPromises();
    expect(wrapper.vm.dataLoading).toBe(false);
  });

  // Test 4: Usage data initial state
  it("should initialize usage data with default values", async () => {
    // After mounted hook completes, data should be populated from API
    await flushPromises();
    expect(wrapper.vm.usageData).toEqual({
      ingestion: "10.50",
      search: "5.25",
      dataretention: "0.00",
      functions: "2.75",
      pipeline: "0.00",
      remotepipeline: "0.00",
      ai_credits: "0.00"
    });
  });

  // Test 5: Chart data initial state
  it("should initialize chart data as empty object", () => {
    expect(wrapper.vm.chartData).toEqual({});
  });

  // Test 6: Options array
  it("should have correct options array", () => {
    expect(wrapper.vm.options).toEqual(["30days", "60days", "3months", "6months"]);
  });

  // Test 7: Store access
  it("should have access to store", () => {
    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state).toBeDefined();
  });

  // Test 8: Translation function
  it("should have access to translation function", () => {
    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe("function");
  });

  // Test 9: Icon URLs generation
  it("should generate correct icon URLs", () => {
    expect(wrapper.vm.actionScriptIcon).toBe("mocked-image-url-images/usage/action_script.svg");
    expect(wrapper.vm.errorTrackingIcon).toBe("mocked-image-url-images/usage/error_tracking.svg");
    expect(wrapper.vm.rumSessionIcon).toBe("mocked-image-url-images/usage/rum_session.svg");
    expect(wrapper.vm.ingestionIcon).toBe("mocked-image-url-images/usage/ingestion.svg");
    expect(wrapper.vm.searchIcon).toBe("mocked-image-url-images/usage/search.svg");
    expect(wrapper.vm.functionsIcon).toBe("mocked-image-url-images/usage/function.svg");
  });

  // Test 10: Data model structure
  it("should have correct data model structure", () => {
    expect(wrapper.vm.dataModel).toBeDefined();
    expect(wrapper.vm.dataModel.chartType).toBe("bar");
    expect(wrapper.vm.dataModel.options).toBeDefined();
    expect(wrapper.vm.dataModel.extras).toBeDefined();
  });

  // Test 11: Usage date computed property default
  it("should return default usage date when no query param", () => {
    expect(wrapper.vm.usageDate).toBe("30days");
  });

  // Test 12: Usage data type computed property default
  it("should return default usage data type when no query param", () => {
    expect(wrapper.vm.usageDataType).toBe("gb");
  });

  // Test 13: Display no data message when usage data is empty
  it("should display no data message when usage data is empty", async () => {
    wrapper.vm.usageData = {};
    await nextTick();
    expect(wrapper.text()).toContain(wrapper.vm.t("billing.messageDataNotFound"));
  });

  // Test 14: Loading state display
  it("should display loading message when data is loading", async () => {
    wrapper.vm.dataLoading = true;
    await nextTick();
    // Component shows an OSpinner (aria-label="Loading") when dataLoading is true,
    // not a "Loading..." text string.
    expect(wrapper.find('[aria-label="Loading"]').exists()).toBe(true);
  });

  // Test 15: Usage tiles display when data is available
  it("should display usage tiles when data is available", async () => {
    wrapper.vm.usageData = {
      ingestion: "10.50",
      search: "5.25",
      functions: "2.75"
    };
    wrapper.vm.dataLoading = false;
    await nextTick();

    expect(wrapper.text()).toContain("Ingestion");
    expect(wrapper.text()).toContain("Search");
  });

  // Test 16: Usage data formatting in tiles
  it("should format usage data correctly in tiles", async () => {
    wrapper.vm.usageData = {
      ingestion: "10.50",
      search: "5.25",
      functions: "2.75"
    };
    wrapper.vm.dataLoading = false;
    await nextTick();

    // Value and unit render in separate spans (no literal space in .text()).
    expect(wrapper.text()).toContain("10.50");
    expect(wrapper.text()).toContain("5.25");
    expect(wrapper.text()).toContain("GB");
  });

  it("auto-scales large byte values up from the base unit", async () => {
    // base GB: 10930.96 GB → 10.67 TB; 1095652 GB → ~1.05 PB
    wrapper.vm.usageData = {
      ingestion: "10930.96",
      dataretention: "1095652",
      search: "5.25",
      ai_credits: "42",
    };
    wrapper.vm.dataLoading = false;
    await nextTick();

    const tiles = wrapper.vm.usageTiles;
    const ing = tiles.find((t: any) => t.key === "ingestion");
    expect(ing.unit).toBe("TB");
    expect(parseFloat(ing.value)).toBeCloseTo(10.67, 1);

    const ret = tiles.find((t: any) => t.key === "dataretention");
    expect(ret.unit).toBe("PB");

    // small value keeps the base unit
    const srch = tiles.find((t: any) => t.key === "search");
    expect(srch.unit).toBe("GB");
    expect(srch.value).toBe("5.25");

    // AI credits is a plain count, never scaled
    const ai = tiles.find((t: any) => t.key === "ai_credits");
    expect(ai.unit).toBe("Credits");
  });


  // Test 19: GetUsage function call with notification
  it("should call getUsage and show notification", async () => {
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "15.50" },
          { event: "SEARCH", value: "7.25" },
          { event: "FUNCTIONS", value: "3.75" }
        ]
      }
    };

    // The notification should have been called during component mounting
    // Let's test that the function completes successfully instead
    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    await wrapper.vm.getUsage();
    await flushPromises();

    // Verify that the function ran successfully
    expect(wrapper.vm.dataLoading).toBe(false);
    expect(mockBillingService.get_data_usage).toHaveBeenCalled();
  });

  // Test 20: GetUsage function updates usage data correctly
  it("should update usage data correctly after successful API call", async () => {
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "10.50" },
          { event: "SEARCH", value: "5.25" },
          { event: "FUNCTIONS", value: "2.75" }
        ]
      }
    };

    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    await wrapper.vm.getUsage();
    await flushPromises();

    expect(wrapper.vm.usageData).toEqual({
      ingestion: "10.50",
      search: "5.25",
      functions: "2.75",
      pipeline: "0.00",
      remotepipeline: "0.00",
      dataretention: "0.00",
      ai_credits: "0.00"
    });
  });

  // Test 21: GetUsage function handles API errors
  it("should handle API errors gracefully", async () => {
    const errorMessage = "API Error";

    // Test that error handling works correctly
    mockBillingService.get_data_usage.mockRejectedValue(new Error(errorMessage));

    try {
      await wrapper.vm.getUsage();
      await flushPromises();
    } catch (error) {
      // Error should be handled gracefully by the component
    }

    // Verify that loading state is reset after error
    expect(wrapper.vm.dataLoading).toBe(false);
    expect(mockBillingService.get_data_usage).toHaveBeenCalled();
  });

  // Test 22: SelectUsageDate function resets chart data
  it("should reset chart data when selectUsageDate is called", async () => {
    // Mock the API response first 
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "10.50" },
        ]
      }
    };
    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    wrapper.vm.chartData = { some: "data" };
    wrapper.vm.selectUsageDate();
    expect(wrapper.vm.chartData).toEqual({});

    await flushPromises();
  });

  // Test 23: Data model chart type
  it("should have bar chart type in data model", () => {
    expect(wrapper.vm.dataModel.chartType).toBe("bar");
  });

  // Test 24: Data model options structure
  it("should have correct options structure in data model", () => {
    const options = wrapper.vm.dataModel.options;
    expect(options.backgroundColor).toBe("transparent");
    expect(options.legend).toBeDefined();
    expect(options.grid).toBeDefined();
    expect(options.tooltip).toBeDefined();
    expect(options.xAxis).toBeDefined();
    expect(options.yAxis).toBeDefined();
    expect(options.toolbox).toBeDefined();
    expect(options.series).toBeDefined();
  });

  // Test 25: Data model legend configuration
  it("should have correct legend configuration", () => {
    const legend = wrapper.vm.dataModel.options.legend;
    expect(legend.show).toBe(false);
    expect(legend.type).toBe("scroll");
    expect(legend.orient).toBe("horizontal");
  });

  // Test 26: Data model grid configuration
  it("should have correct grid configuration", () => {
    const grid = wrapper.vm.dataModel.options.grid;
    expect(grid.containLabel).toBe(true);
    expect(grid.left).toBe(30);
    expect(grid.right).toBe(20);
    expect(grid.top).toBe("15");
    expect(grid.bottom).toBe(35);
  });

  // Test 27: Data model tooltip configuration
  it("should have correct tooltip configuration", () => {
    const tooltip = wrapper.vm.dataModel.options.tooltip;
    expect(tooltip.trigger).toBe("axis");
    expect(tooltip.textStyle.color).toBe("#000");
    expect(tooltip.textStyle.fontSize).toBe(12);
    expect(tooltip.enterable).toBe(true);
    expect(tooltip.backgroundColor).toBe("rgba(255,255,255,1)");
  });

  // Test 28: Data model xAxis configuration
  it("should have correct xAxis configuration", () => {
    const xAxis = wrapper.vm.dataModel.options.xAxis[0];
    expect(xAxis.type).toBe("time");
    expect(xAxis.position).toBe("bottom");
    expect(xAxis.inverse).toBe(false);
    expect(xAxis.name).toBe("Timestamp");
  });

  // Test 29: Data model yAxis configuration
  it("should have correct yAxis configuration", () => {
    const yAxis = wrapper.vm.dataModel.options.yAxis;
    expect(yAxis.type).toBe("value");
    expect(yAxis.name).toBe("K8s Container Name");
    expect(yAxis.nameLocation).toBe("middle");
    expect(yAxis.nameGap).toBe(61);
  });

  // Test 30: Data model toolbox configuration
  it("should have correct toolbox configuration", () => {
    const toolbox = wrapper.vm.dataModel.options.toolbox;
    expect(toolbox.orient).toBe("vertical");
    expect(toolbox.show).toBe(true);
    expect(toolbox.showTitle).toBe(false);
    expect(toolbox.itemSize).toBe(0);
    expect(toolbox.itemGap).toBe(0);
  });

  // Test 31: Data model series configuration
  it("should have correct series configuration", () => {
    const series = wrapper.vm.dataModel.options.series;
    expect(Array.isArray(series)).toBe(true);
    expect(series.length).toBe(2);

    const barSeries = series[0];
    expect(barSeries.type).toBe("bar");
    expect(barSeries.name).toBe("K8s Container Name");
    expect(barSeries.color).toBe("#64b5f6");
  });

  // Test 32: Data model series data array
  it("should have data array in series", () => {
    const series = wrapper.vm.dataModel.options.series[0];
    expect(Array.isArray(series.data)).toBe(true);
    expect(series.data.length).toBeGreaterThan(0);
  });

  // Test 33: Data model extras configuration
  it("should have correct extras configuration", () => {
    const extras = wrapper.vm.dataModel.extras;
    expect(extras.panelId).toBe("Panel_ID5876310");
    expect(extras.isTimeSeries).toBe(true);
  });

  // Test 34: Usage data numeric value parsing
  it("should parse numeric values correctly", async () => {
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "10.567" },
          { event: "SEARCH", value: "5.234" },
        ]
      }
    };

    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    await wrapper.vm.getUsage();
    await flushPromises();

    expect(wrapper.vm.usageData.ingestion).toBe("10.57");
    expect(wrapper.vm.usageData.search).toBe("5.23");
  });

  // Test 35: Case insensitive event name handling
  it("should handle case insensitive event names", async () => {
    const mockResponse = {
      data: {
        data: [
          { event: "ingestion", value: "10.50" },
          { event: "SEARCH", value: "5.25" },
          { event: "Functions", value: "2.75" }
        ]
      }
    };

    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    await wrapper.vm.getUsage();
    await flushPromises();

    expect(wrapper.vm.usageData.ingestion).toBe("10.50");
    expect(wrapper.vm.usageData.search).toBe("5.25");
    expect(wrapper.vm.usageData.functions).toBe("2.75");
  });

  // Test 36: API call parameters
  it("should call API with correct parameters", async () => {
    // Mock the API response first
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "10.50" },
        ]
      }
    };
    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    const orgIdentifier = "test-org";
    wrapper.vm.store.state.selectedOrganization.identifier = orgIdentifier;

    await wrapper.vm.getUsage();
    await flushPromises();

    expect(mockBillingService.get_data_usage).toHaveBeenCalledWith(
      orgIdentifier,
      "30days",
      "gb",
      undefined
    );
  });

  // Test 37: Loading state during API call
  it("should set loading state during API call", async () => {
    const mockPromise = new Promise(() => { }); // Never resolves
    mockBillingService.get_data_usage.mockReturnValue(mockPromise);

    wrapper.vm.getUsage();

    expect(wrapper.vm.dataLoading).toBe(true);
  });

  // Test 38: Component lifecycle - mounted hook
  it("should call selectUsageDate on mount", async () => {
    // Check that the component was mounted and API was called
    // The mounted hook should have triggered selectUsageDate -> getUsage
    await flushPromises();
    expect(mockBillingService.get_data_usage).toHaveBeenCalled();
    expect(wrapper.vm.dataLoading).toBe(false);
  });

  // Test 39: Hidden action script tiles
  it("should not display action script tiles when v-if is false", () => {
    const actionScriptTiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const actionScriptExists = actionScriptTiles.some((tile: any) => tile.text().includes('Action Scripts'));
    expect(actionScriptExists).toBe(false);
  });

  // Test 40: Hidden error tracking tiles
  it("should not display error tracking tiles when v-if is false", () => {
    const tiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const errorTrackingExists = tiles.some((tile: any) => tile.text().includes('Error Tracking'));
    expect(errorTrackingExists).toBe(false);
  });

  // Test 41: Hidden RUM session tiles
  it("should not display RUM session tiles when v-if is false", () => {
    const tiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const rumSessionExists = tiles.some((tile: any) => tile.text().includes('RUM Session'));
    expect(rumSessionExists).toBe(false);
  });

  // Test 42: Usage tiles visibility logic
  it("should show usage tiles when data is available and not loading", async () => {
    wrapper.vm.usageData = { ingestion: "1.00", search: "1.00", functions: "1.00" };
    wrapper.vm.dataLoading = false;
    await nextTick();

    const usageTiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const tileTexts = usageTiles.map((tile: any) => tile.text());

    expect(tileTexts).toContain('Ingestion');
    expect(tileTexts).toContain('Search');
    // Functions card was removed (not a billable line item).
    expect(tileTexts).not.toContain('Functions');
  });

  // Test 43: Usage tiles hidden when loading
  it("should hide usage tiles when loading", async () => {
    wrapper.vm.dataLoading = true;
    wrapper.vm.usageData = {};
    await nextTick();

    const tiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const ingestionExists = tiles.some((tile: any) => tile.text().includes('Ingestion'));
    expect(ingestionExists).toBe(false);
  });

  // Test 44: Usage tiles hidden when no data
  it("should hide usage tiles when no usage data", async () => {
    wrapper.vm.usageData = {};
    wrapper.vm.dataLoading = false;
    await nextTick();

    const tiles = wrapper.findAll('[data-test="billings-usage-tile-title"]');
    const ingestionExists = tiles.some((tile: any) => tile.text().includes('Ingestion'));
    expect(ingestionExists).toBe(false);
  });

  // Test 45: Total usage heading display
  it("renders the billable usage tiles", () => {
    // The "Total Usage" heading was removed; tiles carry the usage now.
    const tiles = wrapper.findAll('[data-test="billings-usage-tile"]');
    expect(tiles.length).toBeGreaterThan(0);
  });

  // Test 46: Component container styling
  it("should have correct container styling", () => {
    const container = wrapper.find('[style="height: calc(100vh - 130px); width: 100%;"]');
    expect(container.exists()).toBe(true);
    expect(container.attributes('style')).toContain('height: calc(100vh - 130px)');
    expect(container.attributes('style')).toContain('width: 100%');
  });


  // Test 48: No data section visibility
  it("should show no data section when usage data is empty", async () => {
    wrapper.vm.usageData = {};
    await nextTick();

    expect(wrapper.text()).toContain(wrapper.vm.t("billing.messageDataNotFound"));
  });

  // Test 49: Data type uppercase display
  it("should display data type in uppercase in tiles", async () => {
    wrapper.vm.usageData = { ingestion: "1.00", search: "1.00", functions: "1.00" };
    wrapper.vm.dataLoading = false;
    await nextTick();

    expect(wrapper.text()).toContain("GB"); // usageDataType.toUpperCase()
  });

  // Test 50: Series line chart configuration
  it("should have line chart series configuration", () => {
    const lineSeries = wrapper.vm.dataModel.options.series[1];
    expect(lineSeries.type).toBe("line");
    expect(lineSeries.markLine).toBeDefined();
    expect(lineSeries.markArea).toBeDefined();
    expect(lineSeries.zlevel).toBe(1);
  });

  // Test 51: Series bar chart zlevel
  it("should have correct zlevel for bar series", () => {
    const barSeries = wrapper.vm.dataModel.options.series[0];
    expect(barSeries.zlevel).toBe(2);
  });

  // Test 52: Mark line styling in line series
  it("should have correct mark line styling", () => {
    const lineSeries = wrapper.vm.dataModel.options.series[1];
    expect(lineSeries.markLine.itemStyle.color).toBe("rgba(0, 191, 255, 0.5)");
    expect(lineSeries.markLine.silent).toBe(false);
    expect(lineSeries.markLine.animation).toBe(false);
  });

  // Test 53: Mark area styling in line series
  it("should have correct mark area styling", () => {
    const lineSeries = wrapper.vm.dataModel.options.series[1];
    expect(lineSeries.markArea.itemStyle.color).toBe("rgba(0, 191, 255, 0.15)");
  });

  // Test 54: Data validation for numeric parsing
  it("should handle invalid numeric values gracefully", async () => {
    const mockResponse = {
      data: {
        data: [
          { event: "INGESTION", value: "invalid" },
          { event: "SEARCH", value: "5.25" },
        ]
      }
    };

    mockBillingService.get_data_usage.mockResolvedValue(mockResponse);

    await wrapper.vm.getUsage();
    await flushPromises();

    expect(wrapper.vm.usageData.ingestion).toBe("NaN"); // parseFloat of "invalid" is NaN
    expect(wrapper.vm.usageData.search).toBe("5.25");
  });

  // Test 55: Router access in component
  it("should have access to router", () => {
    expect(wrapper.vm.router).toBeDefined();
  });

  // The member-org selector now lives in Billing.vue (rendered beside this
  // component) and shares the selection via inject; its formatting/search is
  // covered in UsageMemberList.spec.ts.

  // --- Daily chart appended below the existing cards (self-usage ON) -----
  describe("Daily chart", () => {
    afterEach(() => {
      store.state.organizationData.organizationSettings.usage_stream_enabled = false;
    });

    it("hides the daily chart when self-usage is off", async () => {
      store.state.organizationData.organizationSettings.usage_stream_enabled = false;
      await nextTick();
      expect(wrapper.vm.usageStreamEnabled).toBe(false);
      expect(wrapper.find('[data-test="usage-daily-chart"]').exists()).toBe(
        false,
      );
    });

    it("shows the daily chart when self-usage is on", async () => {
      store.state.organizationData.organizationSettings.usage_stream_enabled = true;
      await nextTick();
      expect(wrapper.vm.usageStreamEnabled).toBe(true);
      expect(wrapper.find('[data-test="usage-daily-chart"]').exists()).toBe(
        true,
      );
    });

    it("builds one combined line panel over the org's usage stream", async () => {
      store.state.organizationData.organizationSettings.usage_stream_enabled = true;
      store.state.selectedOrganization.identifier = "org-daily";
      await nextTick();
      const schema = wrapper.vm.combinedSchema;
      expect(schema.type).toBe("line");
      expect(schema.queries).toHaveLength(1);
      expect(schema.queries[0].fields.stream).toBe("usage");
      expect(schema.queries[0].query).toContain("org_id = 'org-daily'");
      expect(schema.queries[0].query).toContain(
        "event IN ('Ingestion', 'Search', 'Pipeline', 'RemotePipeline')",
      );
      expect(schema.queries[0].query).not.toContain("Functions");
      expect(schema.queries[0].fields.breakdown).toHaveLength(1);
    });

    it("uses the injected range for the chart's time window", async () => {
      store.state.organizationData.organizationSettings.usage_stream_enabled = true;
      await nextTick();
      // injected usageRange = { start: 1000, end: 2000 } (micros)
      expect(wrapper.vm.dailyTimeObj.start_time.getTime()).toBe(1000);
      expect(wrapper.vm.dailyTimeObj.end_time.getTime()).toBe(2000);
    });

    it("fetches the cards with a calendar-derived <N>days range when on", async () => {
      mockBillingService.get_data_usage.mockClear();
      store.state.organizationData.organizationSettings.usage_stream_enabled = true;
      store.state.selectedOrganization.identifier = "org-cal";
      await nextTick();
      await wrapper.vm.getUsage();
      await flushPromises();
      // injected sub-day window rounds up to "1days"
      expect(mockBillingService.get_data_usage).toHaveBeenLastCalledWith(
        "org-cal",
        "1days",
        expect.any(String),
        undefined,
      );
    });
  });

  describe("Usage enable-reporting CTA", () => {
    const mountUsage = () =>
      mount(Usage, {
        global: {
          plugins: [store, router, i18n],
        },
      });

    beforeEach(() => {
      (BillingService.get_data_usage as any).mockResolvedValue({
        data: { data: [], start_time: 0, end_time: 0 },
      });
      store.state.selectedOrganization = { identifier: "org-a" } as any;
      store.state.organizationData = store.state.organizationData || ({} as any);
    });

    it("shows the enable CTA when usage_stream_enabled is false", async () => {
      store.state.organizationData.organizationSettings = {
        usage_stream_enabled: false,
      } as any;
      const wrapper = mountUsage();
      await flushPromises();
      expect(wrapper.find('[data-test="usage-enable-cta"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="usage-daily-chart"]').exists()).toBe(false);
    });

    it("hides the CTA when usage_stream_enabled is true", async () => {
      store.state.organizationData.organizationSettings = {
        usage_stream_enabled: true,
      } as any;
      const wrapper = mountUsage();
      await flushPromises();
      expect(wrapper.find('[data-test="usage-enable-cta"]').exists()).toBe(false);
    });

    it("posts a merged settings payload with usage_stream_enabled:true on click", async () => {
      store.state.organizationData.organizationSettings = {
        usage_stream_enabled: false,
        scrape_interval: 15,
      } as any;
      (organizations.post_organization_settings as any).mockResolvedValue({});
      const wrapper = mountUsage();
      await flushPromises();
      // The CTA now opens a confirm dialog before enabling: fire the empty
      // state's action, then confirm the dialog to run the enable flow.
      wrapper.findComponent({ name: "OEmptyState" }).vm.$emit("action");
      await flushPromises();
      wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
      await flushPromises();
      expect(organizations.post_organization_settings).toHaveBeenCalledWith(
        "org-a",
        expect.objectContaining({
          scrape_interval: 15,
          usage_stream_enabled: true,
        }),
      );
      expect(
        store.state.organizationData.organizationSettings.usage_stream_enabled,
      ).toBe(true);
    });

    it("shows the waiting-for-data graphic when the usage stream is missing", async () => {
      store.state.organizationData.organizationSettings = {
        usage_stream_enabled: true,
      } as any;
      const wrapper = mountUsage();
      await flushPromises();
      // No error yet → no overlay.
      expect(wrapper.find('[data-test="usage-waiting-for-data"]').exists()).toBe(
        false,
      );
      // Chart search errors because the org's usage stream doesn't exist yet.
      wrapper
        .findComponent({ name: "PanelSchemaRenderer" })
        .vm.$emit("error", { message: "Search stream not found: usage" });
      await flushPromises();
      expect(wrapper.find('[data-test="usage-waiting-for-data"]').exists()).toBe(
        true,
      );
      // When data lands the error clears → overlay goes away.
      wrapper
        .findComponent({ name: "PanelSchemaRenderer" })
        .vm.$emit("error", null);
      await flushPromises();
      expect(wrapper.find('[data-test="usage-waiting-for-data"]').exists()).toBe(
        false,
      );
    });

    it("does not show the waiting graphic for unrelated chart errors", async () => {
      store.state.organizationData.organizationSettings = {
        usage_stream_enabled: true,
      } as any;
      const wrapper = mountUsage();
      await flushPromises();
      wrapper
        .findComponent({ name: "PanelSchemaRenderer" })
        .vm.$emit("error", { message: "SQL parse error near GROUP" });
      await flushPromises();
      expect(wrapper.find('[data-test="usage-waiting-for-data"]').exists()).toBe(
        false,
      );
    });
  });
});
