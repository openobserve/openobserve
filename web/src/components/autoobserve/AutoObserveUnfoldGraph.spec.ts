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

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { gt, raw } from "@/types/i18n";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AutoObserveUnfoldGraph from "./AutoObserveUnfoldGraph.vue";
import type { UnfoldCard } from "./unfold.types";

const mountGraph = (props: InstanceType<typeof AutoObserveUnfoldGraph>["$props"]) =>
  mount(AutoObserveUnfoldGraph, { props, global: { plugins: [i18n] } });

describe("AutoObserveUnfoldGraph on AutoObserve issues", () => {
  it("draws one card per signal with its title and gap, and none of the incident options", () => {
    const unfold: UnfoldCard[] = [
      {
        id: "deploy",
        kind: "change",
        lane: "checkout",
        at: "14:00",
        minute: 0,
        title: raw("Deploy v2"),
        tone: "info",
      },
      {
        id: "errors",
        kind: "metric",
        lane: "checkout",
        at: "14:05",
        minute: 5,
        title: raw("Error rate up"),
        tone: "danger",
      },
      {
        id: "page",
        kind: "outcome",
        outcome: "paged",
        lane: null,
        at: "14:06",
        minute: 6,
        title: raw("Paged on-call"),
        tone: "warning",
        after: "errors",
        via: raw("by policy"),
      },
    ];
    const wrapper = mountGraph({ cards: unfold });
    for (const signal of unfold) {
      const el = wrapper.findAll(`[data-test="autoobserve-unfold-card-${signal.id}"]`);
      expect(el).toHaveLength(1);
      expect(el[0].text()).toContain(signal.title);
      // The name-first card sized to its content is an incident option.
      expect(el[0].find('[data-test^="autoobserve-unfold-title-"]').exists()).toBe(false);
      expect((el[0].element as HTMLElement).style.height).not.toBe("");
      if (signal.via) expect(wrapper.text()).toContain(signal.via);
    }
    expect(wrapper.text()).toMatch(/\+\d+ (min|h|d)|Same minute/);
    expect(wrapper.find('[data-test^="autoobserve-unfold-live-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="autoobserve-unfold-later"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="autoobserve-unfold-detail"]').text()).toContain(
      unfold[0].title,
    );
    wrapper.unmount();
  });
});

const card = (over: Partial<UnfoldCard> & Pick<UnfoldCard, "id">): UnfoldCard => ({
  kind: "alert",
  lane: "api",
  at: "14:00",
  minute: 0,
  title: raw(over.id),
  tone: "info",
  ...over,
});

const remOf = (el: { element: Element }, side: "top" | "left" | "width") =>
  parseFloat((el.element as HTMLElement).style[side]);
const leftOf = (wrapper: ReturnType<typeof mountGraph>, id: string) =>
  (wrapper.get(`[data-test="autoobserve-unfold-card-${id}"]`).element as HTMLElement).style.left;

describe("AutoObserveUnfoldGraph options for incidents", () => {
  it("shares a column between lanes only within columnMinutes, and never with a team card", () => {
    const cards = [
      card({ id: "a", lane: "db", minute: 0 }),
      card({ id: "b", lane: "api", minute: 4 }),
      card({ id: "c", lane: "web", minute: 10, after: "a" }),
      card({
        id: "ack",
        kind: "outcome",
        outcome: "acknowledged",
        lane: null,
        minute: 11,
        after: "c",
      }),
      card({ id: "d", lane: "db", minute: 12, after: "c" }),
    ];
    const plain = mountGraph({ cards });
    expect(leftOf(plain, "b")).not.toBe(leftOf(plain, "a"));
    plain.unmount();

    const wrapper = mountGraph({ cards, columnMinutes: 5 });
    expect(leftOf(wrapper, "b")).toBe(leftOf(wrapper, "a"));
    expect(leftOf(wrapper, "c")).not.toBe(leftOf(wrapper, "a"));
    // The team card drops under its alert; the next alert starts a column of its own.
    expect(leftOf(wrapper, "ack")).toBe(leftOf(wrapper, "c"));
    expect(leftOf(wrapper, "d")).not.toBe(leftOf(wrapper, "c"));
    wrapper.unmount();
  });

  it("draws a service-dependency link dashed and a fired-after link solid", () => {
    const wrapper = mountGraph({
      cards: [
        card({ id: "a", lane: "db" }),
        card({ id: "b", lane: "api", minute: 2, after: "a", dependency: true }),
        card({ id: "c", lane: "api", minute: 3 }),
      ],
    });
    const paths = wrapper.findAll("svg.absolute path");
    expect(paths[0].attributes("stroke-dasharray")).toBeDefined();
    expect(paths[1].attributes("stroke-dasharray")).toBeUndefined();
    wrapper.unmount();
  });

  it("routes a long link along its lane and puts the pill near a target two lanes away", () => {
    const cards = [
      card({ id: "a", lane: "l1", minute: 0 }),
      card({ id: "x", lane: "l2", minute: 10, after: "a" }),
      card({ id: "y", lane: "l2", minute: 20, after: "x" }),
      card({ id: "b", lane: "l3", minute: 30, after: "a" }),
    ];
    const wrapper = mountGraph({ cards, routeAround: true });
    const toB = wrapper.findAll("svg.absolute path").at(-1)!.attributes("d");
    const start = toB.match(/^M([\d.]+),([\d.]+)/)!;
    // Leaves the source sideways, along its own lane, before turning down to the target.
    expect(toB).toMatch(new RegExp(`^M${start[1]},${start[2]} L[\\d.]+,${start[2]} `));
    const pill = wrapper.findAll("span").find((s) => s.text() === "+30 min")!;
    const bLeft = parseFloat(leftOf(wrapper, "b"));
    expect(parseFloat((pill.element as HTMLElement).style.left)).toBeGreaterThan(bLeft - 3.75);
    wrapper.unmount();
  });

  it("states a gap of a day or more in days and hours", () => {
    const wrapper = mountGraph({
      compact: true,
      cards: [card({ id: "a" }), card({ id: "b", minute: 2 * 24 * 60 + 125 })],
    });
    expect(wrapper.findAll("span").some((s) => s.text() === "+2 d 2 h")).toBe(true);
    wrapper.unmount();
  });

  it("shows a card's firing strip, and its own facts in the detail", () => {
    const wrapper = mountGraph({
      cards: [
        card({
          id: "a",
          count: 12,
          strip: [1, 0, 3],
          facts: [{ key: "median", label: raw("Median interval"), value: raw("3 min") }],
        }),
      ],
    });
    expect(wrapper.findAll('[data-test="autoobserve-unfold-strip-a"] > span')).toHaveLength(3);
    const detail = wrapper.get('[data-test="autoobserve-unfold-detail"]');
    expect(detail.text()).toContain("Median interval");
    expect(detail.text()).toContain("3 min");
    expect(detail.text()).not.toContain(gt("autoobserve.unfold.when"));
    wrapper.unmount();
  });

  it("lists a fold card's alerts and asks to expand its lane", async () => {
    const wrapper = mountGraph({
      cards: [
        card({ id: "a", lane: "db" }),
        card({
          id: "fold-db",
          kind: "fold",
          lane: "db",
          minute: 5,
          title: raw("+2 more alerts"),
          tone: "neutral",
          folded: [
            { id: "x", title: raw("disk_io_high"), at: "14:05", count: 3 },
            { id: "y", title: raw("replica_lag"), at: "14:07", count: 1 },
          ],
        }),
      ],
    });
    await wrapper.get('[data-test="autoobserve-unfold-card-fold-db"]').trigger("click");
    const detail = wrapper.get('[data-test="autoobserve-unfold-detail"]');
    expect(detail.text()).toContain("disk_io_high");
    expect(detail.text()).toContain("replica_lag");
    await detail.get('[data-test="autoobserve-unfold-expand-lane"]').trigger("click");
    expect(wrapper.emitted("expand-lane")).toEqual([["db"]]);
    wrapper.unmount();
  });

  it("expands a fold by its own key and names its button", async () => {
    const wrapper = mountGraph({
      cards: [
        card({ id: "a", lane: "db" }),
        card({
          id: "fold-services",
          kind: "fold",
          lane: "+2 more services",
          minute: 5,
          title: raw("+2 more services"),
          tone: "neutral",
          expandKey: "fold-services",
          expandLabel: raw("Show every service"),
          folded: [{ id: "x", title: raw("web"), at: "14:05", count: 1 }],
        }),
      ],
    });
    await wrapper.get('[data-test="autoobserve-unfold-card-fold-services"]').trigger("click");
    const button = wrapper.get('[data-test="autoobserve-unfold-expand-lane"]');
    expect(button.text()).toBe("Show every service");
    await button.trigger("click");
    expect(wrapper.emitted("expand-lane")).toEqual([["fold-services"]]);
    wrapper.unmount();
  });

  it("formats every count in the app's locale", async () => {
    const before = i18n.global.locale;
    i18n.global.locale = "de";
    try {
      const wrapper = mountGraph({
        compact: true,
        cards: [
          card({ id: "a", count: 1200 }),
          card({
            id: "fold-api",
            kind: "fold",
            minute: 5,
            title: raw("+2 more alerts"),
            tone: "neutral",
            folded: [{ id: "x", title: raw("disk_io_high"), at: "14:05", count: 4500 }],
          }),
        ],
      });
      expect(wrapper.get('[data-test="autoobserve-unfold-card-a"]').text()).toContain("×1.200");
      await wrapper.get('[data-test="autoobserve-unfold-card-fold-api"]').trigger("click");
      expect(wrapper.get('[data-test="autoobserve-unfold-detail"]').text()).toContain("×4.500");
      wrapper.unmount();
    } finally {
      i18n.global.locale = before;
    }
  });

  describe("selection when the cards change", () => {
    const detailText = (wrapper: ReturnType<typeof mountGraph>) =>
      wrapper.get('[data-test="autoobserve-unfold-detail"]').text();
    const select = (wrapper: ReturnType<typeof mountGraph>, id: string) =>
      wrapper.get(`[data-test="autoobserve-unfold-card-${id}"]`).trigger("click");

    it("selects the new first card, as on another AutoObserve issue", async () => {
      const wrapper = mountGraph({
        cards: [card({ id: "alpha" }), card({ id: "bravo", minute: 1 })],
      });
      await select(wrapper, "bravo");
      await wrapper.setProps({
        cards: [card({ id: "charlie" }), card({ id: "bravo", minute: 1 })],
      });
      expect(detailText(wrapper)).toContain("charlie");
      wrapper.unmount();
    });
  });

  describe("the Later cue in a right-to-left layout", () => {
    const sizeScroller = (el: HTMLElement, scrollLeft: number) => {
      Object.defineProperty(el, "clientWidth", { configurable: true, value: 400 });
      Object.defineProperty(el, "scrollWidth", { configurable: true, value: 1000 });
      el.scrollLeft = scrollLeft;
    };

    it("hides at the scroll end, whose scrollLeft is negative", async () => {
      document.documentElement.dir = "rtl";
      try {
        const cards = Array.from({ length: 6 }, (_, i) => card({ id: `c${i}`, minute: i * 10 }));
        const wrapper = mountGraph({ cards, scrollCue: true });
        const scroller = wrapper.get(".overflow-x-auto");
        sizeScroller(scroller.element as HTMLElement, 0);
        await scroller.trigger("scroll");
        expect(wrapper.find('[data-test="autoobserve-unfold-later"]').exists()).toBe(true);

        sizeScroller(scroller.element as HTMLElement, -600);
        await scroller.trigger("scroll");
        expect(wrapper.find('[data-test="autoobserve-unfold-later"]').exists()).toBe(false);
        wrapper.unmount();
      } finally {
        document.documentElement.dir = "ltr";
      }
    });
  });

  it("pads one column gap after the last column when it cues later cards", () => {
    const cards = [card({ id: "a" }), card({ id: "b", minute: 1 })];
    const plain = mountGraph({ cards });
    const cued = mountGraph({ cards, scrollCue: true });
    const widthOf = (w: ReturnType<typeof mountGraph>) =>
      parseFloat((w.get(".relative.min-w-full").element as HTMLElement).style.width);
    expect(widthOf(cued) - widthOf(plain)).toBeCloseTo(3.75);
    plain.unmount();
    cued.unmount();
  });

  describe("compact cards", () => {
    const cardEl = (wrapper: ReturnType<typeof mountGraph>, id: string) =>
      wrapper.get(`[data-test="autoobserve-unfold-card-${id}"]`);

    it("leads with the name, then the range and its tag, then the count and the state in words", () => {
      const wrapper = mountGraph({
        compact: true,
        cards: [
          card({
            id: "a",
            at: "20:45",
            until: "21:35",
            count: 3,
            tag: "alerts.incidents.unfold.firstToFire",
            live: { firing: true, label: raw("Firing now"), tone: "warning" },
          }),
          card({
            id: "b",
            minute: 1,
            detail: raw("Fired once"),
            live: { firing: false, label: raw("Quiet now") },
          }),
        ],
      });
      expect(cardEl(wrapper, "a").text()).toMatch(
        /^a\s*20:45 → 21:35\s*First to fire\s*×3\s*Firing now$/,
      );
      expect(cardEl(wrapper, "b").text()).toMatch(/^b\s*14:00\s*Fired once\s*Quiet now$/);
      wrapper.unmount();
    });

    it("sizes each lane to its tallest card, so a one-line name leaves no empty row", () => {
      const topOf = (title: string) => {
        const wrapper = mountGraph({
          compact: true,
          cards: [card({ id: "a", title: raw(title) }), card({ id: "b", lane: "db", minute: 1 })],
        });
        const top = remOf(wrapper.get('[data-test="autoobserve-unfold-card-b"]'), "top");
        wrapper.unmount();
        return top;
      };
      expect(topOf("VPC_Flow_Rejected_To_A_Remote_Administration_Port")).toBeGreaterThan(
        topOf("short"),
      );
    });

    it("steps each column right by `step`, never into a card still in its lane", () => {
      const wrapper = mountGraph({
        compact: true,
        step: 3,
        columnMinutes: 5,
        cards: [
          card({ id: "a", minute: 0 }),
          card({ id: "b", lane: "db", minute: 10 }),
          card({ id: "c", lane: "web", minute: 20 }),
          card({ id: "a2", minute: 30 }),
          card({ id: "ack", kind: "outcome", lane: null, minute: 40 }),
        ],
      });
      const el = (id: string) => wrapper.get(`[data-test="autoobserve-unfold-card-${id}"]`);
      const [a, b, c, a2] = ["a", "b", "c", "a2"].map((id) => remOf(el(id), "left"));
      expect([b - a, c - b]).toEqual([3, 3]);
      expect(a2).toBeGreaterThan(a + remOf(el("a"), "width"));
      const labelLeft = (name: string) =>
        (wrapper.findAll("span").find((s) => s.text() === name)!.element as HTMLElement).style.left;
      expect(["db", "web", "Your team"].map(labelLeft)).toEqual(
        ["b", "c", "a"].map((id) => leftOf(wrapper, id)),
      );
      wrapper.unmount();
    });

    it("folds the legend items that do not fit its row into a count that names them", async () => {
      const sizes = { offsetWidth: 100, clientWidth: 350 };
      for (const [name, value] of Object.entries(sizes)) {
        vi.spyOn(HTMLElement.prototype, name as keyof typeof sizes, "get").mockReturnValue(value);
      }
      const wrapper = mountGraph({
        compact: true,
        cards: [card({ id: "a" })],
        legend: ["one", "two", "three", "four", "five"].map((key) => ({
          key,
          label: raw(key),
          tone: "info" as const,
        })),
      });
      await flushPromises();
      const legend = wrapper.findAll('[data-test^="autoobserve-unfold-legend-"]');
      expect(legend.map((li) => li.text())).toEqual(["one", "two", "three", "+2"]);
      expect(legend[3].findComponent(OTooltip).props("content")).toBe("four and five");
      vi.restoreAllMocks();
      wrapper.unmount();
    });
  });

  describe("a page's own panel for some cards", () => {
    const cards = [
      card({ id: "a" }),
      card({ id: "team", kind: "outcome", lane: null, minute: 2, outcome: "open" }),
    ];

    it("starts with nothing selected and asks the page to open its panel", async () => {
      const wrapper = mountGraph({ cards, selection: null, panelKinds: ["alert"] });
      expect(wrapper.findAll('[aria-pressed="true"]')).toHaveLength(0);
      expect(wrapper.find('[data-test="autoobserve-unfold-detail"]').exists()).toBe(false);
      await wrapper.get('[data-test="autoobserve-unfold-card-a"]').trigger("click");
      expect(wrapper.emitted("update:selection")).toEqual([["a"]]);
      await wrapper.setProps({ selection: "a" });
      expect(
        wrapper.get('[data-test="autoobserve-unfold-card-a"]').attributes("aria-pressed"),
      ).toBe("true");
      expect(wrapper.find('[data-test="autoobserve-unfold-detail"]').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  it("scrolls toward later cards when the Later cue is clicked", async () => {
    const cards = Array.from({ length: 6 }, (_, i) => card({ id: `c${i}`, minute: i * 10 }));
    const wrapper = mountGraph({ cards, scrollCue: true });
    const scroller = wrapper.get(".overflow-x-auto").element as HTMLElement;
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 1000 });
    scroller.scrollBy = vi.fn();
    await wrapper.get(".overflow-x-auto").trigger("scroll");
    await wrapper.get('[data-test="autoobserve-unfold-later"] button').trigger("click");
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 320, behavior: "smooth" });
    wrapper.unmount();
  });
});

const liveCard = (over: Partial<UnfoldCard> & Pick<UnfoldCard, "id">): UnfoldCard => ({
  kind: "log",
  lane: "a",
  at: "4:45 PM",
  minute: 0,
  title: raw("Stopped sending data"),
  detail: raw("logs stream"),
  tone: "danger",
  ...over,
});

const liveCards: UnfoldCard[] = [
  liveCard({ id: "stream:a" }),
  liveCard({ id: "stream:b", lane: "b" }),
  liveCard({
    id: "page",
    kind: "outcome",
    outcome: "paged",
    lane: null,
    minute: 20,
    after: "stream:a",
  }),
  liveCard({
    id: "back:a",
    kind: "outcome",
    outcome: "resolved",
    minute: 75,
    title: raw("Sending data again"),
    tone: "success",
    after: "stream:a",
  }),
  liveCard({
    id: "ack",
    kind: "outcome",
    outcome: "resolved",
    lane: null,
    minute: 90,
    after: "stream:b",
  }),
];

const draw = () => mountGraph({ cards: liveCards, liveIssue: true });
const sel = (id: string) => `[data-test="autoobserve-unfold-card-${id}"]`;

describe("AutoObserveUnfoldGraph on a live AutoObserve issue", () => {
  it("stacks same-minute cards of different lanes in one column", () => {
    const w = draw();
    const left = (id: string) =>
      w
        .get(sel(id))
        .attributes("style")
        ?.match(/left: ([\d.]+)rem/)?.[1];
    expect(left("stream:a")).toBe(left("stream:b"));
    expect(Number(left("back:a"))).toBeGreaterThan(Number(left("stream:a")));
    // Cards that happened together are not a sequence, so nothing links them.
    expect(w.find('[data-test="autoobserve-unfold-edge-stream:a>stream:b"]').exists()).toBe(false);
  });

  it("routes a link between lanes through the column gaps, never under a card", () => {
    const w = draw();
    const d = w.get('[data-test="autoobserve-unfold-edge-stream:b>ack"]').attributes("d") ?? "";
    expect(d).not.toContain("C");
    const lefts = w
      .findAll('[data-test^="autoobserve-unfold-card-"]')
      .map((c) => Number(c.attributes("style")?.match(/left: ([\d.]+)rem/)?.[1]));
    const verticals = [...d.matchAll(/H([\d.]+) V/g)].map((m) => Number(m[1]));
    expect(verticals.length).toBeGreaterThan(0);
    for (const x of verticals) expect(lefts.some((l) => x > l && x < l + 11)).toBe(false);
  });

  it("labels only links inside one lane, on one line", () => {
    const w = draw();
    const labels = w.findAll("span.whitespace-nowrap.rounded-full");
    expect(labels.map((l) => l.text())).toEqual(["+1h 15m"]);
  });

  it("gives a card that came back its stream line, and keys outcomes in the legend", () => {
    const w = draw();
    expect(w.get(sel("back:a")).text()).toContain("a");
    expect(w.get(sel("back:a")).text()).toContain("logs stream");
    const legend = w.get('[aria-label="Card types"]').text();
    expect(legend).toContain("Log");
    expect(legend).toContain("Paged");
    expect(legend).toContain("Back or resolved");
  });
});
