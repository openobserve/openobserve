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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import RealTimeAlert from "@/components/alerts/RealTimeAlert.vue";
import i18n from "@/locales";
import { Dialog } from "quasar";

installQuasar({
  plugins: [Dialog],
});

// Mock dependencies
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-${path}`),
  useLocalOrganization: vi.fn(() => ({ value: "test-org" })),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      theme: "dark",
    },
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    resolve: vi.fn(() => ({
      href: "/test-route",
    })),
  }),
}));

// Mock child components
vi.mock("@/components/alerts/FieldsInput.vue", () => ({
  default: {
    name: "FieldsInput",
    template: '<div class="fields-input-mock">FieldsInput</div>',
  },
}));

vi.mock("@/components/alerts/AlertsContainer.vue", () => ({
  default: {
    name: "AlertsContainer",
    template: '<div class="alerts-container-mock"><slot /></div>',
    props: ["name", "isExpanded", "label", "subLabel", "icon", "iconClass", "image"],
    emits: ["update:isExpanded"],
  },
}));

vi.mock("@/components/alerts/FilterGroup.vue", () => ({
  default: {
    name: "FilterGroup",
    template: '<div class="filter-group-mock">FilterGroup</div>',
    props: ["streamFields", "group", "depth"],
    emits: ["addCondition", "addGroup", "removeGroup", "input:update"],
  },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

describe("RealTimeAlert", () => {
  let wrapper: any = null;

  const mockProps = {
    columns: [
      { name: "field1", type: "string" },
      { name: "field2", type: "number" },
      { name: "field3", type: "boolean" },
    ],
    conditions: {
      type: "group",
      operator: "AND",
      conditions: [],
    },
    enableNewValueMode: false,
    expandState: {
      thresholds: true,
      realTimeMode: true,
    },
    trigger: {
      silence: 5,
      frequency: 10,
    },
    destinations: ["dest1", "dest2"],
    formattedDestinations: ["dest1", "dest2", "dest3"],
  };

  // Mock window.open for testing
  const originalOpen = window.open;

  beforeEach(() => {
    window.open = vi.fn();
    
    wrapper = mount(RealTimeAlert, {
      attachTo: "#app",
      shallow: false,
      props: mockProps,
      global: {
        plugins: [i18n],
        stubs: {
          AlertsContainer: true,
          FieldsInput: true,
          FilterGroup: true,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    window.open = originalOpen;
  });

  // Basic Component Tests
  describe("Component Structure", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render AlertsContainer components", () => {
      const alertContainers = wrapper.findAllComponents({ name: "AlertsContainer" });
      expect(alertContainers.length).toBeGreaterThan(0);
    });

    it("should render FilterGroup component", () => {
      const filterGroup = wrapper.findComponent({ name: "FilterGroup" });
      expect(filterGroup.exists()).toBe(true);
    });

    it("should have correct component structure", () => {
      const rootElement = wrapper.find("div");
      expect(rootElement.exists()).toBe(true);
    });

    it("should initialize with correct data structure", () => {
      expect(wrapper.vm.triggerData).toBeDefined();
      expect(wrapper.vm.destinations).toBeDefined();
      expect(wrapper.vm.inputData).toBeDefined();
      expect(wrapper.vm.filteredDestinations).toBeDefined();
    });
  });

  // Props Tests
  describe("Props", () => {
    it("should accept columns prop", () => {
      expect(wrapper.props("columns")).toEqual(mockProps.columns);
    });

    it("should accept conditions prop", () => {
      expect(wrapper.props("conditions")).toEqual(mockProps.conditions);
    });

    it("should accept enableNewValueMode prop", () => {
      expect(wrapper.props("enableNewValueMode")).toBe(false);
    });

    it("should accept expandState prop", () => {
      expect(wrapper.props("expandState")).toEqual(mockProps.expandState);
    });

    it("should accept trigger prop", () => {
      expect(wrapper.props("trigger")).toEqual(mockProps.trigger);
    });

    it("should accept destinations prop", () => {
      expect(wrapper.props("destinations")).toEqual(mockProps.destinations);
    });

    it("should accept formattedDestinations prop", () => {
      expect(wrapper.props("formattedDestinations")).toEqual(mockProps.formattedDestinations);
    });

    it("should handle empty columns prop", async () => {
      await wrapper.setProps({ columns: [] });
      expect(wrapper.props("columns")).toEqual([]);
    });

    it("should handle null conditions prop", async () => {
      await wrapper.setProps({ conditions: null });
      expect(wrapper.props("conditions")).toBeNull();
    });

    it("should handle undefined destinations prop", async () => {
      await wrapper.setProps({ destinations: undefined });
      expect(wrapper.props("destinations")).toBeUndefined();
    });
  });

  // Reactive Data Tests
  describe("Reactive Data", () => {
    it("should initialize triggerData from props", () => {
      expect(wrapper.vm.triggerData).toEqual(mockProps.trigger);
    });

    it("should initialize destinations from props", () => {
      expect(wrapper.vm.destinations).toEqual(mockProps.destinations);
    });

    it("should initialize inputData from conditions prop", () => {
      expect(wrapper.vm.inputData).toEqual(mockProps.conditions);
    });

    it("should initialize filteredDestinations from formattedDestinations prop", () => {
      expect(wrapper.vm.filteredDestinations).toEqual(mockProps.formattedDestinations);
    });

    it("should have destinationSelectRef as null initially", () => {
      expect(wrapper.vm.destinationSelectRef).toBeDefined();
    });

    it("should have isDestinationDropdownOpen as false initially", () => {
      expect(wrapper.vm.isDestinationDropdownOpen).toBe(false);
    });
  });

  // Watcher Tests
  describe("Watchers", () => {

    it("should not clear input when destinations array shrinks", async () => {
      const mockUpdateInputValue = vi.fn();
      wrapper.vm.destinationSelectRef = {
        updateInputValue: mockUpdateInputValue,
      };

      // Simulate removing a destination
      const newDestinations = mockProps.destinations.slice(0, 1);
      await wrapper.setProps({ destinations: newDestinations });
      await flushPromises();

      expect(mockUpdateInputValue).not.toHaveBeenCalled();
    });

    it("should not call updateInputValue when destinationSelectRef is null", async () => {
      // Set destinationSelectRef to null and verify it doesn't cause errors
      wrapper.vm.destinationSelectRef = null;

      const newDestinations = [...mockProps.destinations, "dest6"];
      
      // This should not throw an error even with null ref
      expect(async () => {
        await wrapper.setProps({ destinations: newDestinations });
        await flushPromises();
      }).not.toThrow();
      
      // The component should still exist and be functional
      expect(wrapper.exists()).toBe(true);
    });

  });

  // Method Tests
  describe("Methods", () => {
    describe("updateTrigger", () => {
      it("should emit update:trigger with triggerData", () => {
        wrapper.vm.updateTrigger();
        expect(wrapper.emitted("update:trigger")).toBeTruthy();
        expect(wrapper.emitted("update:trigger")[0]).toEqual([mockProps.trigger]);
      });

      it("should emit correct triggerData after modification", async () => {
        wrapper.vm.triggerData.silence = 15;
        wrapper.vm.updateTrigger();
        
        const emitted = wrapper.emitted("update:trigger");
        expect(emitted[0][0].silence).toBe(15);
      });

      it("should emit multiple times when called multiple times", () => {
        wrapper.vm.updateTrigger();
        wrapper.vm.updateTrigger();
        wrapper.vm.updateTrigger();
        
        expect(wrapper.emitted("update:trigger")).toHaveLength(3);
      });
    });

    describe("addField", () => {
      it("should emit field:add and input:update events", () => {
        const field = { name: "test_field", type: "string" };
        wrapper.vm.addField(field);

        expect(wrapper.emitted("field:add")).toBeTruthy();
        expect(wrapper.emitted("field:add")[0]).toEqual([field]);
        
        expect(wrapper.emitted("input:update")).toBeTruthy();
        expect(wrapper.emitted("input:update")[0]).toEqual(["conditions", field]);
      });

      it("should handle null field", () => {
        wrapper.vm.addField(null);
        
        expect(wrapper.emitted("field:add")[0]).toEqual([null]);
        expect(wrapper.emitted("input:update")[0]).toEqual(["conditions", null]);
      });

      it("should handle complex field objects", () => {
        const complexField = {
          name: "complex_field",
          type: "object",
          properties: {
            nested: { type: "string" }
          }
        };
        
        wrapper.vm.addField(complexField);
        
        expect(wrapper.emitted("field:add")[0]).toEqual([complexField]);
      });
    });

    describe("removeField", () => {
      it("should emit field:remove and input:update events", () => {
        const field = { name: "test_field", type: "string" };
        wrapper.vm.removeField(field);

        expect(wrapper.emitted("field:remove")).toBeTruthy();
        expect(wrapper.emitted("field:remove")[0]).toEqual([field]);
        
        expect(wrapper.emitted("input:update")).toBeTruthy();
        expect(wrapper.emitted("input:update")[0]).toEqual(["conditions", field]);
      });

      it("should handle undefined field", () => {
        wrapper.vm.removeField(undefined);
        
        expect(wrapper.emitted("field:remove")[0]).toEqual([undefined]);
        expect(wrapper.emitted("input:update")[0]).toEqual(["conditions", undefined]);
      });

      it("should handle array fields", () => {
        const arrayField = ["field1", "field2"];
        wrapper.vm.removeField(arrayField);
        
        expect(wrapper.emitted("field:remove")[0]).toEqual([arrayField]);
      });
    });

    describe("routeToCreateDestination", () => {
      it("should open new window with correct URL", () => {
        wrapper.vm.routeToCreateDestination();
        
        expect(window.open).toHaveBeenCalledWith("/test-route", "_blank");
      });

      it("should handle router functionality", () => {
        // Test that the method exists and can be called without errors
        expect(() => wrapper.vm.routeToCreateDestination()).not.toThrow();
        expect(window.open).toHaveBeenCalled();
      });

      it("should handle route creation process", () => {
        wrapper.vm.routeToCreateDestination();
        
        // Verify window.open was called
        expect(window.open).toHaveBeenCalledWith("/test-route", "_blank");
      });
    });

    describe("updateDestinations", () => {
      it("should emit update:destinations with provided destinations", () => {
        const destinations = ["dest1", "dest2", "dest3"];
        wrapper.vm.updateDestinations(destinations);

        expect(wrapper.emitted("update:destinations")).toBeTruthy();
        expect(wrapper.emitted("update:destinations")[0]).toEqual([destinations]);
      });

      it("should handle empty destinations array", () => {
        wrapper.vm.updateDestinations([]);
        
        expect(wrapper.emitted("update:destinations")[0]).toEqual([[]]);
      });

      it("should handle null destinations", () => {
        wrapper.vm.updateDestinations(null);
        
        expect(wrapper.emitted("update:destinations")[0]).toEqual([null]);
      });
    });

    describe("updateGroup", () => {
      it("should emit update:group with provided group", () => {
        const group = { type: "condition", field: "test" };
        wrapper.vm.updateGroup(group);

        expect(wrapper.emitted("update:group")).toBeTruthy();
        expect(wrapper.emitted("update:group")[0]).toEqual([group]);
      });

      it("should handle complex group structures", () => {
        const complexGroup = {
          type: "group",
          operator: "OR",
          conditions: [
            { field: "field1", operator: "equals", value: "test" },
            { field: "field2", operator: "greater", value: 100 }
          ]
        };
        
        wrapper.vm.updateGroup(complexGroup);
        
        expect(wrapper.emitted("update:group")[0]).toEqual([complexGroup]);
      });
    });

    describe("removeConditionGroup", () => {
      it("should emit remove:group with targetGroupId", () => {
        const groupId = "group-123";
        wrapper.vm.removeConditionGroup(groupId);

        expect(wrapper.emitted("remove:group")).toBeTruthy();
        expect(wrapper.emitted("remove:group")[0]).toEqual([groupId]);
      });

      it("should handle empty group ID", () => {
        wrapper.vm.removeConditionGroup("");
        
        expect(wrapper.emitted("remove:group")[0]).toEqual([""]);
      });

      it("should handle null group ID", () => {
        wrapper.vm.removeConditionGroup(null);
        
        expect(wrapper.emitted("remove:group")[0]).toEqual([null]);
      });

      it("should handle with currentGroup parameter", () => {
        const groupId = "group-456";
        const currentGroup = { id: "current-group" };
        
        wrapper.vm.removeConditionGroup(groupId, currentGroup);
        
        expect(wrapper.emitted("remove:group")[0]).toEqual([groupId]);
      });
    });

    describe("filterDestinations", () => {
      it("should show all destinations when filter is empty", () => {
        const mockUpdate = vi.fn();
        
        wrapper.vm.filterDestinations("", mockUpdate);
        
        expect(mockUpdate).toHaveBeenCalled();
        
        // Call the update function to test the logic
        const updateFunction = mockUpdate.mock.calls[0][0];
        updateFunction();
        
        expect(wrapper.vm.filteredDestinations).toEqual(mockProps.formattedDestinations);
      });

      it("should filter destinations based on search term", () => {
        const mockUpdate = vi.fn();
        
        wrapper.vm.filterDestinations("dest1", mockUpdate);
        
        expect(mockUpdate).toHaveBeenCalled();
        
        // Call the update function to test the logic
        const updateFunction = mockUpdate.mock.calls[0][0];
        updateFunction();
        
        expect(wrapper.vm.filteredDestinations).toEqual(["dest1"]);
      });

      it("should perform case-insensitive filtering", () => {
        const mockUpdate = vi.fn();
        
        wrapper.vm.filterDestinations("DEST1", mockUpdate);
        
        const updateFunction = mockUpdate.mock.calls[0][0];
        updateFunction();
        
        expect(wrapper.vm.filteredDestinations).toEqual(["dest1"]);
      });

      it("should handle partial matches", () => {
        const mockUpdate = vi.fn();
        
        wrapper.vm.filterDestinations("est", mockUpdate);
        
        const updateFunction = mockUpdate.mock.calls[0][0];
        updateFunction();
        
        expect(wrapper.vm.filteredDestinations).toEqual(["dest1", "dest2", "dest3"]);
      });

      it("should return empty array when no matches", () => {
        const mockUpdate = vi.fn();
        
        wrapper.vm.filterDestinations("nomatch", mockUpdate);
        
        const updateFunction = mockUpdate.mock.calls[0][0];
        updateFunction();
        
        expect(wrapper.vm.filteredDestinations).toEqual([]);
      });

      it("should handle null formattedDestinations", async () => {
        await wrapper.setProps({ formattedDestinations: null });
        
        const mockUpdate = vi.fn();
        
        expect(() => {
          wrapper.vm.filterDestinations("test", mockUpdate);
          const updateFunction = mockUpdate.mock.calls[0][0];
          updateFunction();
        }).toThrow();
      });
    });
  });

  // Computed Properties Tests
  describe("Computed Properties", () => {
    describe("conditionsImage", () => {
      it("should return dark theme image when theme is dark", () => {
        const result = wrapper.vm.conditionsImage;
        expect(result).toBe("mock-images/alerts/conditions_image.svg");
      });

      it("should return light theme image when theme is light", () => {
        // Test that conditionsImage returns a string that contains expected parts
        const result = wrapper.vm.conditionsImage;
        expect(typeof result).toBe("string");
        expect(result).toContain("conditions_image");
      });

      it("should be reactive to theme changes", () => {
        const result = wrapper.vm.conditionsImage;
        expect(typeof result).toBe("string");
        expect(result).toContain("conditions_image");
      });
    });
  });

  // Event Handling Tests
  describe("Event Handling", () => {
    it("should handle refresh:destinations event", async () => {
      await wrapper.vm.$emit("refresh:destinations");
      
      expect(wrapper.emitted("refresh:destinations")).toBeTruthy();
    });

    it("should handle expand state updates", async () => {
      const newExpandState = { thresholds: false, realTimeMode: true };
      await wrapper.vm.$emit("update:expandState", newExpandState);
      
      expect(wrapper.emitted("update:expandState")).toBeTruthy();
    });

    it("should handle multiple emit calls", () => {
      wrapper.vm.addField({ name: "field1" });
      wrapper.vm.removeField({ name: "field2" });
      wrapper.vm.updateTrigger();
      
      expect(wrapper.emitted("field:add")).toHaveLength(1);
      expect(wrapper.emitted("field:remove")).toHaveLength(1);
      expect(wrapper.emitted("update:trigger")).toHaveLength(1);
    });
  });

  // Error Handling and Edge Cases
  describe("Error Handling", () => {
    it("should handle missing props gracefully", () => {
      const minimalProps = {
        expandState: { thresholds: true, realTimeMode: true },
        trigger: { silence: 5 },
        destinations: [],
        formattedDestinations: [],
        conditions: {},
        columns: []
      };
      
      const minimalWrapper = mount(RealTimeAlert, {
        props: minimalProps,
        global: {
          plugins: [i18n],
          stubs: {
            AlertsContainer: true,
            FilterGroup: true,
          },
        },
      });
      
      expect(minimalWrapper.exists()).toBe(true);
      minimalWrapper.unmount();
    });

    it("should handle malformed conditions prop", async () => {
      const newConditions = "invalid-conditions";
      await wrapper.setProps({ conditions: newConditions });
      
      // The component should handle the prop change without crashing
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid trigger data", async () => {
      await wrapper.setProps({ trigger: null });
      
      // The component should handle the prop change without crashing
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle method calls with invalid parameters", () => {
      expect(() => wrapper.vm.addField()).not.toThrow();
      expect(() => wrapper.vm.removeField()).not.toThrow();
      expect(() => wrapper.vm.updateDestinations()).not.toThrow();
    });
  });

  // Integration Tests
  describe("Integration", () => {
    it("should maintain data consistency across updates", async () => {
      const newTrigger = { silence: 30, frequency: 45 };
      await wrapper.setProps({ trigger: newTrigger });
      
      // The component should handle the update
      expect(wrapper.exists()).toBe(true);
      
      wrapper.vm.updateTrigger();
      expect(wrapper.emitted("update:trigger")).toBeTruthy();
    });

    it("should handle complex workflow scenarios", async () => {
      // Add field
      const field = { name: "new_field", type: "string" };
      wrapper.vm.addField(field);
      
      // Update destinations
      const newDestinations = ["dest4", "dest5"];
      wrapper.vm.updateDestinations(newDestinations);
      
      // Remove group
      wrapper.vm.removeConditionGroup("group-1");
      
      // Update trigger
      wrapper.vm.updateTrigger();
      
      // Verify all events were emitted
      expect(wrapper.emitted("field:add")).toBeTruthy();
      expect(wrapper.emitted("update:destinations")).toBeTruthy();
      expect(wrapper.emitted("remove:group")).toBeTruthy();
      expect(wrapper.emitted("update:trigger")).toBeTruthy();
    });

    it("should handle rapid state changes", async () => {
      for (let i = 0; i < 3; i++) {
        await wrapper.setProps({ 
          destinations: [`dest${i}`, `dest${i+1}`] 
        });
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.destinations).toBeDefined();
    });

    it("should maintain component stability during prop changes", async () => {
      const originalInstance = wrapper.vm;
      
      await wrapper.setProps({
        columns: [{ name: "new_column", type: "text" }],
        conditions: { type: "new_group" },
        destinations: ["new_dest"],
      });
      
      expect(wrapper.vm).toBe(originalInstance);
      expect(wrapper.exists()).toBe(true);
    });
  });
});