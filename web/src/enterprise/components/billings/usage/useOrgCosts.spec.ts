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
import type { MeteringDetails } from "./meteringModel";

vi.mock("./useUsageSearch", () => ({ useUsageSearch: () => ({ search: vi.fn() }) }));

const { priceOrgVolumes } = await import("./useOrgCosts");

const meter = (base: number, divisor: number, percent = 0) => ({
  base_cost: base,
  unit_divisor: divisor,
  metered_amount: 0,
  metered_cost: 0,
  percent_discount: percent,
  discounted_amount: 0,
});

// Ingestion carries a 10% discount; search has none.
const cycle = {
  cycle_start: 1_700_000_000,
  cycle_end: 1_702_592_000,
  ingestion: meter(0.5, 1024, 10),
  query: meter(0.01, 1024),
  ai: meter(0.5, 1),
} as unknown as MeteringDetails;

describe("priceOrgVolumes", () => {
  const hits = [
    { name: "payer", event: "Ingestion", volume: 2048 },
    { name: "payer", event: "Search", volume: 1024 },
    { name: "child", event: "Ingestion", volume: 1024 },
  ];

  it("prices gross at list rate and billed at the cycle's discounted rate", () => {
    const costs = priceOrgVolumes(hits, cycle);
    expect(costs.payer.gross).toBeCloseTo(2048 * (0.5 / 1024) + 1024 * (0.01 / 1024), 12);
    expect(costs.payer.billed).toBeCloseTo(2048 * (0.5 / 1024) * 0.9 + 1024 * (0.01 / 1024), 12);
    expect(costs.child.gross).toBeCloseTo(0.5, 12);
    expect(costs.child.billed).toBeCloseTo(0.45, 12);
  });

  it("counts ingested megabytes and splits the billed cost by meter", () => {
    const costs = priceOrgVolumes(hits, cycle);
    expect(costs.payer.ingested).toBe(2048);
    expect(costs.payer.byMeter.ingestion).toBeCloseTo(0.9, 12);
    expect(costs.payer.byMeter.query).toBeCloseTo(0.01, 12);
  });

  it("prices an event with no meter at zero and returns nothing for no rows", () => {
    expect(priceOrgVolumes([{ name: "x", event: "Functions", volume: 5 }], cycle).x).toEqual({
      gross: 0,
      billed: 0,
      ingested: 0,
      byMeter: {},
    });
    expect(priceOrgVolumes([], cycle)).toEqual({});
  });
});
