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
import type { TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import {
  billingGroupOrgs,
  buildMeterRows,
  cycleProgress,
  estimateCost,
  effectiveRate,
  projectCycleCost,
  scopedMeterRows,
  splitByUse,
  subtotalCost,
  formatCost,
  formatCycle,
  formatRate,
  formatVolume,
  METERS,
  meterForEvent,
  unitRate,
  type MeteringDetails,
} from "./meteringModel";

const t = ((key: string, params?: Record<string, unknown>) =>
  raw(params ? `${key}:${JSON.stringify(params)}` : key)) as unknown as TranslateFn;

const details: MeteringDetails = {
  total_cost: 0.69,
  total_discounted_amount: 0.08,
  cycle_start: 1789046852,
  cycle_end: 1791638852,
  ingestion: {
    base_cost: 0.5,
    unit_divisor: 1024,
    metered_amount: 1016,
    metered_cost: 0.5,
    percent_discount: 10,
    discounted_amount: 0.06,
  },
  query: {
    base_cost: 0.01,
    unit_divisor: 1024,
    metered_amount: 6634,
    metered_cost: 0.07,
    percent_discount: 0,
    discounted_amount: 0,
  },
  retention: {
    base_cost: 1.3563368e-7,
    unit_divisor: 1024,
    metered_amount: 114235,
    metered_cost: 0,
    percent_discount: 0,
    discounted_amount: 0,
  },
  pipeline: {
    base_cost: 0.2,
    unit_divisor: 1024,
    metered_amount: 499,
    metered_cost: 0.2,
    percent_discount: 10,
    discounted_amount: 0.02,
  },
  remote_pipeline: {
    base_cost: 0.3,
    unit_divisor: 1024,
    metered_amount: 0,
    metered_cost: 0,
    percent_discount: 0,
    discounted_amount: 0,
  },
  ai: {
    base_cost: 0.5,
    unit_divisor: 1,
    metered_amount: 1036,
    metered_cost: 518,
    percent_discount: 0,
    discounted_amount: 0,
  },
  synthetics_browser: {
    base_cost: 0.00025739999999999997,
    unit_divisor: 1,
    metered_amount: 0,
    metered_cost: 0,
    percent_discount: 0,
    discounted_amount: 0,
  },
  synthetics_protocol: {
    base_cost: 0.00000494,
    unit_divisor: 1,
    metered_amount: 0,
    metered_cost: 0,
    percent_discount: 0,
    discounted_amount: 0,
  },
  missing_details: [],
};

describe("meteringModel", () => {
  it("formats a byte meter from megabytes and a count meter as a count", () => {
    expect(formatVolume(details.ingestion)).toBe("1016.00 MB");
    expect(formatVolume(details.query)).toBe("6.48 GB");
    expect(formatVolume(details.ai)).toBe("1,036");
  });

  it("renders a dash when a meter is absent", () => {
    expect(formatVolume(undefined)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(null)).toBe("—");
  });

  it("formats cost in dollars", () => {
    expect(formatCost(0.69)).toBe("$0.69");
    expect(formatCost(0)).toBe("$0.00");
  });

  it("keeps four decimals on a sub-cent rate", () => {
    const synthetics = METERS.find((def) => def.key === "synthetics_browser")!;
    expect(formatRate(details.synthetics_browser, synthetics, t)).toContain("$0.0003");
  });

  it("derives the per stored unit rate", () => {
    expect(unitRate(details.ingestion)).toBeCloseTo(0.5 / 1024);
    expect(unitRate(details.ai)).toBe(0.5);
    expect(unitRate({ ...details.ai, unit_divisor: 0 })).toBe(0);
    expect(unitRate(undefined)).toBe(0);
  });

  it("maps a usage stream event back to its meter", () => {
    expect(meterForEvent("Search")?.key).toBe("query");
    expect(meterForEvent("NewIncident")?.key).toBe("ai");
    expect(meterForEvent("Functions")).toBeUndefined();
  });

  it("builds one row per meter, in display order", () => {
    const rows = buildMeterRows(details, t);
    expect(rows.map((row) => row.key)).toEqual(METERS.map((def) => def.key));
    expect(rows[0].gross).toBe(0.5);
    expect(rows[0].discount).toBe(0.06);
    expect(rows[0].cost).toBeCloseTo(0.44);
    expect(rows.every((row) => row.missing === false)).toBe(true);
  });

  it("marks a meter the backend failed to price", () => {
    const rows = buildMeterRows(
      { ...details, missing_details: [{ kind: "retention", error: "boom" }] },
      t,
    );
    expect(rows.find((row) => row.key === "retention")?.missing).toBe(true);
    expect(rows.find((row) => row.key === "ingestion")?.missing).toBe(false);
  });

  it("opens a breakdown only for a meter with something metered", () => {
    const drillable = (key: string) =>
      buildMeterRows(details, t).find((row) => row.key === key)?.drillable;
    expect(drillable("ingestion")).toBe(true);
    // Free to store, but 114 GB is still worth breaking down.
    expect(drillable("retention")).toBe(true);
    // Nothing metered this cycle: a click would open an empty table.
    expect(drillable("synthetics_browser")).toBe(false);
    expect(drillable("remote_pipeline")).toBe(false);
  });

  it("returns no rows when the organization has no pricing", () => {
    expect(buildMeterRows(null, t)).toEqual([]);
  });

  it("formats the billing cycle from Unix seconds", () => {
    expect(formatCycle(details, t)).toContain("billing.usageV2.cycleRange");
    expect(formatCycle(details, t)).toContain("2026");
  });
});

describe("meteringModel cycle math", () => {
  const start = details.cycle_start * 1000;
  const day = 86_400_000;

  it("counts the cycle day from its start, capped at the cycle length", () => {
    expect(cycleProgress(details, start + 1).day).toBe(1);
    expect(cycleProgress(details, start + 10.5 * day).day).toBe(11);
    expect(cycleProgress(details, start + 99 * day).day).toBe(30);
    expect(cycleProgress(details, start).totalDays).toBe(30);
  });

  it("hides the projection for the first days of a cycle", () => {
    expect(projectCycleCost(details, start + 1.5 * day)).toBeNull();
    expect(projectCycleCost(null)).toBeNull();
  });

  it("projects the run rate to the end of the cycle", () => {
    expect(projectCycleCost(details, start + 15 * day)).toBeCloseTo(0.69 * 2);
    expect(projectCycleCost(details, start + 30 * day)).toBeCloseTo(0.69);
  });

  it("sums per meter cost before discounts", () => {
    expect(subtotalCost(details)).toBeCloseTo(518.77);
    expect(subtotalCost(null)).toBe(0);
  });

  it("prices at what was billed, falling back to list price when nothing was metered", () => {
    expect(effectiveRate(details.ingestion)).toBeCloseTo(0.44 / 1016, 10);
    expect(effectiveRate(details.remote_pipeline)).toBeCloseTo(0.3 / 1024);
  });

  it("puts the most expensive meter first and folds unused meters away", () => {
    const { used, unused } = splitByUse(buildMeterRows(details, t));
    expect(used[0].key).toBe("ai");
    expect(used.map((row) => row.key)).not.toContain("remote_pipeline");
    expect(unused.map((row) => row.key)).toContain("synthetics_browser");
  });

  it("keeps an unpriced meter visible even at zero cost", () => {
    const rows = buildMeterRows(
      { ...details, missing_details: [{ kind: "synthetics_browser", error: "x" }] },
      t,
    );
    expect(splitByUse(rows).used.map((row) => row.key)).toContain("synthetics_browser");
  });
});

describe("estimateCost", () => {
  const priced = {
    cycle_start: 1_757_462_400,
    cycle_end: 1_760_054_400,
    ingestion: { base_cost: 0.5, unit_divisor: 1024, metered_amount: 0, metered_cost: 0 },
    query: { base_cost: 0.01, unit_divisor: 1024, metered_amount: 0, metered_cost: 0 },
    pipeline: { base_cost: 0.2, unit_divisor: 1024, metered_amount: 0, metered_cost: 0 },
    retention: { base_cost: 0, unit_divisor: 1024, metered_amount: 1000, metered_cost: 30 },
    ai: { base_cost: 0.5, unit_divisor: 1, metered_amount: 0, metered_cost: 0 },
  } as unknown as MeteringDetails;

  const input = {
    ingestGb: 100,
    searchCount: 10,
    searchMinutes: 60,
    pipelineCount: 5,
    retentionDays: 30,
    aiCredits: 4,
    avgStreamMb: 200,
    scanRateMbPerMin: 100,
  };

  it("prices every meter from the API rate and sums them", () => {
    const { lines, total } = estimateCost(priced, input);
    const cost = (key: string) => lines.find((line) => line.key === key)?.cost ?? 0;
    expect(cost("ingestion")).toBeCloseTo(50, 5);
    expect(cost("query")).toBeCloseTo((10 * 60 * 100 * 0.01) / 1024, 5);
    expect(cost("pipeline")).toBeCloseTo((5 * 200 * 0.2) / 1024, 5);
    expect(cost("ai")).toBeCloseTo(2, 5);
    expect(total).toBeCloseTo(
      lines.reduce((sum, line) => sum + line.cost, 0),
      5,
    );
  });

  it("prices retention from the org's own cost per stored megabyte per day", () => {
    const { lines } = estimateCost(priced, input);
    const retention = lines.find((line) => line.key === "retention");
    // 30 dollars over 1000 MB across the 30 day cycle is 0.001 per MB per day.
    expect(retention?.cost).toBeCloseTo(100 * 1024 * 30 * 0.001, 5);
  });

  it("returns nothing to price without a cycle", () => {
    expect(estimateCost(null, input)).toEqual({ lines: [], total: 0 });
  });

  describe("super org", () => {
    it("lists the super org first, then its members, and nothing for any other org", () => {
      const orgs = billingGroupOrgs(
        [
          {
            payer_org_id: "sup",
            payer_org_name: "Acme",
            member_org_id: "m1",
            member_org_name: "EU",
          },
          { payer_org_id: "sup", payer_org_name: "Acme", member_org_id: "m2", member_org_name: "" },
        ],
        "sup",
      );
      expect(orgs).toEqual([
        { id: "sup", name: "Acme", isSelf: true },
        { id: "m1", name: "EU", isSelf: false },
        { id: "m2", name: "m2", isSelf: false },
      ]);
      expect(billingGroupOrgs([], "sup")).toEqual([]);
      expect(billingGroupOrgs(null, "sup")).toEqual([]);
    });

    it("prices one org's usage at the bill's rates and discounts, without retention", () => {
      const rows = scopedMeterRows(details, { Ingestion: 2048, Search: 1024 }, t);
      const ingestion = rows.find((row) => row.key === "ingestion")!;
      // 2 GB at $0.50/GB is $1.00 gross; the bill's 10% ingestion coupon applies to this org too.
      expect(ingestion.gross).toBeCloseTo(1);
      expect(ingestion.discount).toBeCloseTo(0.1);
      expect(ingestion.cost).toBeCloseTo(0.9);
      expect(ingestion.drillable).toBe(true);
      expect(rows.find((row) => row.key === "pipeline")!.drillable).toBe(false);
      expect(rows.some((row) => row.key === "retention")).toBe(false);
      expect(scopedMeterRows(null, {}, t)).toEqual([]);
    });
  });
});
