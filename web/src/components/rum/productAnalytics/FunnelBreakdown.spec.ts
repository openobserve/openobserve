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

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import FunnelBreakdown from "./FunnelBreakdown.vue";
import { raw } from "@/types/i18n";
import { foldBreakdown } from "@/utils/rum/productAnalyticsModel";

const store = createStore({ state: { theme: "light", timezone: "UTC" } });
const steps = [
  { kind: "c" as const, key: "product_viewed" },
  { kind: "c" as const, key: "checkout_started" },
  { kind: "c" as const, key: "payment_info_submitted" },
  { kind: "c" as const, key: "order_completed" },
];
const PAY = "context_payment_method";
const hits = [
  { dim: "card", c1: 20, c2: 18, c3: 17, c4: 17, dc1: 0, dc2: 0, dc3: 17, dc4: 17, mt3: 14000 },
  { dim: "upi", c1: 9, c2: 8, c3: 8, c4: 4, dc1: 0, dc2: 0, dc3: 8, dc4: 4, mt3: 11000 },
  { dim: null, c1: 60, c2: 30, c3: 3, c4: 1, dc1: 0, dc2: 0, dc3: 0, dc4: 0, mt3: 9000 },
];

const mountTable = async (fold: ReturnType<typeof foldBreakdown>) => {
  const w = mount(FunnelBreakdown, {
    props: {
      rows: fold.rows,
      total: fold.total,
      steps,
      dimLabel: raw(PAY),
      events: [],
      unitNoun: raw("sessions"),
      start: fold.start,
    },
    global: {
      plugins: [store],
      stubs: {
        OPopover: { template: '<div><slot name="trigger" /><slot /></div>' },
      },
    },
  });
  await flushPromises();
  return w;
};

const cell = (w: Awaited<ReturnType<typeof mountTable>>, id: string) =>
  w.find(`[data-test="rum-analytics-funnel-breakdown-${id}"]`);

describe("FunnelBreakdown with an attribute breakdown", () => {
  it("rows run from the start step, with Reached no value, Left before and Total", async () => {
    const fold = foldBreakdown(hits, 4, 5, { f: PAY });
    expect(fold.start?.step).toBe(3);
    const w = await mountTable(fold);
    expect(cell(w, "row-0").text()).toBe("card");
    expect(cell(w, "row-1").text()).toBe("upiLow volume");
    expect(cell(w, "row-2").text()).toBe("Reached step 3, no value");
    expect(cell(w, "row-3").text()).toBe("Left before step 3");
    expect(cell(w, "row-4").text()).toBe("Total");
    expect(w.text()).not.toContain("(not set)");
  });

  it("titles the table by field, leaves out the steps between 1 and k, and converts from k", async () => {
    const w = await mountTable(foldBreakdown(hits, 4, 5, { f: PAY }));
    expect(cell(w, "title").text()).toBe(`By ${PAY}`);
    const headers = w.findAll("th").map((h) => h.text());
    expect(headers).toEqual(
      expect.arrayContaining([
        "1. product_viewed",
        "3. payment_info_submitted",
        "4. order_completed",
        "Conversion from step 3",
        "Median time",
      ]),
    );
    expect(headers).not.toContain("2. checkout_started");
  });

  it("shows each value's median, and none for Left before or Total", async () => {
    const w = await mountTable(foldBreakdown(hits, 4, 5, { f: PAY }));
    expect(cell(w, "row-0-median").text()).toBe("14 s");
    expect(cell(w, "row-1-median").text()).toBe("11 s");
    expect(cell(w, "row-3-median").text()).toBe("—");
    expect(cell(w, "row-4-median").text()).toBe("—");
  });

  it("marks values under 10 at step k as low volume, with a footnote, and never as the best", async () => {
    const w = await mountTable(foldBreakdown(hits, 4, 5, { f: PAY }));
    expect(cell(w, "row-0-low-volume").exists()).toBe(false);
    expect(cell(w, "row-1-low-volume").exists()).toBe(true);
    expect(cell(w, "low-volume-note").text()).toBe(
      "Values below 10 sessions at step 3 are marked low volume",
    );
  });

  it("explains the start step in an About popover", async () => {
    const w = await mountTable(foldBreakdown(hits, 4, 5, { f: PAY }));
    expect(cell(w, "about-text").text()).toContain(
      `${PAY} is first set at step 3, payment_info_submitted, in 25 of the 28 sessions that reached it, so its rates start at step 3.`,
    );
    expect(cell(w, "about-text").text()).toContain(
      "Those that left before step 3 have no value and are counted in one row.",
    );
  });

  it("names a pinned step as picked", async () => {
    const w = await mountTable(foldBreakdown(hits, 4, 5, { f: PAY, s: 4 }));
    expect(cell(w, "about-text").text()).toContain(`${PAY} is read at step 4, order_completed`);
  });

  it("keeps the built-in rows' labels, with a median from step 1 and no About", async () => {
    const w = await mountTable(foldBreakdown(hits, 4));
    expect(cell(w, "row-2").text()).toBe("(not set)");
    expect(cell(w, "about").exists()).toBe(false);
    expect(w.findAll("th").map((h) => h.text())).toContain("2. checkout_started");
    expect(w.findAll("th").map((h) => h.text())).toContain("Conversion from step 1");
  });
});
