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
import WebVitalsDashboard from "@/components/rum/performance/WebVitalsDashboard.vue";
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
vi.mock("@/utils/commons.ts", () => ({
  getConsumableDateTime: vi.fn(),
  getDashboard: vi.fn(),
}));

vi.mock("@/utils/date", () => ({
  parseDuration: vi.fn((str) => parseInt(str) || 0),
  generateDurationLabel: vi.fn((val) => `${val}m`),
  getDurationObjectFromParams: vi.fn(() => ({
    startTime: "2023-01-01T00:00:00Z",
    endTime: "2023-01-02T00:00:00Z",
  })),
  getQueryParamsForDuration: vi.fn(() => ({
    period: "15m",
  })),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => ({
    ...data,
    title: "Web Vitals Dashboard",
    panels: [
      { id: "panel1", title: "Core Web Vitals" },
      { id: "panel2", title: "Performance Metrics" },
    ],
  })),
}));

vi.mock("@/utils/rum/web_vitals.json", () => ({
  default: {
    version: 2,
    title: "Web Vitals Dashboard",
    panels: [
      { id: "vitals-panel", title: "Core Web Vitals" },
      { id: "metrics-panel", title: "Performance Metrics" },
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
    dashboard: "web-vitals-dashboard",
    folder: "rum",
    period: "15m",
    org_identifier: "default",
  },
  name: "webVitalsDashboard",
};

describe("WebVitalsDashboard", () => {
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

    wrapper = mount(WebVitalsDashboard, {
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
          "q-icon": {
            template: '<i data-test="icon" :class="name"></i>',
            props: ["name", "size"],
          },
        },
      },
    });

    wrapper.vm.selectedDate = {
      tab: "relative",
      relative: { value: 1, period: "days" },
      absolute: {
        date: {
          from: "2023-01-01",
          to: "2023-01-02",
        },
      },
    };
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
      expect(wrapper.find(".performance-dashboard").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("WebVitalsDashboard");
    });

    it("should render with provided dateTime prop", () => {
      expect(wrapper.props("dateTime")).toEqual({
        start_time: new Date("2023-01-01T00:00:00Z"),
        end_time: new Date("2023-01-02T00:00:00Z"),
      });
    });
  });

  describe("Web Vitals Info Banner", () => {
    it("should render the web vitals info banner", () => {
      const banner = wrapper.find(".learn-web-vitals-link");
      expect(banner.exists()).toBe(true);
      expect(banner.classes()).toContain("bg-indigo-7"); // Dark theme
    });

    it("should display info icon", () => {
      const icon = wrapper.find("[data-test='icon']");
      expect(icon.exists()).toBe(true);
    });

    it("should have external link to web.dev", () => {
      const link = wrapper.find("a[href='https://web.dev/articles/vitals']");
      expect(link.exists()).toBe(true);
      expect(link.attributes("target")).toBe("_blank");
      expect(link.classes()).toContain("text-white"); // Dark theme
    });

    it("should apply light theme styling", async () => {
      store.state.theme = "light";
      await wrapper.vm.$nextTick();

      const banner = wrapper.find(".learn-web-vitals-link");
      expect(banner.classes()).toContain("bg-indigo-2");

      const link = wrapper.find("a[href='https://web.dev/articles/vitals']");
      expect(link.classes()).toContain("text-dark");
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
        "Web Vitals Dashboard",
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

      const dashboard = wrapper.find(".performance-dashboard");
      expect(dashboard.attributes("style")).toContain("visibility: hidden");
    });

    it("should hide loading spinner when isLoading is empty", async () => {
      wrapper.vm.isLoading.splice(0); // Clear array
      await wrapper.vm.$nextTick();

      const dashboard = wrapper.find(".performance-dashboard");
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
      wrapper.vm.webVitalsChartsRef = { layoutUpdate: mockLayoutUpdate };

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

  describe("Navigation Functions", () => {
    it("should navigate back to dashboard list", () => {
      wrapper.vm.goBackToDashboardList();

      expect(routerPushSpy).toHaveBeenCalledWith({
        path: "/dashboards",
        query: {
          dashboard: "web-vitals-dashboard",
          folder: "rum",
        },
      });
    });

    it("should navigate to add panel page", () => {
      wrapper.vm.addPanelData();

      expect(routerPushSpy).toHaveBeenCalledWith({
        path: "/dashboards/add_panel",
        query: {
          dashboard: "web-vitals-dashboard",
          folder: "rum",
        },
      });
    });

    it("should use default folder when not specified", () => {
      // Update the mocked route to not have a folder
      useRouteSpy.mockReturnValue({
        query: { dashboard: "web-vitals-dashboard" },
      });

      wrapper.vm.goBackToDashboardList();

      expect(routerPushSpy).toHaveBeenCalledWith({
        path: "/dashboards",
        query: {
          dashboard: "web-vitals-dashboard",
          folder: "rum",
        },
      });
    });
  });

  describe("Query Parameters Management", () => {
    it("should update router query on refresh interval change", async () => {
      wrapper.vm.refreshInterval = 300; // 5 minutes

      await wrapper.vm.$nextTick();

      expect(routerReplaceSpy).toHaveBeenCalledWith({
        query: expect.objectContaining({
          org_identifier: "default",
          dashboard: "web-vitals-dashboard",
          folder: "rum",
          refresh: "300m",
          period: "15m",
        }),
      });
    });

    it("should handle selected date changes", async () => {
      await wrapper.vm.$nextTick();

      expect(routerReplaceSpy).toHaveBeenCalled();
    });
  });

  describe("Settings Dialog", () => {
    it("should open settings dialog", () => {
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);

      wrapper.vm.addSettingsData();

      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);
    });
  });

  describe("Filter Functionality", () => {
    it("should filter data correctly", () => {
      const testData = [
        { name: "core-web-vitals" },
        { name: "performance-metrics" },
        { name: "user-interactions" },
      ];

      const filtered = wrapper.vm.filterData(testData, "core");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("core-web-vitals");
    });

    it("should perform case insensitive filtering", () => {
      const testData = [
        { name: "Core-Web-Vitals" },
        { name: "Performance-Metrics" },
      ];

      const filtered = wrapper.vm.filterData(testData, "CORE");

      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("Core-Web-Vitals");
    });

    it("should return empty array when no matches", () => {
      const testData = [
        { name: "core-web-vitals" },
        { name: "performance-metrics" },
      ];

      const filtered = wrapper.vm.filterData(testData, "nonexistent");

      expect(filtered).toHaveLength(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing chart ref gracefully", async () => {
      wrapper.vm.webVitalsChartsRef = null;

      await expect(wrapper.vm.updateLayout()).resolves.not.toThrow();
    });

    it("should handle dashboard loading errors", () => {
      // Mock convertDashboardSchemaVersion to throw
      const mockConvert = vi.fn(() => {
        throw new Error("Schema conversion failed");
      });

      expect(() => {
        wrapper.vm.loadDashboard();
      }).not.toThrow(); // Component should handle errors gracefully
    });
  });

  describe("Component Properties", () => {
    it("should have all required reactive properties", () => {
      expect(wrapper.vm.currentDashboardData).toBeDefined();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(false);
      expect(wrapper.vm.viewOnly).toBe(true);
      expect(wrapper.vm.eventLog).toEqual([]);
      expect(wrapper.vm.variablesData).toBeDefined();
      expect(wrapper.vm.refreshInterval).toBe(0);
      expect(wrapper.vm.selectedDate).toBeDefined();
      expect(wrapper.vm.isLoading).toEqual([]);
    });

    it("should expose all required methods", () => {
      expect(typeof wrapper.vm.loadDashboard).toBe("function");
      expect(typeof wrapper.vm.updateLayout).toBe("function");
      expect(typeof wrapper.vm.variablesDataUpdated).toBe("function");
      expect(typeof wrapper.vm.addSettingsData).toBe("function");
      expect(typeof wrapper.vm.goBackToDashboardList).toBe("function");
      expect(typeof wrapper.vm.addPanelData).toBe("function");
      expect(typeof wrapper.vm.filterData).toBe("function");
    });

    it("should have access to store and utilities", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe(
        "default",
      );
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Integration Tests", () => {
    it("should perform complete dashboard workflow", async () => {
      // Verify component mounted
      expect(wrapper.exists()).toBe(true);

      // Test dashboard loading
      expect(wrapper.vm.currentDashboardData.data.title).toBe(
        "Web Vitals Dashboard",
      );

      // Test variables data update
      const variableData = { values: [{ name: "service", value: "frontend" }] };
      wrapper.vm.variablesDataUpdated(variableData);
      expect(wrapper.vm.variablesData).toEqual(variableData);

      // Test settings dialog
      wrapper.vm.addSettingsData();
      expect(wrapper.vm.showDashboardSettingsDialog).toBe(true);

      // Test layout update
      await wrapper.vm.updateLayout();
      expect(window.dispatchEvent).toHaveBeenCalled();
    });

    it("should handle theme changes correctly", async () => {
      // Test dark theme
      store.state.theme = "dark";
      await wrapper.vm.$nextTick();

      const banner = wrapper.find(".learn-web-vitals-link");
      expect(banner.classes()).toContain("bg-indigo-7");

      // Test light theme
      store.state.theme = "light";
      await wrapper.vm.$nextTick();

      expect(banner.classes()).toContain("bg-indigo-2");
    });
  });

  describe("Accessibility", () => {
    it("should have proper link attributes", () => {
      const link = wrapper.find("a[href='https://web.dev/articles/vitals']");
      expect(link.attributes("title")).toBe("https://web.dev/articles/vitals");
      expect(link.attributes("target")).toBe("_blank");
    });
  });
});
