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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import type { OverviewNowRow, OverviewNowSnapshot } from "@/composables/contextProviders/types";
import i18n from "@/locales";

import { alertRow, anomalyRow, incidentRow, serviceRow } from "./homeFixtures";
import HomeNeedsAttention from "./HomeNeedsAttention.vue";

const snapshotOf = (rows: OverviewNowRow[]): OverviewNowSnapshot => ({
  rows,
  selectedKey: null,
  window: { start: 0, end: 1 },
  services: { available: true, partial: false, dataUntil: null, window: null, allRegions: false },
  noData: false,
});

const mountList = (rows: OverviewNowRow[], extra: Record<string, unknown> = {}) =>
  mount(HomeNeedsAttention, {
    props: { snapshot: snapshotOf(rows), ...extra },
    global: { plugins: [i18n] },
  });

const minutesAgoUs = (minutes: number) => (Date.now() - minutes * 60_000) * 1000;

const detail = (wrapper: ReturnType<typeof mountList>, key: string) =>
  wrapper.get(`[data-test="home-attention-row-${key}"] [data-test="home-attention-detail"]`).text();

describe("HomeNeedsAttention", () => {
  it("keeps the heading and View All with no rows, and no list", () => {
    const wrapper = mountList([]);
    expect(wrapper.get("h2").text()).toBe("Needs Attention");
    expect(wrapper.find('[data-test="home-attention-view-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="home-attention-rows"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="home-attention-empty"]').exists()).toBe(false);
  });

  it("while loading, shows one busy card of three skeleton rows shaped like real rows, and no message", () => {
    const wrapper = mountList([], { empty: "clear", loading: true });
    const card = wrapper.get('[data-test="home-attention-loading"]');
    expect(card.attributes("aria-busy")).toBe("true");
    expect(card.classes()).toEqual(
      expect.arrayContaining(["rounded-surface", "bg-surface-panel", "border"]),
    );
    expect(card.get(".sr-only").text()).toBe("Loading");
    expect(card.get("ul").attributes("aria-hidden")).toBe("true");
    const rows = card.findAll('[data-test="home-attention-skeleton-row"]');
    expect(rows).toHaveLength(3);
    const widths = rows.map((row) =>
      row.findAll('[role="status"]').map((bar) => bar.classes().join(" ")),
    );
    expect(widths.flat().join(" ")).toMatch(/w-11\/20.*w-7\/20.*w-7\/10.*w-2\/5.*w-9\/20.*w-3\/10/);
    for (const row of rows) {
      expect(row.classes()).toEqual(
        expect.arrayContaining(["border-t-[0.0625em]", "py-3", "px-3.5"]),
      );
      expect(row.find(".rounded-full.size-2").exists()).toBe(true);
    }
    expect(wrapper.find('[data-test="home-attention-empty"]').exists()).toBe(false);
  });

  it.each([
    ["clear", "All Clear", "No open incidents", "text-status-success-text"],
    ["no-data", "No Data Yet", "Nothing is being monitored", "text-status-info-text"],
    ["failed", "Couldn't Load Everything", "may be incomplete", "text-status-warning-text"],
  ])("explains %s with the right tone", (empty, title, body, tone) => {
    const wrapper = mountList([], { empty });
    const card = wrapper.get('[data-test="home-attention-empty"]');
    expect(card.text()).toContain(title);
    expect(card.text()).toContain(body);
    expect(wrapper.get('[data-test="home-attention-empty-icon"]').classes()).toContain(tone);
    expect(wrapper.find('[data-test="home-attention-retry"]').exists()).toBe(empty === "failed");
  });

  it("draws an icon tile with the matching tint, and no buttons on clear", () => {
    const tiles = {
      clear: "bg-status-success-bg",
      "no-data": "bg-status-info-bg",
      failed: "bg-status-warning-bg",
    };
    for (const [empty, tint] of Object.entries(tiles)) {
      const tile = mountList([], { empty }).get('[data-test="home-attention-empty-tile"]');
      expect(tile.classes()).toEqual(expect.arrayContaining(["rounded-default", "size-10", tint]));
    }
    expect(
      mountList([], { empty: "clear" }).find('[data-test="home-attention-empty-actions"]').exists(),
    ).toBe(false);
  });

  it("offers only Send Data on no-data, and Retry only on failed", async () => {
    const wrapper = mountList([], { empty: "no-data" });
    expect(wrapper.find('[data-test="home-attention-retry"]').exists()).toBe(false);
    await wrapper.get('[data-test="home-attention-send-data"]').trigger("click");
    expect(wrapper.find('[data-test="home-attention-create-alert"]').exists()).toBe(false);
    expect(wrapper.emitted("sendData")).toHaveLength(1);
    const failed = mountList([], { empty: "failed" });
    expect(failed.find('[data-test="home-attention-send-data"]').exists()).toBe(false);
    expect(
      failed
        .get('[data-test="home-attention-empty-actions"] [data-test="home-attention-retry"]')
        .exists(),
    ).toBe(true);
  });

  it("never gives no-data a success tone", () => {
    const icon = mountList([], { empty: "no-data" }).get('[data-test="home-attention-empty-icon"]');
    expect(icon.classes()).not.toContain("text-status-success-text");
  });

  it("asks to retry from the failed card", async () => {
    const wrapper = mountList([], { empty: "failed" });
    await wrapper.get('[data-test="home-attention-retry"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("shows rows, not the empty card, when there are rows", () => {
    const wrapper = mountList([alertRow("a-1")], { empty: "clear" });
    expect(wrapper.find('[data-test="home-attention-empty"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="home-attention-rows"]').exists()).toBe(true);
  });

  it("lists each kind in the order given, in one divided card as wide as the Ask box, each with its kind", () => {
    const wrapper = mountList([
      incidentRow("inc-1", { title: "Checkout 5xx" }),
      serviceRow("payments", { signal: "latency", p99Ratio: 3 }),
      alertRow("disk", { name: "disk-full" }),
      anomalyRow("spike"),
    ]);
    const section = wrapper.get('[data-test="home-attention"]');
    expect(section.classes()).toEqual(expect.arrayContaining(["mx-auto", "max-w-3xl"]));
    expect(section.get("h2").text()).toBe("Needs Attention");
    const card = wrapper.get('[data-test="home-attention-rows"]');
    expect(card.classes()).toEqual(
      expect.arrayContaining([
        "rounded-surface",
        "bg-surface-panel",
        "border",
        "overflow-y-auto",
        "min-h-0",
      ]),
    );
    const rows = wrapper.findAll('[data-test^="home-attention-row-"]');
    expect(rows.map((row) => row.attributes("data-kind"))).toEqual([
      "incident",
      "service",
      "alert",
      "anomaly",
    ]);
    for (const row of rows) {
      expect(row.classes()).toEqual(
        expect.arrayContaining(["border-t-[0.0625em]", "first:border-t-0", "cursor-pointer"]),
      );
      expect(row.classes()).not.toContain("rounded-surface");
    }
    expect(rows.map((row) => row.get('[data-test="home-attention-kind"]').text())).toEqual([
      "Incident",
      "Service",
      "Alert",
      "Anomaly",
    ]);
    expect(rows[0].get('[data-test="home-attention-sentence"]').text()).toContain("Checkout 5xx");
    expect(rows[0].find('[data-test="home-attention-severity"]').exists()).toBe(true);
    expect(rows[1].find('[data-test="home-attention-severity"]').exists()).toBe(false);
    expect(rows[1].get('[data-test="home-attention-sentence"]').text()).toContain("payments");
    expect(rows[2].get('[data-test="home-attention-sentence"]').text()).toContain("disk-full");
  });

  describe("the second line", () => {
    it("gives a service its baseline, when it went bad in Home's timezone with the full date on hover, and the missing alert", () => {
      const changedAt = Date.UTC(2026, 0, 2, 9, 41) * 1000;
      const wrapper = mountList(
        [
          serviceRow("checkout", {
            errorRate: 6.1,
            baselineErrorRate: 0.4,
            coverage: "none",
            changedAt,
          }),
          serviceRow("cart", { coverage: "unknown", changedAt }),
        ],
        { timezone: "UTC" },
      );
      expect(detail(wrapper, "service:checkout")).toBe(
        "6.1% vs 0.4% (previous 24 h) · since 09:41 · No alert matches this service",
      );
      const row = wrapper.get('[data-test="home-attention-row-service:checkout"]');
      expect(row.get('[data-test="home-attention-since"]').attributes("title")).toBe(
        "2026-01-02 09:41 (UTC)",
      );
      expect(row.get('[data-test="home-attention-no-alert"]').classes()).toContain(
        "text-status-warning-text",
      );
      expect(detail(wrapper, "service:cart")).toContain("alert coverage unknown");
    });

    it("says a service has no baseline yet, gives a slow one its p99 time, and never repeats the sentence's own figure", () => {
      const wrapper = mountList([
        serviceRow("fresh", {
          baselineErrorRate: null,
          baselineHours: null,
          coverage: "covered",
          changedAt: 0,
        }),
        serviceRow("slow", { signal: "latency", p99Ms: 900, coverage: "covered", changedAt: 0 }),
        serviceRow("bare", { signal: "latency", p99Ms: null, coverage: "covered", changedAt: 0 }),
      ]);
      expect(detail(wrapper, "service:fresh")).toBe("Not enough history for a baseline");
      expect(detail(wrapper, "service:slow")).toBe("p99 900 ms");
      expect(
        wrapper
          .find('[data-test="home-attention-row-service:bare"] [data-test="home-attention-detail"]')
          .exists(),
      ).toBe(false);
    });

    it("counts an alert's fires with a plural and says when it last fired or recovered", () => {
      const wrapper = mountList([
        alertRow("once", { count: 1, lastAt: minutesAgoUs(12) }),
        alertRow("often", { count: 3, lastAt: minutesAgoUs(5) }),
        alertRow("flap", {
          state: "recovered",
          bucket: "recovered",
          count: 2,
          lastAt: minutesAgoUs(3),
        }),
        alertRow("unknown", { count: 2, lastAt: 0 }),
      ]);
      expect(detail(wrapper, "alert:once")).toBe("Fired 1 time · last 12 min ago");
      expect(detail(wrapper, "alert:often")).toBe("Fired 3 times · last 5 min ago");
      expect(detail(wrapper, "alert:flap")).toBe("Fired 2 times · recovered 3 min ago");
      expect(detail(wrapper, "alert:unknown")).toBe("Fired 2 times");
    });

    it("counts an incident's alerts with a plural and says when it opened, from the incident and not from when Home listed it", () => {
      const wrapper = mountList(
        [
          incidentRow("one", { alertCount: 1, changedAt: minutesAgoUs(1) }),
          incidentRow("many", { alertCount: 4, changedAt: minutesAgoUs(1) }),
        ],
        {
          rowMeta: {
            "incident:one": {
              service: null,
              repeats: 1,
              flapping: false,
              openedAt: minutesAgoUs(14),
            },
          },
        },
      );
      expect(detail(wrapper, "incident:one")).toBe("1 alert · opened 14 min ago");
      expect(detail(wrapper, "incident:many")).toBe("4 alerts");
    });

    it("names an anomaly's stream and when it last saw one", () => {
      const wrapper = mountList([anomalyRow("spike", { stream: "web_logs", at: minutesAgoUs(7) })]);
      expect(detail(wrapper, "anomaly:spike")).toBe("web_logs · last 7 min ago");
    });

    it("keeps the second line to one cut line in the secondary colour", () => {
      const line = mountList([alertRow("a-1")]).get('[data-test="home-attention-detail"]');
      expect(line.classes()).toEqual(
        expect.arrayContaining(["truncate", "text-xs", "text-text-secondary"]),
      );
    });
  });

  describe("row actions", () => {
    const rows = [incidentRow("inc-1"), serviceRow("cart"), alertRow("a-1"), anomalyRow("an-1")];

    it("with the Ask box on screen, offers Add to Chat, Investigate and the open arrow on every row", () => {
      const wrapper = mountList(rows, { assistant: true });
      for (const row of rows) {
        const actions = wrapper.get(
          `[data-test="home-attention-row-${row.key}"] [data-test="home-attention-actions"]`,
        );
        expect(actions.findAll("button").map((b) => b.attributes("data-test"))).toEqual([
          "home-attention-add",
          "home-attention-investigate",
          "home-attention-open",
        ]);
      }
    });

    it("without the Ask box, offers only the open arrow", () => {
      const wrapper = mountList(rows);
      expect(wrapper.findAll('[data-test="home-attention-add"]')).toHaveLength(0);
      expect(wrapper.findAll('[data-test="home-attention-investigate"]')).toHaveLength(0);
      expect(wrapper.findAll('[data-test="home-attention-open"]')).toHaveLength(rows.length);
    });

    it("emits each action once for its own row and never opens the row from Add to Chat or Investigate", async () => {
      const wrapper = mountList(rows, { assistant: true });
      for (const row of rows) {
        const within = (id: string) =>
          wrapper.get(`[data-test="home-attention-row-${row.key}"] [data-test="${id}"]`);
        await within("home-attention-add").trigger("click");
        await within("home-attention-investigate").trigger("click");
        await within("home-attention-open").trigger("click");
        await wrapper.get(`[data-test="home-attention-row-${row.key}"]`).trigger("click");
      }
      expect(wrapper.emitted("addToChat")).toEqual(rows.map((row) => [row]));
      expect(wrapper.emitted("investigate")).toEqual(rows.map((row) => [row]));
      expect(wrapper.emitted("open")).toEqual(rows.flatMap((row) => [[row], [row]]));
    });

    it("hides Add to Chat and Investigate until the row is hovered or holds keyboard focus, and always shows them on touch and phones", () => {
      const wrapper = mountList([alertRow("a-1")], { assistant: true });
      expect(wrapper.get('[data-test="home-attention-row-alert:a-1"]').classes()).toEqual(
        expect.arrayContaining([
          "group",
          "focus-within:bg-table-row-hover-bg",
          "has-[:focus-visible]:ring-2",
        ]),
      );
      for (const id of ["home-attention-add", "home-attention-investigate"]) {
        const button = wrapper.get(`[data-test="${id}"]`);
        expect(button.element.tagName).toBe("BUTTON");
        expect(button.attributes("tabindex")).not.toBe("-1");
        expect(button.classes()).toEqual(
          expect.arrayContaining([
            "opacity-0",
            "group-hover:opacity-100",
            "group-focus-within:opacity-100",
            "max-md:opacity-100",
            "pointer-coarse:opacity-100",
          ]),
        );
      }
      expect(wrapper.get('[data-test="home-attention-open"]').classes()).not.toContain("opacity-0");
    });

    it("names each action by its row, and turns Add to Chat into a pressed, always shown Remove From Chat once added", () => {
      const row = alertRow("a-1", { name: "disk-full" });
      const wrapper = mountList([row], { assistant: true });
      const add = () => wrapper.get('[data-test="home-attention-add"]');
      expect(add().attributes("aria-label")).toBe("Add disk-full firing to Chat");
      expect(add().attributes("aria-pressed")).toBe("false");
      expect(wrapper.get('[data-test="home-attention-investigate"]').attributes("aria-label")).toBe(
        "Investigate disk-full firing",
      );
      expect(wrapper.get('[data-test="home-attention-open"]').attributes("aria-label")).toBe(
        "Open disk-full firing",
      );
      const added = mountList([row], { assistant: true, addedKeys: [row.key] }).get(
        '[data-test="home-attention-add"]',
      );
      expect(added.attributes("aria-label")).toBe("Remove disk-full firing From Chat");
      expect(added.attributes("aria-pressed")).toBe("true");
      expect(added.classes()).not.toContain("opacity-0");
    });

    it.each([
      ["service", serviceRow("cart"), "View Traces"],
      ["alert", alertRow("a-1"), "View Alert History"],
      ["incident", incidentRow("inc-1"), "Open Incident"],
      ["anomaly", anomalyRow("an-1"), "View Anomaly History"],
    ])(
      "says where the open arrow of a %s row lands, on keyboard focus",
      async (_kind, row, tip) => {
        const wrapper = mount(HomeNeedsAttention, {
          props: { snapshot: snapshotOf([row]) },
          global: { plugins: [i18n] },
          attachTo: document.body,
        });
        const button = wrapper.get('[data-test="home-attention-open"]').element;
        // jsdom computes no display:contents, so the anchor may be OButton's inner wrapper instead of the button.
        const trigger = button.hasAttribute("data-o-tooltip-trigger")
          ? button
          : button.querySelector("[data-o-tooltip-trigger]");
        expect(document.body.textContent).not.toContain(tip);
        trigger?.dispatchEvent(new FocusEvent("focus"));
        await flushPromises();
        await vi.waitFor(() => expect(document.body.textContent).toContain(tip));
        wrapper.unmount();
      },
    );

    it("asks for all rows with View All without opening one", async () => {
      const wrapper = mountList([alertRow("a-1")]);
      const all = wrapper.get('[data-test="home-attention-view-all"]');
      expect(all.text()).toBe("View All");
      await all.trigger("click");
      expect(wrapper.emitted("viewAll")).toHaveLength(1);
      expect(wrapper.emitted("open")).toBeUndefined();
    });
  });
});
