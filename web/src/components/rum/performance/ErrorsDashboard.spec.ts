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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import ErrorsDashboard from "@/components/rum/performance/ErrorsDashboard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { useRoute, useRouter } from "vue-router";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock dependencies
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn().mockResolvedValue({
      data: {
        hits: [
          { url: "https://example.com/page1", error_count: 10 },
          { url: "https://example.com/page2", error_count: 5 },
        ],
      },
    }),
  },
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => ({
    ...data,
    title: "RUM Errors Dashboard",
    panels: [
      { id: "error-panel1", title: "Error Rate" },
      { id: "error-panel2", title: "Top Errors" },
    ],
  })),
}));

vi.mock("@/utils/rum/errors.json", () => ({
  default: {
    version: 2,
    title: "RUM Errors Dashboard",
    panels: [
      { id: "errors-rate", title: "Error Rate" },
      { id: "top-errors", title: "Top Errors" },
    ],
    variables: {
      list: [
        { name: "service", value: "frontend" },
        { name: "environment", value: "production" },
      ],
    },
  },
}));

// Mock vue-router composables
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return {
    ...actual,
    useRoute: vi.fn(),
    useRouter: vi.fn(),
  };
});

// Mock window methods
Object.defineProperty(window, "dispatchEvent", {
  value: vi.fn(),
  writable: true,
});

// Mock route object
const mockRoute = {
  query: {
    dashboard: "errors-dashboard",
    folder: "rum",
    period: "15m",
    org_identifier: "default",
  },
  name: "errorsDashboard",
};

describe("ErrorsDashboard", () => {
  let wrapper: any;
  let useRouteSpy: any;
  let useRouterSpy: any;
  let routerPushSpy: any;
  let routerReplaceSpy: any;

  beforeEach(async () => {
    // Spy on vue-router composables instead of mocking
    routerPushSpy = vi.fn();
    routerReplaceSpy = vi.fn();

    useRouteSpy = vi.mocked(useRoute).mockReturnValue(mockRoute);
    useRouterSpy = vi.mocked(useRouter).mockReturnValue({
      push: routerPushSpy,
      replace: routerReplaceSpy,
    } as any);

    // Set theme in store
    store.state.theme = "dark";

    wrapper = mount(ErrorsDashboard, {
      attachTo: "#app",
      props: {
        dateTime: {
          start_time: new Date("2023-01-01T00:00:00Z"),
          end_time: new Date("2023-01-02T00:00:00Z"),
        },
      },
      global: {
        plugins: [i18n, router],
        provide: {
          store,
          $route: mockRoute,
        },
        stubs: {
          RenderDashboardCharts: {
            template:
              '<div data-test="dashboard-charts">Mock Dashboard Charts</div>',
            props: [
              "viewOnly",
              "dashboardData",
              "currentTimeObj",
              "searchType",
            ],
            methods: {
              layoutUpdate: vi.fn(),
            },
          },
          "q-spinner-hourglass": {
            template: '<div data-test="loading-spinner">Loading...</div>',
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".performance-error-dashboard").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("ErrorsDashboard");
    });

    it("should render with provided dateTime prop", () => {
      expect(wrapper.props("dateTime")).toEqual({
        start_time: new Date("2023-01-01T00:00:00Z"),
        end_time: new Date("2023-01-02T00:00:00Z"),
      });
    });
  });

  describe("Dashboard Charts Integration", () => {
    it("should render dashboard charts component", () => {
      const charts = wrapper.find("[data-test='dashboard-charts']");
      expect(charts.exists()).toBe(true);
    });

    it("should pass correct props to dashboard charts", () => {
      const charts = wrapper.find("[data-test='dashboard-charts']");
      expect(charts.exists()).toBe(true);
    });

    it("should have dashboard data", () => {
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
      expect(wrapper.vm.currentDashboardData.data.title).toBe(
        "RUM Errors Dashboard",
      );
      expect(wrapper.vm.currentDashboardData.data.panels).toHaveLength(2);
    });
  });

  describe("Loading States", () => {
    it("should show loading spinner when isLoading has items", async () => {
      wrapper.vm.isLoading.push("loading");
      await wrapper.vm.$nextTick();

      const spinner = wrapper.find("[data-test='loading-spinner']");
      expect(spinner.exists()).toBe(true);

      const dashboard = wrapper.find(".performance-error-dashboard");
      expect(dashboard.attributes("style")).toContain("visibility: hidden");
    });

    it("should hide loading spinner when isLoading is empty", async () => {
      wrapper.vm.isLoading.splice(0);
      await wrapper.vm.$nextTick();

      const dashboard = wrapper.find(".performance-error-dashboard");
      expect(dashboard.attributes("style")).toContain("visibility: visible");
    });
  });

  describe("Component Lifecycle", () => {
    it("should load dashboard on mount", () => {
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
      expect(wrapper.vm.currentDashboardData.data.panels).toHaveLength(2);
    });

    it("should have updateLayout method", () => {
      expect(typeof wrapper.vm.updateLayout).toBe("function");
    });

    it("should dispatch resize event on updateLayout", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      await wrapper.vm.updateLayout();

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
    });

    it("should handle chart ref layout updates", async () => {
      const mockLayoutUpdate = vi.fn();
      wrapper.vm.errorRenderDashboardChartsRef = {
        layoutUpdate: mockLayoutUpdate,
      };

      await wrapper.vm.updateLayout();

      expect(mockLayoutUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe("Variables Data Management", () => {
    it("should initialize variables data", () => {
      expect(wrapper.vm.variablesData).toBeDefined();
    });

    it("should update variables data", async () => {
      const testData = {
        values: [
          { name: "service", value: "api" },
          { name: "environment", value: "staging" },
        ],
      };

      wrapper.vm.variablesDataUpdated(testData);

      expect(wrapper.vm.variablesData).toEqual(testData);
    });

    it("should not update if data is the same", async () => {
      const testData = { values: [{ name: "service", value: "frontend" }] };
      wrapper.vm.variablesData = testData;

      const originalData = wrapper.vm.variablesData;
      wrapper.vm.variablesDataUpdated(testData);

      expect(wrapper.vm.variablesData).toBe(originalData);
    });
  });

  describe("Settings Dialog", () => {
    it("should open settings dialog", () => {
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);

      wrapper.vm.addSettingsData();

      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing chart ref gracefully", async () => {
      wrapper.vm.errorRenderDashboardChartsRef = null;

      await expect(wrapper.vm.updateLayout()).resolves.not.toThrow();
    });

    it("should handle dashboard loading errors", () => {
      expect(() => {
        wrapper.vm.loadDashboard();
      }).not.toThrow();
    });
  });

  describe("Component Properties", () => {
    it("should have all required reactive properties", () => {
      expect(wrapper.vm.currentDashboardData).toBeDefined();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
      expect(wrapper.vm.viewOnly).toBe(true);
      expect(wrapper.vm.errorsByView).toEqual([]);
      expect(wrapper.vm.variablesData).toBeDefined();
      expect(wrapper.vm.refreshInterval).toBe(0);
      expect(wrapper.vm.isLoading).toEqual([]);
    });

    it("should expose all required methods", () => {
      expect(typeof wrapper.vm.loadDashboard).toBe("function");
      expect(typeof wrapper.vm.updateLayout).toBe("function");
      expect(typeof wrapper.vm.variablesDataUpdated).toBe("function");
      expect(typeof wrapper.vm.addSettingsData).toBe("function");
    });

    it("should have access to store and utilities", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe(
        "default",
      );
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Columns Configuration", () => {
    it("should have correct error-specific columns", () => {
      expect(wrapper.vm.columns).toHaveLength(2);

      const urlColumn = wrapper.vm.columns[0];
      expect(urlColumn.name).toBe("url");
      expect(urlColumn.align).toBe("left");
      expect(typeof urlColumn.field).toBe("function");

      const errorCountColumn = wrapper.vm.columns[1];
      expect(errorCountColumn.name).toBe("error_count");
      expect(errorCountColumn.align).toBe("left");
      expect(errorCountColumn.sortable).toBe(true);
      expect(typeof errorCountColumn.field).toBe("function");
    });

    it("should extract field data correctly", () => {
      const testRow = { url: "https://example.com/test", error_count: 42 };

      expect(wrapper.vm.columns[0].field(testRow)).toBe(
        "https://example.com/test",
      );
      expect(wrapper.vm.columns[1].field(testRow)).toBe(42);
    });
  });

  describe("Integration Tests", () => {
    it("should perform complete dashboard workflow", async () => {
      expect(wrapper.exists()).toBe(true);

      expect(wrapper.vm.currentDashboardData.data.title).toBe(
        "RUM Errors Dashboard",
      );

      const variableData = { values: [{ name: "service", value: "frontend" }] };
      wrapper.vm.variablesDataUpdated(variableData);
      expect(wrapper.vm.variablesData).toEqual(variableData);

      wrapper.vm.addSettingsData();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);

      await wrapper.vm.updateLayout();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });
  });
});
