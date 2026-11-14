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

import { describe, expect, it, vi } from "vitest";
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
      const pressed = wrapper.findAll("[aria-pressed]").map((b) => b.attributes("aria-pressed"));
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

describe("OStatStrip read-only strip keeps main's look", () => {
  const sorted = (classes: string[]) => [...classes].sort();
  const wrapper = () =>
    mount(OStatStrip, {
      props: {
        items: [
          {
            key: "s",
            label: raw("Streams"),
            value: 12,
            icon: "check" as const,
            tone: "primary" as const,
            max: 24,
          },
        ],
      },
    });

  it("renders the same strip, tile, value, chip and bar classes as main", () => {
    const w = wrapper();
    expect(sorted(w.get('[data-test="o-stat-strip"]').classes())).toEqual(
      sorted(["flex", "flex-wrap", "gap-2", "max-lg:gap-1.5"]),
    );
    const tile = w.get('[data-test="o-stat-strip"] > div');
    expect(sorted(tile.classes())).toEqual(
      sorted([
        "flex",
        "min-w-0",
        "flex-col",
        "justify-center",
        "gap-1",
        "overflow-hidden",
        "px-2.5",
        "py-1",
        "text-left",
        "transition-colors",
        "max-lg:px-1.5",
        "rounded-default",
        "bg-surface-base",
        "border",
        "border-border-default",
        "grow",
        "max-lg:shrink-0",
        "max-lg:basis-auto",
        "basis-52",
      ]),
    );
    const value = tile.findAll("span").find((s) => s.text() === "12")!;
    expect(sorted(value.classes())).toEqual(
      sorted([
        "shrink-0",
        "text-2xl",
        "leading-none",
        "font-semibold",
        "whitespace-nowrap",
        "tabular-nums",
        "max-lg:text-lg",
        "text-icon-chip-primary-text",
      ]),
    );
    const chip = tile.get(".grid.h-7");
    expect(chip.classes()).toEqual(
      expect.arrayContaining([
        "bg-icon-chip-primary-bg",
        "text-icon-chip-primary-text",
        "rounded-default",
      ]),
    );
    expect(sorted(tile.get(".h-1").classes())).toEqual(
      sorted(["bg-surface-subtle", "h-1", "overflow-hidden", "rounded-full"]),
    );
    expect(tile.get(".h-1 > div").classes()).toContain("bg-accent");
    expect(tile.find('[data-test="o-stat-card-glyph"]').exists()).toBe(false);
  });
});

describe("OStatStrip filter chips (selectable)", () => {
  const tiles = [
    {
      key: "failed",
      label: raw("Failed"),
      value: 1,
      tone: "error" as const,
      icon: "error" as const,
      dataTest: "x-failed",
    },
    {
      key: "active",
      label: raw("Active"),
      value: 5,
      tone: "success" as const,
      icon: "check" as const,
    },
    { key: "slow", label: raw("Slow"), value: 2, tone: "warning" as const },
    {
      key: "paused",
      label: raw("Paused"),
      value: 0,
      tone: "error" as const,
      icon: "pause" as const,
    },
    { key: "total", label: raw("Total"), value: 8, dataTest: "x-total" },
  ];
  const mountChips = (props: Record<string, unknown> = {}) =>
    mount(OStatStrip, {
      props: { items: tiles, selectable: true, defaultKey: "total", ...props },
    });
  const chip = (w: ReturnType<typeof mountChips>, label: string) =>
    w.findAll("[aria-pressed]").find((b) => b.text().includes(label))!;
  const badge = (w: ReturnType<typeof mountChips>, label: string) =>
    chip(w, label).get('[data-test="o-stat-card-value"]').classes();

  it("renders each filter as a pressable chip inside a labelled group, no tray", () => {
    const w = mountChips();
    const strip = w.get('[data-test="o-stat-strip"]');
    expect(strip.classes()).toEqual(expect.arrayContaining(["px-page-edge", "py-2"]));
    const group = w.get('[role="group"]');
    expect(group.attributes("aria-label")).toBe("Filters");
    const chips = group.findAll("[aria-pressed]");
    expect(chips).toHaveLength(5);
    expect(chips[1].classes()).toEqual(
      expect.arrayContaining(["h-8", "rounded-default", "border", "bg-surface-base"]),
    );
    expect(w.find(".h-1").exists()).toBe(false);
  });

  it("leads with the default chip and keeps the others in the given order", () => {
    const labels = mountChips()
      .findAll('[data-test="o-stat-card-label"]')
      .map((l) => l.text());
    expect(labels).toEqual(["Total", "Failed", "Active", "Slow", "Paused"]);
  });

  it("gives the default chip a neutral grid glyph when it has no icon of its own", () => {
    const glyph = chip(mountChips(), "Total").get('[data-test="o-stat-card-glyph"]');
    expect(glyph.classes()).toContain("text-text-label");
    expect(glyph.findComponent({ name: "OIcon" }).props("name")).toBe("apps");
  });

  it("keeps the item's own icon when the chip is selected, with no check swap", () => {
    const failed = chip(mountChips({ selectedKey: "failed" }), "Failed");
    expect(failed.attributes("aria-pressed")).toBe("true");
    const glyph = failed.get('[data-test="o-stat-card-glyph"]');
    expect(glyph.findComponent({ name: "OIcon" }).props("name")).toBe("error");
    expect(failed.classes()).toEqual(
      expect.arrayContaining(["border-accent", "bg-surface-accent-hover"]),
    );
    expect(failed.get('[data-test="o-stat-card-label"]').classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "font-semibold"]),
    );
  });

  it("colours the glyph by tone, muting it at zero, and falls back to a tone dot", () => {
    const w = mountChips();
    const glyph = (label: string) =>
      chip(w, label).get('[data-test="o-stat-card-glyph"]').classes();
    expect(glyph("Failed")).toContain("text-icon-chip-error-text");
    expect(glyph("Active")).toContain("text-icon-chip-success-text");
    expect(glyph("Paused")).toContain("text-text-muted");
    expect(chip(w, "Slow").find('[data-test="o-stat-card-dot"]').exists()).toBe(true);
  });

  it("tones the count badge only for non-zero problems, and follows the accent when selected", () => {
    const w = mountChips();
    expect(badge(w, "Failed")).toEqual(
      expect.arrayContaining([
        "bg-badge-error-soft-bg",
        "text-badge-error-soft-text",
        "rounded-full",
        "tabular-nums",
      ]),
    );
    expect(badge(w, "Slow")).toEqual(
      expect.arrayContaining(["bg-badge-warning-soft-bg", "text-badge-warning-soft-text"]),
    );
    expect(badge(w, "Active")).toEqual(
      expect.arrayContaining(["bg-surface-subtle", "text-text-heading"]),
    );
    expect(badge(w, "Paused")).toEqual(
      expect.arrayContaining([
        "bg-surface-subtle",
        "text-table-row-text-secondary-tinted",
        "font-medium",
      ]),
    );
    expect(badge(mountChips({ selectedKey: "active" }), "Active")).toEqual(
      expect.arrayContaining(["bg-badge-primary-soft-bg", "text-badge-primary-soft-text"]),
    );
  });

  it("keeps the active default chip pressed but quiet, saving the accent for a real filter", () => {
    const w = mountChips();
    const total = chip(w, "Total");
    expect(total.attributes("aria-pressed")).toBe("true");
    expect(total.classes()).toEqual(
      expect.arrayContaining(["border-border-default", "bg-surface-base"]),
    );
    expect(total.classes()).not.toContain("border-accent");
    expect(total.classes()).not.toContain("bg-surface-accent-hover");
    expect(total.get('[data-test="o-stat-card-label"]').classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "font-semibold"]),
    );
    expect(badge(w, "Total")).toEqual(
      expect.arrayContaining(["bg-surface-subtle", "text-text-heading"]),
    );
    expect(badge(w, "Total")).not.toContain("bg-badge-primary-soft-bg");
  });

  it("reserves the semibold label width so selecting never shifts the strip", () => {
    const label = chip(mountChips(), "Total").get('[data-test="o-stat-card-label"]').element
      .parentElement!;
    expect(label.getAttribute("data-label")).toBe("Total");
    expect(label.className).toContain("after:content-[attr(data-label)]");
  });

  it("tooltips an unselected chip with what clicking it does", () => {
    const tips = chip(mountChips(), "Failed")
      .findAllComponents({ name: "OTooltip" })
      .map((tip) => tip.props("content"));
    expect(tips).toContain("Show only Failed");
  });

  it("emits select with the chip key, including a zero-count chip", async () => {
    const w = mountChips();
    await chip(w, "Paused").trigger("click");
    await chip(w, "Failed").trigger("click");
    expect(w.emitted("select")).toEqual([["paused"], ["failed"]]);
  });

  it("has no Clear button: the default chip is the reset", () => {
    const buttons = mountChips({ selectedKey: "failed" }).findAll("button");
    expect(buttons.some((b) => b.text() === "Clear")).toBe(false);
  });

  it("clears a strip with no default on Esc by re-selecting the active chip, the callers' toggle-off", async () => {
    const w = mountChips({ defaultKey: null, selectedKey: "failed" });
    await chip(w, "Active").trigger("keydown", { key: "Escape" });
    expect(w.emitted("select")).toEqual([["failed"]]);
    expect(chip(w, "Failed").classes()).toContain("border-accent");
  });

  it("clears on Esc while focus is in the chip group", async () => {
    const w = mountChips({ selectedKey: "failed" });
    await chip(w, "Active").trigger("keydown", { key: "Escape" });
    expect(w.emitted("select")).toEqual([["total"]]);
    const idle = mountChips();
    await chip(idle, "Active").trigger("keydown", { key: "Escape" });
    expect(idle.emitted("select")).toBeUndefined();
  });

  it("keeps the data-test hooks on the chips", () => {
    const w = mountChips();
    expect(w.get('[data-test="x-failed"]').attributes("aria-pressed")).toBe("false");
    expect(w.get('[data-test="x-total"]').attributes("aria-pressed")).toBe("true");
  });

  it("renders chips whether tray is unset or true", () => {
    expect(mountChips({ tray: true }).html()).toBe(mountChips().html());
  });

  it("renders clickable cards in the caller's order when tray is false", async () => {
    const w = mountChips({ tray: false, selectedKey: "failed" });
    expect(w.find('[role="group"]').exists()).toBe(false);
    expect(w.get('[data-test="o-stat-strip"]').classes()).toContain("flex-wrap");
    const cards = w.findAll("button");
    expect(cards.map((c) => c.attributes("data-test"))[0]).toBe("x-failed");
    expect(cards).toHaveLength(5);
    expect(cards[0].classes()).toEqual(
      expect.arrayContaining(["border-accent", "bg-surface-base", "rounded-default"]),
    );
    expect(cards[1].classes()).toEqual(
      expect.arrayContaining(["border-border-default", "hover:border-accent"]),
    );
    expect(cards[0].attributes("aria-pressed")).toBe("true");
    expect(w.find(".h-1").exists()).toBe(true);
    await cards[1].trigger("click");
    expect(w.emitted("select")).toEqual([["active"]]);
  });

  it("keeps a selectable:false tile an inert card when tray is false", async () => {
    const items = tiles.map((t) => (t.key === "total" ? { ...t, selectable: false } : t));
    const w = mountChips({ tray: false, items });
    const total = w.get('[data-test="x-total"]');
    expect(total.element.tagName).toBe("DIV");
    await total.trigger("click");
    expect(w.emitted("select")).toBeUndefined();
  });

  it("shows a skeleton in each badge until the first load lands", () => {
    const w = mountChips({ loading: true });
    expect(w.findAll('[data-test="o-stat-card-value-skeleton"]')).toHaveLength(5);
  });
});

describe("OStatStrip mixed strip", () => {
  const items = [
    { key: "calls", label: raw("Calls"), value: 40, icon: "hub" as const, selectable: false },
    { key: "err", label: raw("Errors"), value: 3, tone: "error" as const, selectable: false },
    { key: "all", label: raw("All"), value: 40 },
    { key: "slow", label: raw("Slow"), value: 2, tone: "warning" as const },
  ];
  const mountMixed = () =>
    mount(OStatStrip, {
      props: { items, selectable: true, defaultKey: "all", selectedKey: "slow" },
    });

  it("puts the info KPIs first, then a divider, then the chip group", () => {
    const order = mountMixed().get('[data-test="o-stat-strip"]').element.children;
    expect(order[0].getAttribute("data-test")).toBe("o-stat-strip-kpis");
    expect(order[1].getAttribute("data-test")).toBe("o-stat-strip-group-divider");
    expect(order[1].className).toContain("w-px");
    expect(order[2].getAttribute("data-test")).toBe("o-stat-strip-chip-row");
    expect(order[2].querySelector('[role="group"]')?.getAttribute("data-test")).toBe(
      "o-stat-strip-chips",
    );
  });

  it("renders the info items flat and unpressable, with dividers between them", () => {
    const kpis = mountMixed().get('[data-test="o-stat-strip-kpis"]');
    expect(kpis.findAll("button")).toHaveLength(0);
    expect(kpis.find("[aria-pressed]").exists()).toBe(false);
    expect(kpis.findAll('[data-test="o-stat-strip-divider"]')).toHaveLength(1);
    expect(kpis.text()).toContain("Calls");
  });

  it("keeps the info items out of the chip group", () => {
    const labels = mountMixed()
      .get('[role="group"]')
      .findAll('[data-test="o-stat-card-label"]')
      .map((l) => l.text());
    expect(labels).toEqual(["All", "Slow"]);
  });
});

describe("OStatStrip inline KPI line", () => {
  const items = [
    {
      key: "a",
      label: raw("Streams"),
      value: 12,
      icon: "check" as const,
      max: 24,
      dataTest: "x-a",
    },
    {
      key: "w",
      label: raw("Warnings"),
      value: 2,
      icon: "warning" as const,
      tone: "warning" as const,
    },
    { key: "z", label: raw("Errors"), value: 0, icon: "error" as const, tone: "error" as const },
    {
      key: "s",
      label: raw("Calls"),
      value: 5,
      sub: raw("From traces"),
      subIcon: "account-tree" as const,
      trend: { direction: "up" as const, label: raw("12%") },
    },
  ];
  const mountLine = (props: Record<string, unknown> = {}) =>
    mount(OStatStrip, { props: { items, inline: true, ...props } });

  it("renders one flat line with no buttons, borders, bars or padding of its own", () => {
    const w = mountLine();
    expect(w.get('[data-test="o-stat-strip"]').classes()).not.toContain("px-page-edge");
    expect(w.findAll("button")).toHaveLength(0);
    expect(w.find(".h-1").exists()).toBe(false);
    expect(w.find(".border").exists()).toBe(false);
    expect(w.findAll('[data-test="o-stat-strip-divider"]')).toHaveLength(3);
    const first = w.get('[data-test="x-a"]');
    expect(first.classes()).toEqual(expect.arrayContaining(["h-5", "items-center", "pe-3.5"]));
    expect(first.classes()).not.toContain("cursor-pointer");
  });

  it("keeps the icon neutral unless a problem count is non-zero, and mutes zeros", () => {
    const w = mountLine();
    const glyphs = w.findAll('[data-test="o-stat-card-glyph"]').map((g) => g.classes());
    expect(glyphs[0]).toContain("text-text-label");
    expect(glyphs[1]).toContain("text-icon-chip-warning-text");
    expect(glyphs[2]).toContain("text-text-muted");
    const values = w.findAll('[data-test="o-stat-card-value"]').map((v) => v.classes());
    expect(values[0]).toEqual(
      expect.arrayContaining(["text-base", "font-semibold", "text-text-heading", "tabular-nums"]),
    );
    expect(values[2]).toContain("text-text-muted");
  });

  it("shows the trend inline and the qualifier as a labelled glyph", () => {
    const w = mountLine();
    expect(w.text()).toContain("12%");
    expect(w.get('[data-test="o-stat-card-sub-icon"]').attributes("aria-label")).toBe(
      "From traces",
    );
  });

  it("holds a skeleton while first loading, then keeps values through a refresh", async () => {
    const w = mountLine({ loading: true });
    expect(w.findAll('[data-test="o-stat-card-value-skeleton"]')).toHaveLength(4);
    await w.setProps({ loading: false });
    await w.setProps({ loading: true });
    expect(w.find('[data-test="o-stat-card-value-skeleton"]').exists()).toBe(false);
  });

  it("leaves a non-inline read-only strip as cards", () => {
    const w = mountLine({ inline: false });
    expect(w.get('[data-test="o-stat-strip"]').classes()).toContain("flex-wrap");
    expect(w.findAll(".h-1")).toHaveLength(4);
    expect(w.find('[data-test="o-stat-strip-divider"]').exists()).toBe(false);
  });
});

describe("OStatStrip row above a table", () => {
  const chips = [
    { key: "all", label: raw("All"), value: 4 },
    { key: "failed", label: raw("Failed"), value: 1, tone: "error" as const },
  ];
  const rootOf = (props: Record<string, unknown>) =>
    mount(OStatStrip, { props }).get('[data-test="o-stat-strip"]').classes();
  const ROW = ["px-page-edge", "border-b", "border-border-default"];

  it("draws a filter strip as its own padded row with the hairline on top of the table header", () => {
    expect(rootOf({ items: chips, selectable: true, defaultKey: "all" })).toEqual(
      expect.arrayContaining([...ROW, "min-h-12", "py-2"]),
    );
  });

  it("gives an info strip the same row when asked, and none when it sits in a toolbar", () => {
    expect(rootOf({ items: chips, inline: true, row: true })).toEqual(
      expect.arrayContaining([...ROW, "py-1.5"]),
    );
    const toolbar = rootOf({ items: chips, inline: true });
    for (const cls of ROW) expect(toolbar).not.toContain(cls);
  });

  it("lets a filter strip that is not above a table opt out of the row", () => {
    const root = rootOf({ items: chips, selectable: true, defaultKey: "all", row: false });
    for (const cls of ROW) expect(root).not.toContain(cls);
  });

  it("sits inline at its natural width, so a wrapping toolbar moves it to its own line rather than squeezing it", () => {
    const inline = rootOf({ items: chips, selectable: true, defaultKey: "all", row: false });
    expect(inline).toEqual(
      expect.arrayContaining(["basis-auto", "grow-0", "shrink", "min-w-0", "max-md:basis-full"]),
    );
    const kpisOnly = rootOf({ items: [chips[0]], selectable: true, defaultKey: "all", row: false });
    expect(kpisOnly).toContain("basis-auto");
  });
});

describe("OStatStrip with nothing but the reset chip", () => {
  const items = (failed: number) => [
    { key: "databases", label: raw("Databases"), value: 3, icon: "database" as const },
    { key: "calls", label: raw("Calls"), value: 9, selectable: false },
    {
      key: "failed",
      label: raw("Failed"),
      value: failed,
      tone: "error" as const,
      selectable: failed > 0,
    },
  ];
  const mountDb = (failed: number, props: Record<string, unknown> = {}) =>
    mount(OStatStrip, {
      props: { items: items(failed), selectable: true, defaultKey: "databases", ...props },
    });

  it("reads as KPIs, with no chips, while no real filter exists", () => {
    const w = mountDb(0);
    expect(w.find('[role="group"]').exists()).toBe(false);
    expect(w.find("[aria-pressed]").exists()).toBe(false);
    const labels = w.findAll('[data-test="o-stat-card-label"]').map((l) => l.text());
    expect(labels).toEqual(["Databases", "Calls", "Failed"]);
  });

  it("keeps the row's chip height so the chips appearing later never shift the table", () => {
    expect(mountDb(0).get('[data-test="o-stat-strip"]').classes()).toContain("min-h-12");
  });

  it("brings the reset chip back with the first real filter", () => {
    const group = mountDb(2).get('[role="group"]');
    const labels = group.findAll('[data-test="o-stat-card-label"]').map((l) => l.text());
    expect(labels).toEqual(["Databases", "Failed"]);
  });
});

describe("OStatStrip chip overflow", () => {
  const chips = ["all", "a", "b", "c", "d"].map((key, i) => ({
    key,
    label: raw(key),
    value: i,
  }));
  const mountStrip = (props: Record<string, unknown> = {}) =>
    mount(OStatStrip, {
      props: { items: chips, selectable: true, defaultKey: "all", row: false, ...props },
    });
  const size = (el: Element, sizes: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(sizes))
      Object.defineProperty(el, key, { configurable: true, writable: true, value });
  };
  const shown = (w: ReturnType<typeof mountStrip>, hook: string) =>
    !w.get(`[data-test="${hook}"]`).attributes("style")?.includes("none");
  const edges = (w: ReturnType<typeof mountStrip>) => ({
    back: shown(w, "o-stat-strip-fade-back"),
    forward: shown(w, "o-stat-strip-fade-forward"),
  });

  it("shows no fade or button while every chip fits", async () => {
    const w = mountStrip();
    const box = w.get('[data-test="o-stat-strip-chips"]');
    size(box.element, { scrollWidth: 200, clientWidth: 200, scrollLeft: 0 });
    await box.trigger("scroll");
    expect(edges(w)).toEqual({ back: false, forward: false });
  });

  it("fades only the side that can still scroll", async () => {
    const w = mountStrip();
    const box = w.get('[data-test="o-stat-strip-chips"]');
    size(box.element, { scrollWidth: 400, clientWidth: 200, scrollLeft: 0 });
    await box.trigger("scroll");
    expect(edges(w)).toEqual({ back: false, forward: true });
    size(box.element, { scrollLeft: 100 });
    await box.trigger("scroll");
    expect(edges(w)).toEqual({ back: true, forward: true });
    size(box.element, { scrollLeft: 200 });
    await box.trigger("scroll");
    expect(edges(w)).toEqual({ back: true, forward: false });
  });

  it("overlays the fades and buttons so the chips never move", () => {
    const row = mountStrip().get('[data-test="o-stat-strip-chip-row"]');
    expect(row.classes()).toContain("relative");
    for (const side of ["back", "forward"]) {
      const fade = row.get(`[data-test="o-stat-strip-fade-${side}"]`);
      expect(fade.classes()).toContain("absolute");
      expect(fade.find(`[data-test="o-stat-strip-scroll-${side}"]`).exists()).toBe(true);
    }
  });

  it("re-measures when the ResizeObserver reports a new width", async () => {
    let notify: () => void = () => {};
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe = observe;
        disconnect = vi.fn();
      },
    );
    try {
      const w = mountStrip();
      const box = w.get('[data-test="o-stat-strip-chips"]');
      expect(observe).toHaveBeenCalledWith(box.element);
      size(box.element, { scrollWidth: 400, clientWidth: 200, scrollLeft: 0 });
      notify();
      await w.vm.$nextTick();
      expect(edges(w).forward).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("scrolls the chips by most of a view when an edge button is clicked", async () => {
    const w = mountStrip();
    const box = w.get('[data-test="o-stat-strip-chips"]');
    const scrollBy = vi.fn();
    size(box.element, { scrollWidth: 400, clientWidth: 200, scrollLeft: 0, scrollBy });
    await box.trigger("scroll");
    await w.get('[data-test="o-stat-strip-scroll-forward"]').trigger("click");
    expect(scrollBy).toHaveBeenCalledWith({ left: 150, behavior: "smooth" });
  });

  it("turns a vertical wheel into a horizontal scroll only while the chips can move", async () => {
    const w = mountStrip();
    const box = w.get('[data-test="o-stat-strip-chips"]');
    size(box.element, { scrollWidth: 400, clientWidth: 200, scrollLeft: 0 });
    await box.trigger("scroll");
    await box.trigger("wheel", { deltaY: 60, deltaX: 0 });
    expect((box.element as HTMLElement).scrollLeft).toBe(60);
    // At the start a wheel up is left to the page, so the strip never traps its scroll.
    size(box.element, { scrollLeft: 0 });
    await box.trigger("scroll");
    const up = new WheelEvent("wheel", { deltaY: -60, cancelable: true });
    box.element.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
  });
});

describe("OStatStrip multiple", () => {
  const items = [
    { key: "all", label: raw("All"), value: 9 },
    { key: "a", label: raw("Alpha"), value: 3 },
    { key: "b", label: raw("Beta"), value: 4 },
    { key: "c", label: raw("Gamma"), value: 2 },
  ];
  const mountMulti = (selectedKeys: string[]) =>
    mount(OStatStrip, {
      props: { items, selectable: true, multiple: true, defaultKey: "all", selectedKeys },
    });
  const pressed = (w: ReturnType<typeof mountMulti>) =>
    w
      .findAll("[aria-pressed]")
      .filter((b) => b.attributes("aria-pressed") === "true")
      .map((b) => b.text().replace(/\d+$/, "").trim());

  it("presses the default chip while nothing is picked, and each picked chip otherwise", () => {
    expect(pressed(mountMulti([]))).toEqual(["All"]);
    expect(pressed(mountMulti(["a", "c"]))).toEqual(["Alpha", "Gamma"]);
  });

  it("toggles a chip in and out of the selection", async () => {
    const w = mountMulti(["a"]);
    const chip = (label: string) =>
      w.findAll("[aria-pressed]").find((b) => b.text().includes(label))!;
    await chip("Beta").trigger("click");
    await chip("Alpha").trigger("click");
    expect(w.emitted("update:selectedKeys")).toEqual([[["a", "b"]], [[]]]);
  });

  it("empties the selection from the default chip and Esc", async () => {
    const w = mountMulti(["a", "b"]);
    await w
      .findAll("[aria-pressed]")
      .find((b) => b.text().includes("All"))!
      .trigger("click");
    await w.get('[data-test="o-stat-strip-chips"]').trigger("keydown", { key: "Escape" });
    expect(w.emitted("update:selectedKeys")).toEqual([[[]], [[]]]);
  });

  it("tells the user a click adds or removes once something is picked", () => {
    const tips = mountMulti(["a"])
      .findAllComponents({ name: "OTooltip" })
      .map((tip) => tip.props("content"));
    expect(tips).toEqual(expect.arrayContaining(["Stop showing Alpha", "Also show Beta"]));
  });
});
