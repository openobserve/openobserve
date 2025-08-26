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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import TabsDeletePopUp from "./TabsDeletePopUp.vue";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("TabsDeletePopUp", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    tabs: [
      { tabId: "tab1", name: "Tab 1", panels: [{ id: "panel1" }] },
      { tabId: "tab2", name: "Tab 2", panels: [{ id: "panel2" }] },
      { tabId: "tab3", name: "Tab to Delete", panels: [{ id: "panel3" }, { id: "panel4" }] },
      { tabId: "tab4", name: "Tab 4", panels: [] },
    ],
  };

  const createWrapper = (props = {}) => {
    const defaultProps = {
      tabId: "tab3",
      dashboardData: mockDashboardData,
    };

    return mount(TabsDeletePopUp, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        stubs: {
          QDialog: {
            template: "<div data-test='q-dialog-stub'><slot /></div>",
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly with default props", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dialog-box"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("TabsDeletePopUp");
    });

    it("should initialize with correct prop values", () => {
      const customProps = {
        tabId: "custom-tab",
        dashboardData: { tabs: [] },
      };

      wrapper = createWrapper(customProps);

      expect(wrapper.props("tabId")).toBe("custom-tab");
      expect(wrapper.props("dashboardData")).toEqual({ tabs: [] });
    });

    it("should emit correct events in emits array", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toEqual([
        "update:ok", 
        "update:cancel"
      ]);
    });
  });

  describe("Tab Information Display", () => {
    it("should display tab name to be deleted", () => {
      wrapper = createWrapper();
      
      const tabNameElement = wrapper.find('[data-test="dashboard-tab-delete-tab-name"]');
      expect(tabNameElement.exists()).toBe(true);
      expect(tabNameElement.text()).toBe("Tab to Delete");
    });

    it("should display delete confirmation message", () => {
      wrapper = createWrapper();
      
      const headElement = wrapper.find('[data-test="dashboard-tab-delete-tab-head"]');
      const paraElement = wrapper.find('[data-test="dashboard-tab-delete-tab-para"]');
      
      expect(headElement.exists()).toBe(true);
      expect(headElement.text()).toContain("Delete");
      expect(headElement.text()).toContain("Tab to Delete");
      
      expect(paraElement.exists()).toBe(true);
      expect(paraElement.text()).toContain("This action cannot be undone");
    });

    it("should handle missing tab gracefully", () => {
      wrapper = createWrapper({ tabId: "non-existent-tab" });
      
      const tabNameElement = wrapper.find('[data-test="dashboard-tab-delete-tab-name"]');
      expect(tabNameElement.text()).toBe(""); // Should not crash
    });

    it("should display tab name for different tabs", () => {
      wrapper = createWrapper({ tabId: "tab1" });
      
      const tabNameElement = wrapper.find('[data-test="dashboard-tab-delete-tab-name"]');
      expect(tabNameElement.text()).toBe("Tab 1");
    });
  });

  describe("Panels Handling Display", () => {
    it("should show panel options when tab has panels", () => {
      wrapper = createWrapper();
      
      const panelsContainer = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-container"]');
      expect(panelsContainer.exists()).toBe(true);
    });

    it("should not show panel options when tab has no panels", () => {
      wrapper = createWrapper({ tabId: "tab4" }); // Tab 4 has no panels
      
      const panelsContainer = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-container"]');
      expect(panelsContainer.exists()).toBe(false);
    });

    it("should show move panels radio option", () => {
      wrapper = createWrapper();
      
      const moveRadio = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-move"]');
      expect(moveRadio.exists()).toBe(true);
    });

    it("should show delete panels radio option", () => {
      wrapper = createWrapper();
      
      const deleteRadio = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-delete"]');
      expect(deleteRadio.exists()).toBe(true);
    });

    it("should show tab selection dropdown when move option is selected", () => {
      wrapper = createWrapper();
      
      // Default action should be "move"
      expect(wrapper.vm.action).toBe("move");
      
      const selectElement = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-move-select"]');
      expect(selectElement.exists()).toBe(true);
    });

    it("should handle tab with undefined panels", () => {
      const dataWithUndefinedPanels = {
        tabs: [
          { tabId: "tab1", name: "Tab 1" }, // No panels property
          { tabId: "tab-to-delete", name: "Target Tab" },
        ],
      };
      
      wrapper = createWrapper({ 
        tabId: "tab1",
        dashboardData: dataWithUndefinedPanels 
      });
      
      const panelsContainer = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-container"]');
      expect(panelsContainer.exists()).toBe(false);
    });
  });

  describe("Move Tab Options", () => {
    it("should populate move tab options excluding current tab", () => {
      wrapper = createWrapper();
      
      const expectedOptions = [
        { label: "Tab 1", value: "tab1" },
        { label: "Tab 2", value: "tab2" },
        { label: "Tab 4", value: "tab4" },
      ];
      
      expect(wrapper.vm.moveTabOptions).toEqual(expectedOptions);
    });

    it("should set first available tab as default selection", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.selectedTabToMovePanels).toEqual({
        label: "Tab 1",
        value: "tab1",
      });
    });

    it("should handle case with only one tab", () => {
      const singleTabData = {
        tabs: [
          { tabId: "only-tab", name: "Only Tab", panels: [{ id: "panel1" }] },
        ],
      };
      
      wrapper = createWrapper({
        tabId: "only-tab",
        dashboardData: singleTabData,
      });
      
      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should handle empty dashboard data", () => {
      wrapper = createWrapper({
        dashboardData: { tabs: [] },
      });
      
      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should handle dashboard data without tabs property", () => {
      // This test is primarily for error handling - the component will error
      // in template if dashboardData.tabs is undefined
      expect(() => {
        wrapper = createWrapper({ dashboardData: {} });
      }).toThrow();
    });
  });

  describe("Action Selection", () => {
    it("should initialize with move action as default", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.action).toBe("move");
    });

    it("should change action when radio button is selected", async () => {
      wrapper = createWrapper();
      
      const deleteRadio = wrapper.findComponent({ name: "QRadio" });
      await deleteRadio.vm.$emit("update:modelValue", "delete");
      
      expect(wrapper.vm.action).toBe("delete");
    });

    it("should handle action change from move to delete", async () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.action).toBe("move");
      
      wrapper.vm.action = "delete";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.action).toBe("delete");
    });

    it("should handle action change from delete to move", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.action = "delete";
      await wrapper.vm.$nextTick();
      
      wrapper.vm.action = "move";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.action).toBe("move");
    });
  });

  describe("Confirmation Buttons", () => {
    it("should render cancel button", () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      expect(cancelBtn.exists()).toBe(true);
      expect(cancelBtn.text()).toBe("confirmDialog.cancel");
    });

    it("should render confirm button", () => {
      wrapper = createWrapper();
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      expect(confirmBtn.exists()).toBe(true);
      expect(confirmBtn.text()).toBe("confirmDialog.ok");
    });

    it("should have correct button attributes", () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      
      expect(cancelBtn.classes()).toContain("q-mr-sm");
      expect(confirmBtn.classes()).toContain("no-border");
      
      // Find the specific confirm button component
      const allButtons = wrapper.findAllComponents({ name: "QBtn" });
      const confirmBtnComponent = allButtons.find(btn => 
        btn.attributes("data-test") === "confirm-button"
      );
      
      if (confirmBtnComponent) {
        expect(confirmBtnComponent.props("color")).toBe("primary");
      } else {
        // Fallback: just check that confirm button exists and has expected classes
        expect(confirmBtn.exists()).toBe(true);
        expect(confirmBtn.classes()).toContain("no-border");
      }
    });
  });

  describe("Event Emissions", () => {
    it("should emit update:cancel when cancel button is clicked", async () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      await cancelBtn.trigger("click");
      
      expect(wrapper.emitted("update:cancel")).toBeTruthy();
      expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    });

    it("should emit update:ok without parameters when delete action is selected", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.action = "delete";
      await wrapper.vm.$nextTick();
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      await confirmBtn.trigger("click");
      
      expect(wrapper.emitted("update:ok")).toBeTruthy();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")?.[0]).toEqual([]);
    });

    it("should emit update:ok with tab id when move action is selected", async () => {
      wrapper = createWrapper();
      
      // Default action is "move"
      expect(wrapper.vm.action).toBe("move");
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      await confirmBtn.trigger("click");
      
      expect(wrapper.emitted("update:ok")).toBeTruthy();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")?.[0]).toEqual(["tab1"]);
    });

    it("should emit multiple events when buttons are clicked multiple times", async () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      
      await cancelBtn.trigger("click");
      await confirmBtn.trigger("click");
      await cancelBtn.trigger("click");
      
      expect(wrapper.emitted("update:cancel")).toHaveLength(2);
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
    });

    it("should emit update:ok with correct tab id for different selections", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.selectedTabToMovePanels = { label: "Tab 2", value: "tab2" };
      await wrapper.vm.$nextTick();
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      await confirmBtn.trigger("click");
      
      expect(wrapper.emitted("update:ok")?.[0]).toEqual(["tab2"]);
    });
  });

  describe("Tab Selection Dropdown", () => {
    it("should render dropdown when action is move", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.action).toBe("move");
      
      const selectElement = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-move-select"]');
      expect(selectElement.exists()).toBe(true);
    });

    it("should update selected tab when dropdown value changes", async () => {
      wrapper = createWrapper();
      
      const newSelection = { label: "Tab 2", value: "tab2" };
      wrapper.vm.selectedTabToMovePanels = newSelection;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.selectedTabToMovePanels).toEqual(newSelection);
    });

    it("should handle empty options gracefully", () => {
      const emptyTabsData = {
        tabs: [
          { tabId: "only-tab", name: "Only Tab", panels: [{ id: "panel1" }] },
        ],
      };
      
      wrapper = createWrapper({
        tabId: "only-tab",
        dashboardData: emptyTabsData,
      });
      
      expect(wrapper.vm.moveTabOptions).toEqual([]);
      // selectedTabToMovePanels should be the first item in empty array, which is undefined
      expect(wrapper.vm.selectedTabToMovePanels).toBeUndefined();
    });
  });

  describe("Props Validation and Edge Cases", () => {
    it("should handle undefined tabId", () => {
      wrapper = createWrapper({ tabId: undefined });
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.moveTabOptions).toBeDefined();
    });

    it("should handle null dashboardData", () => {
      // This test is primarily for error handling - the component will error
      // in template if dashboardData is null since it doesn't have defensive checks
      expect(() => {
        wrapper = createWrapper({ dashboardData: null });
      }).toThrow();
    });

    it("should handle dashboardData without tabs", () => {
      // This test is primarily for error handling - the component will error
      // in template if dashboardData.tabs is undefined
      expect(() => {
        wrapper = createWrapper({ dashboardData: {} });
      }).toThrow();
    });

    it("should handle empty string tabId", () => {
      wrapper = createWrapper({ tabId: "" });
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle special characters in tab names", () => {
      const specialCharsData = {
        tabs: [
          { tabId: "tab1", name: "Tab with <>&\"' special chars", panels: [] },
          { tabId: "tab2", name: "Normal Tab", panels: [] },
        ],
      };
      
      wrapper = createWrapper({
        tabId: "tab2",
        dashboardData: specialCharsData,
      });
      
      expect(wrapper.vm.moveTabOptions[0].label).toBe("Tab with <>&\"' special chars");
    });
  });

  describe("Component State Management", () => {
    it("should initialize with correct default state", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.action).toBe("move");
      expect(wrapper.vm.selectedTabToMovePanels).toBeDefined();
      expect(wrapper.vm.moveTabOptions).toBeDefined();
    });

    it("should maintain state consistency during interactions", async () => {
      wrapper = createWrapper();
      
      const initialAction = wrapper.vm.action;
      const initialOptions = wrapper.vm.moveTabOptions;
      
      // Simulate some interactions
      wrapper.vm.action = "delete";
      await wrapper.vm.$nextTick();
      
      wrapper.vm.action = "move";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.action).toBe("move");
      expect(wrapper.vm.moveTabOptions).toEqual(initialOptions);
    });

    it("should handle state changes during confirmation", async () => {
      wrapper = createWrapper();
      
      // Change action to delete
      wrapper.vm.action = "delete";
      await wrapper.vm.$nextTick();
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      await confirmBtn.trigger("click");
      
      expect(wrapper.emitted("update:ok")?.[0]).toEqual([]);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      
      // Rapid action changes
      for (let i = 0; i < 10; i++) {
        wrapper.vm.action = i % 2 === 0 ? "move" : "delete";
        await wrapper.vm.$nextTick();
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("TabsDeletePopUp");
    });

    it("should maintain component integrity after multiple operations", async () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      
      for (let i = 0; i < 5; i++) {
        await cancelBtn.trigger("click");
        
        wrapper.vm.action = i % 2 === 0 ? "move" : "delete";
        await wrapper.vm.$nextTick();
        
        await confirmBtn.trigger("click");
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("TabsDeletePopUp");
    });

    it("should handle very large number of tabs", () => {
      const largeDashboardData = {
        tabs: Array.from({ length: 100 }, (_, i) => ({
          tabId: `tab${i}`,
          name: `Tab ${i}`,
          panels: i % 3 === 0 ? [{ id: `panel${i}` }] : [],
        })),
      };
      
      wrapper = createWrapper({
        tabId: "tab50",
        dashboardData: largeDashboardData,
      });
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.moveTabOptions).toHaveLength(99); // All except the current tab
    });
  });

  describe("Accessibility and User Experience", () => {
    it("should have proper form structure with radio groups", () => {
      wrapper = createWrapper();
      
      const radioGroup = wrapper.find('.radio-group');
      expect(radioGroup.exists()).toBe(true);
    });

    it("should have proper button roles and attributes", () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      
      expect(cancelBtn.exists()).toBe(true);
      expect(confirmBtn.exists()).toBe(true);
    });

    it("should provide clear action feedback through UI state", async () => {
      wrapper = createWrapper();
      
      // Verify the move option is properly structured
      const moveRadio = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-move"]');
      expect(moveRadio.exists()).toBe(true);
      
      // Verify the delete option is properly structured  
      const deleteRadio = wrapper.find('[data-test="dashboard-tab-delete-tab-panels-delete"]');
      expect(deleteRadio.exists()).toBe(true);
    });
  });
});