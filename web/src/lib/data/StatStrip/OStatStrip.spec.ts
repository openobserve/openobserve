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
import OStatCard from "./OStatCard.vue";
import { raw } from "@/types/i18n";
import type { StatItem } from "./OStatStrip.types";

const items: StatItem[] = [
  { key: "a", label: raw("All"), value: 128 },
  { key: "b", label: raw("Regressed"), value: 93 },
];

const filterItems: StatItem[] = [
  { key: "firing", label: raw("Firing"), value: 3, tone: "err" },
  { key: "paused", label: raw("Paused"), value: 2 },
  { key: "all", label: raw("All"), value: 14 },
];

const mountFilter = (props: Record<string, unknown> = {}) =>
  mount(OStatStrip, { props: { items: filterItems, selectable: true, ...props } });

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

  it("grows a tile to its content past 240 and wraps the strip instead of cutting a label", () => {
    const strip = mount(OStatStrip, { props: { items } }).get('[data-test="o-stat-strip"]');
    expect(strip.classes()).toEqual(
      expect.arrayContaining(["*:min-w-max", "*:max-w-60", "*:flex-1", "flex-wrap"]),
    );
    expect(strip.classes()).not.toContain("*:min-w-34");
  });

  it("wraps a label to two lines rather than cutting it once a phone squeezes the tile", () => {
    const label = mount(OStatStrip, { props: { items } }).get('[data-test="o-stat-card-label"]');
    expect(label.classes()).toContain("line-clamp-2");
    expect(label.classes()).not.toContain("truncate");
  });

  describe("selection", () => {
    it("renders filter tiles as pressed buttons", () => {
      const pressed = mountFilter({ selectedKey: "paused" })
        .findAll("button")
        .map((b) => b.attributes("aria-pressed"));
      expect(pressed).toEqual(["false", "true", "false"]);
    });

    it("marks the selected tile with an accent border, never a fill or shadow", () => {
      const [, paused] = mountFilter({ selectedKey: "paused" }).findAll("button");
      expect(paused.classes()).toEqual(
        expect.arrayContaining(["border-accent", "ring-1", "ring-inset", "ring-accent"]),
      );
      expect(paused.classes().some((c) => /^shadow/.test(c))).toBe(false);
      expect(paused.classes()).toContain("bg-surface-base");
    });

    it("never draws the All tile as selected, even when the filter names it", () => {
      const all = mountFilter({ selectedKey: "all" }).findAll("button")[2];
      expect(all.attributes("aria-pressed")).toBe("false");
      expect(all.classes()).not.toContain("border-accent");
    });

    it("treats an item flagged all as the reset tile", () => {
      const wrapper = mountFilter({
        items: [filterItems[0], { key: "total", label: raw("Total"), value: 14, all: true }],
        selectedKey: "total",
      });
      expect(wrapper.findAll("button")[1].attributes("aria-pressed")).toBe("false");
    });

    it("emits the key of a newly clicked tile", async () => {
      const wrapper = mountFilter();
      await wrapper.findAll("button")[0].trigger("click");
      expect(wrapper.emitted("select")?.[0]).toEqual(["firing"]);
      expect(wrapper.emitted("update:selectedKey")?.[0]).toEqual(["firing"]);
    });

    it("clears the filter when the selected tile is clicked again", async () => {
      const wrapper = mountFilter({ selectedKey: "firing" });
      await wrapper.findAll("button")[0].trigger("click");
      expect(wrapper.emitted("select")?.[0]).toEqual([null]);
    });

    it("clears the filter from the All tile, which stays clickable", async () => {
      const wrapper = mountFilter({ selectedKey: "firing" });
      await wrapper.findAll("button")[2].trigger("click");
      expect(wrapper.emitted("select")?.[0]).toEqual([null]);
    });

    it("keeps a per-item read-out out of the filter", async () => {
      const wrapper = mountFilter({
        items: [{ key: "calls", label: raw("Calls"), value: 4, selectable: false }, ...filterItems],
      });
      expect(wrapper.findAll("button")).toHaveLength(3);
      await wrapper.get('[data-test="o-stat-strip"] > div').trigger("click");
      expect(wrapper.emitted("select")).toBeUndefined();
    });

    it("leaves a static strip's tiles unpressable", () => {
      const wrapper = mount(OStatStrip, { props: { items, selectedKey: "b" } });
      expect(wrapper.findAll("button")).toHaveLength(0);
      expect(wrapper.find("[aria-pressed]").exists()).toBe(false);
    });
  });

  describe("multiple", () => {
    const mountMulti = (selectedKeys: string[] = []) =>
      mountFilter({ multiple: true, selectedKeys });

    it("marks every picked tile and never the All tile", () => {
      const pressed = mountMulti(["firing", "paused", "all"])
        .findAll("button")
        .map((b) => b.attributes("aria-pressed"));
      expect(pressed).toEqual(["true", "true", "false"]);
    });

    it("adds a tile to the selection", async () => {
      const wrapper = mountMulti(["firing"]);
      await wrapper.findAll("button")[1].trigger("click");
      expect(wrapper.emitted("update:selectedKeys")?.[0]).toEqual([["firing", "paused"]]);
      expect(wrapper.emitted("select")?.[0]).toEqual(["paused"]);
    });

    it("removes a picked tile from the selection", async () => {
      const wrapper = mountMulti(["firing", "paused"]);
      await wrapper.findAll("button")[0].trigger("click");
      expect(wrapper.emitted("update:selectedKeys")?.[0]).toEqual([["paused"]]);
    });

    it("empties the selection from the All tile", async () => {
      const wrapper = mountMulti(["firing"]);
      await wrapper.findAll("button")[2].trigger("click");
      expect(wrapper.emitted("update:selectedKeys")?.[0]).toEqual([[]]);
      expect(wrapper.emitted("select")?.[0]).toEqual([null]);
    });

    it("says what a click does in each tile's tooltip", () => {
      const cards = mountMulti(["firing"]).findAllComponents(OStatCard);
      expect(cards[0].props("hint")).toBe("Stop showing Firing");
      expect(cards[1].props("hint")).toBe("Also show Paused");
      expect(cards[2].props("hint")).toBeUndefined();
    });
  });

  describe("keyboard and semantics", () => {
    it("clears a single selection on Escape", async () => {
      const wrapper = mountFilter({ selectedKey: "firing" });
      await wrapper.get('[data-test="o-stat-strip"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("select")?.[0]).toEqual([null]);
    });

    it("empties a multiple selection on Escape", async () => {
      const wrapper = mountFilter({ multiple: true, selectedKeys: ["paused"] });
      await wrapper.get('[data-test="o-stat-strip"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("update:selectedKeys")?.[0]).toEqual([[]]);
    });

    it("ignores Escape when nothing is filtered", async () => {
      const wrapper = mountFilter();
      await wrapper.get('[data-test="o-stat-strip"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("select")).toBeUndefined();
    });

    it("names a filter strip as a group", () => {
      const strip = mountFilter().get('[data-test="o-stat-strip"]');
      expect(strip.attributes("role")).toBe("group");
      expect(strip.attributes("aria-label")).toBeTruthy();
    });

    it("keeps a strip whose only filter is All display-only", () => {
      const wrapper = mountFilter({ items: [filterItems[2]] });
      expect(wrapper.findAll("button")).toHaveLength(0);
      expect(wrapper.get('[data-test="o-stat-strip"]').attributes("role")).toBeUndefined();
    });
  });

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

describe("OStatCard", () => {
  const card = (props: Record<string, unknown>) =>
    mount(OStatCard, { props: { label: raw("Firing"), icon: "bell", ...props } });
  const valueOf = (w: ReturnType<typeof card>) => w.get('[data-test="o-stat-card-value"]');
  const fillOf = (w: ReturnType<typeof card>) => w.get('[data-test="o-stat-card-fill"]');

  it("colours value, chip and fill with the tone when the value is above 0", () => {
    const w = card({ value: 3, tone: "err", max: 12 });
    expect(valueOf(w).classes()).toContain("text-badge-error-soft-text");
    expect(w.get('[data-test="o-stat-card-icon"]').classes()).toContain("bg-badge-error-soft-bg");
    expect(fillOf(w).classes()).toContain("bg-badge-error-solid-bg");
    expect(fillOf(w).attributes("style")).toContain("width: 25%");
  });

  it("renders zero muted with no tone and an empty track", () => {
    const w = card({ value: 0, tone: "err", max: 12 });
    expect(valueOf(w).text()).toBe("0");
    expect(valueOf(w).classes()).toContain("text-text-muted");
    expect(w.get('[data-test="o-stat-card-icon"]').classes()).not.toContain(
      "bg-badge-error-soft-bg",
    );
    expect(fillOf(w).attributes("style")).toContain("width: 0%");
  });

  it.each([null, undefined])("renders an unknown value (%s) as a muted dash", (value) => {
    const w = card({ value, tone: "ok" });
    expect(valueOf(w).text()).toBe("—");
    expect(valueOf(w).classes()).toContain("text-text-muted");
  });

  it("always draws the track and leaves it empty without a max", () => {
    const w = card({ value: 9, tone: "ok" });
    expect(fillOf(w).attributes("style")).toContain("width: 0%");
  });

  it("uses the 24 px value on overviews", () => {
    expect(valueOf(card({ value: 1, size: "lg" })).classes()).toContain("text-2xl");
    expect(valueOf(card({ value: 1 })).classes()).toContain("text-xl");
  });

  it("shows a delta in its tone", () => {
    const w = card({
      value: 5,
      delta: { direction: "up", label: raw("4%"), tone: "ok" },
    });
    const delta = w.get('[data-test="o-stat-card-delta"]');
    expect(delta.text()).toBe("▲ 4%");
    expect(delta.classes()).toContain("text-badge-success-soft-text");
  });

  it("compacts a large number and keeps the exact one for the tooltip", () => {
    const w = card({ value: 819500, compactValue: true });
    expect(valueOf(w).text()).toContain("819.5K");
  });

  it("keeps the shimmer in the value while loading, never a 0", () => {
    const w = card({ value: 0, loading: true });
    expect(w.find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(true);
    expect(valueOf(w).text()).not.toContain("0");
  });

  it("hovers a filter tile with a lighter accent border and no fill", () => {
    const w = card({ value: 1, clickable: true });
    expect(w.element.tagName).toBe("BUTTON");
    expect(w.classes()).toContain("hover:border-accent/50");
    expect(w.classes().some((c) => c.startsWith("hover:bg-"))).toBe(false);
  });
});
