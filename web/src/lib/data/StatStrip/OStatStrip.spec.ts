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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OStatStrip from "./OStatStrip.vue";
import { raw } from "@/types/i18n";

const items = [
  { key: "a", label: raw("All"), value: 128 },
  { key: "b", label: raw("Regressed"), value: 93 },
];

function basisOf(compact: boolean) {
  const wrapper = mount(OStatStrip, {
    props: { items, compact },
    global: { stubs: { OStatCard: { template: '<div v-bind="$attrs" />' } } },
  });
  return wrapper.findAll("[class]")[1]?.classes() ?? [];
}

describe("OStatStrip", () => {
  describe("loading", () => {
    it("holds a skeleton in place of each value until the first load lands", async () => {
      const wrapper = mount(OStatStrip, { props: { items, loading: true } });
      expect(wrapper.findAll('[data-test="o-stat-card-value-skeleton"]')).toHaveLength(2);
      expect(wrapper.text()).not.toContain("128");
      await wrapper.setProps({ loading: false });
      expect(wrapper.find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("128");
    });

    it("covers a page whose loading flag only turns on once its fetch starts", async () => {
      const wrapper = mount(OStatStrip, { props: { items, loading: false } });
      await wrapper.setProps({ loading: true });
      expect(wrapper.findAll('[data-test="o-stat-card-value-skeleton"]')).toHaveLength(2);
    });

    it("keeps the last values through a refresh instead of flickering", async () => {
      const wrapper = mount(OStatStrip, { props: { items, loading: true } });
      await wrapper.setProps({ loading: false });
      await wrapper.setProps({ loading: true });
      expect(wrapper.find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("128");
    });
  });

  // A five-tile filter strip wraps to two rows at the default basis, which is
  // sized for long labels.
  it("narrows the wrap threshold when compact", () => {
    expect(basisOf(false)).toContain("basis-52");
    expect(basisOf(true)).toContain("basis-36");
  });

  it("keeps the tiles growing to fill the strip either way", () => {
    expect(basisOf(false)).toContain("grow");
    expect(basisOf(true)).toContain("grow");
  });

  // ── which tile reads as active ────────────────────────────────────────────
  describe("selection", () => {
    const selectedKeys = (props: Record<string, unknown>) =>
      mount(OStatStrip, {
        props: { items, selectable: true, ...props },
        global: {
          stubs: {
            OStatCard: {
              props: ["selected", "dataTest"],
              template: '<div :data-test="dataTest" :data-selected="String(selected)" />',
            },
          },
        },
      }).findAll("[data-selected='true']").length;

    const selectedTile = (props: Record<string, unknown>) => {
      const wrapper = mount(OStatStrip, {
        props: { items, selectable: true, ...props },
        global: {
          stubs: {
            OStatCard: {
              props: ["selected"],
              template: '<div data-card :data-selected="String(selected)" />',
            },
          },
        },
      });
      return wrapper
        .findAll("[data-card]")
        .findIndex((card) => card.attributes("data-selected") === "true");
    };

    it("marks the selected tile", () => {
      expect(selectedTile({ selectedKey: "b" })).toBe(1);
    });

    it("falls back to the default tile when nothing is filtered", () => {
      // Otherwise the strip shows NO tile active while the grid behind it is
      // showing everything — a state the control cannot express.
      expect(selectedTile({ selectedKey: null, defaultKey: "a" })).toBe(0);
    });

    it("falls back when the filter names no tile of its own", () => {
      // Several callers spell "no filter" as the string "all" rather than null.
      expect(selectedTile({ selectedKey: "all", defaultKey: "a" })).toBe(0);
    });

    it("lights exactly one tile, never two", () => {
      expect(selectedKeys({ selectedKey: "b", defaultKey: "a" })).toBe(1);
      expect(selectedKeys({ selectedKey: null, defaultKey: "a" })).toBe(1);
    });

    it("leaves every tile unlit when there is no default to fall back to", () => {
      expect(selectedKeys({ selectedKey: null })).toBe(0);
    });

    it("announces which tile is pressed, not just a border colour", () => {
      // The only cue today is `border-accent`, so the filter state does not
      // exist for anyone using a screen reader.
      const wrapper = mount(OStatStrip, {
        props: { items, selectable: true, selectedKey: "b", defaultKey: "a" },
      });
      const pressed = wrapper.findAll("button").map((b) => b.attributes("aria-pressed"));
      expect(pressed).toEqual(["false", "true"]);
    });

    it("leaves a static strip's tiles unpressable, not merely unpressed", () => {
      const wrapper = mount(OStatStrip, { props: { items } });
      expect(wrapper.findAll("button")).toHaveLength(0);
      expect(wrapper.find("[aria-pressed]").exists()).toBe(false);
    });

    it("stays inert when the strip is not selectable", () => {
      expect(selectedKeys({ selectable: false, selectedKey: "b", defaultKey: "a" })).toBe(0);
    });
  });

  // ── a qualifier shown as a glyph ──────────────────────────────────────────
  describe("subIcon", () => {
    const mountCard = (item: Record<string, unknown>) =>
      mount(OStatStrip, {
        props: { items: [{ key: "c", label: raw("Calls"), value: 5, ...item }] },
      });

    it("renders the qualifier as a labelled glyph instead of text", () => {
      const wrapper = mountCard({ sub: raw("From traces"), subIcon: "account-tree" });
      const icon = wrapper.get("[data-test='o-stat-card-sub-icon']");
      expect(icon.attributes("aria-label")).toBe("From traces");
      expect(wrapper.text()).not.toContain("From traces");
    });

    it("tooltips the glyph with subTooltip, falling back to sub", () => {
      const tip = (item: Record<string, unknown>) =>
        mountCard({ sub: raw("From traces"), subIcon: "account-tree", ...item })
          .findAllComponents({ name: "OTooltip" })
          .find((t) => t.element.closest?.('[data-test="o-stat-card-sub-icon"]'))
          ?.props("content");
      expect(tip({ subTooltip: raw("Measured from your traces") })).toBe(
        "Measured from your traces",
      );
      expect(tip({})).toBe("From traces");
    });

    it("keeps the text qualifier when no glyph is given", () => {
      const wrapper = mountCard({ sub: raw("wait time") });
      expect(wrapper.find("[data-test='o-stat-card-sub-icon']").exists()).toBe(false);
      expect(wrapper.text()).toContain("wait time");
    });
  });

  describe("stacked layout", () => {
    const mountStacked = (
      item: Record<string, unknown> = {},
      props: Record<string, unknown> = {},
    ) =>
      mount(OStatStrip, {
        props: {
          layout: "stacked",
          items: [{ key: "c", label: raw("Calls"), value: 5, sub: raw("Not set up"), ...item }],
          ...props,
        },
      });

    it("puts the label above the value and the qualifier on its own line below", () => {
      const wrapper = mountStacked();
      const text = wrapper.text();
      expect(text.indexOf("Calls")).toBeLessThan(text.indexOf("5"));
      expect(text.indexOf("5")).toBeLessThan(text.indexOf("Not set up"));
      expect(wrapper.findAll("[data-test='o-stat-card-sub-stacked']")).toHaveLength(1);
      expect(text.match(/Not set up/g)).toHaveLength(1);
    });

    it("draws the value large and keeps the qualifier visible on narrow screens", () => {
      const wrapper = mountStacked();
      expect(wrapper.get("[data-test='o-stat-card-value']").classes()).toContain("text-3xl");
      expect(wrapper.get("[data-test='o-stat-card-sub-stacked']").classes()).not.toContain(
        "max-lg:hidden",
      );
    });

    it("draws no proportion bar unless a max is given", () => {
      expect(mountStacked().find(".h-1").exists()).toBe(false);
      expect(mountStacked({ max: 10 }).find(".h-1").exists()).toBe(true);
    });

    it("sizes tiles as fractions of the strip instead of the default basis", () => {
      const wrapper = mount(OStatStrip, {
        props: { items, layout: "stacked", compact: true },
        global: { stubs: { OStatCard: { template: '<div v-bind="$attrs" />' } } },
      });
      const classes = wrapper.findAll("[class]")[1]?.classes() ?? [];
      expect(classes).toEqual(expect.arrayContaining(["grow", "basis-1/6", "max-md:basis-1/3"]));
      expect(classes).not.toContain("basis-36");
    });

    it("shows a keyboard focus ring on a clickable stacked tile only", () => {
      const ring = (props: Record<string, unknown>) =>
        mountStacked({}, props).get("[data-test='o-stat-card-value']").element.parentElement!
          .className;
      expect(ring({ selectable: true })).toContain("focus-visible:ring-3");
      expect(ring({})).not.toContain("focus-visible:ring-3");
    });

    it("leaves the default inline tile unchanged", () => {
      const wrapper = mountStacked({}, { layout: undefined });
      expect(wrapper.find("[data-test='o-stat-card-value']").exists()).toBe(false);
      expect(wrapper.find("[data-test='o-stat-card-sub-stacked']").exists()).toBe(false);
      expect(wrapper.text()).toContain("Not set up");
    });
  });
});
