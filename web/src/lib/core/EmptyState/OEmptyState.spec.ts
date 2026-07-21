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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ── Mock illustrations module — must be hoisted so the component import sees it ─
// Each preset references an illustration component by name from the illustrations
// catalog. The Proxy returns a lightweight stub for every key so no illustration
// .vue files are loaded and we never rely on their internal rendering.
const illustrationsProxy = vi.hoisted(
  () =>
    new Proxy(
      {} as Record<string, unknown>,
      {
        get: () => ({
          name: "IllustrationStub",
          props: ["width", "animated"],
          template: '<div data-test="illustration-stub"></div>',
        }),
      },
    ),
);

vi.mock("./illustrations", () => ({
  illustrations: illustrationsProxy,
}));

import OEmptyState from "./OEmptyState.vue";

// ── Child component stubs ──────────────────────────────────────────────────────
// EmptyStateActionCard: renders a button with the translated label, emits click.
const EmptyStateActionCardStub = {
  name: "EmptyStateActionCard",
  props: ["icon", "label", "sublabel"],
  emits: ["click"],
  template: `
    <button
      data-test="empty-state-action-card-stub"
      :data-label="label"
      @click="$emit('click')"
    >{{ label }}</button>
  `,
};

// OIcon: no-op span.
const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: '<span data-test="o-icon-stub"></span>',
};

// OButton: renders a button with slot content, emits click.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "iconLeft"],
  emits: ["click"],
  template: '<button data-test="o-button-stub" @click="$emit(\'click\')"><slot /></button>',
};

// ── Mount factory ──────────────────────────────────────────────────────────────
// Defaults to the "no-dashboards" preset which has 3 bundled action cards and a
// "block" size — exercising the most common render path. Individual tests override
// props to target specific branches.
function buildWrapper(props = {}) {
  return mount(OEmptyState, {
    props: { preset: "no-dashboards", ...props },
    global: {
      plugins: [store, i18n],
      stubs: {
        EmptyStateActionCard: EmptyStateActionCardStub,
        OIcon: OIconStub,
        OButton: OButtonStub,
      },
    },
  });
}

describe("OEmptyState", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── columns prop ────────────────────────────────────────────────────────────

  describe("columns prop", () => {
    it("uses flex-wrap on the actions wrapper when columns is true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ columns: true });

      // Assert — the actions wrapper (which receives the conditional flex
      // classes) should have flex-wrap and should NOT have flex-nowrap.
      const flexWrapEl = wrapper.find(".flex-wrap");
      const flexNowrapEl = wrapper.find(".flex-nowrap");

      expect(flexWrapEl.exists()).toBe(true);
      expect(flexNowrapEl.exists()).toBe(false);
    });

    it("uses flex-nowrap on the actions wrapper when columns is false", () => {
      // Arrange & Act
      wrapper = buildWrapper({ columns: false });

      // Assert
      const flexWrapEl = wrapper.find(".flex-wrap");
      const flexNowrapEl = wrapper.find(".flex-nowrap");

      expect(flexWrapEl.exists()).toBe(false);
      expect(flexNowrapEl.exists()).toBe(true);
    });

    it("uses flex-nowrap on the actions wrapper when columns is omitted (default)", () => {
      // Arrange & Act — no columns prop at all
      wrapper = buildWrapper();

      // Assert — default is false, so flex-nowrap should be present and
      // flex-wrap should not.
      const flexWrapEl = wrapper.find(".flex-wrap");
      const flexNowrapEl = wrapper.find(".flex-nowrap");

      expect(flexWrapEl.exists()).toBe(false);
      expect(flexNowrapEl.exists()).toBe(true);
    });

    it("does not apply flex-wrap to any element when columns is false", () => {
      // Arrange & Act
      wrapper = buildWrapper({ columns: false });

      // Assert — no element in the entire rendered tree should carry flex-wrap
      expect(wrapper.findAll(".flex-wrap")).toHaveLength(0);
    });

    it("does not apply flex-nowrap to any element when columns is true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ columns: true });

      // Assert
      expect(wrapper.findAll(".flex-nowrap")).toHaveLength(0);
    });
  });

  // ── Preset rendering ────────────────────────────────────────────────────────

  describe("preset rendering", () => {
    it("renders the root element with the o2-empty-state data-test", () => {
      // Arrange & Act
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="o2-empty-state"]').exists()).toBe(true);
    });

    it("renders the illustration stub from the preset", () => {
      // Arrange & Act — no-dashboards preset maps to illustration "board",
      // which the Proxy resolves to IllustrationStub.
      wrapper = buildWrapper();

      // Assert
      expect(wrapper.find('[data-test="illustration-stub"]').exists()).toBe(true);
    });

    it("renders the title from the preset i18n key", () => {
      // Arrange & Act
      wrapper = buildWrapper();

      // Assert — the title is an <h2> element for block size, with the text
      // resolved from emptyState.noDashboards.title
      const title = wrapper.find("h2");
      expect(title.exists()).toBe(true);
      expect(title.text()).toContain("Create your first dashboard");
    });

    it("renders the description from the preset i18n key", () => {
      // Arrange & Act
      wrapper = buildWrapper();

      // Assert — description is a <p> with text-secondary class
      const description = wrapper.find("p");
      expect(description.exists()).toBe(true);
      expect(description.text()).toContain("Dashboards bring your metrics");
    });

    it("uses an inline p tag for title when size is inline", () => {
      // Arrange & Act
      wrapper = buildWrapper({ size: "inline" });

      // Assert — inline size renders title as a <p>, not <h2>
      expect(wrapper.find("h2").exists()).toBe(false);
      expect(wrapper.find("p").exists()).toBe(true);
    });

    it("does not render the illustration when size is inline", () => {
      // Arrange & Act — inline never renders the full illustration
      wrapper = buildWrapper({ size: "inline" });

      // Assert
      expect(wrapper.find('[data-test="illustration-stub"]').exists()).toBe(false);
    });

    it("renders an inline icon when size is inline", () => {
      // Arrange & Act
      wrapper = buildWrapper({ size: "inline" });

      // Assert — the inline icon wrapper + OIcon stub should be present
      expect(wrapper.find('[data-test="o-icon-stub"]').exists()).toBe(true);
    });
  });

  // ── filtered state ──────────────────────────────────────────────────────────

  describe("filtered state", () => {
    it("shows a Clear filters action card when filtered is true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ filtered: true });

      // Assert — exactly one action card with the Clear filters label
      const cards = wrapper.findAll('[data-test="empty-state-action-card-stub"]');
      expect(cards).toHaveLength(1);
      expect(cards[0].attributes("data-label")).toBe("Clear filters");
    });

    it("shows filtered title with noun substitution", () => {
      // Arrange & Act — "no-dashboards" preset → noun = "dashboards"
      wrapper = buildWrapper({ filtered: true });

      // Assert — title contains the noun injected into the filtered template
      const title = wrapper.find("h2");
      expect(title.text()).toBe("No dashboards found");
    });

    it("shows filtered description with noun substitution", () => {
      // Arrange & Act
      wrapper = buildWrapper({ filtered: true });

      // Assert
      const description = wrapper.find("p");
      expect(description.text()).toContain("No dashboards match your current filters");
    });

    it("does not render preset actions when filtered is true", () => {
      // Arrange & Act — "no-dashboards" has 3 actions for first-run, but
      // filtered replaces them with the single Clear filters card.
      wrapper = buildWrapper({ filtered: true });

      // Assert
      const cards = wrapper.findAll('[data-test="empty-state-action-card-stub"]');
      expect(cards).toHaveLength(1);
      expect(cards[0].attributes("data-label")).toBe("Clear filters");
    });

    it("renders the no-results illustration when filtered is true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ filtered: true });

      // Assert — illustration stub is still rendered (the filtered path
      // forces illustrationName to "no-results").
      expect(wrapper.find('[data-test="illustration-stub"]').exists()).toBe(true);
    });

    it("falls back to generic noun when preset has no noun mapping", () => {
      // Arrange — "no-data" preset is not listed in presetNouns, so it falls
      // back to emptyState.filtered.fallbackNoun = "results".
      // Act
      wrapper = mount(OEmptyState, {
        props: { preset: "no-data", filtered: true },
        global: {
          plugins: [store, i18n],
          stubs: {
            EmptyStateActionCard: EmptyStateActionCardStub,
            OIcon: OIconStub,
            OButton: OButtonStub,
          },
        },
      });

      // Assert
      const title = wrapper.find("h2");
      expect(title.text()).toBe("No results found");
    });
  });

  // ── Preset actions ──────────────────────────────────────────────────────────

  describe("preset actions", () => {
    it("renders all action cards from the preset when not filtered", () => {
      // Arrange & Act — "no-dashboards" has 3 actions
      wrapper = buildWrapper();

      // Assert
      const cards = wrapper.findAll('[data-test="empty-state-action-card-stub"]');
      expect(cards).toHaveLength(3);
    });

    it("renders action cards with translated labels", () => {
      // Arrange & Act
      wrapper = buildWrapper();

      // Assert — the three "no-dashboards" actions with their English labels
      const cards = wrapper.findAll('[data-test="empty-state-action-card-stub"]');
      const labels = cards.map((c) => c.attributes("data-label"));
      expect(labels).toEqual([
        "New dashboard",
        "Import dashboard",
        "Browse templates",
      ]);
    });

    it("does not render action cards when hideAction is true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ hideAction: true });

      // Assert — actions are suppressed entirely
      expect(wrapper.find('[data-test="empty-state-action-card-stub"]').exists()).toBe(false);
    });

    it("does not render the actions wrapper when there are no actions", () => {
      // Arrange — "no-data" preset has no actions array
      // Act
      wrapper = mount(OEmptyState, {
        props: { preset: "no-data" },
        global: {
          plugins: [store, i18n],
          stubs: {
            EmptyStateActionCard: EmptyStateActionCardStub,
            OIcon: OIconStub,
            OButton: OButtonStub,
          },
        },
      });

      // Assert — neither action cards nor the wrapper flex div exists.
      // The wrapper div itself has no data-test, but it is the parent of
      // action card stubs. If no cards render, the wrapper never appears.
      expect(wrapper.find('[data-test="empty-state-action-card-stub"]').exists()).toBe(false);
      // Additionally, the flex-wrap/flex-nowrap classes should not appear
      // anywhere since the actions wrapper div is not rendered.
      expect(wrapper.find(".flex-nowrap").exists()).toBe(false);
    });
  });

  // ── action event ────────────────────────────────────────────────────────────

  describe("action event", () => {
    it('emits "action" with the action id when an action card is clicked', async () => {
      // Arrange
      wrapper = buildWrapper();
      const firstCard = wrapper.find('[data-test="empty-state-action-card-stub"]');

      // Act
      await firstCard.trigger("click");

      // Assert — the first "no-dashboards" action is "create"
      const emitted = wrapper.emitted("action");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["create"]);
    });

    it('emits "action" with "clear-filters" id when filtered and the card is clicked', async () => {
      // Arrange
      wrapper = buildWrapper({ filtered: true });
      const card = wrapper.find('[data-test="empty-state-action-card-stub"]');

      // Act
      await card.trigger("click");

      // Assert
      const emitted = wrapper.emitted("action");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["clear-filters"]);
    });

    it('emits "action" once per click', async () => {
      // Arrange
      wrapper = buildWrapper();
      const card = wrapper.find('[data-test="empty-state-action-card-stub"]');

      // Act
      await card.trigger("click");

      // Assert
      expect(wrapper.emitted("action")).toHaveLength(1);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("renders the component with backdrop when backdrop is explicitly true", () => {
      // Arrange & Act
      wrapper = buildWrapper({ backdrop: true });

      // Assert — the root element renders correctly.
      expect(wrapper.find('[data-test="o2-empty-state"]').exists()).toBe(true);
    });

    it("renders the component without backdrop when backdrop is explicitly false", () => {
      // Arrange & Act
      wrapper = buildWrapper({ backdrop: false });

      // Assert — the root element still renders.
      expect(wrapper.find('[data-test="o2-empty-state"]').exists()).toBe(true);
    });

    it("renders actionLabel and secondaryActionLabel as OButton stubs when no preset actions exist", () => {
      // Arrange — explicit actionLabel + secondaryActionLabel bypass the card
      // path entirely. No preset actions, no cards.
      // Act
      wrapper = mount(OEmptyState, {
        props: {
          preset: "no-data",
          actionLabel: "Retry",
          secondaryActionLabel: "Cancel",
        },
        global: {
          plugins: [store, i18n],
          stubs: {
            EmptyStateActionCard: EmptyStateActionCardStub,
            OIcon: OIconStub,
            OButton: OButtonStub,
          },
        },
      });

      // Assert
      const buttons = wrapper.findAll('[data-test="o-button-stub"]');
      expect(buttons).toHaveLength(2);
    });
  });
});
