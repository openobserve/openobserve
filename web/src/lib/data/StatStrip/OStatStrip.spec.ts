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
});

describe("OStatStrip tray (selectable)", () => {
  const tiles = [
    { key: "failed", label: raw("Failed"), value: 1, tone: "error" as const },
    { key: "total", label: raw("Total"), value: 8 },
  ];
  const mountTray = (props: Record<string, unknown> = {}) =>
    mount(OStatStrip, { props: { items: tiles, selectable: true, defaultKey: "total", ...props } });

  it("sits in a non-wrapping recessed tray that scrolls sideways only", () => {
    const strip = mountTray().get('[data-test="o-stat-strip"]');
    expect(strip.classes()).toContain("bg-surface-subtle");
    expect(strip.classes()).not.toContain("flex-wrap");
    expect(strip.classes()).toContain("overflow-x-auto");
    expect(strip.classes()).toContain("overflow-y-hidden");
  });

  it("keeps tile width independent of how many tiles there are", () => {
    const one = mountTray({ items: [tiles[0]] }).get("button");
    const two = mountTray().get("button");
    expect(one.classes()).toContain("grow-0");
    expect(one.classes()).toContain("max-w-56");
    expect(two.classes()).toContain("grow-0");
  });

  it("lifts only the selected tile with a tone top bar", () => {
    const [failed, total] = mountTray({ selectedKey: "failed" }).findAll("button");
    expect(failed.classes()).toContain("border-t-error-500");
    expect(failed.classes()).toContain("z-10");
    expect(total.classes()).not.toContain("z-10");
  });

  it("lets a navigation strip opt out of the tray while staying selectable", () => {
    const strip = mountTray({ tray: false }).get('[data-test="o-stat-strip"]');
    expect(strip.classes()).toContain("flex-wrap");
    expect(strip.classes()).not.toContain("bg-surface-subtle");
    expect(mountTray({ tray: false }).get("button").classes()).not.toContain("grow-0");
  });

  it("does not tint tiles that cannot be clicked on hover", () => {
    const wrapper = mountTray({
      items: [{ key: "calls", label: raw("Calls"), value: 4, selectable: false }, ...tiles],
    });
    const [calls, failed] = wrapper.findAll("button, div.flex-col");
    expect(calls.classes()).not.toContain("hover:bg-surface-base/60");
    expect(failed.classes()).toContain("hover:bg-surface-base/60");
  });

  it("keeps the progress track visible on unselected tiles", () => {
    const [failed, total] = mountTray({ selectedKey: "failed" }).findAll("button");
    const track = (b: typeof failed) => b.find(".h-1").classes();
    expect(track(total)).toContain("bg-surface-base");
    expect(track(failed)).toContain("bg-surface-subtle");
  });

  it("uses the accent top bar for a neutral selected tile", () => {
    const [, total] = mountTray().findAll("button");
    expect(total.classes()).toContain("border-t-accent");
  });

  it("leaves a non-selectable strip as the old wrapping tiles", () => {
    const strip = mount(OStatStrip, { props: { items: tiles } }).get('[data-test="o-stat-strip"]');
    expect(strip.classes()).toContain("flex-wrap");
    expect(strip.classes()).not.toContain("bg-surface-subtle");
  });
});
