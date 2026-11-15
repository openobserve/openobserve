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

import { describe, it, expect, afterEach, vi } from "vitest";
import { h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

import OEmptyState from "./OEmptyState.vue";
import { EMPTY_STATE_KINDS, EMPTY_STATE_SIZES, type EmptyStateProps } from "./OEmptyState.types";

const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: '<span data-test="o-icon-stub" :data-name="name"></span>',
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "icon"],
  emits: ["click"],
  template:
    '<button :data-variant="variant" :data-size="size" :data-icon="icon" @click="$emit(\'click\')"><slot /></button>',
};

function mountState(props: EmptyStateProps = {}, slots: Record<string, () => unknown> = {}) {
  return mount(OEmptyState, {
    props: { title: raw("No alerts yet"), ...props },
    slots,
    global: { plugins: [i18n], stubs: { OIcon: OIconStub, OButton: OButtonStub } },
  });
}

const iconName = (w: VueWrapper) => w.find('[data-test="o-icon-stub"]').attributes("data-name");
const tile = (w: VueWrapper) => w.find('[data-test="o2-empty-state-icon"]');
const primary = (w: VueWrapper) => w.find('[data-test="o2-empty-state-action"]');
const secondary = (w: VueWrapper) => w.find('[data-test="o2-empty-state-secondary-action"]');

describe("OEmptyState", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("API constants", () => {
    it("exposes the four kinds and the region and compact variants", () => {
      expect(EMPTY_STATE_KINDS).toEqual(["first-run", "filtered", "denied", "error"]);
      expect(EMPTY_STATE_SIZES).toEqual(["region", "compact"]);
    });
  });

  describe("kind", () => {
    it("defaults to first-run with the inbox icon on a neutral tile", () => {
      wrapper = mountState();
      expect(wrapper.attributes("data-kind")).toBe("first-run");
      expect(iconName(wrapper)).toBe("inbox");
      expect(tile(wrapper).classes()).toContain("bg-surface-subtle");
    });

    it.each([
      ["filtered", "search-off"],
      ["denied", "lock"],
      ["error", "warning-amber"],
    ] as const)("%s uses the %s icon", (kind, icon) => {
      wrapper = mountState({ kind });
      expect(iconName(wrapper)).toBe(icon);
    });

    it("keeps the tile neutral for every kind and tints only the error icon", () => {
      wrapper = mountState({ kind: "error" });
      expect(tile(wrapper).classes()).toEqual(
        expect.arrayContaining(["bg-surface-subtle", "text-status-error-text"]),
      );
      wrapper.unmount();
      wrapper = mountState({ kind: "denied" });
      expect(tile(wrapper).classes()).toContain("text-text-secondary");
    });

    it("lets icon override the kind default", () => {
      wrapper = mountState({ kind: "filtered", icon: "dashboard" });
      expect(iconName(wrapper)).toBe("dashboard");
    });

    it.each([
      ["error", "Couldn't load this data"],
      ["denied", "You don't have access"],
      ["filtered", "No matches"],
    ] as const)("%s falls back to its own title and text", (kind, title) => {
      wrapper = mount(OEmptyState, {
        props: { kind },
        global: { plugins: [i18n], stubs: { OIcon: OIconStub, OButton: OButtonStub } },
      });
      expect(wrapper.find('[data-test="o2-empty-state-title"]').text()).toBe(title);
      expect(wrapper.find('[data-test="o2-empty-state-text"]').exists()).toBe(true);
    });

    it("keeps a caller title without adding the kind's text", () => {
      wrapper = mountState({ kind: "error" });
      expect(wrapper.find('[data-test="o2-empty-state-title"]').text()).toBe("No alerts yet");
      expect(wrapper.find('[data-test="o2-empty-state-text"]').exists()).toBe(false);
    });
  });

  describe("region variant", () => {
    it("sits 64 px below the region top, centred, never vertically centred", () => {
      wrapper = mountState();
      expect(wrapper.attributes("data-o2-empty")).toBe("region");
      expect(wrapper.classes()).toEqual(
        expect.arrayContaining(["pt-16", "items-center", "self-start", "text-center"]),
      );
      expect(wrapper.classes()).not.toContain("justify-center");
    });

    it("renders a 40 px tile, a 14 px / 600 h2 title and 13 px text up to 420 px", () => {
      wrapper = mountState({ text: raw("Alerts watch a query.") });
      expect(tile(wrapper).classes()).toEqual(
        expect.arrayContaining(["size-10", "rounded-surface"]),
      );
      expect(wrapper.find("h2").text()).toBe("No alerts yet");
      expect(wrapper.find("h2").classes()).toEqual(
        expect.arrayContaining(["text-sm", "font-title"]),
      );
      const text = wrapper.find('[data-test="o2-empty-state-text"]');
      expect(text.text()).toBe("Alerts watch a query.");
      expect(text.classes()).toEqual(
        expect.arrayContaining(["text-compact", "text-text-secondary", "max-w-105"]),
      );
    });
  });

  describe("compact variant", () => {
    it("puts a 16 px icon inline with a 13 px / 500 title, left-aligned", () => {
      wrapper = mountState({ size: "compact", text: raw("Try another search.") });
      expect(wrapper.attributes("data-o2-empty")).toBe("compact");
      expect(wrapper.classes()).toEqual(expect.arrayContaining(["items-start", "text-start"]));
      expect(tile(wrapper).attributes("data-name")).toBe("inbox");
      expect(wrapper.find("h2").exists()).toBe(false);
      expect(wrapper.find('[data-test="o2-empty-state-title"]').classes()).toEqual(
        expect.arrayContaining(["text-compact", "font-medium"]),
      );
    });

    it("shows one sm action and drops the secondary", () => {
      wrapper = mountState({
        size: "compact",
        kind: "error",
        onAction: vi.fn(),
        secondaryActionLabel: raw("Import"),
        onSecondaryAction: vi.fn(),
      });
      expect(primary(wrapper).attributes("data-size")).toBe("sm");
      expect(primary(wrapper).text()).toBe("Retry");
      expect(secondary(wrapper).exists()).toBe(false);
    });
  });

  describe("copy", () => {
    it("renders the #text slot in place of the text prop", () => {
      wrapper = mountState({}, { text: () => h("strong", "rich") });
      expect(wrapper.find('[data-test="o2-empty-state-text"] strong').text()).toBe("rich");
    });

    it("omits the text paragraph when there is no text", () => {
      wrapper = mountState();
      expect(wrapper.find('[data-test="o2-empty-state-text"]').exists()).toBe(false);
    });

    it("shows the request id in mono under an error", () => {
      wrapper = mountState({ kind: "error", requestId: "7f3a9c21" });
      const meta = wrapper.find('[data-test="o2-empty-state-request-id"]');
      expect(meta.text()).toContain("7f3a9c21");
      expect(meta.classes()).toEqual(expect.arrayContaining(["font-mono", "text-text-muted"]));
    });

    it("shows who can grant access when denied", () => {
      wrapper = mountState({ kind: "denied", contact: raw("Ask an org admin.") });
      expect(wrapper.find('[data-test="o2-empty-state-contact"]').text()).toBe("Ask an org admin.");
    });
  });

  describe("actions", () => {
    it("renders no action without a label or a listener", () => {
      wrapper = mountState({ kind: "error" });
      expect(primary(wrapper).exists()).toBe(false);
    });

    it("renders a primary md button for first-run and calls onAction", async () => {
      const onAction = vi.fn();
      wrapper = mountState({ actionLabel: raw("New alert"), onAction });
      expect(primary(wrapper).attributes("data-variant")).toBe("primary");
      expect(primary(wrapper).attributes("data-size")).toBeUndefined();
      await primary(wrapper).trigger("click");
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith();
    });

    it("does not render a first-run action from a listener alone", () => {
      wrapper = mountState({ onAction: vi.fn() });
      expect(primary(wrapper).exists()).toBe(false);
    });

    it("defaults error to a plain secondary Retry when someone listens", () => {
      wrapper = mountState({ kind: "error", onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Retry");
      expect(primary(wrapper).attributes("data-icon")).toBeUndefined();
      expect(primary(wrapper).attributes("data-variant")).toBe("secondary");
    });

    it("defaults filtered to Clear filters when someone listens", () => {
      wrapper = mountState({ kind: "filtered", onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Clear filters");
      expect(primary(wrapper).attributes("data-variant")).toBe("secondary");
    });

    it("keeps an explicit label over the kind default", () => {
      wrapper = mountState({ kind: "error", actionLabel: raw("Reconnect"), onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Reconnect");
    });

    it("renders the secondary md action and calls onSecondaryAction", async () => {
      const onSecondaryAction = vi.fn();
      wrapper = mountState({ secondaryActionLabel: raw("Import"), onSecondaryAction });
      expect(secondary(wrapper).attributes("data-variant")).toBe("secondary");
      expect(secondary(wrapper).attributes("data-size")).toBeUndefined();
      await secondary(wrapper).trigger("click");
      expect(onSecondaryAction).toHaveBeenCalledTimes(1);
    });

    it("lets the #actions slot replace the buttons", () => {
      wrapper = mountState(
        { actionLabel: raw("New alert") },
        { actions: () => h("a", { "data-test": "custom" }, "Docs") },
      );
      expect(wrapper.find('[data-test="custom"]').exists()).toBe(true);
      expect(primary(wrapper).exists()).toBe(false);
    });

    it("renders the #extra slot below the actions", () => {
      wrapper = mountState({}, { extra: () => h("p", { "data-test": "extra" }, "More") });
      expect(wrapper.find('[data-test="extra"]').exists()).toBe(true);
    });
  });
});
