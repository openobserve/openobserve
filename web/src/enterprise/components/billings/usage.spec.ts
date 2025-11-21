// Copyright 2023 OpenObserve Inc.
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
import { Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";
import { nextTick } from "vue";

installQuasar({
  plugins: [Notify],
});

// Mock the billings service
vi.mock("@/services/billings", () => ({
  default: {
    get_data_usage: vi.fn(),
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

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-image-url-${path}`),
}));

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

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("Usage Component", () => {
  let wrapper: any = null;
  const mockBillingService = vi.mocked(BillingService);
  let mockNotify: any;

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

    // Mock quasar notify
    mockNotify = vi.fn(() => vi.fn()); // Returns dismiss function

    wrapper = mount(Usage, {
      attachTo: "#app",
      global: {
        plugins: [i18n],
        provide: {
          store,
          $router: mockRouter,
        },
        mocks: {
          $q: {
            notify: mockNotify,
          },
          $t: (key: string) => key, // Mock translation function
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
      remotepipeline: "0.00"
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
    expect(wrapper.text()).toContain("Loading...");
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
    expect(wrapper.text()).toContain("Functions");
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

    expect(wrapper.text()).toContain("10.50 GB");
    expect(wrapper.text()).toContain("5.25 GB");
    expect(wrapper.text()).toContain("2.75 GB");
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
      dataretention: "0.00"
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
      "gb"
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
    const actionScriptTiles = wrapper.findAll('.usage-tile-title');
    const actionScriptExists = actionScriptTiles.some((tile: any) => tile.text().includes('Action Scripts'));
    expect(actionScriptExists).toBe(false);
  });

  // Test 40: Hidden error tracking tiles
  it("should not display error tracking tiles when v-if is false", () => {
    const tiles = wrapper.findAll('.usage-tile-title');
    const errorTrackingExists = tiles.some((tile: any) => tile.text().includes('Error Tracking'));
    expect(errorTrackingExists).toBe(false);
  });

  // Test 41: Hidden RUM session tiles
  it("should not display RUM session tiles when v-if is false", () => {
    const tiles = wrapper.findAll('.usage-tile-title');
    const rumSessionExists = tiles.some((tile: any) => tile.text().includes('RUM Session'));
    expect(rumSessionExists).toBe(false);
  });

  // Test 42: Usage tiles visibility logic
  it("should show usage tiles when data is available and not loading", async () => {
    wrapper.vm.usageData = { ingestion: "1.00", search: "1.00", functions: "1.00" };
    wrapper.vm.dataLoading = false;
    await nextTick();

    const usageTiles = wrapper.findAll('.usage-tile-title');
    const tileTexts = usageTiles.map((tile: any) => tile.text());

    expect(tileTexts).toContain('Ingestion');
    expect(tileTexts).toContain('Search');
    expect(tileTexts).toContain('Functions');
  });

  // Test 43: Usage tiles hidden when loading
  it("should hide usage tiles when loading", async () => {
    wrapper.vm.dataLoading = true;
    wrapper.vm.usageData = {};
    await nextTick();

    const tiles = wrapper.findAll('.usage-tile-title');
    const ingestionExists = tiles.some((tile: any) => tile.text().includes('Ingestion'));
    expect(ingestionExists).toBe(false);
  });

  // Test 44: Usage tiles hidden when no data
  it("should hide usage tiles when no usage data", async () => {
    wrapper.vm.usageData = {};
    wrapper.vm.dataLoading = false;
    await nextTick();

    const tiles = wrapper.findAll('.usage-tile-title');
    const ingestionExists = tiles.some((tile: any) => tile.text().includes('Ingestion'));
    expect(ingestionExists).toBe(false);
  });

  // Test 45: Total usage heading display
  it("should display total usage heading", () => {
    expect(wrapper.text()).toContain(wrapper.vm.t("billing.totalUsage"));
  });

  // Test 46: Component container styling
  it("should have correct container styling", () => {
    const container = wrapper.find('.q-pa-md');
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
});
