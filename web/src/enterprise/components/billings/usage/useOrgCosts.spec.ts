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

import { flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { MeteringDetails } from "./meteringModel";

const search = vi.fn().mockResolvedValue([]);
vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search }) }));

const { priceOrgVolumes, useOrgCosts } = await import("./useOrgCosts");

const meter = (meteredCost: number, discounted = 0) => ({
  base_cost: 0.5,
  unit_divisor: 1024,
  metered_amount: 0,
  metered_cost: meteredCost,
  percent_discount: 0,
  discounted_amount: discounted,
});

// Ingestion: $100 gross, $10 off, so $90 billed. Search: $20, no discount.
const cycle = {
  cycle_start: 1_700_000_000,
  cycle_end: 1_702_592_000,
  ingestion: meter(100, 10),
  query: meter(20),
  ai: meter(0),
} as unknown as MeteringDetails;

describe("priceOrgVolumes", () => {
  const hits = [
    { name: "payer", event: "Ingestion", volume: 300 },
    { name: "child", event: "Ingestion", volume: 100 },
    { name: "payer", event: "Search", volume: 50 },
  ];

  it("splits each meter's bill by volume share, so the orgs add up to the bill", () => {
    const costs = priceOrgVolumes(hits, cycle);
    // Ingestion 300:100 of $90 billed and $100 gross; all of Search's $20 to the payer.
    expect(costs.payer.billed).toBeCloseTo(67.5 + 20, 9);
    expect(costs.payer.gross).toBeCloseTo(75 + 20, 9);
    expect(costs.child.billed).toBeCloseTo(22.5, 9);
    expect(costs.child.gross).toBeCloseTo(25, 9);
    expect(costs.payer.billed + costs.child.billed).toBeCloseTo(90 + 20, 9);
  });

  it("keeps the bill's total even when the stream's volumes are inflated", () => {
    const doubled = hits.map((hit) => ({ ...hit, volume: hit.volume * 2 }));
    const costs = priceOrgVolumes(doubled, cycle);
    expect(costs.payer.billed + costs.child.billed).toBeCloseTo(110, 9);
  });

  it("keeps each org's part of each meter, and its ingested megabytes", () => {
    const costs = priceOrgVolumes(hits, cycle);
    expect(costs.payer.ingested).toBe(300);
    expect(costs.child.byMeter.ingestion).toEqual({
      volume: 100,
      gross: expect.closeTo(25, 9),
      billed: expect.closeTo(22.5, 9),
    });
    expect(costs.payer.byMeter.query?.billed).toBeCloseTo(20, 9);
  });

  it("gives an event with no meter nothing and returns nothing for no rows", () => {
    expect(priceOrgVolumes([{ name: "x", event: "Functions", volume: 5 }], cycle).x).toEqual({
      gross: 0,
      billed: 0,
      ingested: 0,
      byMeter: {},
    });
    expect(priceOrgVolumes([], cycle)).toEqual({});
  });
});

describe("useOrgCosts", () => {
  it("re-reads when a Refresh brings a new bill", async () => {
    const details = ref<MeteringDetails | null>(cycle);
    useOrgCosts(details, ref([{ id: "payer", name: "Payer", isSelf: true }]));
    await flushPromises();
    details.value = { ...cycle };
    await flushPromises();

    expect(search).toHaveBeenCalledTimes(2);
  });
});
