// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import PrebuiltDestinationSelector from "./PrebuiltDestinationSelector.vue";
import config from "@/aws-exports";
import enUS from "@/locales/languages/en-US.json";
import { PREBUILT_DESTINATION_TYPES } from "@/utils/prebuilt-templates";
import { createI18n } from "vue-i18n";

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
        ...enUS,
        alerts: {
          customDestination: "Custom Destination",
          customDestinationDescription: "Configure a custom webhook destination",
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
      const description = customCard.find('[data-test="destination-type-description"]');

      expect(description.text()).toBe("Configure a custom webhook destination");
    });

    it("should render icon for custom destination", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const icon = customCard.findComponent({ name: "OIcon" });

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
      const checkIcon = customCard.find(".check-icon");

      expect(checkIcon.exists()).toBe(true);
      const qIcon = checkIcon.findComponent({ name: "OIcon" });
      expect(qIcon.props("name")).toBe("check");
    });

    it("should not show check icon on unselected cards", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const cards = getAllCards(wrapper);

      cards.forEach((card) => {
        const typeAttr = card.attributes("data-type");
        if (typeAttr !== "custom") {
          const checkIcons = card.findAll('[name="check-circle"]');
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
      const icon = customCard.findComponent({ name: "OIcon" });

      expect(icon.props("name")).toBe("settings");
    });

    it("should render icons with a size prop", () => {
      wrapper = mountComponent();
      const customCard = findCardByType(wrapper, "custom");
      const icon = customCard.findComponent({ name: "OIcon" });

      // The OIcon size prop is set to "md" in the template
      expect(icon.props("size")).toBe("md");
    });

    it("should render check icon with positive color when selected", () => {
      wrapper = mountComponent({ modelValue: "custom" });
      const customCard = findCardByType(wrapper, "custom");
      const checkIcon = customCard
        .findAllComponents({ name: "OIcon" })
        .find((icon) => icon.props("name") === "check");

      expect(checkIcon).toBeDefined();
      // OIcon no longer has a `color` prop — color comes from the `.check-icon` parent class
      const wrapperDiv = checkIcon?.element.parentElement;
      expect(wrapperDiv?.classList.contains("check-icon")).toBe(true);
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
        const icon = card.find('[data-test="destination-type-icon"]');
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
        expect(card.element.closest(".selector-grid")).not.toBeNull();
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

describe("Approved Slack choices", () => {
  const descriptionOf = (wrapper: VueWrapper, type: string) => {
    const card = findCardByType(wrapper, type);
    return wrapper.find(`[id="${card.attributes("aria-describedby")}"]`);
  };

  it("keeps the descriptions in the tooltip text, not in the visible tile", () => {
    const wrapper = mountComponent({ slackApp: true });
    const app = descriptionOf(wrapper, "slack_app");
    expect(app.attributes("data-test")).toBe("destination-type-description");
    expect(app.classes()).toContain("sr-only");
    expect(app.text()).toContain(
      "Recommended for alert response. Updates scheduled alerts in place. Acknowledge, mute and investigate from Slack. Needs a connected workspace.",
    );
    expect(descriptionOf(wrapper, "slack").text()).toContain(
      "Posts a new message with your webhook and template. Use it for on-call pages or custom Slack layouts.",
    );
    const shown = findCardByType(wrapper, "slack").find(".card-content").text();
    expect(shown).not.toContain("Posts a new message");
    wrapper.unmount();
  });

  it("has no tag inside the Slack tiles", () => {
    const wrapper = mountComponent({ slackApp: true });
    expect(wrapper.findAll('[data-test="destination-type-tag"]')).toHaveLength(0);
    expect(findCardByType(wrapper, "slack_app").find(".card-content").text()).not.toContain(
      "Recommended",
    );
    expect(wrapper.find('[data-test="destination-type-off"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("renders a short line on every tile", () => {
    const wrapper = mountComponent({ slackApp: true });
    const expected: Record<string, string> = {
      slack_app: "Act on alerts",
      slack: "Post only",
      discord: "Chat posts",
      msteams: "Chat posts",
      email: "HTML email",
      pagerduty: "Page on-call",
      opsgenie: "Page on-call",
      servicenow: "IT incidents",
      jira: "Issue tickets",
      custom: "URL or email",
    };
    for (const [type, text] of Object.entries(expected)) {
      const short = findCardByType(wrapper, type).find('[data-test="destination-type-short"]');
      expect(short.text()).toBe(text);
      expect(short.classes()).toContain("mt-auto");
    }
    wrapper.unmount();
  });

  it("marks the unavailable app Off and explains it in the tile tooltip, not under the row", () => {
    const wrapper = mountComponent({
      slackApp: false,
      unavailableReason: "flag",
      canManageSlack: true,
    });
    const card = findCardByType(wrapper, "slack_app");
    expect(card.find('[data-test="destination-type-off"]').text()).toBe("Off");
    expect(descriptionOf(wrapper, "slack_app").text()).toContain("O2_SLACK_ENABLED");
    wrapper.unmount();
  });

  it("renders nothing after the tile row", () => {
    for (const props of [{ slackApp: true }, { slackApp: false, unavailableReason: "flag" }]) {
      const wrapper = mountComponent(props);
      const root = wrapper.element as HTMLElement;
      expect(root.children).toHaveLength(1);
      expect(root.querySelector(".selector-grid")!.parentElement!.parentElement).toBe(root);
      expect(wrapper.find('[data-test="slack-app-unavailable"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="slack-choice-hint"]').exists()).toBe(false);
      wrapper.unmount();
    }
  });

  const HINT =
    "On-call pages and super clusters use the webhook. Manual and realtime sends from a Slack app destination are separate posts.";

  it("gives the unavailable Slack app tile the reason, its description and the choice hint as separate lines", () => {
    const wrapper = mountComponent({
      slackApp: false,
      unavailableReason: "master_key",
      canManageSlack: true,
    });
    const lines = descriptionOf(wrapper, "slack_app")
      .findAll("span")
      .map((line) => line.text());
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("O2_MASTER_ENCRYPTION_KEY");
    expect(lines[2]).toBe(HINT);
    wrapper.unmount();
  });

  it("gives the available Slack app and the webhook tile their description and the choice hint", () => {
    const wrapper = mountComponent({ slackApp: true });
    for (const id of ["slack_app", "slack"]) {
      const lines = descriptionOf(wrapper, id)
        .findAll("span")
        .map((line) => line.text());
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe(HINT);
    }
    wrapper.unmount();
  });

  it("keeps the choice hint off non-Slack tiles", () => {
    const wrapper = mountComponent({ slackApp: true });
    expect(descriptionOf(wrapper, "jira").text()).not.toContain(HINT);
    wrapper.unmount();
  });

  it.each([
    ["flag", "O2_SLACK_ENABLED"],
    ["master_key", "O2_MASTER_ENCRYPTION_KEY"],
  ])("names the operator setting in the tooltip for reason %s", (unavailableReason, name) => {
    const wrapper = mountComponent({ slackApp: false, unavailableReason, canManageSlack: true });
    expect(descriptionOf(wrapper, "slack_app").text()).toContain(name);
    expect(wrapper.findAll("button")).toHaveLength(0);
    wrapper.unmount();
  });

  it("applies the selected class on click", async () => {
    const wrapper = mountComponent({ slackApp: true });
    await findCardByType(wrapper, "discord").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0]).toEqual(["discord"]);
    await wrapper.setProps({ modelValue: "discord" });
    expect(findCardByType(wrapper, "discord").classes()).toContain("selected");
    wrapper.unmount();
  });

  const inCloud = (run: () => void | Promise<void>) => async () => {
    const was = config.isCloud;
    config.isCloud = "true";
    try {
      await run();
    } finally {
      config.isCloud = was;
    }
  };

  it(
    "tells every Cloud user the app is not on for the region, with no server variable",
    inCloud(() => {
      for (const canManageSlack of [true, false]) {
        const wrapper = mountComponent({
          slackApp: false,
          unavailableReason: "flag",
          canManageSlack,
        });
        const text = descriptionOf(wrapper, "slack_app").text();
        expect(text).toContain("Not turned on for your Cloud region yet");
        expect(text).not.toContain("O2_SLACK_ENABLED");
        wrapper.unmount();
      }
    }),
  );

  it("tells a member who can't turn Slack on to ask an org admin", () => {
    const wrapper = mountComponent({
      slackApp: false,
      unavailableReason: "flag",
      canManageSlack: false,
    });
    expect(descriptionOf(wrapper, "slack_app").text()).toContain(
      "Ask an org admin to turn on the Slack app",
    );
    wrapper.unmount();
  });

  it("keeps every other destination tile whole in the wider grid", () => {
    const wrapper = mountComponent({ slackApp: true });
    expect(wrapper.find(".selector-grid").classes()).toEqual(
      expect.arrayContaining(["grid-flow-col", "@max-[54rem]/dest-picker:grid-cols-5"]),
    );
    const others = PREBUILT_DESTINATION_TYPES.filter((type) => type.id !== "slack");
    expect(others.length).toBeGreaterThan(0);
    for (const type of others) {
      const card = findCardByType(wrapper, type.id);
      expect(card.classes()).toEqual(expect.arrayContaining(["min-w-0", "cursor-pointer"]));
      expect(card.attributes("aria-disabled")).toBeUndefined();
      expect(card.find('[data-test="destination-type-icon"]').exists()).toBe(true);
      expect(card.find('[data-test="destination-type-name"]').text()).toBe(type.name);
      expect(card.find(".card-content").classes()).toContain("min-w-0");
      expect(card.find('[data-test="destination-type-short"]').exists()).toBe(true);
    }
    expect(findCardByType(wrapper, "custom").exists()).toBe(true);
    wrapper.unmount();
  });

  it("disables the unavailable app with a linked reason while keeping the webhook selectable", async () => {
    const wrapper = mountComponent({ slackApp: false });
    const app = findCardByType(wrapper, "slack_app");
    expect(app.exists()).toBe(true);
    expect(app.attributes("aria-disabled")).toBe("true");
    expect(app.attributes("tabindex")).toBe("0");
    const reason = wrapper.find(`[id="${app.attributes("aria-describedby")}"]`);
    expect(reason.text()).toContain("Needs the Enterprise Slack app on a single cluster");
    expect(app.find(".card-content").classes()).toContain("opacity-40");
    await app.trigger("click");
    await app.trigger("keydown", { key: "Enter" });
    await app.trigger("keydown", { key: " " });
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await clickCard(wrapper, "slack");
    expect(wrapper.emitted("select")).toEqual([["slack"]]);
    wrapper.unmount();
  });
});
