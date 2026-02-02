// Copyright 2025 OpenObserve Inc.
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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import DualListSelector from "@/components/common/DualListSelector.vue";

installQuasar();

describe("DualListSelector", () => {
  const mockItems = [
    { label: "Item One", value: "item-1" },
    { label: "Item Two", value: "item-2" },
    { label: "Item Three", value: "item-3" },
    { label: "Item Four", value: "item-4" },
    { label: "Item Five", value: "item-5" },
  ];

  describe("Props and Initialization", () => {
    it("renders with default props", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button @click='$attrs.onClick'><slot /></button>" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("uses custom titles", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: mockItems,
          leftTitle: "Priority",
          rightTitle: "Options",
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      expect(wrapper.text()).toContain("Priority");
      expect(wrapper.text()).toContain("Options");
    });

    it("displays pre-selected items", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      expect(wrapper.vm.selectedItems).toHaveLength(2);
      expect(wrapper.vm.availableItems).toHaveLength(3);
    });
  });

  describe("Computed Properties", () => {
    it("correctly calculates available items", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      const available = wrapper.vm.availableItems;
      expect(available).toHaveLength(3);
      expect(available.map((i: any) => i.value)).toEqual(["item-2", "item-4", "item-5"]);
    });

    it("correctly maps selected items using itemsMap", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-2", "item-4"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      const selected = wrapper.vm.selectedItems;
      expect(selected).toHaveLength(2);
      expect(selected[0].label).toBe("Item Two");
      expect(selected[1].label).toBe("Item Four");
    });

    it("filters selected items by search query", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.searchLeft = "two";
      expect(wrapper.vm.filteredSelected).toHaveLength(1);
      expect(wrapper.vm.filteredSelected[0].label).toBe("Item Two");
    });

    it("filters available items by search query", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.searchRight = "four";
      expect(wrapper.vm.filteredAvailable).toHaveLength(1);
      expect(wrapper.vm.filteredAvailable[0].label).toBe("Item Four");
    });
  });

  describe("Selection Management", () => {
    it("toggles left selection", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.toggleLeftSelection("item-1");
      expect(wrapper.vm.leftSelected).toContain("item-1");

      wrapper.vm.toggleLeftSelection("item-1");
      expect(wrapper.vm.leftSelected).not.toContain("item-1");
    });

    it("toggles right selection", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.toggleRightSelection("item-1");
      expect(wrapper.vm.rightSelected).toContain("item-1");

      wrapper.vm.toggleRightSelection("item-1");
      expect(wrapper.vm.rightSelected).not.toContain("item-1");
    });
  });

  describe("Transfer Operations", () => {
    it("adds selected items from right to left", async () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.rightSelected = ["item-1", "item-3"];
      wrapper.vm.addSelected();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["item-1", "item-3"]]);
      expect(wrapper.vm.rightSelected).toHaveLength(0);
    });

    it("adds all items and clears selection", async () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.rightSelected = ["item-2"];
      wrapper.vm.addAll();

      const emitted = wrapper.emitted("update:modelValue")![0][0] as string[];
      expect(emitted).toHaveLength(5);
      expect(emitted).toContain("item-1");
      expect(emitted).toContain("item-2");
      expect(wrapper.vm.rightSelected).toHaveLength(0);
    });

    it("removes selected items and clears selection", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.leftSelected = ["item-1", "item-3"];
      wrapper.vm.removeSelected();

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([["item-2"]]);
      expect(wrapper.vm.leftSelected).toHaveLength(0);
    });

    it("removes all items and clears both selections", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.leftSelected = ["item-1"];
      wrapper.vm.rightSelected = ["item-3"];
      wrapper.vm.removeAll();

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([[]]);
      expect(wrapper.vm.leftSelected).toHaveLength(0);
      expect(wrapper.vm.rightSelected).toHaveLength(0);
    });
  });

  describe("Reordering Operations", () => {
    it("moves item up", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.moveUp(1);

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([
        ["item-2", "item-1", "item-3"],
      ]);
    });

    it("moves item down", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.moveDown(0);

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([
        ["item-2", "item-1", "item-3"],
      ]);
    });

    it("does not move up when at index 0", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.moveUp(0);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("does not move down when at last index", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.moveDown(1);

      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("removes single item", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.removeItem("item-2");

      expect(wrapper.emitted("update:modelValue")![0]).toEqual([
        ["item-1", "item-3"],
      ]);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty allItems array", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: [],
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      expect(wrapper.vm.availableItems).toHaveLength(0);
      expect(wrapper.vm.selectedItems).toHaveLength(0);
    });

    it("handles single item in modelValue", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      expect(wrapper.vm.selectedItems).toHaveLength(1);
      wrapper.vm.moveUp(0);
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
      wrapper.vm.moveDown(0);
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });

    it("handles search with no results", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.searchLeft = "nonexistent";
      expect(wrapper.vm.filteredSelected).toHaveLength(0);

      wrapper.vm.searchRight = "xyz";
      expect(wrapper.vm.filteredAvailable).toHaveLength(0);
    });

    it("handles invalid value in modelValue gracefully", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "invalid-item", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      // Should filter out invalid items
      expect(wrapper.vm.selectedItems).toHaveLength(2);
      expect(wrapper.vm.selectedItems.map((i: any) => i.value)).toEqual(["item-1", "item-2"]);
    });
  });

  describe("Event Emissions", () => {
    it("emits update:modelValue on addSelected", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: [],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.rightSelected = ["item-1"];
      wrapper.vm.addSelected();

      expect(wrapper.emitted()).toHaveProperty("update:modelValue");
      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["item-1"]);
    });

    it("emits update:modelValue on moveUp", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.moveUp(1);

      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["item-2", "item-1"]);
    });

    it("emits update:modelValue on removeItem", () => {
      const wrapper = mount(DualListSelector, {
        props: {
          modelValue: ["item-1", "item-2", "item-3"],
          allItems: mockItems,
        },
        global: {
          stubs: {
            "q-input": { template: "<input />" },
            "q-list": { template: "<div><slot /></div>" },
            "q-item": { template: "<div><slot /></div>" },
            "q-item-section": { template: "<div><slot /></div>" },
            "q-btn": { template: "<button />" },
            "q-icon": { template: "<i />" },
            "q-checkbox": { template: "<input type='checkbox' />" },
            "q-tooltip": { template: "<div />" },
          },
        },
      });

      wrapper.vm.removeItem("item-2");

      expect(wrapper.emitted("update:modelValue")![0][0]).toEqual(["item-1", "item-3"]);
    });
  });
});
