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
  { kind: "c" as const, key: "payment_info_submitted" },
  { kind: "c" as const, key: "order_completed" },
];
const hits = [
  { dim: "card", c1: 10, c2: 8, c3: 6, dc1: 0, dc2: 8, dc3: 6 },
  { dim: null, c1: 20, c2: 4, c3: 2, dc1: 0, dc2: 0, dc3: 0 },
];

const mountTable = async (fold: ReturnType<typeof foldBreakdown>, startStep?: number) => {
  const w = mount(FunnelBreakdown, {
    props: {
      rows: fold.rows,
      total: fold.total,
      steps,
      dimLabel: raw("context_payment_method"),
      events: [],
      ...(startStep ? { startStep } : {}),
    },
    global: { plugins: [store] },
  });
  await flushPromises();
  return w;
};

const label = (w: Awaited<ReturnType<typeof mountTable>>, i: number) =>
  w.find(`[data-test="rum-analytics-funnel-breakdown-row-${i}"]`).text();

describe("FunnelBreakdown with an attribute breakdown", () => {
  it("names the no-value and left-before rows after the start step", async () => {
    const fold = foldBreakdown(hits, 3, 5, { f: "context_payment_method" });
    const w = await mountTable(fold, fold.start!.step);
    expect(label(w, 0)).toBe("card");
    expect(label(w, 1)).toBe("Reached step 2, no value");
    expect(label(w, 2)).toBe("Left before step 2");
    expect(label(w, 3)).toBe("Total");
    expect(w.text()).not.toContain("(not set)");
  });

  it("keeps the built-in rows' labels", async () => {
    const w = await mountTable(foldBreakdown(hits, 3));
    expect(label(w, 1)).toBe("(not set)");
  });
});
