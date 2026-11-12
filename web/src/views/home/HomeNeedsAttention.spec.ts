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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import type {
  OverviewNowRow,
  OverviewNowSnapshot,
} from "@/composables/contextProviders/types";
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

describe("HomeNeedsAttention", () => {
  it("keeps the heading and View All with no rows, and no list", () => {
    const wrapper = mountList([]);
    expect(wrapper.get("h2").text()).toBe("Needs Attention");
    expect(wrapper.find('[data-test="home-attention-view-all"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="home-attention-rows"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="home-attention-empty"]').exists()).toBe(false);
  });

  it("shows a skeleton instead of any message while loading", () => {
    const wrapper = mountList([], { empty: "clear", loading: true });
    expect(wrapper.find('[data-test="home-attention-loading"]').exists()).toBe(true);
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
    const tiles = { clear: "bg-status-success-bg", "no-data": "bg-status-info-bg", failed: "bg-status-warning-bg" };
    for (const [empty, tint] of Object.entries(tiles)) {
      const tile = mountList([], { empty }).get('[data-test="home-attention-empty-tile"]');
      expect(tile.classes()).toEqual(expect.arrayContaining(["rounded-default", "size-10", tint]));
    }
    expect(mountList([], { empty: "clear" }).find('[data-test="home-attention-empty-actions"]').exists()).toBe(false);
  });

  it("offers only Send Data on no-data, and Retry only on failed", async () => {
    const wrapper = mountList([], { empty: "no-data" });
    expect(wrapper.find('[data-test="home-attention-retry"]').exists()).toBe(false);
    await wrapper.get('[data-test="home-attention-send-data"]').trigger("click");
    expect(wrapper.find('[data-test="home-attention-create-alert"]').exists()).toBe(false);
    expect(wrapper.emitted("sendData")).toHaveLength(1);
    const failed = mountList([], { empty: "failed" });
    expect(failed.find('[data-test="home-attention-send-data"]').exists()).toBe(false);
    expect(failed.get('[data-test="home-attention-empty-actions"] [data-test="home-attention-retry"]').exists()).toBe(true);
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

  it("lists each kind in the order given under a Needs Attention heading, as wide as the Ask box", () => {
    const wrapper = mountList([
      incidentRow("inc-1", { title: "Checkout 5xx", changedAt: (Date.now() - 14 * 60_000) * 1000 }),
      serviceRow("payments", { signal: "latency", p99Ratio: 3 }),
      alertRow("disk", { name: "disk-full" }),
    ]);
    const section = wrapper.get('[data-test="home-attention"]');
    expect(section.classes()).toEqual(expect.arrayContaining(["mx-auto", "max-w-3xl"]));
    expect(section.get("h2").text()).toBe("Needs Attention");
    const rows = wrapper.findAll('[data-test^="home-attention-row-"]');
    expect(rows.map((row) => row.attributes("data-kind"))).toEqual(["incident", "service", "alert"]);
    expect(rows[0].get('[data-test="home-attention-sentence"]').text()).toContain("Checkout 5xx");
    expect(rows[0].get('[data-test="home-attention-age"]').text()).toBe("14 min");
    expect(rows[0].find('[data-test="home-attention-severity"]').exists()).toBe(true);
    expect(rows[1].get('[data-test="home-attention-sentence"]').text()).toContain("payments");
    expect(rows[1].find('[data-test="home-attention-age"]').exists()).toBe(false);
    expect(rows[2].get('[data-test="home-attention-sentence"]').text()).toContain("disk-full");
    for (const row of rows) {
      const actions = row.findAll("button");
      expect(actions).toHaveLength(1);
      expect(actions[0].text()).toBe("Open");
    }
    expect(wrapper.find('[data-test="home-now-row-investigate"]').exists()).toBe(false);
  });

  it("opens a row from its Open button once, or from a click anywhere on it, for every kind", async () => {
    const rows = [incidentRow("inc-1"), serviceRow("cart"), alertRow("a-1"), anomalyRow("an-1")];
    const wrapper = mountList(rows);
    for (const row of rows) {
      await wrapper.get(`[data-test="home-attention-row-${row.key}"] button`).trigger("click");
      await wrapper.get(`[data-test="home-attention-row-${row.key}"]`).trigger("click");
    }
    expect(wrapper.emitted("open")).toEqual(rows.flatMap((row) => [[row], [row]]));
  });

  it("names each Open by its row and asks for all of them with View All", async () => {
    const wrapper = mountList([alertRow("a-1", { name: "disk-full" })]);
    expect(wrapper.get('[data-test="home-attention-open"]').attributes("aria-label")).toContain(
      "disk-full",
    );
    const all = wrapper.get('[data-test="home-attention-view-all"]');
    expect(all.text()).toBe("View All");
    await all.trigger("click");
    expect(wrapper.emitted("viewAll")).toHaveLength(1);
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});
