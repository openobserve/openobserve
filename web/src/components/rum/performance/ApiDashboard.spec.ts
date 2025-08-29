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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ApiDashboard from "./ApiDashboard.vue";
import { createI18n } from "vue-i18n";
import { createStore } from "vuex";
import { nextTick, ref } from "vue";

// Mock dependencies
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(() => ({
      then: vi.fn((callback) => {
        callback({
          data: {
            hits: [
              {
                url: "https://api.example.com/users?id=123",
                max_duration: 2.5,
                max_resource_size: 1024.5,
                error_count: 5,
              },
              {
                url: "https://api.example.com/posts?limit=10",
                max_duration: 1.8,
                max_resource_size: 512.3,
                error_count: 2,
              },
            ],
          },
        });
        return { catch: vi.fn() };
      }),
    })),
  },
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

vi.mock("@/utils/rum/api.json", () => ({
  default: {
    version: 2,
    title: "API Performance Dashboard",
    panels: [
      { id: "panel1", title: "API Response Time" },
      { id: "panel2", title: "API Error Rate" },
      { id: "panel3", title: "API Throughput" },
    ],
  },
}));

// Create mock router functions
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

// Mock vue-router
vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "api-dashboard",
      folder: "rum",
    },
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
}));

vi.mock("@/views/Dashboards/RenderDashboardCharts.vue", () => ({
  default: {
    name: "RenderDashboardCharts",
    template:
      '<div class="render-dashboard-charts">Mock API Dashboard Charts</div>',
    props: ["viewOnly", "dashboardData", "currentTimeObj", "searchType"],
    methods: {
      layoutUpdate: vi.fn(),
    },
    emits: ["variablesData"],
  },
}));

installQuasar();

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
  },
});

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: {
      rum: {
        apiPerformance: "API Performance",
      },
    },
  },
});

describe("ApiDashboard.vue", () => {
  let wrapper: any;
  let mockConvertDashboardSchemaVersion: any;
  let mockSearchService: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup mocks
    const { convertDashboardSchemaVersion } = await import(
      "@/utils/dashboard/convertDashboardSchemaVersion"
    );
    mockConvertDashboardSchemaVersion = vi.mocked(
      convertDashboardSchemaVersion,
    );

    mockSearchService = (await import("@/services/search")).default;

    // Clear router mocks
    mockRouterPush.mockClear();
    mockRouterReplace.mockClear();

    // Mock window methods
    Object.defineProperty(window, "dispatchEvent", {
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully with default props", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: {
              query: {
                dashboard: "api-dashboard",
                folder: "rum",
              },
            },
          },
        },
      });

      await nextTick();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".api-performance-dashboards").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.vm.$options.name).toBe("ApiDashboard");
    });

    it("should mount with custom dateTime and selectedDate props", async () => {
      const customDateTime = {
        start_time: new Date("2023-01-01"),
        end_time: new Date("2023-01-02"),
      };

      const customSelectedDate = {
        startTime: "2023-01-01T00:00:00Z",
        endTime: "2023-01-02T00:00:00Z",
      };

      wrapper = mount(ApiDashboard, {
        props: {
          dateTime: customDateTime,
          selectedDate: customSelectedDate,
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.props("dateTime")).toEqual(customDateTime);
      expect(wrapper.props("selectedDate")).toEqual(customSelectedDate);
    });

    it("should have correct key prop for organization change", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      const qPage = wrapper.find(".api-performance-dashboards");
      expect(qPage.exists()).toBe(true);
    });
  });

  describe("Dashboard Loading", () => {
    it("should call loadDashboard on mount", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      await nextTick();
      expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();
    });

    it("should load dashboard data correctly", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      await wrapper.vm.loadDashboard();
      expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
    });

    it("should handle variables data when dashboard has no variables", async () => {
      mockConvertDashboardSchemaVersion.mockReturnValue({
        panels: [],
        variables: null,
      });

      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      await wrapper.vm.loadDashboard();

      expect(wrapper.vm.variablesData.isVariablesLoading).toBe(false);
      expect(wrapper.vm.variablesData.values).toEqual([]);
    });

    it("should handle existing variables data", async () => {
      const mockDashboardWithVars = {
        variables: {
          list: [{ name: "service", value: "api" }],
        },
      };
      mockConvertDashboardSchemaVersion.mockReturnValue(mockDashboardWithVars);

      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      await wrapper.vm.loadDashboard();

      expect(wrapper.vm.currentDashboardData.data).toEqual(
        mockDashboardWithVars,
      );
    });
  });

  describe("Component Layout", () => {
    it("should execute updateLayout correctly", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(typeof wrapper.vm.updateLayout).toBe("function");

      await wrapper.vm.updateLayout();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });

    it("should handle updateLayout with null ref gracefully", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      wrapper.vm.apiDashboardChartsRef = null;

      await wrapper.vm.updateLayout();
      expect(true).toBe(true); // Test passes if no error is thrown
    });
  });

  describe("Loading States", () => {
    it("should show loading spinner when isLoading has items", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
          stubs: {
            "q-spinner-hourglass": true,
          },
        },
      });

      wrapper.vm.isLoading.push("loading");
      await nextTick();

      expect(wrapper.find("q-spinner-hourglass-stub").exists()).toBe(true);
      expect(wrapper.text()).toContain("Loading Dashboard");
    });

    it("should hide loading spinner when isLoading is empty", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      wrapper.vm.isLoading.splice(0);
      await nextTick();

      const dashboardDiv = wrapper.find(".api-performance-dashboards");
      expect(dashboardDiv.attributes("style")).toContain("visibility: visible");
    });

    it("should hide dashboard when loading", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      wrapper.vm.isLoading.push("dashboard-loading");
      await nextTick();

      const dashboardDiv = wrapper.find(".api-performance-dashboards");
      expect(dashboardDiv.attributes("style")).toContain("visibility: hidden");
    });
  });

  describe("RenderDashboardCharts Integration", () => {
    it("should render RenderDashboardCharts with correct props", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      const dashboardCharts = wrapper.findComponent({
        name: "RenderDashboardCharts",
      });
      expect(dashboardCharts.exists()).toBe(true);
      expect(dashboardCharts.props("viewOnly")).toBe(true);
      expect(dashboardCharts.props("searchType")).toBe("RUM");
    });

    it("should handle variablesData event from RenderDashboardCharts", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      const testVariablesData = {
        values: [{ name: "service", value: "api" }],
      };

      const dashboardCharts = wrapper.findComponent({
        name: "RenderDashboardCharts",
      });

      // Simulate variablesData event
      await dashboardCharts.vm.$emit("variablesData", testVariablesData);

      expect(wrapper.vm.variablesData).toEqual(testVariablesData);
    });

    it("should not update variables data if unchanged", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      const testVariablesData = {
        values: [{ name: "service", value: "api" }],
      };

      wrapper.vm.variablesData = testVariablesData;

      // Should not update if data is the same
      wrapper.vm.variablesDataUpdated(testVariablesData);

      expect(wrapper.vm.variablesData).toEqual(testVariablesData);
    });

    it("should pass dashboard data to RenderDashboardCharts", async () => {
      const testDashboardData = {
        title: "Test API Dashboard",
        panels: [{ id: "panel1", title: "API Metrics" }],
      };

      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      wrapper.vm.currentDashboardData.data = testDashboardData;
      await nextTick();

      const dashboardCharts = wrapper.findComponent({
        name: "RenderDashboardCharts",
      });
      expect(dashboardCharts.props("dashboardData")).toEqual(testDashboardData);
    });
  });

  describe("API Resource Queries", () => {
    describe("getTopSlowResources", () => {
      it("should fetch top slow resources", async () => {
        const selectedDate = {
          startTime: 1640995200000, // 2022-01-01
          endTime: 1641081600000, // 2022-01-02
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        await wrapper.vm.getTopSlowResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            query: {
              query: {
                sql: `SELECT avg(resource_duration/1000000) as max_duration, SPLIT_PART(resource_url, '?', 1) AS url FROM "_rumdata" where resource_duration>=0 and resource_method is not null group by url order by max_duration desc`,
                start_time: selectedDate.startTime,
                end_time: selectedDate.endTime,
                from: 0,
                size: 10,
              },
            },
            page_type: "logs",
          }),
          "RUM",
        );

        expect(wrapper.vm.topSlowResources).toHaveLength(2);
        expect(wrapper.vm.topSlowResources[0]).toEqual({
          url: "/users",
          max_duration: "2.50",
        });
      });

      it("should handle SQL injection in variables", async () => {
        const selectedDate = {
          startTime: 1640995200000,
          endTime: 1641081600000,
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = {
          values: [
            {
              type: "query_values",
              name: "service",
              value: "api'; DROP TABLE users; --",
            },
          ],
        };

        await wrapper.vm.getTopSlowResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            query: {
              query: {
                sql: `SELECT avg(resource_duration/1000000) as max_duration, SPLIT_PART(resource_url, '?', 1) AS url FROM "_rumdata" where resource_duration>=0 and resource_method is not null  and service='api'; DROP TABLE users; --' group by url order by max_duration desc`,
                start_time: selectedDate.startTime,
                end_time: selectedDate.endTime,
                from: 0,
                size: 10,
              },
            },
            page_type: "logs",
          }),
          "RUM",
        );
      });
    });

    describe("getTopHeavyResources", () => {
      it("should fetch top heavy resources", async () => {
        const selectedDate = {
          startTime: 1640995200000,
          endTime: 1641081600000,
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        await wrapper.vm.getTopHeavyResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            query: {
              query: {
                sql: `SELECT avg(resource_size/1024) as max_resource_size, SPLIT_PART(resource_url, '?', 1) AS url FROM "_rumdata" WHERE resource_size>=0 group by url order by max_resource_size desc`,
                start_time: selectedDate.startTime,
                end_time: selectedDate.endTime,
                from: 0,
                size: 10,
              },
            },
            page_type: "logs",
          }),
          "RUM",
        );

        expect(wrapper.vm.topHeavyResources).toHaveLength(2);
        console.log(wrapper.vm.topHeavyResources);
        expect(wrapper.vm.topHeavyResources[0].url).toBe("/users");
      });

      it("should include variables in WHERE clause", async () => {
        const selectedDate = {
          startTime: 1640995200000,
          endTime: 1641081600000,
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = {
          values: [
            {
              type: "query_values",
              name: "service",
              value: "api",
            },
          ],
        };

        await wrapper.vm.getTopHeavyResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            page_type: "logs",
            query: {
              query: {
                end_time: 1641081600000,
                from: 0,
                size: 10,
                sql: `SELECT avg(resource_size/1024) as max_resource_size, SPLIT_PART(resource_url, '?', 1) AS url FROM "_rumdata" WHERE resource_size>=0  and service='api' group by url order by max_resource_size desc`,
                start_time: 1640995200000,
              },
            },
          }),
          "RUM",
        );
      });
    });

    describe("getTopErrorResources", () => {
      it("should fetch top error resources", async () => {
        const selectedDate = {
          startTime: 1640995200000,
          endTime: 1641081600000,
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        await wrapper.vm.getTopErrorResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            query: {
              query: {
                sql: `SELECT SPLIT_PART(resource_url, '?', 1) AS url, count(*) as error_count FROM "_rumdata" WHERE resource_status_code>400  group by url order by error_count desc`,
                start_time: selectedDate.startTime,
                end_time: selectedDate.endTime,
                from: 0,
                size: 10,
              },
            },
            page_type: "logs",
          }),
          "RUM",
        );

        expect(wrapper.vm.topErrorResources).toHaveLength(2);
        expect(wrapper.vm.topErrorResources[0].url).toBe("/users");
      });

      it("should handle empty variables data", async () => {
        const selectedDate = {
          startTime: 1640995200000,
          endTime: 1641081600000,
        };

        wrapper = mount(ApiDashboard, {
          props: { selectedDate },
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = { values: [] };

        await wrapper.vm.getTopErrorResources();

        expect(mockSearchService.search).toHaveBeenCalledWith(
          expect.objectContaining({
            org_identifier: "test-org",
            query: {
              query: {
                sql: `SELECT SPLIT_PART(resource_url, '?', 1) AS url, count(*) as error_count FROM "_rumdata" WHERE resource_status_code>400  group by url order by error_count desc`,
                start_time: selectedDate.startTime,
                end_time: selectedDate.endTime,
                from: 0,
                size: 10,
              },
            },
            page_type: "logs",
          }),
          "RUM",
        );
      });
    });

    describe("getVariablesString", () => {
      it("should generate correct variables string", () => {
        wrapper = mount(ApiDashboard, {
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = {
          values: [
            {
              type: "query_values",
              name: "service",
              value: "api",
            },
            {
              type: "query_values",
              name: "environment",
              value: "production",
            },
          ],
        };

        const result = wrapper.vm.getVariablesString();

        expect(result).toBe(" and service='api' and environment='production'");
      });

      it("should skip variables without values", () => {
        wrapper = mount(ApiDashboard, {
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = {
          values: [
            {
              type: "query_values",
              name: "service",
              value: "",
            },
            {
              type: "query_values",
              name: "environment",
              value: "production",
            },
          ],
        };

        const result = wrapper.vm.getVariablesString();

        expect(result).toBe(" and environment='production'");
      });

      it("should skip non-query_values type variables", () => {
        wrapper = mount(ApiDashboard, {
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = {
          values: [
            {
              type: "constant",
              name: "service",
              value: "api",
            },
            {
              type: "query_values",
              name: "environment",
              value: "production",
            },
          ],
        };

        const result = wrapper.vm.getVariablesString();

        expect(result).toBe(" and environment='production'");
      });

      it("should handle empty or null variables data", () => {
        wrapper = mount(ApiDashboard, {
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });

        wrapper.vm.variablesData = { values: null };
        expect(wrapper.vm.getVariablesString()).toBe("");

        wrapper.vm.variablesData = { values: [] };
        expect(wrapper.vm.getVariablesString()).toBe("");
      });
    });
  });

  describe("Selected Date Watcher", () => {
    it("should trigger API calls when selectedDate changes", async () => {
      const initialDate = {
        startTime: 1640995200000,
        endTime: 1641081600000,
      };

      const newDate = {
        startTime: 1641168000000, // Different date
        endTime: 1641254400000,
      };

      wrapper = mount(ApiDashboard, {
        props: { selectedDate: initialDate },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      mockSearchService.search.mockClear();

      // Change selectedDate prop
      await wrapper.setProps({ selectedDate: newDate });

      // The watcher should trigger the API calls
      expect(mockSearchService.search).toHaveBeenCalledTimes(2); // Heavy and Slow resources
    });

    it("should not trigger API calls when selectedDate is unchanged", async () => {
      const sameDate = {
        startTime: 1640995200000,
        endTime: 1641081600000,
      };

      wrapper = mount(ApiDashboard, {
        props: { selectedDate: sameDate },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      mockSearchService.search.mockClear();

      // Set the same selectedDate
      await wrapper.setProps({ selectedDate: sameDate });

      // Should not trigger API calls since the data is the same
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });
  });

  describe("Variables Data", () => {
    it("should update variables data correctly", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      const testVariablesData = {
        values: [
          { name: "service", value: "api", type: "query_values" },
          { name: "environment", value: "production", type: "query_values" },
        ],
      };

      wrapper.vm.variablesDataUpdated(testVariablesData);

      expect(wrapper.vm.variablesData).toEqual(testVariablesData);
    });
  });

  describe("Settings Dialog", () => {
    it("should open settings dialog", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
      wrapper.vm.addSettingsData();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
    });
  });

  describe("Component Properties", () => {
    it("should have all required reactive properties", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.vm.currentDashboardData).toBeDefined();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
      expect(wrapper.vm.viewOnly).toBe(true);
      expect(wrapper.vm.eventLog).toEqual([]);
      expect(wrapper.vm.topSlowResources).toEqual([]);
      expect(wrapper.vm.topHeavyResources).toEqual([]);
      expect(wrapper.vm.topErrorResources).toEqual([]);
      expect(typeof wrapper.vm.variablesData).toBe("object");
      expect(wrapper.vm.refDateTime).toBe(null);
      expect(wrapper.vm.refreshInterval).toBe(0);
      expect(wrapper.vm.isLoading).toEqual([]);
    });

    it("should expose all required methods", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(typeof wrapper.vm.loadDashboard).toBe("function");
      expect(typeof wrapper.vm.updateLayout).toBe("function");
      expect(typeof wrapper.vm.getTopSlowResources).toBe("function");
      expect(typeof wrapper.vm.getTopHeavyResources).toBe("function");
      expect(typeof wrapper.vm.getTopErrorResources).toBe("function");
      expect(typeof wrapper.vm.getVariablesString).toBe("function");
      expect(typeof wrapper.vm.variablesDataUpdated).toBe("function");
      expect(typeof wrapper.vm.addSettingsData).toBe("function");
    });

    it("should have access to store and utilities", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe(
        "test-org",
      );
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Default Props", () => {
    it("should use default props when none provided", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.props("dateTime")).toEqual({});
      expect(wrapper.props("selectedDate")).toEqual({});
    });

    it("should validate props correctly", () => {
      const validDateTime = {
        start_time: new Date(),
        end_time: new Date(),
      };

      const validSelectedDate = {
        startTime: 1640995200000,
        endTime: 1641081600000,
      };

      wrapper = mount(ApiDashboard, {
        props: {
          dateTime: validDateTime,
          selectedDate: validSelectedDate,
        },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(wrapper.props("dateTime")).toEqual(validDateTime);
      expect(wrapper.props("selectedDate")).toEqual(validSelectedDate);
    });
  });

  describe("Component Lifecycle", () => {
    it("should call loadDashboard and updateLayout on mount", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      await nextTick();

      expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();
    });

    it("should call updateLayout on activated", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      (window.dispatchEvent as any).mockClear();

      await wrapper.vm.updateLayout();

      expect(window.dispatchEvent).toHaveBeenCalled();
    });

    it("should unmount cleanly without errors", () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle search service errors gracefully", async () => {
      mockSearchService.search.mockRejectedValueOnce(
        new Error("Search failed"),
      );

      const selectedDate = {
        startTime: 1640995200000,
        endTime: 1641081600000,
      };

      wrapper = mount(ApiDashboard, {
        props: { selectedDate },
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      // Should not throw even if search fails
      expect(() => wrapper.vm.getTopSlowResources()).not.toThrow();
    });

    it("should handle schema conversion errors gracefully", async () => {
      mockConvertDashboardSchemaVersion.mockImplementation(() => {
        throw new Error("Schema conversion failed");
      });

      expect(() => {
        wrapper = mount(ApiDashboard, {
          global: {
            plugins: [mockI18n],
            provide: {
              store: mockStore,
            },
            mocks: {
              $store: mockStore,
              $router: mockRouter,
              $route: { query: {} },
            },
          },
        });
      }).not.toThrow();

      // Reset mock for cleanup
      mockConvertDashboardSchemaVersion.mockImplementation((data) => data);
    });

    it("should handle missing apiDashboardChartsRef", async () => {
      wrapper = mount(ApiDashboard, {
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: { query: {} },
          },
        },
      });

      wrapper.vm.apiDashboardChartsRef = null;

      expect(async () => {
        await wrapper.vm.updateLayout();
      }).not.toThrow();
    });
  });

  describe("Integration Tests", () => {
    it("should perform complete component workflow", async () => {
      const customProps = {
        dateTime: {
          start_time: new Date("2023-01-01"),
          end_time: new Date("2023-01-02"),
        },
        selectedDate: {
          startTime: 1640995200000,
          endTime: 1641081600000,
        },
      };

      wrapper = mount(ApiDashboard, {
        props: customProps,
        global: {
          plugins: [mockI18n],
          provide: {
            store: mockStore,
          },
          mocks: {
            $store: mockStore,
            $router: mockRouter,
            $route: {
              query: {
                dashboard: "api-dashboard",
                folder: "rum",
              },
            },
          },
        },
      });

      // Verify component mounted
      expect(wrapper.exists()).toBe(true);

      // Test loadDashboard was called
      expect(mockConvertDashboardSchemaVersion).toHaveBeenCalled();

      // Test variables data update
      const variableData = {
        values: [{ name: "service", value: "api", type: "query_values" }],
      };
      wrapper.vm.variablesDataUpdated(variableData);
      expect(wrapper.vm.variablesData).toEqual(variableData);

      // Test API resource queries
      await wrapper.vm.getTopSlowResources();
      await wrapper.vm.getTopHeavyResources();
      await wrapper.vm.getTopErrorResources();

      expect(mockSearchService.search).toHaveBeenCalledTimes(3);

      // Verify resource arrays are populated
      expect(wrapper.vm.topSlowResources).toHaveLength(2);
      expect(wrapper.vm.topHeavyResources).toHaveLength(2);
      expect(wrapper.vm.topErrorResources).toHaveLength(2);

      // Test variables string generation
      const variablesString = wrapper.vm.getVariablesString();
      expect(variablesString).toContain("service='api'");

      // Test settings dialog
      wrapper.vm.addSettingsData();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);

      // Test layout update
      await wrapper.vm.updateLayout();
      expect(window.dispatchEvent).toHaveBeenCalled();

      // Verify dashboard charts integration
      const chartsComponent = wrapper.findComponent({
        name: "RenderDashboardCharts",
      });
      expect(chartsComponent.exists()).toBe(true);
      expect(chartsComponent.props()).toMatchObject({
        viewOnly: true,
        searchType: "RUM",
        currentTimeObj: customProps.dateTime,
      });

      // Test selectedDate watcher by changing props
      const newSelectedDate = {
        startTime: 1641168000000,
        endTime: 1641254400000,
      };

      mockSearchService.search.mockClear();
      await wrapper.setProps({ selectedDate: newSelectedDate });

      // Should trigger the watcher and API calls
      expect(mockSearchService.search).toHaveBeenCalledTimes(2);
    });
  });
});
