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

// Stub ODrawer so tests are deterministic (no Portal/Reka teleport) and so we
// can assert on the props the component forwards + emit the click events
// the component listens to.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-drawer-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-drawer-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Stub AddDashboard so we can spy on the imperatively-called submit() method
// from setup, without actually rendering its internals.
const AddDashboardStub = {
  name: "AddDashboard",
  props: ["activeFolderId", "showFolderSelection"],
  emits: ["updated"],
  template: `<div data-test="add-dashboard-stub"></div>`,
  methods: {
    submit: vi.fn(),
  },
};

const mountComponent = (props: any = {}, store: any) =>
  mount(SelectDashboardDropdown, {
    props: {
      folderId: "folder1",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        ODrawer: ODrawerStub,
        AddDashboard: AddDashboardStub,
      },
    },
  });

describe("SelectDashboardDropdown", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "org123",
        },
        organizationData: {
          folders: [
            {
              folderId: "folder1",
              name: "Test Folder",
            },
            {
              folderId: "default",
              name: "Default Folder",
            },
          ],
        },
      },
    });

    vi.clearAllMocks();
  });

  it("should render the component", () => {
    const wrapper = mountComponent({}, store);
    expect(wrapper.exists()).toBe(true);
  });

  it("should render dashboard dropdown", () => {
    const wrapper = mountComponent({}, store);
    const dropdown = wrapper.find(
      '[data-test="dashboard-dropdown-dashboard-selection"]',
    );
    expect(dropdown.exists()).toBe(true);
  });

  it("should render add button", () => {
    const wrapper = mountComponent({}, store);
    const addButton = wrapper.find(
      '[data-test="dashboard-dashboard-new-add"]',
    );
    expect(addButton.exists()).toBe(true);
  });

  it("should open add dashboard dialog when add button is clicked", async () => {
    const wrapper = mountComponent({}, store);

    const addButton = wrapper.find(
      '[data-test="dashboard-dashboard-new-add"]',
    );
    await addButton.trigger("click");

    expect(wrapper.vm.showAddDashboardDialog).toBe(true);
  });

  it("should emit dashboard-selected when selectedDashboard changes", async () => {
    const wrapper = mountComponent({}, store);
    await flushPromises();

    wrapper.vm.selectedDashboard = {
      label: "Test Dashboard",
      value: "test123",
    };
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("dashboard-selected")).toBeTruthy();
  });

  it("should load dashboards on mount", async () => {
    const wrapper = mountComponent({}, store);
    await flushPromises();

    expect(wrapper.vm.dashboardList).toHaveLength(2);
    expect(wrapper.vm.dashboardList[0].label).toBe("Dashboard 1");
  });

  it("should select first dashboard automatically", async () => {
    const wrapper = mountComponent({}, store);
    await flushPromises();

    expect(wrapper.vm.selectedDashboard).toEqual({
      label: "Dashboard 1",
      value: "dash1",
    });
  });

  describe("ODrawer migration", () => {
    it("should render ODrawer in place of q-dialog", () => {
      const wrapper = mountComponent({}, store);
      expect(wrapper.findComponent(ODrawerStub).exists()).toBe(true);
    });

    it("should keep ODrawer closed by default", () => {
      const wrapper = mountComponent({}, store);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(false);
    });

    it("should forward open=true to ODrawer once add button is clicked", async () => {
      const wrapper = mountComponent({}, store);

      const addButton = wrapper.find(
        '[data-test="dashboard-dashboard-new-add"]',
      );
      await addButton.trigger("click");
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("open")).toBe(true);
    });

    it("should use width 20 on ODrawer", () => {
      const wrapper = mountComponent({}, store);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("width")).toBe(20);
    });

    it("should pass 'New dashboard' title to ODrawer", () => {
      const wrapper = mountComponent({}, store);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("title")).toBe("New dashboard");
    });

    it("should render i18n label on secondary (cancel) button", () => {
      const wrapper = mountComponent({}, store);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("should render i18n label on primary (save) button", () => {
      const wrapper = mountComponent({}, store);
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
    });

    it("should keep data-test hook on the drawer", () => {
      const wrapper = mountComponent({}, store);
      // data-test is passed through as an attribute on ODrawer
      const drawer = wrapper.findComponent(ODrawerStub);
      expect(drawer.attributes("data-test")).toBe(
        "dashboard-dashboard-add-dialog",
      );
    });
  });

  describe("ODrawer event handling", () => {
    it("should close drawer when ODrawer emits click:secondary", async () => {
      const wrapper = mountComponent({}, store);
      wrapper.vm.showAddDashboardDialog = true;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:secondary");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);
    });

    it("should forward update:open into showAddDashboardDialog", async () => {
      const wrapper = mountComponent({}, store);
      wrapper.vm.showAddDashboardDialog = true;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);
    });

    it("should call addDashboardRef.submit() when ODrawer emits click:primary", async () => {
      const wrapper = mountComponent({}, store);
      wrapper.vm.showAddDashboardDialog = true;
      await wrapper.vm.$nextTick();

      const submitSpy = vi.fn();
      wrapper.vm.addDashboardRef = { submit: submitSpy };

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("click:primary");

      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it("should not throw when click:primary is emitted with no addDashboardRef", async () => {
      const wrapper = mountComponent({}, store);
      wrapper.vm.showAddDashboardDialog = true;
      wrapper.vm.addDashboardRef = null;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
    });
  });

  describe("updateDashboardList", () => {
    it("should close drawer and select the just-created dashboard", async () => {
      const wrapper = mountComponent({}, store);
      await flushPromises();

      wrapper.vm.showAddDashboardDialog = true;
      await wrapper.vm.$nextTick();

      await wrapper.vm.updateDashboardList("dash1", "folder1");
      await flushPromises();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);
      expect(wrapper.vm.selectedDashboard).toEqual({
        label: "Dashboard 1",
        value: "dash1",
      });
    });

    it("should emit dashboard-list-updated after refresh", async () => {
      const wrapper = mountComponent({}, store);
      await flushPromises();

      await wrapper.vm.updateDashboardList("dash1", "folder1");
      await flushPromises();

      expect(wrapper.emitted("dashboard-list-updated")).toBeTruthy();
    });
  });

  describe("edge cases", () => {
    it("should set selectedDashboard to null when folder has no dashboards", async () => {
      const commons = await import("@/utils/commons");
      (commons.getAllDashboardsByFolderId as any).mockResolvedValueOnce([]);

      const wrapper = mountComponent({}, store);
      await flushPromises();

      expect(wrapper.vm.dashboardList).toEqual([]);
      expect(wrapper.vm.selectedDashboard).toBeNull();
    });

    it("should not load dashboards when folderId is null", async () => {
      const commons = await import("@/utils/commons");
      (commons.getAllDashboardsByFolderId as any).mockClear();

      const wrapper = mountComponent({ folderId: null }, store);
      await flushPromises();

      expect(commons.getAllDashboardsByFolderId).not.toHaveBeenCalled();
      expect(wrapper.vm.dashboardList).toEqual([]);
    });

    it("should reload dashboards when folderId prop changes", async () => {
      const commons = await import("@/utils/commons");
      const wrapper = mountComponent({}, store);
      await flushPromises();

      (commons.getAllDashboardsByFolderId as any).mockClear();
      await wrapper.setProps({ folderId: "default" });
      await flushPromises();

      expect(commons.getAllDashboardsByFolderId).toHaveBeenCalledWith(
        expect.anything(),
        "default",
      );
    });
  });
});
