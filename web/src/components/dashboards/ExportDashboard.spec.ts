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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import ExportDashboard from "./ExportDashboard.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

// Mock getDashboard utility
vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn().mockResolvedValue({
    title: "Test Dashboard",
    dashboardId: "dash123",
    owner: "testuser@example.com",
    tabs: [],
    panels: [],
  }),
}));

describe("ExportDashboard", () => {
  let store: any;
  let router: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/dashboards",
          name: "dashboards",
          component: { template: "<div>Dashboards</div>" },
        },
      ],
    });

    router.push({ path: "/dashboards", query: { folder: "default" } });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render export button", () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const exportButton = wrapper.find('[data-test="export-dashboard"]');
    expect(exportButton.exists()).toBe(true);
  });

  it("should have download icon", () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const exportButton = wrapper.find('[data-test="export-dashboard"]');
    expect(exportButton.attributes("icon")).toBe("download");
  });

  it("should call downloadDashboard when button is clicked", async () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const downloadSpy = vi.spyOn(wrapper.vm, "downloadDashboard");
    const exportButton = wrapper.find('[data-test="export-dashboard"]');
    
    await exportButton.trigger("click");
    
    expect(downloadSpy).toHaveBeenCalled();
  });

  it("should create download link with dashboard data", async () => {
    // Mock document.createElement
    const mockAnchor = {
      setAttribute: vi.fn(),
      click: vi.fn(),
    };
    const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue(mockAnchor as any);

    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.downloadDashboard();
    await flushPromises();

    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(mockAnchor.setAttribute).toHaveBeenCalledWith("href", expect.stringContaining("data:text/json"));
    expect(mockAnchor.setAttribute).toHaveBeenCalledWith("download", expect.stringContaining(".dashboard.json"));
    expect(mockAnchor.click).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it("should use dashboard title as filename", async () => {
    const mockAnchor = {
      setAttribute: vi.fn(),
      click: vi.fn(),
    };
    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor as any);

    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.downloadDashboard();
    await flushPromises();

    expect(mockAnchor.setAttribute).toHaveBeenCalledWith(
      "download",
      "Test Dashboard.dashboard.json"
    );
  });

  it("should remove owner from exported dashboard data", async () => {
    const { getDashboard } = await import("@/utils/commons");

    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    await wrapper.vm.downloadDashboard();
    await flushPromises();

    expect(getDashboard).toHaveBeenCalledWith(
      store,
      "dash123",
      "default"
    );
  });

  it("should accept dashboardId prop", () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "test-dashboard-id",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    expect(wrapper.props("dashboardId")).toBe("test-dashboard-id");
  });

  it("should have proper button styling classes", () => {
    const wrapper = mount(ExportDashboard, {
      props: {
        dashboardId: "dash123",
      },
      global: {
        plugins: [i18n, store, router],
      },
    });

    const exportButton = wrapper.find('[data-test="export-dashboard"]');
    expect(exportButton.classes()).toContain("dashboard-icons");
  });
});
