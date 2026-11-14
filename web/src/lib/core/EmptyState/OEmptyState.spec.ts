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
    it("exposes the four kinds and two sizes", () => {
      expect(EMPTY_STATE_KINDS).toEqual(["first-run", "filtered", "denied", "error"]);
      expect(EMPTY_STATE_SIZES).toEqual(["page", "inline"]);
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

    it("tints the tile red only for error", () => {
      wrapper = mountState({ kind: "error" });
      expect(tile(wrapper).classes()).toContain("bg-status-error-bg");
      wrapper.unmount();
      wrapper = mountState({ kind: "denied" });
      expect(tile(wrapper).classes()).not.toContain("bg-status-error-bg");
    });

    it("lets icon override the kind default", () => {
      wrapper = mountState({ kind: "filtered", icon: "dashboard" });
      expect(iconName(wrapper)).toBe("dashboard");
    });
  });

  describe("size", () => {
    it("page renders a 40 px surface tile and an h2 title", () => {
      wrapper = mountState();
      expect(tile(wrapper).classes()).toEqual(
        expect.arrayContaining(["size-10", "rounded-surface"]),
      );
      expect(wrapper.find("h2").text()).toBe("No alerts yet");
      expect(wrapper.find("h2").classes()).toContain("text-base");
    });

    it("inline renders a 32 px menu tile, a 14 px title and 13 px text", () => {
      wrapper = mountState({ size: "inline", text: raw("Try another search.") });
      expect(tile(wrapper).classes()).toEqual(expect.arrayContaining(["size-8", "rounded-menu"]));
      expect(wrapper.find("h2").exists()).toBe(false);
      expect(wrapper.find('[data-test="o2-empty-state-title"]').classes()).toContain("text-sm");
      expect(wrapper.find('[data-test="o2-empty-state-text"]').classes()).toContain("text-compact");
    });
  });

  describe("copy", () => {
    it("renders text in 14 px secondary reading text", () => {
      wrapper = mountState({ text: raw("Alerts watch a query.") });
      const text = wrapper.find('[data-test="o2-empty-state-text"]');
      expect(text.text()).toBe("Alerts watch a query.");
      expect(text.classes()).toEqual(expect.arrayContaining(["text-sm", "text-text-secondary"]));
    });

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

    it("renders a primary lg CTA for first-run and calls onAction", async () => {
      const onAction = vi.fn();
      wrapper = mountState({ actionLabel: raw("New alert"), onAction });
      expect(primary(wrapper).attributes("data-variant")).toBe("primary");
      expect(primary(wrapper).attributes("data-size")).toBe("lg");
      await primary(wrapper).trigger("click");
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith();
    });

    it("does not render a first-run action from a listener alone", () => {
      wrapper = mountState({ onAction: vi.fn() });
      expect(primary(wrapper).exists()).toBe(false);
    });

    it("defaults error to Retry with the refresh icon when someone listens", () => {
      wrapper = mountState({ kind: "error", onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Retry");
      expect(primary(wrapper).attributes("data-icon")).toBe("refresh");
      expect(primary(wrapper).attributes("data-variant")).toBe("secondary");
    });

    it("defaults filtered to Clear filters when someone listens", () => {
      wrapper = mountState({ kind: "filtered", onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Clear filters");
      expect(primary(wrapper).attributes("data-icon")).toBeUndefined();
      expect(primary(wrapper).attributes("data-variant")).toBe("secondary");
    });

    it("keeps an explicit label over the kind default", () => {
      wrapper = mountState({ kind: "error", actionLabel: raw("Reconnect"), onAction: vi.fn() });
      expect(primary(wrapper).text()).toBe("Reconnect");
      expect(primary(wrapper).attributes("data-icon")).toBeUndefined();
    });

    it("renders the secondary action and calls onSecondaryAction", async () => {
      const onSecondaryAction = vi.fn();
      wrapper = mountState({ secondaryActionLabel: raw("Import"), onSecondaryAction });
      expect(secondary(wrapper).attributes("data-variant")).toBe("secondary");
      expect(secondary(wrapper).attributes("data-size")).toBe("lg");
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
