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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import SinglePanelMove from "./SinglePanelMove.vue";

// Mock external dependencies
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder",
      tab: "current-tab-id",
    },
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
    },
  }),
}));

const mockAddTab = {
  name: "AddTab",
  props: ["editMode", "tabId", "dashboardId"],
  template: "<div data-test='mock-add-tab'></div>",
};

// Stub ODialog so tests are deterministic (no Portal/Reka teleport) and so we
// can assert on the props the component forwards + emit the click events
// the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
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
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
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
  ],
  emits: ["update:open", "close", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-drawer-stub"
      :data-open="String(open)"
      :data-size="size"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

describe("SinglePanelMove", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    dashboardId: "test-dashboard-id",
    tabs: [
      { tabId: "tab1", name: "Tab 1" },
      { tabId: "tab2", name: "Tab 2" },
      { tabId: "current-tab-id", name: "Current Tab" },
      { tabId: "tab3", name: "Tab 3" },
    ],
  };

  const createWrapper = (props = {}) => {
    const defaultProps = {
      title: "Move Panel",
      message: "Select a tab to move the panel to",
      modelValue: true,
    };

    return mount(SinglePanelMove, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        components: {
          AddTab: mockAddTab,
        },
        stubs: {
          ODialog: ODialogStub,
          ODrawer: ODrawerStub,
          AddTab: mockAddTab,
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDashboard } = await import("../../../utils/commons");
    vi.mocked(getDashboard).mockResolvedValue(mockDashboardData);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render the ODialog wrapper", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("SinglePanelMove");
    });

    it("should initialize with correct prop values", () => {
      const customProps = {
        title: "Custom Move Title",
        message: "Custom move message",
      };

      wrapper = createWrapper(customProps);

      expect(wrapper.props("title")).toBe("Custom Move Title");
      expect(wrapper.props("message")).toBe("Custom move message");
    });

    it("should declare the expected emits", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toEqual([
        "update:ok",
        "update:cancel",
        "refresh",
      ]);
    });
  });

  describe("ODialog Prop Forwarding", () => {
    it("forwards the title prop to ODialog", () => {
      wrapper = createWrapper({ title: "Move Panel Dialog" });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Move Panel Dialog");
    });

    it("uses size 'sm' on ODialog", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("sm");
    });

    it("forwards the open state from modelValue to ODialog", () => {
      wrapper = createWrapper({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });

    it("renders i18n label on the secondary (cancel) button", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("secondaryButtonLabel")).toBe("confirmDialog.cancel");
    });

    it("renders the literal 'Move' label on the primary (confirm) button", () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Move");
    });

    it("defaults open to false when modelValue is not provided", () => {
      wrapper = createWrapper({ modelValue: undefined });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });
  });

  describe("Dashboard Data Loading", () => {
    it("should call getDashboard on mount with correct parameters", async () => {
      const { getDashboard } = await import("../../../utils/commons");

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(vi.mocked(getDashboard)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-dashboard", // dashboard query param
        "test-folder", // folder query param
      );
    });

    it("should populate currentDashboardData after successful fetch", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentDashboardData.data).toEqual(mockDashboardData);
    });

    it("should handle empty dashboard response gracefully", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({} as any);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.moveTabOptions).toEqual([]);
      expect(wrapper.vm.selectedMoveTabId).toBeNull();
    });
  });

  describe("Message Display", () => {
    it("should render the provided message inside the dialog body", () => {
      wrapper = createWrapper({ message: "Please select target tab" });
      expect(wrapper.text()).toContain("Please select target tab");
    });

    it("should handle empty message", () => {
      wrapper = createWrapper({ message: "" });
      // Should not throw, dialog still rendered
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("should handle empty title", () => {
      wrapper = createWrapper({ title: "" });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("");
    });
  });

  describe("Tab Selection Dropdown", () => {
    it("should render tab selection dropdown", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const selectElement = wrapper.find(
        '[data-test="dashboard-tab-move-select"]',
      );
      expect(selectElement.exists()).toBe(true);
    });

    it("should populate move tab options excluding current tab", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const expectedOptions = [
        { label: "Tab 1", value: "tab1" },
        { label: "Tab 2", value: "tab2" },
        { label: "Tab 3", value: "tab3" },
      ];

      expect(wrapper.vm.moveTabOptions).toEqual(expectedOptions);
    });

    it("should set first available tab as default selection", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(wrapper.vm.selectedMoveTabId).toEqual({
        label: "Tab 1",
        value: "tab1",
      });
    });

    it("should handle empty tab options when only current tab exists", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        ...mockDashboardData,
        tabs: [{ tabId: "current-tab-id", name: "Current Tab" }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(wrapper.vm.moveTabOptions).toEqual([]);
      expect(wrapper.vm.selectedMoveTabId).toBeNull();
    });

    it("should still render the select when no tabs are available", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        ...mockDashboardData,
        tabs: [{ tabId: "current-tab-id", name: "Current Tab" }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(wrapper.vm.moveTabOptions).toHaveLength(0);

      const selectElement = wrapper.find(
        '[data-test="dashboard-tab-move-select"]',
      );
      expect(selectElement.exists()).toBe(true);
    });
  });

  describe("Add Tab Button and Drawer", () => {
    it("should render add tab button", () => {
      wrapper = createWrapper();

      const addTabBtn = wrapper.find(
        '[data-test="dashboard-tab-move-add-tab-btn"]',
      );
      expect(addTabBtn.exists()).toBe(true);
    });

    it("should show add tab drawer when add button is clicked", async () => {
      wrapper = createWrapper();

      const addTabBtn = wrapper.find(
        '[data-test="dashboard-tab-move-add-tab-btn"]',
      );
      await addTabBtn.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);
      expect(wrapper.vm.isTabEditMode).toBe(false);
    });

    it("should render the ODrawer stub which hosts the AddTab dialog", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const drawer = wrapper.find('[data-test="o-drawer-stub"]');
      expect(drawer.exists()).toBe(true);
    });

    it("should pass correct state when add tab button is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const addTabBtn = wrapper.find(
        '[data-test="dashboard-tab-move-add-tab-btn"]',
      );
      await addTabBtn.trigger("click");

      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe(
        "test-dashboard-id",
      );
    });

    it("closes the drawer when the ODrawer emits close", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent(ODrawerStub);
      await drawer.vm.$emit("close");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });
  });

  describe("Confirm Button Disabled State", () => {
    it("should mark primaryButtonDisabled true when no tab is selected", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedMoveTabId = null;
      await wrapper.vm.$nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should mark primaryButtonDisabled false when a tab is selected", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });
  });

  describe("Event Emissions", () => {
    it("should emit update:cancel when ODialog emits click:secondary", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:cancel")).toBeTruthy();
      expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    });

    it("should emit update:ok with selected tab value when ODialog emits click:primary", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("update:ok")).toBeTruthy();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")?.[0]).toEqual(["tab1"]);
    });

    it("should not emit update:ok when secondary (cancel) is clicked", async () => {
      wrapper = createWrapper();
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.emitted("update:ok")).toBeFalsy();
    });

    it("should not emit update:cancel when primary (confirm) is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      expect(wrapper.emitted("update:cancel")).toBeFalsy();
    });

    it("should emit refresh event when refreshRequired is called", async () => {
      wrapper = createWrapper();

      const newTabData = { name: "New Tab", tabId: "new-tab-id" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should emit multiple events when buttons are clicked multiple times", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialog = wrapper.findComponent(ODialogStub);

      await dialog.vm.$emit("click:secondary");
      await dialog.vm.$emit("click:primary");
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("update:cancel")).toHaveLength(2);
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
    });
  });

  describe("Refresh Functionality", () => {
    it("should update tab options after refresh", async () => {
      const { getDashboard } = await import("../../../utils/commons");

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const newDashboardData = {
        ...mockDashboardData,
        tabs: [...mockDashboardData.tabs, { tabId: "new-tab", name: "New Tab" }],
      };

      vi.mocked(getDashboard).mockResolvedValueOnce(newDashboardData);

      const newTabData = { name: "New Tab", tabId: "new-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.selectedMoveTabId).toEqual({
        label: "New Tab",
        value: "new-tab",
      });
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should close add tab drawer after refresh", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddTabDialog = true;

      const newTabData = { name: "Test Tab", tabId: "test-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });
  });

  describe("Props Validation", () => {
    it("should handle string title prop", () => {
      wrapper = createWrapper({ title: "Valid Title" });
      expect(wrapper.props("title")).toBe("Valid Title");
    });

    it("should handle string message prop", () => {
      wrapper = createWrapper({ message: "Valid Message" });
      expect(wrapper.props("message")).toBe("Valid Message");
    });

    it("should handle undefined props gracefully", () => {
      wrapper = createWrapper({ title: undefined, message: undefined });
      expect(wrapper.props("title")).toBeUndefined();
      expect(wrapper.props("message")).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle empty dashboard data", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({} as any);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should handle dashboard data without tabs", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({ dashboardId: "test" } as any);

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });
  });

  describe("Component State Management", () => {
    it("should initialize with correct default state", () => {
      wrapper = createWrapper();

      // selectedMoveTabId begins null synchronously, before async mount finishes.
      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.selectedTabIdToEdit).toBeNull();
      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should maintain reactive state for currentDashboardData", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe(
        "test-dashboard-id",
      );
    });

    it("should update selectedMoveTabId when tab options change", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const newTabData = { name: "Updated Tab", tabId: "updated-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.selectedMoveTabId.value).toBe("updated-tab");
    });
  });

  describe("Edge Cases and Integration", () => {
    it("should handle rapid add-tab-drawer toggles", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const addTabBtn = wrapper.find(
        '[data-test="dashboard-tab-move-add-tab-btn"]',
      );
      await addTabBtn.trigger("click");

      wrapper.vm.showAddTabDialog = false;
      await wrapper.vm.$nextTick();

      await addTabBtn.trigger("click");
      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });

    it("should maintain component integrity after multiple operations", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const dialog = wrapper.findComponent(ODialogStub);
      const addTabBtn = wrapper.find(
        '[data-test="dashboard-tab-move-add-tab-btn"]',
      );

      for (let i = 0; i < 5; i++) {
        await addTabBtn.trigger("click");
        await dialog.vm.$emit("click:secondary");
        if (wrapper.vm.selectedMoveTabId) {
          await dialog.vm.$emit("click:primary");
        }
      }

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("SinglePanelMove");
    });

    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});
