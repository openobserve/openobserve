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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SelectTabDropdown from "./SelectTabDropdown.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import { createStore } from "vuex";

installQuasar();

// Stub AddTab to expose v-model:open + refresh contract used by the
// ODialog/ODrawer-based migration of SelectTabDropdown.
// inheritAttrs:false so parent's data-test fall-through doesn't clobber our
// own data-test markers used for query selectors.
const AddTabStub = {
  name: "AddTab",
  inheritAttrs: false,
  props: ["open", "editMode", "dashboardId", "folderId"],
  emits: ["update:open", "refresh"],
  template: `
    <div
      data-test="add-tab-stub"
      :data-open="String(open)"
      :data-edit-mode="String(editMode)"
      :data-dashboard-id="dashboardId == null ? '' : String(dashboardId)"
      :data-folder-id="folderId == null ? '' : String(folderId)"
    >
      <button
        data-test="add-tab-stub-close"
        @click="$emit('update:open', false)"
      />
      <button
        data-test="add-tab-stub-refresh"
        @click="$emit('refresh', { name: 'Emitted Tab', tabId: 'emitted123' })"
      />
    </div>
  `,
};

const mountComponent = (props: Record<string, any>, store: any) =>
  mount(SelectTabDropdown, {
    props,
    global: {
      plugins: [i18n, store],
      stubs: { AddTab: AddTabStub },
    },
  });

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
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    expect(wrapper.exists()).toBe(true);
  });

  it("should render tab dropdown", () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    const dropdown = wrapper.find(
      '[data-test="dashboard-dropdown-tab-selection"]',
    );
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add tab button", () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    const addButton = wrapper.find('[data-test="dashboard-tab-new-add"]');
    expect(addButton.exists()).toBe(true);
  });

  it("should render AddTab stub with closed state and forwarded props", () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    const addTab = wrapper.find('[data-test="add-tab-stub"]');
    expect(addTab.exists()).toBe(true);
    expect(addTab.attributes("data-open")).toBe("false");
    expect(addTab.attributes("data-edit-mode")).toBe("false");
    expect(addTab.attributes("data-dashboard-id")).toBe("dash1");
    expect(addTab.attributes("data-folder-id")).toBe("folder1");
  });

  it("should open add tab dialog when add button is clicked", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    const addButton = wrapper.find('[data-test="dashboard-tab-new-add"]');
    await addButton.trigger("click");

    expect(wrapper.vm.showAddTabDialog).toBe(true);
    expect(
      wrapper.find('[data-test="add-tab-stub"]').attributes("data-open"),
    ).toBe("true");
  });

  it("should close add tab dialog when AddTab emits update:open=false", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    // open first
    await wrapper
      .find('[data-test="dashboard-tab-new-add"]')
      .trigger("click");
    expect(wrapper.vm.showAddTabDialog).toBe(true);

    // child emits update:open=false (v-model:open contract from ODialog/ODrawer)
    await wrapper
      .find('[data-test="add-tab-stub-close"]')
      .trigger("click");

    expect(wrapper.vm.showAddTabDialog).toBe(false);
    expect(
      wrapper.find('[data-test="add-tab-stub"]').attributes("data-open"),
    ).toBe("false");
  });

  it("should emit tab-selected when selectedTab changes", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    wrapper.vm.selectedTab = { label: "Test Tab", value: "testTab123" };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("tab-selected")).toBeTruthy();
  });

  it("should load tabs on mount", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    expect(wrapper.vm.tabList).toHaveLength(2);
    expect(wrapper.vm.tabList[0].label).toBe("Tab 1");
  });

  it("should select first tab automatically", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    expect(wrapper.vm.selectedTab).toEqual({
      label: "Tab 1",
      value: "tab1",
    });
  });

  it("should emit tab-list-updated after loading tabs", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    expect(wrapper.emitted("tab-list-updated")).toBeTruthy();
  });

  it("should handle null dashboardId gracefully", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: null },
      store,
    );

    await flushPromises();

    expect(wrapper.vm.tabList).toEqual([]);
  });

  it("should handle null folderId gracefully", async () => {
    const wrapper = mountComponent(
      { folderId: null, dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    expect(wrapper.vm.tabList).toEqual([]);
  });

  it("should update tab list after adding new tab", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    const newTab = { name: "New Tab", tabId: "newTab123" };
    await wrapper.vm.updateTabList(newTab);

    expect(wrapper.vm.showAddTabDialog).toBe(false);
    expect(wrapper.vm.selectedTab).toEqual({
      label: "New Tab",
      value: "newTab123",
    });
  });

  it("should close dialog and update selected tab when AddTab emits refresh", async () => {
    const wrapper = mountComponent(
      { folderId: "folder1", dashboardId: "dash1" },
      store,
    );

    await flushPromises();

    // open the dialog
    await wrapper
      .find('[data-test="dashboard-tab-new-add"]')
      .trigger("click");
    expect(wrapper.vm.showAddTabDialog).toBe(true);

    // child emits refresh with new tab payload
    await wrapper
      .find('[data-test="add-tab-stub-refresh"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.vm.showAddTabDialog).toBe(false);
    expect(wrapper.vm.selectedTab).toEqual({
      label: "Emitted Tab",
      value: "emitted123",
    });
  });
});
