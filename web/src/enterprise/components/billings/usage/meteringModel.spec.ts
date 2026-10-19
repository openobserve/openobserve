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
import type { TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";
import {
  billingGroupOrgs,
  buildMeterRows,
  cycleProgress,
  apiCheckRuns,
  browserStepRuns,
  estimateCost,
  retentionDailyRate,
  fitWholeCount,
  runsPerMonth,
  effectiveRate,
  projectCycleCost,
  scopedMeterRows,
  splitByUse,
  subtotalCost,
  formatCost,
  formatCycle,
  formatRate,
  formatVolume,
  formatGbHours,
  METERS,
  meterForEvent,
  monthlyPace,
  unitRate,
  volumeDetails,
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
    expect(formatVolume({ ...details.query, metered_amount: 1361.92 }, "retention")).toBe(
      "1.33 GB-hours",
    );
    expect(formatGbHours(2_560_000)).toBe("2,500.00 GB-hours");
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

  it("keeps three significant digits on a sub-cent rate", () => {
    const synthetics = METERS.find((def) => def.key === "synthetics_browser")!;
    // $0.0002574: four fixed decimals rounded it to $0.0003, 16% high.
    expect(formatRate(details.synthetics_browser, synthetics, t)).toContain("$0.000257");
  });

  it("never shows a real but tiny rate as $0.00, and prices retention per GB-hour", () => {
    const meter = (key: string) => METERS.find((def) => def.key === key)!;
    const protocol = { ...details.synthetics_protocol, base_cost: 0.00000494 };
    expect(formatRate(protocol, meter("synthetics_protocol"), t)).toContain('"rate":"$0.00000494"');
    // Retention is metered in MB-hours and Stripe divides by 1024, so its unit is the GB-hour.
    const retention = { ...details.retention, base_cost: 1.3563368e-7, unit_divisor: 1024 };
    const retentionRate = formatRate(retention, meter("retention"), t);
    expect(retentionRate).toContain('"rate":"$0.000000136"');
    expect(retentionRate).toContain('"unit":"billing.usageV2.unitGbHour"');
    // A rate of a cent or more reads as before.
    expect(formatRate({ ...details.ingestion, base_cost: 0.5 }, meter("ingestion"), t)).toContain(
      '"rate":"$0.50"',
    );
  });

  it("derives the per stored unit rate", () => {
    expect(unitRate(details.ingestion)).toBeCloseTo(0.5 / 1024);
    expect(unitRate(details.ai)).toBe(0.5);
    expect(unitRate({ ...details.ai, unit_divisor: 0 })).toBe(0);
    expect(unitRate(undefined)).toBe(0);
  });

  it("maps a usage stream event back to its meter", () => {
    expect(meterForEvent("Search")?.key).toBe("query");
    expect(meterForEvent("AiCredits")?.key).toBe("ai");
    expect(meterForEvent("NewIncident")).toBeUndefined();
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

  it("says what was billed when per-started-GB rounding moves the amount, and only then", () => {
    // 297 MB at $0.50 per GB came to $0.50: Stripe billed one whole GB.
    const small = buildMeterRows(
      {
        ...details,
        ingestion: {
          ...details.ingestion,
          base_cost: 0.5,
          unit_divisor: 1024,
          metered_amount: 297,
          metered_cost: 0.5,
        },
      },
      t,
    ).find((row) => row.key === "ingestion")!;
    expect(String(small.subline)).toContain("billing.usageV2.volumeAtRateBilled");
    expect(String(small.subline)).toContain('"amount":"1"');
    expect(String(small.subline)).toContain('"unit":"billing.usageV2.unitGb"');

    // 2,855.15 GB billed as 2,856: rounding moves it 0.03%, so the row keeps its plain line.
    const large = buildMeterRows(
      {
        ...details,
        ingestion: {
          ...details.ingestion,
          base_cost: 0.5,
          unit_divisor: 1024,
          metered_amount: 2_923_673.6,
          metered_cost: 1428,
        },
      },
      t,
    ).find((row) => row.key === "ingestion")!;
    expect(large.subline).toBeUndefined();

    // A counted meter is billed exactly as counted.
    const counted = buildMeterRows(details, t).find((row) => row.key === "ai")!;
    expect(counted.subline).toBeUndefined();
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

  it("reads usage so far as a month from the days that have passed", () => {
    // 900 GB by day 9 is 100 GB a day, so 3,000 GB a month, not 900 spread over the whole cycle.
    expect(monthlyPace(900, details, start + 9 * day)).toBeCloseTo(3000);
    // An hour in still counts as one day, so a cycle's first hours do not swing it.
    expect(monthlyPace(10, details, start + day / 24)).toBeCloseTo(300);
    // Once the cycle is over, the whole cycle has passed.
    expect(monthlyPace(900, details, start + 99 * day)).toBeCloseTo(900);
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
    pipelineCount: 5,
    retentionDays: 30,
    aiCredits: 4,
    avgStreamMb: 200,
    scanPerSearchMb: 6000,
    browserChecks: 0,
    browserSteps: 5,
    browserRegions: 1,
    browserDevices: 1,
    browserIntervalSec: 300,
    apiChecks: 0,
    apiRegions: 1,
    apiIntervalSec: 300,
  };

  it("prices synthetics per run: browser per step, region and device; API per region", () => {
    const withSynthetics = {
      ...priced,
      synthetics_browser: { base_cost: 0.0002574, unit_divisor: 1 },
      synthetics_protocol: { base_cost: 0.00000494, unit_divisor: 1 },
    } as unknown as MeteringDetails;
    const plan = {
      ...input,
      browserChecks: 10,
      browserSteps: 5,
      browserRegions: 2,
      browserDevices: 2,
      apiChecks: 20,
      apiRegions: 3,
    };
    // Every 300 seconds is 8,640 runs in a 30 day month.
    expect(runsPerMonth(300)).toBe(8640);
    expect(browserStepRuns(plan)).toBe(1_728_000);
    expect(apiCheckRuns(plan)).toBe(518_400);
    const { lines } = estimateCost(withSynthetics, plan);
    const line = (key: string) => lines.find((entry) => entry.key === key);
    expect(line("synthetics_browser")).toMatchObject({ quantity: 1_728_000, unit: "run" });
    expect(line("synthetics_browser")?.cost).toBeCloseTo(1_728_000 * 0.0002574, 6);
    expect(line("synthetics_protocol")?.cost).toBeCloseTo(518_400 * 0.00000494, 6);
  });

  it("never runs a check with no interval", () => {
    expect(runsPerMonth(0)).toBe(0);
    expect(apiCheckRuns({ ...input, apiChecks: 5, apiIntervalSec: 0 })).toBe(0);
  });

  it("prices every meter from the API rate and sums them", () => {
    const { lines, total } = estimateCost(priced, input);
    const cost = (key: string) => lines.find((line) => line.key === key)?.cost ?? 0;
    expect(cost("ingestion")).toBeCloseTo(50, 5);
    expect(cost("query")).toBeCloseTo((10 * 6000 * 0.01) / 1024, 5);
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
    // 30 dollars over 1000 MB-hours is 0.03 per MB-hour, so 0.72 per MB per day.
    expect(retention?.cost).toBeCloseTo(100 * 1024 * 30 * 0.72, 5);
  });

  it("converts billed MB-hours to a daily rate, falling back to list price before any usage", () => {
    const at = (retention: Record<string, number>) =>
      retentionDailyRate({ ...priced, retention } as unknown as MeteringDetails);
    // 72 dollars over 72,000 MB-hours is 0.001 per MB-hour, 0.024 per MB-day.
    expect(
      at({ base_cost: 0, unit_divisor: 1024, metered_amount: 72_000, metered_cost: 72 }),
    ).toBeCloseTo(0.024, 10);
    // 1.024 dollars per GB-hour is 0.001 per MB-hour.
    expect(
      at({ base_cost: 1.024, unit_divisor: 1024, metered_amount: 0, metered_cost: 0 }),
    ).toBeCloseTo(0.024, 10);
    expect(retentionDailyRate(null)).toBe(0);
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

    it("shows one org's share of each meter, without retention", () => {
      const rows = scopedMeterRows(
        details,
        {
          ingestion: { volume: 2048, gross: 1, billed: 0.9 },
          query: { volume: 0, gross: 0, billed: 0 },
        },
        t,
      );
      const ingestion = rows.find((row) => row.key === "ingestion")!;
      expect(ingestion.gross).toBeCloseTo(1);
      expect(ingestion.discount).toBeCloseTo(0.1);
      expect(ingestion.discountPercent).toBe(10);
      expect(ingestion.cost).toBeCloseTo(0.9);
      expect(ingestion.drillable).toBe(true);
      expect(rows.find((row) => row.key === "query")!.drillable).toBe(false);
      expect(rows.find((row) => row.key === "pipeline")!.drillable).toBe(false);
      expect(rows.some((row) => row.key === "retention")).toBe(false);
      expect(scopedMeterRows(null, {}, t)).toEqual([]);
    });
  });
});

describe("meteringModel billing dates", () => {
  // The daily usage buckets start at UTC midnight; west of UTC a browser-zone label is a day early.
  it("reads billing days in UTC, whatever the browser's time zone", async () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      vi.resetModules();
      const model = await import("./meteringModel");
      const oct12 = Date.UTC(2026, 9, 12) / 1000;
      expect(new Date(oct12 * 1000).getDate()).toBe(11);
      expect(model.formatDay(oct12)).toBe("Oct 12");
      expect(model.formatFullDay(oct12)).toBe("Oct 12, 2026");
    } finally {
      process.env.TZ = zone;
      vi.resetModules();
    }
  });
});

describe("meteringModel usage without a bill", () => {
  it("adds each meter's events into its volume, in megabytes or a count, with no money", () => {
    const usage = volumeDetails(
      { Ingestion: 2048, AiCredits: 5, NewIncident: 2, Other: 9 },
      10,
      20,
    );
    expect(usage.ingestion).toMatchObject({
      metered_amount: 2048,
      unit_divisor: 1024,
      metered_cost: 0,
    });
    expect(usage.ai).toMatchObject({ metered_amount: 5, unit_divisor: 1, metered_cost: 0 });
    expect(usage.query.metered_amount).toBe(0);
    expect(usage).toMatchObject({ total_cost: 0, cycle_start: 10, cycle_end: 20 });
  });
});

describe("meteringModel whole counts for the estimator", () => {
  it("rounds to a whole count, at least one once there is usage, with the size scaled to fit", () => {
    expect(fitWholeCount(1 / 3)).toEqual({ count: 1, scale: 1 / 3 });
    const three = fitWholeCount(3.4);
    expect(three.count).toBe(3);
    expect(three.count * three.scale).toBeCloseTo(3.4, 9);
    expect(fitWholeCount(0)).toEqual({ count: 0, scale: 1 });
    expect(fitWholeCount(Number.NaN)).toEqual({ count: 0, scale: 1 });
  });
});
