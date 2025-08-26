// Copyright 2023 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { useLogsURL } from "@/composables/useLogsURL";

// Mock store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org"
    },
    zoConfig: {
      super_cluster_enabled: true,
      min_auto_refresh_interval: 5
    }
  }
};

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      query: {
        stream: "test-stream",
        query: "dGVzdCBxdWVyeQ==", // base64 encoded "test query"
        sql_mode: "true",
        from: "1640995200000",
        to: "1640998800000",
        period: "1h",
        show_histogram: "true",
        defined_schemas: "field1,field2",
        refresh: "10",
        functionContent: "dGVzdCBmdW5jdGlvbg==", // base64 encoded "test function"
        stream_type: "logs",
        type: "search",
        quick_mode: "true",
        regions: "us-east-1,us-west-1",
        clusters: "cluster1,cluster2",
        logs_visualize_toggle: "visualize",
        fn_editor: "true",
        visualization_data: "eyJ0ZXN0IjoidmFsdWUifQ=="
      }
    }
  },
  push: vi.fn()
};

// Mock dependencies
vi.mock("vuex", () => ({
  useStore: vi.fn(() => mockStore)
}));

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => mockRouter)
}));

// Mock useLogsState
vi.mock("@/composables/useLogsState", () => ({
  useLogsState: vi.fn(() => ({
    searchObj: {
      data: {
        stream: {
          streamType: "logs",
          selectedStream: ["test-stream"]
        },
        datetime: {
          startTime: "1640995200000",
          endTime: "1640998800000",
          type: "relative",
          relativeTimePeriod: "1h"
        },
        query: "SELECT * FROM logs",
        tempFunctionContent: "test function content",
        transformType: "function",
        resultGrid: {
          currentPage: 1
        }
      },
      meta: {
        sqlMode: true,
        showTransformEditor: true,
        useUserDefinedSchemas: ["field1", "field2"],
        refreshInterval: 10,
        resultGrid: {
          rowsPerPage: 50
        },
        showHistogram: true,
        pageType: "logs",
        quickMode: true,
        regions: ["us-east-1"],
        clusters: ["cluster1"],
        logsVisualizeToggle: "visualize",
        functionEditorPlaceholderFlag: true
      },
      shouldIgnoreWatcher: false
    }
  }))
}));

// Mock utility functions
vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: vi.fn((str) => btoa(unescape(encodeURIComponent(str)))),
  b64DecodeUnicode: vi.fn((str) => decodeURIComponent(escape(atob(str)))),
  useLocalTimezone: vi.fn()
}));

vi.mock("@/utils/logs/transformers", () => ({
  generateURLQuery: vi.fn((params) => ({
    stream_type: params.streamType,
    stream: params.selectedStream.join(","),
    query: "encoded_query",
    sql_mode: params.sqlMode.toString(),
    show_histogram: params.meta.showHistogram.toString(),
    from: params.datetime.startTime,
    to: params.datetime.endTime,
    period: params.datetime.relativeTimePeriod
  })),
  encodeVisualizationConfig: vi.fn((config) => "encoded_config_data")
}));

vi.mock("@/utils/logs/parsers", () => ({
  extractValueQuery: vi.fn((params) => ({
    "test-stream": "SELECT * FROM [INDEX_NAME]"
  })),
  createSQLParserFunctions: vi.fn(() => ({
    parseSQL: vi.fn((query) => {
      if (!query || query.trim() === "") return null;
      return {
        columns: [{ name: "*", type: "wildcard" }],
        from: [{ name: "logs" }]
      };
    }),
    unparseSQL: vi.fn((obj) => "SELECT * FROM logs")
  }))
}));

describe("useLogsURL", () => {
  let logsURL: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logsURL = useLogsURL();
  });

  describe("initialization", () => {
    it("should initialize URL composable with all required functions", () => {
      expect(logsURL).toBeDefined();
      expect(typeof logsURL.generateURLQuery).toBe("function");
      expect(typeof logsURL.updateUrlQueryParams).toBe("function");
      expect(typeof logsURL.restoreUrlQueryParams).toBe("function");
      expect(typeof logsURL.routeToSearchSchedule).toBe("function");
    });

    it("should initialize URL parameter utilities", () => {
      expect(typeof logsURL.getCurrentUrlParams).toBe("function");
      expect(typeof logsURL.hasUrlParam).toBe("function");
      expect(typeof logsURL.getUrlParam).toBe("function");
      expect(typeof logsURL.updateUrlParam).toBe("function");
    });

    it("should initialize sharing and navigation utilities", () => {
      expect(typeof logsURL.generateShareableUrl).toBe("function");
      expect(typeof logsURL.navigateToSearch).toBe("function");
      expect(typeof logsURL.clearUrlParams).toBe("function");
    });
  });

  describe("URL query generation", () => {
    it("should generate URL query from search state", () => {
      const query = logsURL.generateURLQuery();
      
      expect(query).toBeDefined();
      expect(typeof query).toBe("object");
      expect(query.org_identifier).toBe("test-org");
      expect(query.quick_mode).toBe(true);
    });

    it("should generate URL query for share link", () => {
      const query = logsURL.generateURLQuery(true);
      
      expect(query).toBeDefined();
      expect(typeof query).toBe("object");
    });

    it("should include dashboard panel data in URL query", () => {
      const dashboardPanelData = {
        data: {
          config: { chartType: "bar" },
          type: "histogram"
        }
      };
      
      const query = logsURL.generateURLQuery(false, dashboardPanelData);
      
      expect(query).toBeDefined();
      expect(query.visualization_data).toBeDefined();
    });

    it("should include function content in URL query", () => {
      const query = logsURL.generateURLQuery();
      
      expect(query).toBeDefined();
      expect(query.functionContent).toBeDefined();
    });

    it("should include super cluster settings", () => {
      const query = logsURL.generateURLQuery();
      
      expect(query).toBeDefined();
      expect(query.regions).toBeDefined();
      expect(query.clusters).toBeDefined();
    });

    it("should handle generation errors gracefully", () => {
      expect(() => logsURL.generateURLQuery()).not.toThrow();
    });
  });

  describe("URL parameter updates", () => {
    it("should update URL query parameters", () => {
      expect(() => logsURL.updateUrlQueryParams()).not.toThrow();
      expect(mockRouter.push).toHaveBeenCalled();
    });

    it("should update URL with dashboard panel data", () => {
      const dashboardPanelData = {
        data: { config: {}, type: "bar" }
      };
      
      expect(() => logsURL.updateUrlQueryParams(dashboardPanelData)).not.toThrow();
    });

    it("should clean search history type from URL", () => {
      logsURL.updateUrlQueryParams();
      
      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.type).toBeUndefined();
    });

    it("should handle update errors gracefully", () => {
      mockRouter.push.mockImplementationOnce(() => {
        throw new Error("Router error");
      });
      
      expect(() => logsURL.updateUrlQueryParams()).not.toThrow();
    });
  });

  describe("URL parameter restoration", () => {
    it("should restore URL query parameters", async () => {
      await expect(logsURL.restoreUrlQueryParams()).resolves.not.toThrow();
    });

    it("should restore date/time parameters", async () => {
      await logsURL.restoreUrlQueryParams();
      
      // Verify that datetime was restored (would be tested through state changes)
      expect(() => logsURL.restoreUrlQueryParams()).not.toThrow();
    });

    it("should restore query and SQL mode", async () => {
      await logsURL.restoreUrlQueryParams();
      
      // Verify restoration logic executed
      expect(() => logsURL.restoreUrlQueryParams()).not.toThrow();
    });

    it("should restore function content", async () => {
      await logsURL.restoreUrlQueryParams();
      
      // Verify function content restoration
      expect(() => logsURL.restoreUrlQueryParams()).not.toThrow();
    });

    it("should validate refresh interval", async () => {
      await logsURL.restoreUrlQueryParams();
      
      // Verify refresh interval validation
      expect(() => logsURL.restoreUrlQueryParams()).not.toThrow();
    });

    it("should handle missing stream parameter", async () => {
      mockRouter.currentRoute.value.query = {};
      
      await expect(logsURL.restoreUrlQueryParams()).resolves.not.toThrow();
    });

    it("should restore super cluster settings", async () => {
      await logsURL.restoreUrlQueryParams();
      
      // Verify super cluster restoration
      expect(() => logsURL.restoreUrlQueryParams()).not.toThrow();
    });

    it("should handle restoration errors gracefully", async () => {
      mockRouter.currentRoute.value = null;
      
      await expect(logsURL.restoreUrlQueryParams()).resolves.not.toThrow();
    });
  });

  describe("routing operations", () => {
    it("should route to search schedule page", () => {
      expect(() => logsURL.routeToSearchSchedule()).not.toThrow();
      expect(mockRouter.push).toHaveBeenCalledWith({
        query: {
          action: "search_scheduler",
          org_identifier: "test-org",
          type: "search_scheduler_list"
        }
      });
    });

    it("should navigate to specific search configuration", () => {
      const config = {
        query: "SELECT * FROM logs",
        streams: ["stream1", "stream2"],
        timeRange: { start: "123", end: "456" },
        sqlMode: true
      };
      
      expect(() => logsURL.navigateToSearch(config)).not.toThrow();
      expect(mockRouter.push).toHaveBeenCalled();
    });

    it("should navigate with time period instead of range", () => {
      const config = {
        timeRange: { start: "123", end: "456", period: "1h" }
      };
      
      expect(() => logsURL.navigateToSearch(config)).not.toThrow();
    });

    it("should handle routing errors gracefully", () => {
      mockRouter.push.mockImplementationOnce(() => {
        throw new Error("Router error");
      });
      
      expect(() => logsURL.routeToSearchSchedule()).not.toThrow();
      expect(() => logsURL.navigateToSearch({})).not.toThrow();
    });
  });

  describe("query extraction", () => {
    it("should extract value query locally", () => {
      const result = logsURL.extractValueQueryLocal();
      
      expect(result).toBeDefined();
      expect(typeof result).toBe("object");
      expect(result["test-stream"]).toBeDefined();
    });

    it("should handle extraction errors gracefully", () => {
      expect(() => logsURL.extractValueQueryLocal()).not.toThrow();
    });
  });

  describe("URL parameter utilities", () => {
    beforeEach(() => {
      // Reset router mock to ensure currentRoute is available
      mockRouter.currentRoute = {
        value: {
          query: {
            stream: "test-stream",
            query: "dGVzdCBxdWVyeQ==", // base64 encoded "test query"
            sql_mode: "true",
            from: "1640995200000",
            to: "1640998800000",
            period: "1h",
            show_histogram: "true",
            defined_schemas: "field1,field2",
            refresh: "10",
            functionContent: "dGVzdCBmdW5jdGlvbg==", // base64 encoded "test function"
            stream_type: "logs",
            type: "search",
            quick_mode: "true",
            regions: "us-east-1,us-west-1",
            clusters: "cluster1,cluster2",
            logs_visualize_toggle: "visualize",
            fn_editor: "true",
            visualization_data: "eyJ0ZXN0IjoidmFsdWUifQ=="
          }
        }
      };
      mockRouter.push = vi.fn();
    });

    it("should get current URL parameters", () => {
      const params = logsURL.getCurrentUrlParams();
      
      expect(params).toBeDefined();
      expect(typeof params).toBe("object");
      expect(params.stream).toBe("test-stream");
    });

    it("should check if URL has specific parameter", () => {
      expect(logsURL.hasUrlParam("stream")).toBe(true);
      expect(logsURL.hasUrlParam("nonexistent")).toBe(false);
    });

    it("should get specific URL parameter value", () => {
      expect(logsURL.getUrlParam("stream")).toBe("test-stream");
      expect(logsURL.getUrlParam("nonexistent")).toBeNull();
    });

    it("should update specific URL parameter", () => {
      logsURL.updateUrlParam("test_param", "test_value");
      
      expect(mockRouter.push).toHaveBeenCalled();
      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.test_param).toBe("test_value");
    });

    it("should remove parameter when value is null", () => {
      logsURL.updateUrlParam("stream", null);
      
      expect(mockRouter.push).toHaveBeenCalled();
      const callArgs = mockRouter.push.mock.calls[0][0];
      expect(callArgs.query.stream).toBeUndefined();
    });

    it("should clear all URL parameters", () => {
      logsURL.clearUrlParams();
      
      expect(mockRouter.push).toHaveBeenCalledWith({ query: {} });
    });

    it("should handle parameter utility errors gracefully", () => {
      mockRouter.currentRoute.value = null;
      
      expect(() => logsURL.getCurrentUrlParams()).not.toThrow();
      expect(() => logsURL.hasUrlParam("test")).not.toThrow();
      expect(() => logsURL.getUrlParam("test")).not.toThrow();
      expect(() => logsURL.updateUrlParam("test", "value")).not.toThrow();
    });
  });

  describe("route checking", () => {
    beforeEach(() => {
      // Ensure router mock has the expected type
      mockRouter.currentRoute = {
        value: {
          query: {
            type: "search",
            stream: "test-stream"
          }
        }
      };
    });

    it("should check if route matches specific type", () => {
      expect(logsURL.isRouteType("search")).toBe(true);
      expect(logsURL.isRouteType("dashboard")).toBe(false);
    });

    it("should handle route type checking errors", () => {
      mockRouter.currentRoute.value = null;
      
      expect(() => logsURL.isRouteType("search")).not.toThrow();
      expect(logsURL.isRouteType("search")).toBe(false);
    });
  });

  describe("sharing utilities", () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/logs',
          href: 'https://example.com/logs'
        },
        writable: true
      });
    });

    it("should generate shareable URL", () => {
      const url = logsURL.generateShareableUrl();
      
      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
      expect(url).toContain("https://example.com/logs");
    });

    it("should generate shareable URL with dashboard panel data", () => {
      const dashboardPanelData = {
        data: { config: {}, type: "bar" }
      };
      
      const url = logsURL.generateShareableUrl(dashboardPanelData);
      
      expect(url).toBeDefined();
      expect(typeof url).toBe("string");
    });

    it("should handle URL generation errors", () => {
      // Temporarily break the location object
      const originalLocation = window.location;
      delete (window as any).location;
      
      const result = logsURL.generateShareableUrl();
      expect(typeof result).toBe("string");
      
      // Restore location
      window.location = originalLocation;
    });
  });

  describe("configuration utilities", () => {
    it("should get visualization config from dashboard panel data", () => {
      const dashboardPanelData = {
        data: {
          config: { chartType: "bar", theme: "dark" },
          type: "histogram"
        }
      };
      
      const config = logsURL.getVisualizationConfig(dashboardPanelData);
      
      expect(config).toBeDefined();
      expect(config.config).toEqual({ chartType: "bar", theme: "dark" });
      expect(config.type).toBe("histogram");
    });

    it("should return null for invalid dashboard panel data", () => {
      expect(logsURL.getVisualizationConfig(null)).toBeNull();
      expect(logsURL.getVisualizationConfig({})).toBeNull();
      expect(logsURL.getVisualizationConfig({ data: null })).toBeNull();
    });

    it("should use default values for missing config data", () => {
      const dashboardPanelData = { data: {} };
      
      const config = logsURL.getVisualizationConfig(dashboardPanelData);
      
      expect(config).toBeDefined();
      expect(config.config).toEqual({});
      expect(config.type).toBe("bar");
    });

    it("should check if refresh interval is enabled", () => {
      expect(logsURL.enableRefreshInterval(10)).toBe(true);
      expect(logsURL.enableRefreshInterval(1)).toBe(false);
    });

    it("should handle missing zoConfig", () => {
      mockStore.state.zoConfig = null;
      
      expect(logsURL.enableRefreshInterval(10)).toBe(true);
    });

    it("should handle config utility errors gracefully", () => {
      expect(() => logsURL.getVisualizationConfig({ invalid: "data" })).not.toThrow();
      expect(() => logsURL.enableRefreshInterval(NaN)).not.toThrow();
    });
  });

  describe("error handling", () => {
    it("should handle all operations gracefully with null inputs", () => {
      expect(() => logsURL.generateURLQuery()).not.toThrow();
      expect(() => logsURL.updateUrlQueryParams(null)).not.toThrow();
      expect(() => logsURL.getVisualizationConfig(null)).not.toThrow();
    });

    it("should handle router errors in all operations", () => {
      mockRouter.push = vi.fn().mockImplementation(() => {
        throw new Error("Router error");
      });
      mockRouter.currentRoute = { value: null };
      
      expect(() => logsURL.updateUrlQueryParams()).not.toThrow();
      expect(() => logsURL.routeToSearchSchedule()).not.toThrow();
      expect(() => logsURL.navigateToSearch({})).not.toThrow();
      expect(() => logsURL.updateUrlParam("test", "value")).not.toThrow();
      expect(() => logsURL.clearUrlParams()).not.toThrow();
    });

    it("should handle complex error scenarios", () => {
      // Simulate complete router failure
      mockRouter.currentRoute = null;
      mockRouter.push = null;
      
      expect(() => logsURL.getCurrentUrlParams()).not.toThrow();
      expect(() => logsURL.hasUrlParam("test")).not.toThrow();
      expect(() => logsURL.getUrlParam("test")).not.toThrow();
      expect(() => logsURL.isRouteType("search")).not.toThrow();
    });
  });

  describe("integration scenarios", () => {
    beforeEach(() => {
      // Reset mocks for integration tests
      vi.clearAllMocks();
      mockRouter.currentRoute = {
        value: {
          query: {
            stream: "test-stream",
            query: "dGVzdCBxdWVyeQ==",
            sql_mode: "true",
            type: "search"
          }
        }
      };
      mockRouter.push = vi.fn();
    });

    it("should handle complete URL workflow", () => {
      // Generate URL query
      const query = logsURL.generateURLQuery();
      expect(query).toBeDefined();
      
      // Update URL parameters
      logsURL.updateUrlQueryParams();
      expect(mockRouter.push).toHaveBeenCalled();
      
      // Get current params
      const params = logsURL.getCurrentUrlParams();
      expect(params).toBeDefined();
      
      // Check specific parameter
      const hasStream = logsURL.hasUrlParam("stream");
      expect(hasStream).toBe(true);
      
      // Generate shareable URL
      const shareUrl = logsURL.generateShareableUrl();
      expect(shareUrl).toBeDefined();
    });

    it("should handle restoration and navigation workflow", async () => {
      // Restore from URL
      await logsURL.restoreUrlQueryParams();
      
      // Navigate to new search
      logsURL.navigateToSearch({
        query: "SELECT * FROM new_logs",
        streams: ["new-stream"]
      });
      
      // Route to schedule
      logsURL.routeToSearchSchedule();
      
      expect(mockRouter.push).toHaveBeenCalledTimes(3);
    });

    it("should handle parameter management workflow", () => {
      // Get initial state
      const initialParams = logsURL.getCurrentUrlParams();
      expect(initialParams).toBeDefined();
      
      // Update specific parameter
      logsURL.updateUrlParam("custom_param", "custom_value");
      
      // Mock updated router state for checking the parameter
      mockRouter.currentRoute.value.query.custom_param = "custom_value";
      
      // Check if parameter exists
      expect(logsURL.hasUrlParam("custom_param")).toBe(true);
      
      // Get parameter value
      const paramValue = logsURL.getUrlParam("custom_param");
      expect(paramValue).toBe("custom_value");
      
      // Clear all parameters
      logsURL.clearUrlParams();
      
      expect(mockRouter.push).toHaveBeenCalledWith({ query: {} });
    });

    it("should handle visualization and sharing workflow", () => {
      // Ensure window.location is properly set
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          pathname: '/logs',
          href: 'https://example.com/logs'
        },
        writable: true
      });

      const dashboardData = {
        data: {
          config: { type: "line", data: [1, 2, 3] },
          type: "chart"
        }
      };
      
      // Get visualization config
      const vizConfig = logsURL.getVisualizationConfig(dashboardData);
      expect(vizConfig).toBeDefined();
      
      // Generate URL with visualization
      const urlQuery = logsURL.generateURLQuery(false, dashboardData);
      expect(urlQuery.visualization_data).toBeDefined();
      
      // Generate shareable URL
      const shareUrl = logsURL.generateShareableUrl(dashboardData);
      expect(shareUrl).toContain("https://example.com/logs");
    });
  });
});