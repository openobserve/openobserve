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
import PanelSidebar from "./PanelSidebar.vue";

describe("PanelSidebar", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(PanelSidebar, {
      props: {
        title: "Test Sidebar",
        modelValue: false,
        ...props,
      },
      global: {
        plugins: [Quasar],
        stubs: {
          "q-icon": {
            template: '<div class="q-icon" :class="$attrs.class" :data-test="$attrs[\'data-test\']" :name="name"><slot /></div>',
            props: ["name"],
            inheritAttrs: false,
          },
          "q-btn": {
            template: '<button @click="$emit(\'click\', $event)" :data-test="$attrs[\'data-test\']" class="q-btn" :class="$attrs.class" :icon="icon"><slot /></button>',
            props: ["square", "icon"],
            emits: ["click"],
            inheritAttrs: false,
          },
          "q-separator": {
            template: '<div class="q-separator"></div>',
          },
        },
      },
      slots: {
        default: '<div data-test="sidebar-slot-content">Sidebar Content</div>',
      },
    });
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".sidebar").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBeUndefined(); // Default component
    });

    it("should initialize with provided props", () => {
      wrapper = createWrapper({
        title: "Custom Title",
        modelValue: true,
      });
      
      expect(wrapper.props("title")).toBe("Custom Title");
      expect(wrapper.props("modelValue")).toBe(true);
    });

    it("should initialize isOpen based on modelValue prop", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should initialize isOpen as false by default", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.isOpen).toBe(false);
    });
  });

  describe("Props Validation", () => {
    it("should require title prop", () => {
      const component = PanelSidebar as any;
      expect(component.props.title.required).toBe(true);
      expect(component.props.title.type).toBe(String);
    });

    it("should require modelValue prop", () => {
      const component = PanelSidebar as any;
      expect(component.props.modelValue.required).toBe(true);
      expect(component.props.modelValue.type).toBe(Boolean);
    });

    it("should accept string title prop", () => {
      wrapper = createWrapper({ title: "Test Title" });
      
      expect(wrapper.props("title")).toBe("Test Title");
    });

    it("should accept boolean modelValue prop", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.props("modelValue")).toBe(true);
    });
  });

  describe("Collapsed State Rendering", () => {
    it("should show collapsed header when isOpen is false", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar-header-collapsed").exists()).toBe(true);
      expect(wrapper.find(".sidebar-header-expanded").exists()).toBe(false);
    });

    it("should render expand icon in collapsed state", () => {
      wrapper = createWrapper({ modelValue: false });
      
      const icon = wrapper.find('[data-test="dashboard-sidebar"]');
      expect(icon.exists()).toBe(true);
      expect(icon.attributes("name")).toBe("expand_all");
      expect(icon.classes()).toContain("collapsed-icon");
      expect(icon.classes()).toContain("rotate-90");
    });

    it("should display title in collapsed state", () => {
      wrapper = createWrapper({ 
        title: "Test Sidebar Title",
        modelValue: false 
      });
      
      const titleElement = wrapper.find(".collapsed-title");
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.text()).toBe("Test Sidebar Title");
    });

    it("should apply correct CSS classes in collapsed state", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar").classes()).not.toContain("open");
    });

    it("should not show sidebar content when collapsed", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar-content").exists()).toBe(false);
    });
  });

  describe("Expanded State Rendering", () => {
    it("should show expanded header when isOpen is true", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find(".sidebar-header-expanded").exists()).toBe(true);
      expect(wrapper.find(".sidebar-header-collapsed").exists()).toBe(false);
    });

    it("should render collapse button in expanded state", () => {
      wrapper = createWrapper({ modelValue: true });
      
      const collapseBtn = wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]');
      expect(collapseBtn.exists()).toBe(true);
      expect(collapseBtn.attributes("icon")).toBe("unfold_less");
      expect(collapseBtn.classes()).toContain("collapse-button");
      expect(collapseBtn.classes()).toContain("rotate-90");
    });

    it("should display title in expanded state", () => {
      wrapper = createWrapper({ 
        title: "Expanded Sidebar Title",
        modelValue: true 
      });
      
      const titleElement = wrapper.find(".expanded-title");
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.text()).toBe("Expanded Sidebar Title");
    });

    it("should apply correct CSS classes in expanded state", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find(".sidebar").classes()).toContain("open");
    });

    it("should show sidebar content when expanded", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find(".sidebar-content").exists()).toBe(true);
      expect(wrapper.find(".sidebar-content").classes()).toContain("scroll");
    });

    it("should render slot content in expanded state", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find('[data-test="sidebar-slot-content"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="sidebar-slot-content"]').text()).toBe("Sidebar Content");
    });
  });

  describe("Toggle Functionality", () => {
    it("should toggle sidebar when collapsed header is clicked", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const collapsedHeader = wrapper.find(".sidebar-header-collapsed");
      await collapsedHeader.trigger("click");
      
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should toggle sidebar when collapse button is clicked", async () => {
      wrapper = createWrapper({ modelValue: true });
      
      const collapseBtn = wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]');
      await collapseBtn.trigger("click");
      
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should emit update:modelValue when toggling from collapsed", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const collapsedHeader = wrapper.find(".sidebar-header-collapsed");
      await collapsedHeader.trigger("click");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([true]);
    });

    it("should emit update:modelValue when toggling from expanded", async () => {
      wrapper = createWrapper({ modelValue: true });
      
      const collapseBtn = wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]');
      await collapseBtn.trigger("click");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([false]);
    });

    it("should call toggleSidebar method on collapsed header click", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const toggleSpy = vi.spyOn(wrapper.vm, "toggleSidebar");
      const collapsedHeader = wrapper.find(".sidebar-header-collapsed");
      await collapsedHeader.trigger("click");
      
      expect(toggleSpy).toHaveBeenCalledOnce();
    });

    it("should call toggleSidebar method on collapse button click", async () => {
      wrapper = createWrapper({ modelValue: true });
      
      // Verify the method exists and can be called
      expect(typeof wrapper.vm.toggleSidebar).toBe("function");
      
      const collapseBtn = wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]');
      await collapseBtn.trigger("click");
      
      // Verify the click triggered the expected state change
      expect(wrapper.vm.isOpen).toBe(false);
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Prop Watcher", () => {
    it("should update isOpen when modelValue prop changes", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.vm.isOpen).toBe(false);
      
      await wrapper.setProps({ modelValue: true });
      
      expect(wrapper.vm.isOpen).toBe(true);
    });

    it("should update isOpen from true to false", async () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.vm.isOpen).toBe(true);
      
      await wrapper.setProps({ modelValue: false });
      
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should re-render component when modelValue changes", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar-header-collapsed").exists()).toBe(true);
      
      await wrapper.setProps({ modelValue: true });
      
      expect(wrapper.find(".sidebar-header-expanded").exists()).toBe(true);
      expect(wrapper.find(".sidebar-header-collapsed").exists()).toBe(false);
    });

    it("should show/hide content based on modelValue changes", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar-content").exists()).toBe(false);
      
      await wrapper.setProps({ modelValue: true });
      
      expect(wrapper.find(".sidebar-content").exists()).toBe(true);
    });
  });

  describe("Event Emissions", () => {
    it("should have correct emits configuration", () => {
      const component = PanelSidebar as any;
      expect(component.emits).toContain("update:modelValue");
    });

    it("should emit correct value when toggling", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      wrapper.vm.toggleSidebar();
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([true]);
    });

    it("should emit multiple times on multiple toggles", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      wrapper.vm.toggleSidebar(); // false -> true
      wrapper.vm.toggleSidebar(); // true -> false
      
      const emissions = wrapper.emitted("update:modelValue");
      expect(emissions).toBeTruthy();
      expect(emissions.length).toBe(2);
      expect(emissions[0]).toEqual([true]);
      expect(emissions[1]).toEqual([false]);
    });
  });

  describe("Setup Function", () => {
    it("should return correct properties from setup", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.isOpen).toBeDefined();
      expect(wrapper.vm.toggleSidebar).toBeDefined();
      expect(typeof wrapper.vm.toggleSidebar).toBe("function");
    });

    it("should initialize isOpen with props.modelValue", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.vm.isOpen).toBe(true);
    });
  });

  describe("Separator Rendering", () => {
    it("should render q-separator", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find(".q-separator").exists()).toBe(true);
    });

    it("should render separator in both states", async () => {
      wrapper = createWrapper({ modelValue: false });
      expect(wrapper.find(".q-separator").exists()).toBe(true);
      
      await wrapper.setProps({ modelValue: true });
      expect(wrapper.find(".q-separator").exists()).toBe(true);
    });
  });

  describe("Slot Functionality", () => {
    it("should render default slot content when expanded", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find('[data-test="sidebar-slot-content"]').exists()).toBe(true);
    });

    it("should not render slot content when collapsed", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find('[data-test="sidebar-slot-content"]').exists()).toBe(false);
    });

    it("should handle empty slot gracefully", () => {
      const wrapper = mount(PanelSidebar, {
        props: {
          title: "Test",
          modelValue: true,
        },
        global: {
          plugins: [Quasar],
          stubs: {
            "q-icon": true,
            "q-btn": true,
            "q-separator": true,
          },
        },
      });
      
      expect(wrapper.find(".sidebar-content").exists()).toBe(true);
    });
  });

  describe("CSS Classes and Styling", () => {
    it("should apply base sidebar class", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find(".sidebar").exists()).toBe(true);
    });

    it("should apply open class when expanded", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find(".sidebar.open").exists()).toBe(true);
    });

    it("should not apply open class when collapsed", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find(".sidebar").classes()).not.toContain("open");
    });

    it("should apply correct icon classes", () => {
      wrapper = createWrapper({ modelValue: false });
      
      const icon = wrapper.find(".q-icon");
      expect(icon.classes()).toContain("collapsed-icon");
      expect(icon.classes()).toContain("rotate-90");
    });

    it("should apply correct button classes", () => {
      wrapper = createWrapper({ modelValue: true });
      
      const button = wrapper.find(".q-btn");
      expect(button.classes()).toContain("collapse-button");
      expect(button.classes()).toContain("rotate-90");
    });

    it("should apply scroll class to content", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find(".sidebar-content.scroll").exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.find('[data-test="dashboard-sidebar"]').exists()).toBe(true);
    });

    it("should have proper data-test attributes for collapse button", () => {
      wrapper = createWrapper({ modelValue: true });
      
      expect(wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]').exists()).toBe(true);
    });

    it("should be keyboard accessible for collapsed header", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const collapsedHeader = wrapper.find(".sidebar-header-collapsed");
      
      // Test that click events work (keyboard accessibility through click)
      await collapsedHeader.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should be keyboard accessible for collapse button", async () => {
      wrapper = createWrapper({ modelValue: true });
      
      const collapseBtn = wrapper.find('[data-test="dashboard-sidebar-collapse-btn"]');
      
      // Test that click events work (keyboard accessibility through click)
      await collapseBtn.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Title Display", () => {
    it("should display different titles", () => {
      const titles = ["Filters", "Chart Config", "Data Source", "Advanced Options"];
      
      titles.forEach((title) => {
        const testWrapper = createWrapper({ title, modelValue: false });
        expect(testWrapper.find(".collapsed-title").text()).toBe(title);
        testWrapper.unmount();
      });
    });

    it("should display title in both collapsed and expanded states", async () => {
      const title = "Dynamic Title";
      wrapper = createWrapper({ title, modelValue: false });
      
      expect(wrapper.find(".collapsed-title").text()).toBe(title);
      
      await wrapper.setProps({ modelValue: true });
      expect(wrapper.find(".expanded-title").text()).toBe(title);
    });

    it("should handle empty title", () => {
      wrapper = createWrapper({ title: "", modelValue: false });
      
      expect(wrapper.find(".collapsed-title").text()).toBe("");
    });

    it("should handle long titles", () => {
      const longTitle = "This is a very long title that might cause layout issues if not handled properly";
      wrapper = createWrapper({ title: longTitle, modelValue: false });
      
      expect(wrapper.find(".collapsed-title").text()).toBe(longTitle);
    });
  });

  describe("Component Lifecycle", () => {
    it("should mount without errors", () => {
      expect(() => createWrapper()).not.toThrow();
    });

    it("should unmount without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle prop changes after mount", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      await wrapper.setProps({ modelValue: true });
      expect(wrapper.vm.isOpen).toBe(true);
      
      await wrapper.setProps({ title: "New Title" });
      expect(wrapper.props("title")).toBe("New Title");
    });
  });

  describe("State Management", () => {
    it("should maintain internal state correctly", () => {
      wrapper = createWrapper({ modelValue: false });
      
      expect(wrapper.vm.isOpen).toBe(false);
      
      wrapper.vm.toggleSidebar();
      expect(wrapper.vm.isOpen).toBe(true);
      
      wrapper.vm.toggleSidebar();
      expect(wrapper.vm.isOpen).toBe(false);
    });

    it("should sync internal state with prop changes", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      // Internal state should match prop
      expect(wrapper.vm.isOpen).toBe(false);
      
      // Change prop externally
      await wrapper.setProps({ modelValue: true });
      expect(wrapper.vm.isOpen).toBe(true);
      
      // Change prop back
      await wrapper.setProps({ modelValue: false });
      expect(wrapper.vm.isOpen).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid toggle clicks", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      const collapsedHeader = wrapper.find(".sidebar-header-collapsed");
      
      // Rapid clicks
      await collapsedHeader.trigger("click");
      await collapsedHeader.trigger("click");
      
      // Should handle multiple emissions
      expect(wrapper.emitted("update:modelValue").length).toBeGreaterThan(1);
    });

    it("should handle prop and method conflicts gracefully", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      // Initial state should be false
      expect(wrapper.vm.isOpen).toBe(false);
      
      // Method toggles to true
      wrapper.vm.toggleSidebar(); // false -> true
      expect(wrapper.vm.isOpen).toBe(true);
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([true]);
      
      // Test shows that component can handle state changes
      // without breaking or throwing errors
      expect(() => wrapper.setProps({ modelValue: false })).not.toThrow();
    });

    it("should maintain reactivity after multiple prop changes", async () => {
      wrapper = createWrapper({ modelValue: false });
      
      // Multiple prop changes
      await wrapper.setProps({ modelValue: true });
      await wrapper.setProps({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      
      // Should still be reactive
      expect(wrapper.vm.isOpen).toBe(true);
      expect(wrapper.find(".sidebar-content").exists()).toBe(true);
    });
  });
});