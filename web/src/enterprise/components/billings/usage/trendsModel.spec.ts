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
import type { MeteringDetails } from "./meteringModel";
import {
  bucketSeconds,
  cyclePrices,
  forecastCycle,
  priceAt,
  priceCaseSql,
  summarizeTrend,
  toEpochSeconds,
  trendBucket,
} from "./trendsModel";

const DAY = 86_400;

const cycle = (start: number, ingestionDiscount: number) =>
  ({
    cycle_start: start,
    cycle_end: start + 30 * DAY,
    ingestion: {
      base_cost: 0.5,
      unit_divisor: 1024,
      metered_amount: 0,
      metered_cost: 0,
      percent_discount: ingestionDiscount,
    },
  }) as unknown as MeteringDetails;

// Two cycles with different discounts, as in the design doc's worked example.
const first = cycle(1_700_000_000, 10);
const second = cycle(1_700_000_000 + 30 * DAY, 5);
const prices = cyclePrices([second, first]);

describe("trendsModel", () => {
  it("prices a unit from base_cost, unit_divisor and that cycle's discount", () => {
    expect(prices[0].rates.Ingestion).toBeCloseTo(0.000439453125, 12);
    expect(prices[1].rates.Ingestion).toBeCloseTo(0.0004638671875, 12);
  });

  it("prices a range that crosses two cycles by each cycle's own rate", () => {
    const inFirst = priceAt(prices, "Ingestion", first.cycle_start + DAY);
    const inSecond = priceAt(prices, "Ingestion", second.cycle_start + DAY);
    expect(inFirst).toBeCloseTo(0.000439453125, 12);
    expect(inSecond).toBeCloseTo(0.0004638671875, 12);
  });

  it("keeps the earlier price across a gap and the first price before any cycle", () => {
    const gapped = cyclePrices([first, cycle(second.cycle_start + 10 * DAY, 5)]);
    expect(priceAt(gapped, "Ingestion", second.cycle_start + DAY)).toBeCloseTo(0.000439453125, 12);
    expect(priceAt(gapped, "Ingestion", first.cycle_start - DAY)).toBeCloseTo(0.000439453125, 12);
  });

  it("writes the same boundaries into SQL, switching price at the next cycle's start", () => {
    const sql = priceCaseSql(prices, ["Ingestion"]);
    expect(sql).toBe(
      `case when event = 'Ingestion' and _timestamp < ${second.cycle_start * 1_000_000} ` +
        `then ${prices[0].rates.Ingestion} when event = 'Ingestion' then ` +
        `${prices[1].rates.Ingestion} else 0 end`,
    );
  });

  it("totals by meter and by day, and narrows the days to an isolated meter", () => {
    const rows = [
      { ts: first.cycle_start, event: "Ingestion", cost: 0.45 },
      { ts: first.cycle_start, event: "Search", cost: 0.05 },
    ];
    const all = summarizeTrend(rows);
    expect(all.meters[0].key).toBe("ingestion");
    expect(all.total).toBeCloseTo(0.5, 6);
    const only = summarizeTrend(rows, "ingestion");
    expect(only.total).toBeCloseTo(0.45, 6);
    expect(only.days).toEqual([{ ts: first.cycle_start, cost: 0.45 }]);
  });

  it("forecasts from the trailing week, counting days with no usage as zero", () => {
    const start = 1_700_000_000 - (1_700_000_000 % DAY);
    const now = start + 10 * DAY + 3600;
    const summary = { total: 7, days: [{ ts: start + 10 * DAY, cost: 7 }], meters: [] };
    const forecast = forecastCycle(summary, start, start + 30 * DAY, now);
    expect(forecast?.paceDays).toBe(7);
    expect(forecast?.pace).toBeCloseTo(1, 6);
    expect(forecast?.low).toBeCloseTo(7, 6);
    expect(forecastCycle(summary, start, now - 1, now)).toBeNull();
  });

  it("reads the backend's mixed timestamp units and picks a bucket per window", () => {
    expect(toEpochSeconds(1_789_046_852)).toBe(1_789_046_852);
    expect(toEpochSeconds(1_789_046_852_000_000)).toBe(1_789_046_852);
    expect(bucketSeconds("2026-09-12T00:00:00")).toBe(Date.UTC(2026, 8, 12) / 1000);
    expect(trendBucket(0, 15 * 60)).toBe("1 minute");
    expect(trendBucket(0, 24 * 3600)).toBe("1 hour");
    expect(trendBucket(0, 30 * DAY)).toBe("1 day");
  });
});
