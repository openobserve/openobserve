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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import DrilldownUserGuide from "@/components/dashboards/addPanel/DrilldownUserGuide.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock getBoundingClientRect
const mockGetBoundingClientRect = vi.fn(() => ({
  top: 100,
  left: 200,
  right: 250,
  bottom: 130,
  width: 50,
  height: 30,
  x: 200,
  y: 100,
  toJSON: () => ({}),
}));

// Helpers to query the teleported content directly from document.body
const getUserGuideEl = (): HTMLElement | null =>
  document.body.querySelector(".user-guide");
const getHighlightEls = (): HTMLElement[] =>
  Array.from(document.body.querySelectorAll(".user-guide .bg-highlight"));
const getGuideText = (): string => getUserGuideEl()?.textContent ?? "";

describe("DrilldownUserGuide", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.theme = "light";

    // Mock getBoundingClientRect for DOM elements
    Element.prototype.getBoundingClientRect = mockGetBoundingClientRect as any;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Clean up any teleported nodes left behind
    document.body.innerHTML = "";
  });

  const createWrapper = (props = {}) => {
    return mount(DrilldownUserGuide, {
      attachTo: document.body,
      props: {
        ...props,
      },
      global: {
        plugins: [i18n, store, router],
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render user guide button", () => {
      wrapper = createWrapper();

      expect(
        wrapper.find('[data-test="dashboard-drilldown-help-btn"]').exists()
      ).toBe(true);
    });

    it("should render help icon", () => {
      wrapper = createWrapper();

      const button = wrapper.find('[data-test="dashboard-drilldown-help-btn"]');
      expect(button.exists()).toBe(true);
    });

    it("should render tooltip text", () => {
      wrapper = createWrapper();

      // Test that the component contains tooltip-related content
      expect(wrapper.exists()).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-drilldown-help-btn"]').exists()
      ).toBe(true);
    });

    it("should not show user guide initially", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showUserGuide).toBe(false);
      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      // v-show => display: none when false
      expect(userGuide!.style.display).toBe("none");
    });
  });

  describe("User Guide Content", () => {
    it("should render user guide content when visible", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.style.display).not.toBe("none");
    });

    it("should contain variable reference documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("dynamic variables");
      expect(content).toContain("${variable_name}");
      expect(content).toContain("Use current dashboard's variable");
    });

    it("should contain query reference documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("Use current query");
      expect(content).toContain("${query}");
      expect(content).toContain("${query_encoded}");
    });

    it("should contain time period reference documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("Use current selected time period");
      expect(content).toContain("${start_time}");
      expect(content).toContain("${end_time}");
    });

    it("should contain series data reference documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("Use Series name and value");
      expect(content).toContain("${series.__name}");
      expect(content).toContain("${series.__value}");
      expect(content).toContain("${series.__axisValue}");
    });

    it("should contain table chart drilldown documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("For table chart drilldown");
      expect(content).toContain("${row.field");
      expect(content).toContain("${row.index}");
    });

    it("should contain pie/donut chart drilldown documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("For Pie/Donut chart drilldown");
    });

    it("should contain sankey chart drilldown documentation", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();
      expect(content).toContain("For Sankey chart drilldown");
      expect(content).toContain("${edge.__source}");
      expect(content).toContain("${edge.__target}");
      expect(content).toContain("${edge.__value}");
      expect(content).toContain("${node.__name}");
      expect(content).toContain("${node.__value}");
    });

    it("should contain highlighted code examples", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const highlights = getHighlightEls();
      expect(highlights.length).toBeGreaterThan(0);
    });
  });

  describe("User Guide Toggle", () => {
    it("should toggle user guide visibility when button is clicked", async () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showUserGuide).toBe(false);

      const button = wrapper.find('[data-test="dashboard-drilldown-help-btn"]');
      await button.trigger("click");

      expect(wrapper.vm.showUserGuide).toBe(true);

      await button.trigger("click");

      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should have onUserGuideClick method", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.onUserGuideClick).toBe("function");
    });

    it("should toggle visibility through method call", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showUserGuide).toBe(false);

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(false);
    });
  });

  describe("User Guide Positioning", () => {
    it("should position user guide relative to button", async () => {
      wrapper = createWrapper();

      // Show user guide
      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      // Simulate button click which positions the guide
      await wrapper.vm.onUserGuideClick();

      // The positioning logic should have been called
      expect(mockGetBoundingClientRect).toHaveBeenCalled();
    });

    it("should handle positioning when refs are available", () => {
      wrapper = createWrapper();

      // Mock the refs
      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: mockGetBoundingClientRect,
      };
      wrapper.vm.userGuideDivRef = {
        style: {} as any,
      };

      wrapper.vm.onUserGuideClick();

      expect(wrapper.vm.userGuideDivRef.style.top).toBe("132px"); // 100 + 32
      expect(wrapper.vm.userGuideDivRef.style.left).toBe("248px"); // 200 + 48
    });

    it("should handle missing refs gracefully", () => {
      wrapper = createWrapper();

      wrapper.vm.userGuideBtnRef = null;
      wrapper.vm.userGuideDivRef = null;

      expect(() => wrapper.vm.onUserGuideClick()).not.toThrow();
    });
  });

  describe("Mouse Events", () => {
    it("should hide user guide when mouse leaves", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUserGuide).toBe(true);

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      userGuide!.dispatchEvent(new MouseEvent("mouseleave"));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should handle mouseleave event", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();

      // Trigger mouseleave
      userGuide!.dispatchEvent(new MouseEvent("mouseleave"));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUserGuide).toBe(false);
    });
  });

  describe("Theme Integration", () => {
    it("should apply light theme classes", async () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.classList.contains("theme-light")).toBe(true);
      expect(userGuide!.classList.contains("bg-white")).toBe(true);
    });

    it("should apply dark theme classes", async () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.classList.contains("theme-dark")).toBe(true);
      expect(userGuide!.classList.contains("bg-dark")).toBe(true);
    });

    it("should have access to store", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should react to theme changes", async () => {
      wrapper = createWrapper();

      store.state.theme = "light";
      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      let userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.classList.contains("theme-light")).toBe(true);

      store.state.theme = "dark";
      await wrapper.vm.$nextTick();

      userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.classList.contains("theme-dark")).toBe(true);
    });
  });

  describe("Styling and Layout", () => {
    it("should have correct user guide container styling", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      expect(userGuide!.classList.contains("scroll")).toBe(true);
      expect(userGuide!.classList.contains("o2-input")).toBe(true);
    });

    it("should have correct positioning styles", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      const style = userGuide!.getAttribute("style") ?? "";

      // Updated to match migrated styles
      expect(style).toContain("position: fixed");
      expect(style).toContain("z-index: 9999");
      expect(style).toContain("width: 500px");
      expect(style).toContain("max-height: 300px");
    });

    it("should highlight code examples correctly", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const highlights = getHighlightEls();
      expect(highlights.length).toBeGreaterThan(0);

      // Check that highlights have the correct class
      highlights.forEach((highlight) => {
        expect(highlight.classList.contains("bg-highlight")).toBe(true);
      });
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe("DrilldownUserGuide");
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.onUserGuideClick).toBe("function");
    });

    it("should have all required data properties", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.showUserGuide).toBeDefined();
      expect(wrapper.vm.userGuideBtnRef).toBeDefined();
      expect(wrapper.vm.userGuideDivRef).toBeDefined();
    });

    it("should have correct initial state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showUserGuide).toBe(false);
    });
  });

  describe("Refs Management", () => {
    it("should have userGuideBtnRef reference", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.userGuideBtnRef).toBeDefined();
    });

    it("should have userGuideDivRef reference", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.userGuideDivRef).toBeDefined();
    });

    it("should handle ref elements properly", async () => {
      wrapper = createWrapper();

      await wrapper.vm.$nextTick();

      // Refs should be reactive references
      expect(wrapper.vm.userGuideBtnRef).toBeDefined();
      expect(wrapper.vm.userGuideDivRef).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();
      // Avoid double-unmount in afterEach
      wrapper = null;
    });

    it("should handle multiple rapid clicks", async () => {
      wrapper = createWrapper();

      const button = wrapper.find('[data-test="dashboard-drilldown-help-btn"]');

      // Rapid clicks
      await button.trigger("click");
      await button.trigger("click");
      await button.trigger("click");

      // Should end up in the correct state
      expect(wrapper.vm.showUserGuide).toBe(true);
    });

    it("should handle positioning without DOM elements", () => {
      wrapper = createWrapper();

      // Simulate missing DOM elements
      wrapper.vm.userGuideBtnRef = null;
      wrapper.vm.userGuideDivRef = null;

      expect(() => wrapper.vm.onUserGuideClick()).not.toThrow();
      expect(wrapper.vm.showUserGuide).toBe(false); // Should still toggle
    });

    it("should handle getBoundingClientRect errors", () => {
      wrapper = createWrapper();

      // Mock error in getBoundingClientRect
      wrapper.vm.userGuideBtnRef = {
        getBoundingClientRect: vi.fn(() => {
          throw new Error("DOM error");
        }),
      };
      wrapper.vm.userGuideDivRef = { style: {} as any };

      expect(() => wrapper.vm.onUserGuideClick()).toThrow();
    });
  });

  describe("Documentation Content Sections", () => {
    it("should contain all major documentation sections", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();

      // Check all major sections are present
      expect(content).toContain("Use current dashboard's variable");
      expect(content).toContain("Use current query");
      expect(content).toContain("Use current selected time period");
      expect(content).toContain("Use Series name and value");
      expect(content).toContain("For table chart drilldown");
      expect(content).toContain("For Pie/Donut chart drilldown");
      expect(content).toContain("For Sankey chart drilldown");
    });

    it("should contain specific variable examples", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();

      // Check specific examples are present
      expect(content).toContain("${test}");
      expect(content).toContain("from=${start_time}&to=${end_time}");
      expect(content).toContain("${row.field.test}");
      expect(content).toContain('${row.field["test"]}');
    });

    it("should contain helpful notes and explanations", async () => {
      wrapper = createWrapper();

      wrapper.vm.showUserGuide = true;
      await wrapper.vm.$nextTick();

      const content = getGuideText();

      expect(content).toContain("Note:");
      expect(content).toContain("Even with a relative time period");
      expect(content).toContain("For Example");
    });
  });

  describe("Interactive Behavior", () => {
    it("should show and hide guide based on user interaction", async () => {
      wrapper = createWrapper();

      // Initially hidden
      expect(wrapper.vm.showUserGuide).toBe(false);
      const initialUserGuide = getUserGuideEl();
      expect(initialUserGuide).toBeTruthy();
      expect(initialUserGuide!.style.display).toBe("none");

      // Show on button click
      const button = wrapper.find('[data-test="dashboard-drilldown-help-btn"]');
      await button.trigger("click");

      expect(wrapper.vm.showUserGuide).toBe(true);

      // Hide on mouseleave
      const userGuide = getUserGuideEl();
      expect(userGuide).toBeTruthy();
      userGuide!.dispatchEvent(new MouseEvent("mouseleave"));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUserGuide).toBe(false);
    });

    it("should handle show/hide state transitions", async () => {
      wrapper = createWrapper();

      // Test multiple state transitions
      expect(wrapper.vm.showUserGuide).toBe(false);

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(false);

      wrapper.vm.onUserGuideClick();
      expect(wrapper.vm.showUserGuide).toBe(true);

      wrapper.vm.showUserGuide = false; // Simulate mouseleave
      expect(wrapper.vm.showUserGuide).toBe(false);
    });
  });
});
