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
import SelectDashboardDropdown from "./SelectDashboardDropdown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";

installQuasar();

// Mock the utils functions
vi.mock("@/utils/commons", () => ({
  getAllDashboardsByFolderId: vi.fn().mockResolvedValue([
    { title: "Dashboard 1", dashboardId: "dash1" },
    { title: "Dashboard 2", dashboardId: "dash2" },
  ]),
  getDashboard: vi.fn().mockResolvedValue({
    title: "Dashboard 1",
    dashboardId: "dash1",
  }),
}));

describe("SelectDashboardDropdown", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
        organizationData: {
          folders: [],
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render dashboard dropdown", () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const dropdown = wrapper.find('[data-test="dashboard-dropdown-dashboard-selection"]');
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add button", () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-dashboard-new-add"]');
    expect(addButton.exists()).toBe(true);
  });

  it("should open add dashboard dialog when add button is clicked", async () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-dashboard-new-add"]');
    await addButton.trigger("click");

    expect(wrapper.vm.showAddDashboardDialog).toBe(true);
  });

  it("should emit dashboard-selected when selectedDashboard changes", async () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    wrapper.vm.selectedDashboard = { label: "Test Dashboard", value: "test123" };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("dashboard-selected")).toBeTruthy();
  });

  it("should load dashboards on mount", async () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.dashboardList).toHaveLength(2);
    expect(wrapper.vm.dashboardList[0].label).toBe("Dashboard 1");
  });

  it("should select first dashboard automatically", async () => {
    const wrapper = mount(SelectDashboardDropdown, {
      props: {
        folderId: "folder1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.selectedDashboard).toEqual({
      label: "Dashboard 1",
      value: "dash1",
    });
  });
});
