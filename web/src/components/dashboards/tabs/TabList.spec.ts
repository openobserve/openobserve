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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import TabList from "./TabList.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: {},
  name: "dashboards",
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
}));

// Mock AddTab component (now uses v-model:open with ODrawer internally)
vi.mock("./AddTab.vue", () => ({
  default: {
    name: "AddTab",
    template: '<div v-if="open" data-test="add-tab-component">AddTab Component</div>',
    props: ["dashboardId", "open"],
    emits: ["refresh", "update:open"],
  },
}));

// Inline rename + reorder pull in i18n, the store, notifications and the tab
// persistence helpers — mock them so the component mounts in isolation (mirrors
// AddTab.spec).
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const mockStore = {
  state: { selectedOrganization: { identifier: "test-org" } },
};
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

const mockShowPositiveNotification = vi.fn();
const mockShowErrorNotification = vi.fn();
const mockShowConflictErrorNotification = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: mockShowPositiveNotification,
    showErrorNotification: mockShowErrorNotification,
    showConfictErrorNotificationWithRefreshBtn: mockShowConflictErrorNotification,
  }),
}));

const mockEditTab = vi.fn();
const mockUpdateDashboard = vi.fn();
vi.mock("@/utils/commons", () => ({
  editTab: (...args: any[]) => mockEditTab(...args),
  updateDashboard: (...args: any[]) => mockUpdateDashboard(...args),
}));

describe("TabList", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    dashboardId: "test-dashboard-id",
    name: "Test Dashboard",
    tabs: [
      {
        tabId: "tab1",
        name: "First Tab",
        panels: [],
      },
      {
        tabId: "tab2",
        name: "Second Tab",
        panels: [],
      },
      {
        tabId: "tab3",
        name: "Very Long Tab Name That Should Be Truncated",
        panels: [],
      },
    ],
  };

  const createWrapper = (props = {}, options: any = {}) => {
    const selectedTabIdRef = { value: "tab1" };

    // Clone so reorder's in-place mutation of the tab array doesn't leak
    // between tests.
    return mount(TabList, {
      props: {
        dashboardData: JSON.parse(JSON.stringify(mockDashboardData)),
        ...props,
      },
      global: {
        plugins: [],
        provide: {
          selectedTabId: selectedTabIdRef,
        },
        stubs: {
          OIcon: {
            template: "<span data-test='OIcon'></span>",
          },
        },
        ...options,
      },
    });
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-list"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe("TabList");
    });

    it("should accept dashboardData prop", () => {
      wrapper = createWrapper();

      expect(wrapper.props("dashboardData")).toEqual(mockDashboardData);
    });

    it("should accept viewOnly prop with default false", () => {
      wrapper = createWrapper();

      expect(wrapper.props("viewOnly")).toBe(false);
    });

    it("should handle viewOnly prop when true", () => {
      wrapper = createWrapper({ viewOnly: true });

      expect(wrapper.props("viewOnly")).toBe(true);
    });
  });

  describe("Tabs Rendering", () => {
    it("should render all tabs from dashboardData", () => {
      wrapper = createWrapper();

      // Test that all specific tabs exist
      expect(wrapper.find('[data-test="dashboard-tab-tab1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab2"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab3"]').exists()).toBe(true);

      // Test that tabs contain the expected content
      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').text()).toBe("First Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab2-name"]').text()).toBe("Second Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab3-name"]').text()).toContain(
        "Very Long Tab",
      );
    });

    it("shows a panel-count badge per tab, excluding section headers", () => {
      const dashboard = {
        ...mockDashboardData,
        tabs: [
          {
            tabId: "tab1",
            name: "First Tab",
            // Two real panels + one section header → count should be 2.
            panels: [{ id: "p1" }, { o2SectionHeader: true, id: "h1" }, { id: "p2" }],
          },
        ],
      };
      wrapper = createWrapper({ dashboardData: dashboard });

      const badge = wrapper.find('[data-test="dashboard-tab-tab1-panel-count"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("2");
    });

    it("shows 0 on a tab with no panels", () => {
      wrapper = createWrapper();
      const badge = wrapper.find('[data-test="dashboard-tab-tab1-panel-count"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("0");
    });

    it("should display tab names correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').text()).toBe("First Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab2-name"]').text()).toBe("Second Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab3-name"]').text()).toBe(
        "Very Long Tab Name That Should Be Truncated",
      );
    });

    it("should handle empty tabs array", () => {
      const emptyDashboard = {
        ...mockDashboardData,
        tabs: [],
      };

      wrapper = createWrapper({ dashboardData: emptyDashboard });

      const tabs = wrapper.findAll('[data-test^="dashboard-tab-tab"]');
      expect(tabs.length).toBe(0);
    });

    it("should handle missing tabs property", () => {
      const dashboardWithoutTabs = {
        dashboardId: "test",
        name: "Test",
      };

      wrapper = createWrapper({ dashboardData: dashboardWithoutTabs });

      const tabs = wrapper.findAll('[data-test^="dashboard-tab-tab"]');
      expect(tabs.length).toBe(0);
    });

    it("should apply correct title attribute for tab names", () => {
      wrapper = createWrapper();

      const firstTab = wrapper.find('[data-test="dashboard-tab-tab1-name"]');
      expect(firstTab.attributes("title")).toBe("First Tab");
    });
  });

  describe("Tab Interaction", () => {
    it("should have correct tabs configuration", () => {
      wrapper = createWrapper();

      const oTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      expect(oTabs.exists()).toBe(true);
    });

    it("should handle tab click events", async () => {
      wrapper = createWrapper();

      const secondTab = wrapper.find('[data-test="dashboard-tab-tab2"]');
      await secondTab.trigger("click");

      expect(secondTab.exists()).toBe(true);
    });

    it("should display tab content with proper styling", () => {
      wrapper = createWrapper();

      const tabNames = wrapper.findAll('[data-test$="-name"]');
      expect(tabNames.length).toBeGreaterThan(0);
      tabNames.forEach((tabName) => {
        // The inline truncation style is now a set of utilities.
        const classes = tabName.classes();
        expect(classes).toContain("whitespace-nowrap");
        expect(classes).toContain("overflow-hidden");
        expect(classes).toContain("text-ellipsis");
        // flex-1 (was w-full) so the name shares the row with the panel-count badge.
        expect(classes).toContain("flex-1");
      });
    });
  });

  describe("Add Tab Button", () => {
    it("should show add button when not in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: false });

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);
    });

    it("should hide add button when in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: true });

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(false);
    });

    it("should have add icon and tooltip", () => {
      wrapper = createWrapper({ viewOnly: false });

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);

      // Migrated to OTooltip with :content prop; verify prop instead of DOM.
      // t() is mocked as identity, so the prop carries the i18n key.
      const tooltip = wrapper.findComponent({ name: "OTooltip" });
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.props("content")).toBe("dashboard.newTab");
    });

    it("should open add tab dialog when clicked", async () => {
      wrapper = createWrapper({ viewOnly: false });

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });

    it("should show add button without requiring hover", () => {
      wrapper = createWrapper({ viewOnly: false });

      // The + is a persistent affordance (spreadsheet-style tab bars).
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.isVisible()).toBe(true);
    });
  });

  describe("Rename Pencil", () => {
    it("should render a hover-revealed pencil on every tab when editable", () => {
      wrapper = createWrapper({ viewOnly: false });

      for (const id of ["tab1", "tab2", "tab3"]) {
        const pencil = wrapper.find(`[data-test="dashboard-tab-${id}-rename-btn"]`);
        expect(pencil.exists()).toBe(true);
        // Hidden at rest; revealed by tab hover (group/otab), never layout.
        expect(pencil.classes()).toContain("opacity-0");
        expect(pencil.classes()).toContain("group-hover/otab:opacity-60");
      }
    });

    it("should keep the pencil out of flow so revealing it cannot resize the tab", () => {
      wrapper = createWrapper({ viewOnly: false });

      const pencil = wrapper.find('[data-test="dashboard-tab-tab1-rename-btn"]');
      expect(pencil.classes()).toContain("absolute");
    });

    it("should swap the pencil for a confirm tick while its tab is being edited", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-tab-tab1-rename-btn"]').exists()).toBe(false);
      const tick = wrapper.find('[data-test="dashboard-tab-tab1-rename-confirm-btn"]');
      expect(tick.exists()).toBe(true);
      // Same absolute slot as the pencil — out of flow, so no width change.
      expect(tick.classes()).toContain("absolute");
      // Other tabs don't get a tick, only the one being edited.
      expect(wrapper.find('[data-test="dashboard-tab-tab2-rename-confirm-btn"]').exists()).toBe(
        false,
      );
    });

    it("should commit the rename when the confirm tick is clicked", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();
      wrapper.vm.editingName = "Ticked Name";
      await wrapper.find('[data-test="dashboard-tab-tab1-rename-confirm-btn"]').trigger("click");
      await flushPromises();

      expect(mockEditTab).toHaveBeenCalledWith(mockStore, "test-dashboard-id", "default", "tab1", {
        name: "Ticked Name",
      });
      expect(wrapper.vm.editingTabId).toBe(null);
    });

    it("should not show any pencil in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: true });

      expect(wrapper.find('[data-test="dashboard-tab-tab1-rename-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="dashboard-tab-tab2-rename-btn"]').exists()).toBe(false);
    });
  });

  describe("AddTab Dialog", () => {
    it("should render AddTab component with open=false initially", () => {
      wrapper = createWrapper({ viewOnly: false });

      const addTab = wrapper.findComponent({ name: "AddTab" });
      expect(addTab.exists()).toBe(true);
      expect(addTab.props("open")).toBe(false);
    });

    it("should pass open=true to AddTab when dialog is shown", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      const addTab = wrapper.findComponent({ name: "AddTab" });
      expect(addTab.props("open")).toBe(true);

      const addTabContent = wrapper.find('[data-test="add-tab-component"]');
      expect(addTabContent.exists()).toBe(true);
    });

    it("should pass dashboardId to AddTab", () => {
      wrapper = createWrapper({ viewOnly: false });

      const addTab = wrapper.findComponent({ name: "AddTab" });
      expect(addTab.props("dashboardId")).toBe(mockDashboardData.dashboardId);
    });

    it("should handle refresh event from AddTab component", async () => {
      wrapper = createWrapper({ viewOnly: false });

      // Test the refreshDashboard method directly
      wrapper.vm.refreshDashboard();

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should close dialog after refresh", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.refreshDashboard();

      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("should open dialog when add button is clicked", async () => {
      wrapper = createWrapper({ viewOnly: false });

      // Simulate hover to show the add button
      const container = wrapper.find('[data-test="dashboard-tab-list-container"]');
      await container.trigger("mouseover");

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);

      await wrapper.vm.$nextTick();
      const addTab = wrapper.findComponent({ name: "AddTab" });
      expect(addTab.props("open")).toBe(true);
    });

    it("should react to AddTab update:open event", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      const addTab = wrapper.findComponent({ name: "AddTab" });
      await addTab.vm.$emit("update:open", false);

      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should trigger refreshDashboard via AddTab refresh event", async () => {
      wrapper = createWrapper({ viewOnly: false });

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      const addTab = wrapper.findComponent({ name: "AddTab" });
      await addTab.vm.$emit("refresh");

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });
  });

  describe("Computed Properties", () => {
    it("should compute tabs from dashboardData", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.tabs).toEqual(mockDashboardData.tabs);
    });

    it("should return empty array when dashboardData has no tabs", () => {
      const dashboardWithoutTabs = {
        dashboardId: "test",
        name: "Test",
      };

      wrapper = createWrapper({ dashboardData: dashboardWithoutTabs });

      expect(wrapper.vm.tabs).toEqual([]);
    });

    it("should handle null dashboardData", () => {
      wrapper = createWrapper({ dashboardData: null });

      expect(wrapper.vm.tabs).toEqual([]);
    });
  });

  describe("Dependency Injection", () => {
    it("should inject selectedTabId with default value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.selectedTabId).toBeDefined();
    });

    it("should use custom selectedTabId when provided", () => {
      const customSelectedTabIdRef = { value: "tab2" };

      wrapper = mount(TabList, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [],
          provide: {
            selectedTabId: customSelectedTabIdRef,
          },
          stubs: {
            OIcon: {
              template: "<span data-test='OIcon'></span>",
            },
          },
        },
      });

      expect(wrapper.vm.selectedTabId.value).toBe("tab2");
    });
  });

  describe("Props Validation", () => {
    it("should require dashboardData prop", () => {
      const component = TabList as any;
      expect(component.props.dashboardData.required).toBe(true);
      expect(component.props.dashboardData.type).toBe(Object);
    });

    it("should have correct viewOnly prop configuration", () => {
      const component = TabList as any;
      expect(component.props.viewOnly.type).toBe(Boolean);
      expect(component.props.viewOnly.default).toBe(false);
    });
  });

  describe("Event Emissions", () => {
    it("should emit refresh event", async () => {
      wrapper = createWrapper();

      wrapper.vm.refreshDashboard();

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should have correct emits configuration", () => {
      const component = TabList as any;
      expect(component.emits).toContain("refresh");
    });
  });

  describe("Router Integration", () => {
    it("should access route object", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.route).toEqual(mockRoute);
      expect(wrapper.vm.route.params.dashboard).toBe("test-dashboard");
    });
  });

  describe("Component State", () => {
    it("should initialize showAddTabDialog as false", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should maintain reactive state", async () => {
      wrapper = createWrapper({ viewOnly: false });

      expect(wrapper.vm.showAddTabDialog).toBe(false);

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });
  });

  describe("Component Styling", () => {
    it("should have correct container styling", () => {
      wrapper = createWrapper();

      const container = wrapper.find('[data-test="dashboard-tab-list-container"]');
      // Was inline `display: flex`; now the `flex` utility.
      expect(container.classes()).toContain("flex");
      expect(container.classes()).toContain("items-center");
    });

    it("should apply correct styling to tabs", () => {
      wrapper = createWrapper();

      const oTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      // Was inline `max-width: calc(100% - 40px)`; the 40px is now 2.5rem.
      expect(oTabs.classes()).toContain("max-w-[calc(100%_-_2.5rem)]");
    });
  });

  describe("Error Handling", () => {
    it("should handle undefined tab properties gracefully", () => {
      const dashboardWithUndefinedTabs = {
        dashboardId: "test",
        name: "Test",
        tabs: [
          { tabId: "tab1", name: "Tab 1" }, // valid tab
          { tabId: "tab2", name: "Tab 2" }, // valid tab
        ],
      };

      expect(() => {
        wrapper = createWrapper({ dashboardData: dashboardWithUndefinedTabs });
      }).not.toThrow();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes for testing", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-tab-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').exists()).toBe(true);
    });

    it("should have accessible add button when not in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: false });

      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);
      const tooltip = wrapper.findComponent({ name: "OTooltip" });
      // t() is mocked as identity, so the prop carries the i18n key.
      expect(tooltip.props("content")).toBe("dashboard.newTab");
    });

    it("should prevent click propagation on tabs", () => {
      wrapper = createWrapper();

      const oTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      const tabElement = wrapper.find('[data-test="dashboard-tab-tab1"]');

      // These should have @click.stop handlers
      expect(oTabs.exists()).toBe(true);
      expect(tabElement.exists()).toBe(true);
    });
  });

  describe("Reorder", () => {
    it("should enable reorderable OTabs only when not viewOnly", () => {
      wrapper = createWrapper({ viewOnly: false });
      expect(wrapper.findComponent({ name: "OTabs" }).props("reorderable")).toBe(true);

      wrapper.unmount();
      wrapper = createWrapper({ viewOnly: true });
      expect(wrapper.findComponent({ name: "OTabs" }).props("reorderable")).toBe(false);
    });

    it("should move a tab before the drop target and persist the new order", async () => {
      wrapper = createWrapper();

      // Drop tab3 before tab1 → [tab3, tab1, tab2]
      await wrapper.vm.onReorder({ from: "tab3", to: "tab1", before: true });

      expect(wrapper.vm.tabs.map((tab: any) => tab.tabId)).toEqual(["tab3", "tab1", "tab2"]);
      // Persisted via the same updateDashboard path the settings screen uses.
      expect(mockUpdateDashboard).toHaveBeenCalledTimes(1);
      const [, org, dashboardId, dashboard, folder] = mockUpdateDashboard.mock.calls[0];
      expect(org).toBe("test-org");
      expect(dashboardId).toBe("test-dashboard-id");
      expect(folder).toBe("default");
      expect(dashboard.tabs.map((tab: any) => tab.tabId)).toEqual(["tab3", "tab1", "tab2"]);
    });

    it("should move a tab after the drop target", async () => {
      wrapper = createWrapper();

      // Drop tab1 after tab2 → [tab2, tab1, tab3]
      await wrapper.vm.onReorder({ from: "tab1", to: "tab2", before: false });

      expect(wrapper.vm.tabs.map((tab: any) => tab.tabId)).toEqual(["tab2", "tab1", "tab3"]);
    });

    it("should snap back and emit refresh when persistence fails", async () => {
      mockUpdateDashboard.mockRejectedValueOnce(new Error("boom"));
      wrapper = createWrapper();

      await wrapper.vm.onReorder({ from: "tab3", to: "tab1", before: true });
      await flushPromises();

      expect(mockShowErrorNotification).toHaveBeenCalled();
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("should ignore a reorder referencing an unknown tab id", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onReorder({ from: "ghost", to: "tab1", before: true });

      expect(mockUpdateDashboard).not.toHaveBeenCalled();
      expect(wrapper.vm.tabs.map((tab: any) => tab.tabId)).toEqual(["tab1", "tab2", "tab3"]);
    });
  });

  describe("Inline rename", () => {
    it("should show a rename input for the tab being edited", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab2", name: "Second Tab" });
      await flushPromises();

      const input = wrapper.find('[data-test="dashboard-tab-tab2-rename-input"]');
      expect(input.exists()).toBe(true);
      expect((input.element as HTMLInputElement).value).toBe("Second Tab");
      expect(wrapper.vm.editingTabId).toBe("tab2");
    });

    // A 0 min track (`minmax(0,max-content)`) lets the editing tab shrink to 0px
    // once the strip overflows, hiding the input. jsdom has no layout engine, so
    // assert the declaration rather than the width.
    it("should size the rename field with a max-content track that cannot collapse", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab2", name: "Second Tab" });
      await flushPromises();

      const grid = wrapper.find('[data-test="dashboard-tab-tab2-rename-input"]').element
        .parentElement as HTMLElement;
      expect(grid.className).toContain("grid-cols-[max-content]");
      expect(grid.className).not.toContain("minmax(0");
    });

    it("should persist a changed name via editTab and emit refresh", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();
      wrapper.vm.editingName = "Renamed Tab";
      await wrapper.vm.commitRename({ tabId: "tab1", name: "First Tab" });

      expect(mockEditTab).toHaveBeenCalledWith(mockStore, "test-dashboard-id", "default", "tab1", {
        name: "Renamed Tab",
      });
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.vm.editingTabId).toBe(null);
    });

    it("should not call editTab when the name is unchanged", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();
      await wrapper.vm.commitRename({ tabId: "tab1", name: "First Tab" });

      expect(mockEditTab).not.toHaveBeenCalled();
      expect(wrapper.vm.editingTabId).toBe(null);
    });

    it("should not call editTab when the name is emptied", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();
      wrapper.vm.editingName = "   ";
      await wrapper.vm.commitRename({ tabId: "tab1", name: "First Tab" });

      expect(mockEditTab).not.toHaveBeenCalled();
      expect(wrapper.vm.editingTabId).toBe(null);
    });

    it("should revert on cancel without persisting", async () => {
      wrapper = createWrapper();

      wrapper.vm.startRename({ tabId: "tab1", name: "First Tab" });
      await flushPromises();
      wrapper.vm.editingName = "Half typed";
      wrapper.vm.cancelRename();

      expect(mockEditTab).not.toHaveBeenCalled();
      expect(wrapper.vm.editingTabId).toBe(null);
      expect(wrapper.vm.editingName).toBe("");
    });
  });
});
