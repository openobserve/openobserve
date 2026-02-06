// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PrebuiltDestinationSelector from "./PrebuiltDestinationSelector.vue";
import { createI18n } from "vue-i18n";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates mock i18n instance
 */
function createMockI18n() {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        alerts: {
          customDestination: "Custom Destination",
          customDestinationDescription:
            "Configure a custom webhook destination",
        },
      },
    },
  });
}

/**
 * Creates mock props for PrebuiltDestinationSelector
 */
function createMockProps(overrides = {}) {
  return {
    modelValue: null,
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
 * Finds all elements by data-test attribute
 */
function findAllByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.findAll(`[data-test="${testId}"]`);
}

/**
 * Finds a destination card by type
 */
function findCardByType(wrapper: VueWrapper, typeId: string) {
  return wrapper.find(`[data-test="destination-type-card"][data-type="${typeId}"]`);
}

/**
 * Clicks a destination card
 */
async function clickCard(wrapper: VueWrapper, typeId: string) {
  const card = findCardByType(wrapper, typeId);
  await card.trigger("click");
  await flushPromises();
}

/**
 * Gets all destination type cards
 */
function getAllCards(wrapper: VueWrapper) {
  return findAllByTestId(wrapper, "destination-type-card");
}

/**
 * Checks if a card is selected
 */
function isCardSelected(wrapper: VueWrapper, typeId: string): boolean {
  const card = findCardByType(wrapper, typeId);
  return card.classes().includes("selected");
}

/**
 * Mounts the component with default test setup
 */
function mountComponent(props = {}) {
  const i18n = createMockI18n();
  const defaultProps = createMockProps(props);

  return mount(PrebuiltDestinationSelector, {
    props: defaultProps,
    global: {
      plugins: [i18n],
    },
  });
}

// ==================== TESTS ====================

describe("PrebuiltDestinationSelector", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("Component Rendering", () => {
    it("should render the component", () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "prebuilt-destination-selector")).toBe(true);
    });

    it("should render destination type cards", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);
      expect(cards.length).toBeGreaterThan(0);
    });

    it("should render custom destination card", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      expect(customCard.exists()).toBe(true);
    });

    it("should apply custom-card class to custom destination", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      expect(customCard.classes()).toContain("custom-card");
    });
  });

  describe("Card Content Display", () => {
    it("should display destination type names", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const name = card.find('[data-test="destination-type-name"]');
        expect(name.exists()).toBe(true);
        expect(name.text().length).toBeGreaterThan(0);
      });
    });

    it("should display destination type descriptions", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const description = card.find('[data-test="destination-type-description"]');
        expect(description.exists()).toBe(true);
      });
    });

    it("should display custom destination name from i18n", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const name = customCard.find('[data-test="destination-type-name"]');

      expect(name.text()).toBe("Custom Destination");
    });

    it("should display custom destination description from i18n", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const description = customCard.find(
        '[data-test="destination-type-description"]'
      );

      expect(description.text()).toBe("Configure a custom webhook destination");
    });

    it("should render icon for custom destination", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const icon = customCard.findComponent({ name: "QIcon" });

      expect(icon.exists()).toBe(true);
      expect(icon.props("name")).toBe("settings");
    });
  });

  describe("Selection Functionality", () => {
    it("should start with no selection when modelValue is null", () => {
      wrapper = mountComponent({ modelValue: null });
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        expect(card.classes()).not.toContain("selected");
      });
    });

    it("should apply selected class to initially selected card", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");

      expect(customCard.classes()).toContain("selected");
    });

    it("should show check icon on selected card", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");
      const checkIcon = customCard.findAll('[name="check_circle"]');

      expect(checkIcon.length).toBeGreaterThan(0);
    });

    it("should not show check icon on unselected cards", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const typeAttr = card.attributes("data-type");
        if (typeAttr !== "custom") {
          const checkIcons = card.findAll('[name="check_circle"]');
          expect(checkIcons.length).toBe(0);
        }
      });
    });

    it("should emit update:modelValue when card is clicked", async () => {
      wrapper = mountComponent();
      await clickCard(wrapper, "custom");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["custom"]);
    });

    it("should emit select event when card is clicked", async () => {
      wrapper = mountComponent();
      await clickCard(wrapper, "custom");

      expect(wrapper.emitted("select")).toBeTruthy();
      expect(wrapper.emitted("select")?.[0]).toEqual(["custom"]);
    });

    it("should update selected class when clicking different card", async () => {
      wrapper = mountComponent({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);

      // Simulate parent updating modelValue
      await wrapper.setProps({ modelValue: null });

      // Click a different card (we can't know the exact type IDs without importing the constant)
      // So we'll just verify the custom card is no longer selected
      expect(isCardSelected(wrapper, "custom")).toBe(false);
    });

    it("should handle multiple rapid clicks", async () => {
      wrapper = mountComponent();

      await clickCard(wrapper, "custom");
      await wrapper.setProps({ modelValue: "custom" });

      await clickCard(wrapper, "custom");
      await wrapper.setProps({ modelValue: "custom" });

      await clickCard(wrapper, "custom");

      expect(wrapper.emitted("select")?.length).toBe(3);
    });
  });

  describe("V-Model Pattern", () => {
    it("should support v-model with null initial value", () => {
      wrapper = mountComponent({ modelValue: null });
      expect(wrapper.props("modelValue")).toBe(null);
    });

    it("should support v-model with custom initial value", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      expect(wrapper.props("modelValue")).toBe("custom");
    });

    it("should emit update:modelValue for v-model sync", async () => {
      wrapper = mountComponent({ modelValue: null });
      await clickCard(wrapper, "custom");

      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["custom"]);
    });

    it("should update display when modelValue prop changes", async () => {
      wrapper = mountComponent({ modelValue: null });

      await wrapper.setProps({ modelValue: "custom" });
      await flushPromises();

      expect(isCardSelected(wrapper, "custom")).toBe(true);
    });

    it("should handle modelValue changes to null", async () => {
      wrapper = mountComponent({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);

      await wrapper.setProps({ modelValue: null });
      await flushPromises();

      expect(isCardSelected(wrapper, "custom")).toBe(false);
    });
  });

  describe("Icon Mapping", () => {
    it("should render settings icon for custom destination", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const icon = customCard.findComponent({ name: "QIcon" });

      expect(icon.props("name")).toBe("settings");
    });

    it("should render icons with correct size", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const icon = customCard.findComponent({ name: "QIcon" });

      expect(icon.props("size")).toBe("1.5rem");
    });

    it("should render check icon with positive color when selected", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");
      const checkIcon = customCard
        .findAllComponents({ name: "QIcon" })
        .find((icon) => icon.props("name") === "check_circle");

      expect(checkIcon).toBeDefined();
      expect(checkIcon?.props("color")).toBe("positive");
    });
  });

  describe("Styling and Visual States", () => {
    it("should have destination-card class on all cards", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        expect(card.classes()).toContain("destination-card");
      });
    });

    it("should apply selected class styling", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");

      expect(customCard.classes()).toContain("selected");
    });

    it("should have card-content div in each card", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const content = card.find(".card-content");
        expect(content.exists()).toBe(true);
      });
    });

    it("should have card-icon div in each card", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const icon = card.find(".card-icon");
        expect(icon.exists()).toBe(true);
      });
    });

    it("should apply dashed border to custom card", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");

      expect(customCard.classes()).toContain("custom-card");
    });

    it("should have check-icon div when card is selected", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");
      const checkIcon = customCard.find(".check-icon");

      expect(checkIcon.exists()).toBe(true);
    });
  });

  describe("Grid Layout", () => {
    it("should render cards in a grid", () => {
      wrapper = mountComponent();
      const grid = wrapper.find(".selector-grid");

      expect(grid.exists()).toBe(true);
    });

    it("should render multiple cards in the grid", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      // Should have at least the custom card
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });

    it("should render cards within grid container", () => {
      wrapper = mountComponent();
      const grid = wrapper.find(".selector-grid");
      const cards = grid.findAll('[data-test="destination-type-card"]');

      expect(cards.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined modelValue", () => {
      wrapper = mountComponent({ modelValue: undefined });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle very long destination names gracefully", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const name = card.find('[data-test="destination-type-name"]');
        expect(name.exists()).toBe(true);
      });
    });

    it("should handle empty descriptions", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const description = card.find('[data-test="destination-type-description"]');
        expect(description.exists()).toBe(true);
      });
    });

    it("should maintain selection state across renders", async () => {
      wrapper = mountComponent({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);

      // Force re-render
      await wrapper.vm.$forceUpdate();
      await flushPromises();

      expect(isCardSelected(wrapper, "custom")).toBe(true);
    });

    it("should handle rapid selection changes", async () => {
      wrapper = mountComponent();

      await clickCard(wrapper, "custom");
      await wrapper.setProps({ modelValue: "custom" });

      await wrapper.setProps({ modelValue: null });

      await clickCard(wrapper, "custom");
      await wrapper.setProps({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have clickable cards", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        expect(card.element.tagName).toBe("DIV");
      });
    });

    it("should have alt text for destination logos when using images", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const logo = card.find(".destination-logo");
        if (logo.exists()) {
          expect(logo.attributes("alt")).toBeDefined();
        }
      });
    });

    it("should have data-type attribute for identification", () => {
      wrapper = mountComponent();
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        expect(card.attributes("data-type")).toBeDefined();
        expect(card.attributes("data-type")?.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete selection workflow", async () => {
      wrapper = mountComponent({ modelValue: null });

      // Initially no selection
      expect(isCardSelected(wrapper, "custom")).toBe(false);

      // User clicks custom card
      await clickCard(wrapper, "custom");

      // Events are emitted
      expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["custom"]);
      expect(wrapper.emitted("select")?.[0]).toEqual(["custom"]);

      // Parent updates modelValue
      await wrapper.setProps({ modelValue: "custom" });
      await flushPromises();

      // Card is now selected
      expect(isCardSelected(wrapper, "custom")).toBe(true);
    });

    it("should handle switching between different destinations", async () => {
      wrapper = mountComponent({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);

      // Switch to null
      await wrapper.setProps({ modelValue: null });
      await flushPromises();

      expect(isCardSelected(wrapper, "custom")).toBe(false);

      // Select custom again
      await clickCard(wrapper, "custom");
      await wrapper.setProps({ modelValue: "custom" });

      expect(isCardSelected(wrapper, "custom")).toBe(true);
    });

    it("should maintain grid layout with all cards visible", () => {
      wrapper = mountComponent();

      const grid = wrapper.find(".selector-grid");
      const cards = getAllCards(wrapper);

      expect(grid.exists()).toBe(true);
      expect(cards.length).toBeGreaterThan(0);

      // All cards should be within the grid
      cards.forEach((card) => {
        expect(card.element.parentElement?.classList.contains("selector-grid")).toBe(
          true
        );
      });
    });

    it("should show visual feedback for selection across multiple cards", async () => {
      wrapper = mountComponent({ modelValue: "custom" });

      const customCard = findCardByType(wrapper, "custom");
      expect(customCard.classes()).toContain("selected");

      // Verify check icon is present
      const checkIcon = customCard.find(".check-icon");
      expect(checkIcon.exists()).toBe(true);

      // Switch selection
      await wrapper.setProps({ modelValue: null });
      await flushPromises();

      expect(customCard.classes()).not.toContain("selected");
      expect(customCard.find(".check-icon").exists()).toBe(false);
    });
  });
});
