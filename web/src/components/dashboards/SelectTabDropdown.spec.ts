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
import SelectTabDropdown from "./SelectTabDropdown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";

installQuasar();

// Mock the utils functions
vi.mock("@/utils/commons", () => ({
  getDashboard: vi.fn().mockResolvedValue({
    title: "Test Dashboard",
    dashboardId: "dash1",
    tabs: [
      { name: "Tab 1", tabId: "tab1" },
      { name: "Tab 2", tabId: "tab2" },
    ],
  }),
}));

describe("SelectTabDropdown", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("should render tab dropdown", () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const dropdown = wrapper.find('[data-test="dashboard-dropdown-tab-selection"]');
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add tab button", () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-tab-new-add"]');
    expect(addButton.exists()).toBe(true);
  });

  it("should open add tab dialog when add button is clicked", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    const addButton = wrapper.find('[data-test="dashboard-tab-new-add"]');
    await addButton.trigger("click");

    expect(wrapper.vm.showAddTabDialog).toBe(true);
  });

  it("should emit tab-selected when selectedTab changes", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    wrapper.vm.selectedTab = { label: "Test Tab", value: "testTab123" };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("tab-selected")).toBeTruthy();
  });

  it("should load tabs on mount", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.tabList).toHaveLength(2);
    expect(wrapper.vm.tabList[0].label).toBe("Tab 1");
  });

  it("should select first tab automatically", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.selectedTab).toEqual({
      label: "Tab 1",
      value: "tab1",
    });
  });

  it("should emit tab-list-updated after loading tabs", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.emitted("tab-list-updated")).toBeTruthy();
  });

  it("should handle null dashboardId gracefully", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: null,
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.tabList).toEqual([]);
  });

  it("should handle null folderId gracefully", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: null,
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    expect(wrapper.vm.tabList).toEqual([]);
  });

  it("should update tab list after adding new tab", async () => {
    const wrapper = mount(SelectTabDropdown, {
      props: {
        folderId: "folder1",
        dashboardId: "dash1",
      },
      global: {
        plugins: [i18n, store],
      },
    });

    await flushPromises();

    const newTab = { name: "New Tab", tabId: "newTab123" };
    await wrapper.vm.updateTabList(newTab);

    expect(wrapper.vm.showAddTabDialog).toBe(false);
    expect(wrapper.vm.selectedTab).toEqual({
      label: "New Tab",
      value: "newTab123",
    });
  });
});
