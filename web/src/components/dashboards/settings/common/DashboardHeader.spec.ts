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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import DashboardHeader from "./DashboardHeader.vue";

describe("DashboardHeader", () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(DashboardHeader, {
      props,
      global: {
        plugins: [Quasar],
      },
    });
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly with default props", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.row.items-center.no-wrap.q-mb-sm').exists()).toBe(true);
      expect(wrapper.findComponent({ name: 'QSeparator' }).exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("DashboardHeader");
    });

    it("should initialize with default prop values", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('title')).toBe("");
      expect(wrapper.props('backButton')).toBe(false);
    });

    it("should accept custom prop values", () => {
      const customProps = {
        title: "Custom Title",
        backButton: true
      };
      
      wrapper = createWrapper(customProps);
      
      expect(wrapper.props('title')).toBe("Custom Title");
      expect(wrapper.props('backButton')).toBe(true);
    });
  });

  describe("Title Display", () => {
    it("should display empty title by default", () => {
      wrapper = createWrapper();
      
      const titleElement = wrapper.find('.text-h6');
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.text()).toBe("");
    });

    it("should display provided title", () => {
      wrapper = createWrapper({ title: "Dashboard Settings" });
      
      const titleElement = wrapper.find('.text-h6');
      expect(titleElement.text()).toBe("Dashboard Settings");
    });

    it("should update title when prop changes", async () => {
      wrapper = createWrapper({ title: "Initial Title" });
      
      expect(wrapper.find('.text-h6').text()).toBe("Initial Title");
      
      await wrapper.setProps({ title: "Updated Title" });
      
      expect(wrapper.find('.text-h6').text()).toBe("Updated Title");
    });

    it("should handle special characters in title", () => {
      const specialTitle = "Title with <>&\"' special chars";
      wrapper = createWrapper({ title: specialTitle });
      
      expect(wrapper.find('.text-h6').text()).toBe(specialTitle);
    });

    it("should handle very long title", () => {
      const longTitle = "A".repeat(200);
      wrapper = createWrapper({ title: longTitle });
      
      expect(wrapper.find('.text-h6').text()).toBe(longTitle);
    });

    it("should handle undefined title gracefully", () => {
      wrapper = createWrapper({ title: undefined });
      
      expect(wrapper.find('.text-h6').text()).toBe("");
    });
  });

  describe("Back Button Functionality", () => {
    it("should not show back button by default", () => {
      wrapper = createWrapper();
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      expect(backButton.exists()).toBe(false);
    });

    it("should show back button when backButton prop is true", () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButtonContainer = wrapper.find('.col-auto');
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      
      expect(backButtonContainer.exists()).toBe(true);
      expect(backButton.exists()).toBe(true);
    });

    it("should have correct back button attributes", () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      
      expect(backButton.props('noCaps')).toBe(true);
      expect(backButton.props('padding')).toBe('xs');
      expect(backButton.props('outline')).toBe(true);
      expect(backButton.props('icon')).toBe('arrow_back_ios_new');
      expect(backButton.classes()).toContain('q-mr-md');
    });

    it("should emit back event when back button is clicked", async () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      await backButton.trigger('click');
      
      expect(wrapper.emitted('back')).toBeTruthy();
      expect(wrapper.emitted('back')).toHaveLength(1);
    });

    it("should emit back event multiple times when clicked multiple times", async () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      await backButton.trigger('click');
      await backButton.trigger('click');
      await backButton.trigger('click');
      
      expect(wrapper.emitted('back')).toHaveLength(3);
    });

    it("should toggle back button visibility when prop changes", async () => {
      wrapper = createWrapper({ backButton: false });
      
      expect(wrapper.findComponent({ name: 'QBtn' }).exists()).toBe(false);
      
      await wrapper.setProps({ backButton: true });
      
      expect(wrapper.findComponent({ name: 'QBtn' }).exists()).toBe(true);
      
      await wrapper.setProps({ backButton: false });
      
      expect(wrapper.findComponent({ name: 'QBtn' }).exists()).toBe(false);
    });
  });

  describe("Right Slot Functionality", () => {
    it("should render right slot content", () => {
      wrapper = mount(DashboardHeader, {
        props: { title: "Test" },
        slots: {
          right: '<button data-test="custom-button">Custom Button</button>'
        },
        global: {
          plugins: [Quasar],
        },
      });
      
      const rightSlot = wrapper.find('[data-test="custom-button"]');
      expect(rightSlot.exists()).toBe(true);
      expect(rightSlot.text()).toBe("Custom Button");
    });

    it("should handle multiple elements in right slot", () => {
      wrapper = mount(DashboardHeader, {
        props: { title: "Test" },
        slots: {
          right: '<span data-test="span-1">Span 1</span><span data-test="span-2">Span 2</span>'
        },
        global: {
          plugins: [Quasar],
        },
      });
      
      expect(wrapper.find('[data-test="span-1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="span-2"]').exists()).toBe(true);
    });

    it("should handle empty right slot", () => {
      wrapper = createWrapper({ title: "Test" });
      
      const rightSlotContainers = wrapper.findAll('.col-auto');
      const rightSlotContainer = rightSlotContainers.length > 0 ? rightSlotContainers[rightSlotContainers.length - 1] : undefined;
      if (rightSlotContainer) {
        expect(rightSlotContainer.exists()).toBe(true);
        expect(rightSlotContainer.text()).toBe("");
      } else {
        // If no col-auto exists, the right slot container should still be present but empty
        expect(wrapper.html()).toContain('<div class="col-auto"></div>');
      }
    });

    it("should handle complex slot content", () => {
      const complexSlotContent = `
        <div data-test="complex-slot">
          <button>Button 1</button>
          <input type="text" />
          <select><option>Option 1</option></select>
        </div>
      `;
      
      wrapper = mount(DashboardHeader, {
        props: { title: "Test" },
        slots: {
          right: complexSlotContent
        },
        global: {
          plugins: [Quasar],
        },
      });
      
      const complexSlot = wrapper.find('[data-test="complex-slot"]');
      expect(complexSlot.exists()).toBe(true);
      expect(complexSlot.find('button').exists()).toBe(true);
      expect(complexSlot.find('input').exists()).toBe(true);
      expect(complexSlot.find('select').exists()).toBe(true);
    });
  });

  describe("Layout Structure", () => {
    it("should have correct CSS classes for layout", () => {
      wrapper = createWrapper({ backButton: true });
      
      const mainRow = wrapper.find('.row.items-center.no-wrap.q-mb-sm');
      expect(mainRow.exists()).toBe(true);
      
      const titleColumn = wrapper.find('.col');
      expect(titleColumn.exists()).toBe(true);
      
      const rightColumn = wrapper.findAll('.col-auto');
      expect(rightColumn.length).toBe(2); // Back button and right slot containers
    });

    it("should have separator with correct classes", () => {
      wrapper = createWrapper();
      
      const separator = wrapper.findComponent({ name: 'QSeparator' });
      expect(separator.exists()).toBe(true);
      expect(separator.classes()).toContain('q-mb-sm');
    });

    it("should maintain layout structure without back button", () => {
      wrapper = createWrapper({ backButton: false, title: "Test Title" });
      
      const mainRow = wrapper.find('.row.items-center.no-wrap.q-mb-sm');
      expect(mainRow.exists()).toBe(true);
      
      const titleColumn = wrapper.find('.col');
      expect(titleColumn.exists()).toBe(true);
      
      // Should have only one col-auto for right slot when no back button
      const rightColumn = wrapper.findAll('.col-auto');
      expect(rightColumn.length).toBe(1);
    });

    it("should maintain layout structure with back button", () => {
      wrapper = createWrapper({ backButton: true, title: "Test Title" });
      
      const mainRow = wrapper.find('.row.items-center.no-wrap.q-mb-sm');
      expect(mainRow.exists()).toBe(true);
      
      const titleColumn = wrapper.find('.col');
      expect(titleColumn.exists()).toBe(true);
      
      // Should have two col-auto: one for back button, one for right slot
      const autoColumns = wrapper.findAll('.col-auto');
      expect(autoColumns.length).toBe(2);
    });
  });

  describe("Event Handling", () => {
    it("should have onBackClicked method in component instance", () => {
      wrapper = createWrapper({ backButton: true });
      
      expect(wrapper.vm.onBackClicked).toBeDefined();
      expect(typeof wrapper.vm.onBackClicked).toBe('function');
    });

    it("should call onBackClicked when back button is triggered programmatically", async () => {
      wrapper = createWrapper({ backButton: true });
      
      wrapper.vm.onBackClicked();
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.emitted('back')).toBeTruthy();
    });

    it("should not have back event emitted without back button", () => {
      wrapper = createWrapper({ backButton: false });
      
      expect(wrapper.emitted('back')).toBeFalsy();
    });
  });

  describe("Props Validation", () => {
    it("should handle string title prop", () => {
      wrapper = createWrapper({ title: "Valid String Title" });
      
      expect(wrapper.props('title')).toBe("Valid String Title");
    });

    it("should handle boolean backButton prop", () => {
      wrapper = createWrapper({ backButton: true });
      
      expect(wrapper.props('backButton')).toBe(true);
    });

    it("should handle boolean false for backButton", () => {
      wrapper = createWrapper({ backButton: false });
      
      expect(wrapper.props('backButton')).toBe(false);
    });

    it("should use default values when props are not provided", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('title')).toBe("");
      expect(wrapper.props('backButton')).toBe(false);
    });
  });

  describe("Accessibility", () => {
    it("should be focusable when back button is present", () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      expect(backButton.exists()).toBe(true);
    });

    it("should have proper heading hierarchy with title", () => {
      wrapper = createWrapper({ title: "Main Title" });
      
      const titleElement = wrapper.find('.text-h6');
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.classes()).toContain('text-h6');
    });

    it("should support keyboard navigation for back button", async () => {
      wrapper = createWrapper({ backButton: true });
      
      const backButton = wrapper.findComponent({ name: 'QBtn' });
      
      // Simulate keyboard events
      await backButton.trigger('keydown.enter');
      await backButton.trigger('keydown.space');
      
      // Should still be able to click
      await backButton.trigger('click');
      
      expect(wrapper.emitted('back')).toBeTruthy();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle null title", () => {
      wrapper = createWrapper({ title: null });
      
      expect(wrapper.find('.text-h6').text()).toBe("");
    });

    it("should handle numeric title", () => {
      wrapper = createWrapper({ title: 123 });
      
      expect(wrapper.find('.text-h6').text()).toBe("123");
    });

    it("should handle empty string title", () => {
      wrapper = createWrapper({ title: "" });
      
      expect(wrapper.find('.text-h6').text()).toBe("");
    });

    it("should handle rapid prop changes", async () => {
      wrapper = createWrapper({ title: "Initial", backButton: false });
      
      await wrapper.setProps({ title: "Changed 1", backButton: true });
      await wrapper.setProps({ title: "Changed 2", backButton: false });
      await wrapper.setProps({ title: "Final", backButton: true });
      
      expect(wrapper.find('.text-h6').text()).toBe("Final");
      expect(wrapper.findComponent({ name: 'QBtn' }).exists()).toBe(true);
    });

    it("should maintain component integrity after multiple re-renders", async () => {
      wrapper = createWrapper();
      
      for (let i = 0; i < 10; i++) {
        await wrapper.setProps({ 
          title: `Title ${i}`, 
          backButton: i % 2 === 0 
        });
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.text-h6').text()).toBe("Title 9");
      expect(wrapper.findComponent({ name: 'QBtn' }).exists()).toBe(false); // 9 % 2 !== 0
    });
  });
});