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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AlertsContainer from "./AlertsContainer.vue";
import { createStore } from "vuex";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates a mock Vuex store
 */
function createMockStore(theme = "light") {
  return createStore({
    state: {
      theme,
    },
  });
}

/**
 * Creates mock props for AlertsContainer
 */
function createMockProps(overrides = {}) {
  return {
    name: "test-container",
    label: "Test Container",
    subLabel: "",
    isExpandable: true,
    isExpanded: false,
    icon: "edit",
    image: "",
    iconClass: "",
    labelClass: "",
    ...overrides,
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Finds an element by data-test attribute
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  return findByTestId(wrapper, testId).exists();
}

/**
 * Clicks the header to toggle expansion
 */
async function clickHeader(wrapper: VueWrapper) {
  const header = findByTestId(wrapper, "alerts-container-header");
  await header.trigger("click");
  await flushPromises();
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}, theme = "light", slots = {}) {
  const store = createMockStore(theme);
  const defaultProps = createMockProps(props);

  return mount(AlertsContainer, {
    props: defaultProps,
    global: {
      plugins: [store],
    },
    slots,
  });
}

// ==================== TESTS ====================

describe("AlertsContainer", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "alerts-container")).toBe(true);
    });

    it("should render header section", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "alerts-container-header")).toBe(true);
    });

    it("should render label wrapper", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "container-label-wrapper")).toBe(true);
    });

    it("should render expand toggle icon", () => {
      wrapper = mountComponent();
      expect(existsByTestId(wrapper, "expand-toggle-icon")).toBe(true);
    });
  });

  describe("Label Display", () => {
    it("should display main label", () => {
      wrapper = mountComponent({ label: "Destinations" });
      const label = findByTestId(wrapper, "container-label");
      expect(label.text()).toBe("Destinations");
    });

    it("should display sublabel when provided", () => {
      wrapper = mountComponent({
        label: "Main Label",
        subLabel: "Subtitle text",
      });
      const sublabel = findByTestId(wrapper, "container-sublabel");
      expect(sublabel.text()).toBe("Subtitle text");
    });

    it("should render empty sublabel when not provided", () => {
      wrapper = mountComponent({ label: "Label", subLabel: "" });
      const sublabel = findByTestId(wrapper, "container-sublabel");
      expect(sublabel.text()).toBe("");
    });

    it("should update label when prop changes", async () => {
      wrapper = mountComponent({ label: "Initial" });
      await wrapper.setProps({ label: "Updated" });
      const label = findByTestId(wrapper, "container-label");
      expect(label.text()).toBe("Updated");
    });
  });

  describe("Icon Display", () => {
    it("should display icon when no image provided", () => {
      wrapper = mountComponent({ icon: "settings", image: "" });
      expect(existsByTestId(wrapper, "container-icon")).toBe(true);
      expect(existsByTestId(wrapper, "container-image")).toBe(false);
    });

    it("should render correct icon name", () => {
      wrapper = mountComponent({ icon: "notifications" });
      const icon = findByTestId(wrapper, "container-icon");
      expect(icon.attributes("name")).toBe("notifications");
    });

    it("should display image when provided", () => {
      wrapper = mountComponent({ image: "/path/to/image.png", icon: "edit" });
      expect(existsByTestId(wrapper, "container-image")).toBe(true);
      expect(existsByTestId(wrapper, "container-icon")).toBe(false);
    });

    it("should render correct image src", () => {
      wrapper = mountComponent({ image: "/assets/logo.svg" });
      const img = findByTestId(wrapper, "container-image");
      expect(img.attributes("src")).toBe("/assets/logo.svg");
    });

    it("should apply icon class", () => {
      wrapper = mountComponent({
        icon: "edit",
        iconClass: "custom-icon-class",
      });
      const icon = findByTestId(wrapper, "container-icon");
      expect(icon.classes()).toContain("custom-icon-class");
    });

    it("should apply dark mode icon styles", () => {
      wrapper = mountComponent({ icon: "edit" }, "dark");
      const icon = findByTestId(wrapper, "container-icon");
      expect(icon.classes()).toContain("tw:text-gray-100");
      expect(icon.classes()).toContain("tw:bg-gray-600");
    });

    it("should apply light mode icon styles", () => {
      wrapper = mountComponent({ icon: "edit" }, "light");
      const icon = findByTestId(wrapper, "container-icon");
      expect(icon.classes()).toContain("light-mode-icon");
    });
  });

  describe("Expand/Collapse Functionality", () => {
    it("should start collapsed by default", () => {
      wrapper = mountComponent({ isExpanded: false });
      expect(existsByTestId(wrapper, "container-content")).toBe(false);
    });

    it("should start expanded when isExpanded is true", () => {
      wrapper = mountComponent({ isExpanded: true });
      expect(existsByTestId(wrapper, "container-content")).toBe(true);
    });

    it("should emit update:isExpanded when header is clicked", async () => {
      wrapper = mountComponent({ isExpanded: false });
      await clickHeader(wrapper);

      expect(wrapper.emitted("update:isExpanded")).toBeTruthy();
      expect(wrapper.emitted("update:isExpanded")?.[0]).toEqual([true]);
    });

    it("should toggle from collapsed to expanded", async () => {
      wrapper = mountComponent({ isExpanded: false });
      await clickHeader(wrapper);

      expect(wrapper.emitted("update:isExpanded")?.[0]).toEqual([true]);
    });

    it("should toggle from expanded to collapsed", async () => {
      wrapper = mountComponent({ isExpanded: true });
      await clickHeader(wrapper);

      expect(wrapper.emitted("update:isExpanded")?.[0]).toEqual([false]);
    });

    it("should show down arrow when collapsed", () => {
      wrapper = mountComponent({ isExpanded: false });
      const icon = findByTestId(wrapper, "expand-toggle-icon");
      expect(icon.attributes("name")).toBe("keyboard_arrow_down");
    });

    it("should show up arrow when expanded", () => {
      wrapper = mountComponent({ isExpanded: true });
      const icon = findByTestId(wrapper, "expand-toggle-icon");
      expect(icon.attributes("name")).toBe("keyboard_arrow_up");
    });

    it("should update toggle icon when expansion changes", async () => {
      wrapper = mountComponent({ isExpanded: false });
      const icon = findByTestId(wrapper, "expand-toggle-icon");
      expect(icon.attributes("name")).toBe("keyboard_arrow_down");

      await wrapper.setProps({ isExpanded: true });
      expect(icon.attributes("name")).toBe("keyboard_arrow_up");
    });

    it("should handle multiple rapid toggles", async () => {
      wrapper = mountComponent({ isExpanded: false });

      await clickHeader(wrapper);
      await wrapper.setProps({ isExpanded: true });

      await clickHeader(wrapper);
      await wrapper.setProps({ isExpanded: false });

      await clickHeader(wrapper);

      expect(wrapper.emitted("update:isExpanded")?.length).toBe(3);
    });
  });

  describe("Slot Content", () => {
    it("should render slot content when expanded", () => {
      wrapper = mountComponent(
        { isExpanded: true },
        "light",
        { default: '<div class="test-content">Slot Content</div>' }
      );

      expect(existsByTestId(wrapper, "container-content")).toBe(true);
      expect(wrapper.html()).toContain("Slot Content");
    });

    it("should not render slot content when collapsed", () => {
      wrapper = mountComponent(
        { isExpanded: false },
        "light",
        { default: '<div class="test-content">Slot Content</div>' }
      );

      expect(existsByTestId(wrapper, "container-content")).toBe(false);
      expect(wrapper.html()).not.toContain("Slot Content");
    });

    it("should show/hide slot content on toggle", async () => {
      wrapper = mountComponent(
        { isExpanded: false },
        "light",
        { default: '<div class="test-content">Dynamic Content</div>' }
      );

      expect(wrapper.html()).not.toContain("Dynamic Content");

      await wrapper.setProps({ isExpanded: true });
      await flushPromises();

      expect(wrapper.html()).toContain("Dynamic Content");
    });
  });

  describe("Theme Support", () => {
    it("should apply dark mode styles to toggle icon", () => {
      wrapper = mountComponent({ isExpanded: false }, "dark");
      const icon = findByTestId(wrapper, "expand-toggle-icon");
      expect(icon.classes()).toContain("tw:text-gray-100");
      expect(icon.classes()).toContain("tw:bg-gray-600");
    });

    it("should apply light mode styles to toggle icon", () => {
      wrapper = mountComponent({ isExpanded: false }, "light");
      const icon = findByTestId(wrapper, "expand-toggle-icon");
      expect(icon.classes()).toContain("tw:text-gray-900");
      expect(icon.classes()).toContain("tw:bg-gray-300");
    });

    it("should apply dark mode styles to sublabel", () => {
      wrapper = mountComponent({ subLabel: "Test" }, "dark");
      const sublabel = findByTestId(wrapper, "container-sublabel");
      expect(sublabel.classes()).toContain("tw:text-[#c6c6c6]");
    });

    it("should apply light mode styles to sublabel", () => {
      wrapper = mountComponent({ subLabel: "Test" }, "light");
      const sublabel = findByTestId(wrapper, "container-sublabel");
      expect(sublabel.classes()).toContain("tw:text-gray-900");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long labels", () => {
      const longLabel = "A".repeat(500);
      wrapper = mountComponent({ label: longLabel });
      const label = findByTestId(wrapper, "container-label");
      expect(label.text()).toBe(longLabel);
    });

    it("should handle labels with special characters", () => {
      const specialLabel = "Label <>&\"' Special";
      wrapper = mountComponent({ label: specialLabel });
      const label = findByTestId(wrapper, "container-label");
      expect(label.text()).toBe(specialLabel);
    });

    it("should handle empty icon", () => {
      wrapper = mountComponent({ icon: "" });
      const icon = findByTestId(wrapper, "container-icon");
      expect(icon.exists()).toBe(true);
      expect(icon.attributes("name")).toBe("");
    });

    it("should handle invalid image path gracefully", () => {
      wrapper = mountComponent({ image: "/invalid/path.png" });
      const img = findByTestId(wrapper, "container-image");
      expect(img.exists()).toBe(true);
    });

    it("should handle both icon and image classes", () => {
      wrapper = mountComponent({
        image: "/test.png",
        iconClass: "custom-class",
      });
      const img = findByTestId(wrapper, "container-image");
      expect(img.classes()).toContain("custom-class");
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete user interaction flow", async () => {
      wrapper = mountComponent(
        {
          label: "My Section",
          subLabel: "Click to expand",
          isExpanded: false,
        },
        "light",
        { default: '<div>Hidden Content</div>' }
      );

      // Verify initial state
      expect(findByTestId(wrapper, "container-label").text()).toBe("My Section");
      expect(existsByTestId(wrapper, "container-content")).toBe(false);

      // User clicks to expand
      await clickHeader(wrapper);
      expect(wrapper.emitted("update:isExpanded")?.[0]).toEqual([true]);

      // Simulate parent updating prop
      await wrapper.setProps({ isExpanded: true });
      expect(existsByTestId(wrapper, "container-content")).toBe(true);

      // User clicks to collapse
      await clickHeader(wrapper);
      expect(wrapper.emitted("update:isExpanded")?.[1]).toEqual([false]);
    });

    it("should handle v-model pattern correctly", async () => {
      wrapper = mountComponent({ isExpanded: false });

      // Parent updates v-model
      await wrapper.setProps({ isExpanded: true });
      expect(existsByTestId(wrapper, "container-content")).toBe(true);

      // Component emits update
      await clickHeader(wrapper);
      expect(wrapper.emitted("update:isExpanded")).toBeTruthy();

      // Parent syncs state
      await wrapper.setProps({ isExpanded: false });
      expect(existsByTestId(wrapper, "container-content")).toBe(false);
    });

    it("should maintain state across theme changes", async () => {
      const store = createMockStore("light");
      wrapper = mount(AlertsContainer, {
        props: createMockProps({ isExpanded: true }),
        global: { plugins: [store] },
      });

      expect(existsByTestId(wrapper, "container-content")).toBe(true);

      // Change theme
      store.state.theme = "dark";
      await flushPromises();

      // State should remain
      expect(existsByTestId(wrapper, "container-content")).toBe(true);
    });
  });
});
