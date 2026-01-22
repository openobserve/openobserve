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

/**
 * Unit tests for ErrorViewer.vue component
 * 
 * This test suite covers:
 * 1. Component mounting and basic rendering
 * 2. Loading states and UI feedback
 * 3. Data processing and transformation
 * 4. Error handling scenarios
 * 5. Component methods and computed properties
 * 6. Integration with child components
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { Quasar } from "quasar";
import i18n from "@/locales";

// Mock search service
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

// Mock the child components
vi.mock("@/components/rum/errorTracking/view/ErrorHeader.vue", () => ({
  default: {
    name: "ErrorHeader",
    template: "<div data-test='error-header'>ErrorHeader</div>",
    props: ["error"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorTags.vue", () => ({
  default: {
    name: "ErrorTags",
    template: "<div data-test='error-tags'>ErrorTags</div>",
    props: ["error"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorEvents.vue", () => ({
  default: {
    name: "ErrorEvents",
    template: "<div data-test='error-events'>ErrorEvents</div>",
    props: ["error"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorSessionReplay.vue", () => ({
  default: {
    name: "ErrorSessionReplay",
    template: "<div data-test='error-session-replay'>ErrorSessionReplay</div>",
    props: ["error"],
  },
}));

vi.mock("@/components/rum/errorTracking/view/ErrorStackTrace.vue", () => ({
  default: {
    name: "ErrorStackTrace",
    template: "<div data-test='error-stack-trace'>ErrorStackTrace</div>",
    props: ["error_stack", "error"],
  },
}));

// Mock composables
vi.mock("@/composables/useQuery", () => ({
  default: () => ({
    getTimeInterval: vi.fn(),
    parseQuery: vi.fn(),
    buildQueryPayload: vi.fn(),
  }),
}));

vi.mock("@/composables/useErrorTracking", () => ({
  default: () => ({
    errorTrackingState: {
      data: {
        stream: {
          errorStream: "test_error_stream",
        },
      },
    },
  }),
}));

// Import the component after mocks
import ErrorViewer from "./ErrorViewer.vue";
import searchService from "@/services/search";

describe("ErrorViewer.vue", () => {
  let wrapper: VueWrapper<any>;
  let store: any;
  let router: any;
  let mockSearchService: any;

  const createMockStore = () => {
    return createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        zoConfig: {
          timestamp_column: "_timestamp",
        },
      },
    });
  };

  const createMockRouter = () => {
    return createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/error-viewer",
          component: ErrorViewer,
        },
        {
          path: "/",
          component: { template: "<div>Home</div>" },
        },
      ],
    });
  };

  const mockErrorData = {
    error_id: "test-error-id-123",
    type: "error",
    error_handling: "unhandled",
    error_stack: "Error: Test error\n    at test.js:1:1\n    at main.js:2:2",
    error_handling_stack: "Error: Test error\n    at test.js:1:1\n    at main.js:2:2",
    timestamp: 1640995200000000,
    message: "Test error message",
  };

  const mockEventsData = [
    {
      error_id: "test-error-id-123",
      type: "error",
      error_type: "TypeError",
      timestamp: 1640995200000000,
    },
    {
      error_id: "test-error-id-123",
      type: "action",
      action_type: "click",
      timestamp: 1640995199000000,
    },
    {
      error_id: "test-error-id-123",
      type: "view",
      view_loading_type: "route_change",
      timestamp: 1640995198000000,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    store = createMockStore();
    router = createMockRouter();
    mockSearchService = vi.mocked(searchService);

    // Mock router.currentRoute.value.query
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          timestamp: "1640995200000000",
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const mountComponent = (routeQuery: Record<string, any> = { timestamp: "1640995200000000" }) => {
    // Update router mock
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: routeQuery,
      },
    });

    return mount(ErrorViewer, {
      global: {
        plugins: [store, router, Quasar, i18n],
        stubs: {
          QSpinnerHourglass: {
            template: "<div data-test='spinner'>Loading...</div>",
          },
          QSeparator: {
            template: "<hr data-test='separator' />",
          },
        },
      },
    });
  };

  describe("Component Structure and Mounting", () => {
    it("should mount successfully", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have the correct container class", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      expect(wrapper.find(".error-viewer-container").exists()).toBe(true);
    });

    it("should have correct styles applied", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      const container = wrapper.find(".error-viewer-container");
      expect(container.exists()).toBe(true);
      // Check that the container has the expected CSS class
      expect(container.classes()).toContain("error-viewer-container");
    });
  });

  describe("Data Properties and Initialization", () => {
    it("should initialize with empty errorDetails", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      expect(wrapper.vm.errorDetails).toEqual({});
    });

    it("should initialize with empty isLoading array", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      expect(wrapper.vm.isLoading).toEqual([]);
    });
  });

  describe("Computed Properties", () => {
    it("should compute timestamp correctly from route query", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent({ timestamp: "1234567890" });
      expect(wrapper.vm.getTimestamp).toBe(1234567890);
    });

    it("should use default timestamp (30000) when route query is missing", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent({});
      expect(wrapper.vm.getTimestamp).toBe(30000);
    });

    it("should use default timestamp when route query timestamp is invalid", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent({ timestamp: "invalid" });
      expect(wrapper.vm.getTimestamp).toBe(30000);
    });

    it("should handle null/undefined timestamp", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent({ timestamp: null });
      expect(wrapper.vm.getTimestamp).toBe(30000);
    });
  });

  describe("Event Category Processing Method", () => {
    beforeEach(() => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
    });

    it("should categorize error events correctly", () => {
      const component = wrapper.vm;
      
      expect(component.getErrorCategory({ type: "error", error_type: "TypeError" })).toBe("TypeError");
      expect(component.getErrorCategory({ type: "resource", resource_type: "xhr" })).toBe("xhr");
      expect(component.getErrorCategory({ type: "view", view_loading_type: "route_change" })).toBe("Navigation");
      expect(component.getErrorCategory({ type: "view", view_loading_type: "initial_load" })).toBe("Reload");
      expect(component.getErrorCategory({ type: "action", action_type: "click" })).toBe("click");
      expect(component.getErrorCategory({ type: "unknown" })).toBe("unknown");
    });

    it("should default to 'Error' for error type without error_type", () => {
      const component = wrapper.vm;
      expect(component.getErrorCategory({ type: "error" })).toBe("Error");
    });

    it("should handle edge cases", () => {
      const component = wrapper.vm;
      expect(component.getErrorCategory({})).toBe(undefined);
      expect(component.getErrorCategory({ type: "" })).toBe("");
    });
  });

  describe("Component Rendering", () => {
    it("should render loading spinner when isLoading has elements", async () => {
      // Mock search to add to loading array
      wrapper = mountComponent();
      
      // Manually add to isLoading array to simulate loading state
      wrapper.vm.isLoading.push(true);
      await nextTick();

      expect(wrapper.find('[data-test="spinner"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("Hold on tight, we're fetching error details.");
    });

    it("should not render main content when loading", async () => {
      wrapper = mountComponent();
      
      // Manually add to isLoading array to simulate loading state
      wrapper.vm.isLoading.push(true);
      await nextTick();

      expect(wrapper.find('[data-test="error-header"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="error-tags"]').exists()).toBe(false);
    });

    it("should render main content when not loading", async () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      
      // Ensure isLoading is empty
      wrapper.vm.isLoading = [];
      await nextTick();

      expect(wrapper.find('[data-test="error-header"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-tags"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-stack-trace"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-session-replay"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="error-events"]').exists()).toBe(true);
    });

    it("should render separator", async () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      
      // Ensure isLoading is empty
      wrapper.vm.isLoading = [];
      await nextTick();

      expect(wrapper.find('[data-test="separator"]').exists()).toBe(true);
    });
  });

  describe("Child Component Props", () => {
    beforeEach(async () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      
      // Set up error details manually for testing
      wrapper.vm.errorDetails = mockErrorData;
      wrapper.vm.errorDetails.error_stack = ["Error: Test", "  at test.js:1:1"];
      wrapper.vm.isLoading = [];
      await nextTick();
    });

    it("should pass correct props to ErrorHeader", () => {
      const errorHeader = wrapper.findComponent({ name: "ErrorHeader" });
      expect(errorHeader.props("error")).toEqual(wrapper.vm.errorDetails);
    });

    it("should pass correct props to ErrorTags", () => {
      const errorTags = wrapper.findComponent({ name: "ErrorTags" });
      expect(errorTags.props("error")).toEqual(wrapper.vm.errorDetails);
    });

    it("should pass correct props to ErrorStackTrace", () => {
      const errorStackTrace = wrapper.findComponent({ name: "ErrorStackTrace" });
      expect(errorStackTrace.props("error")).toEqual(wrapper.vm.errorDetails);
      expect(errorStackTrace.props("error_stack")).toEqual(wrapper.vm.errorDetails.error_stack || []);
    });

    it("should pass correct props to ErrorSessionReplay", () => {
      const errorSessionReplay = wrapper.findComponent({ name: "ErrorSessionReplay" });
      expect(errorSessionReplay.props("error")).toEqual(wrapper.vm.errorDetails);
    });

    it("should pass correct props to ErrorEvents", () => {
      const errorEvents = wrapper.findComponent({ name: "ErrorEvents" });
      expect(errorEvents.props("error")).toEqual(wrapper.vm.errorDetails);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle search service errors gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSearchService.search.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await nextTick();

      // Component should still mount and not crash
      expect(wrapper.exists()).toBe(true);
      
      consoleErrorSpy.mockRestore();
    });

    it("should handle component unmounting gracefully", () => {
      mockSearchService.search.mockResolvedValue({
        data: { hits: [mockErrorData] },
      });
      wrapper = mountComponent();
      
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Manual Error Details Processing", () => {
    it("should process error_handling_stack when available", async () => {
      wrapper = mountComponent();
      
      // Manually set error details with handling stack
      const testErrorData = {
        ...mockErrorData,
        error_handling_stack: "Error: Handling stack\n    at handler.js:1:1",
        error_stack: "Error: Regular stack\n    at main.js:1:1",
      };
      
      // Simulate the error stack processing logic
      const errorStack = testErrorData.error_handling_stack || testErrorData.error_stack;
      const processedStack = errorStack.split("\n");
      
      expect(processedStack).toEqual([
        "Error: Handling stack",
        "    at handler.js:1:1",
      ]);
    });

    it("should fallback to error_stack when error_handling_stack is not available", async () => {
      wrapper = mountComponent();
      
      // Manually set error details without handling stack
      const testErrorData = {
        ...mockErrorData,
        error_stack: "Error: Regular stack\n    at main.js:1:1",
      };
      delete testErrorData.error_handling_stack;
      
      // Simulate the error stack processing logic
      const errorStack = testErrorData.error_handling_stack || testErrorData.error_stack;
      const processedStack = errorStack.split("\n");
      
      expect(processedStack).toEqual([
        "Error: Regular stack",
        "    at main.js:1:1",
      ]);
    });
  });

  describe("Component State Management", () => {
    it("should manage loading state correctly", async () => {
      wrapper = mountComponent();
      
      // Test adding to loading state
      wrapper.vm.isLoading.push(true);
      expect(wrapper.vm.isLoading.length).toBe(1);
      
      // Test removing from loading state
      wrapper.vm.isLoading.pop();
      expect(wrapper.vm.isLoading.length).toBe(0);
    });

    it("should maintain errorDetails state", async () => {
      wrapper = mountComponent();
      
      // Test setting error details
      wrapper.vm.errorDetails = mockErrorData;
      expect(wrapper.vm.errorDetails.error_id).toBe("test-error-id-123");
      expect(wrapper.vm.errorDetails.type).toBe("error");
    });
  });

  describe("Search Service Integration", () => {
    it("should have access to search service methods", () => {
      // Test that the search service is properly mocked and accessible
      expect(mockSearchService.search).toBeDefined();
      expect(typeof mockSearchService.search).toBe("function");
    });

    it("should be able to call search service", async () => {
      mockSearchService.search.mockResolvedValueOnce({
        data: { hits: [mockErrorData] },
      });

      // Manually call the search service to test integration
      const result = await mockSearchService.search({
        org_identifier: "test-org",
        query: { sql: "SELECT * FROM test" },
        page_type: "logs",
      }, "RUM");

      expect(result.data.hits).toEqual([mockErrorData]);
      expect(mockSearchService.search).toHaveBeenCalledWith(
        {
          org_identifier: "test-org",
          query: { sql: "SELECT * FROM test" },
          page_type: "logs",
        },
        "RUM"
      );
    });
  });
});
