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
import {
  SYNTHETIC_FIELDS,
  SYNTHETIC_RESULTS_STREAM,
  STATUS_VALUES,
  bucketInterval,
  buildHistogramSql,
  buildKpiSql,
  buildLastRunSql,
  buildRunsSql,
  mapHistogram,
  mapKpi,
  mapRun,
} from "./syntheticResultsSchema";

describe("syntheticResultsSchema query builders", () => {
  it("should reference the configured stream and fields in the KPI SQL", () => {
    const sql = buildKpiSql("mon-1");
    expect(sql).toContain(`FROM "${SYNTHETIC_RESULTS_STREAM}"`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.monitorId} = 'mon-1'`);
    expect(sql).toContain(
      `FILTER (WHERE ${SYNTHETIC_FIELDS.status} = '${STATUS_VALUES.passed}')`,
    );
    expect(sql).toContain(
      `FILTER (WHERE ${SYNTHETIC_FIELDS.status} != '${STATUS_VALUES.passed}')`,
    );
    expect(sql).toContain(`approx_percentile_cont(${SYNTHETIC_FIELDS.duration}, 0.95)`);
  });

  it("should order the last-run query by timestamp descending with limit 1", () => {
    const sql = buildLastRunSql("mon-1");
    expect(sql).toContain(`ORDER BY ${SYNTHETIC_FIELDS.timestamp} DESC`);
    expect(sql).toContain("LIMIT 1");
  });

  it("should embed the histogram interval and group by bucket", () => {
    const sql = buildHistogramSql("mon-1", "5 minutes");
    expect(sql).toContain(`histogram(${SYNTHETIC_FIELDS.timestamp}, '5 minutes')`);
    expect(sql).toContain("GROUP BY ts");
    expect(sql).toContain("ORDER BY ts");
  });

  it("should apply the requested limit on the runs query", () => {
    const sql = buildRunsSql("mon-1", 50);
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain(`${SYNTHETIC_FIELDS.location} as location`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.device} as device`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.error} as error`);
  });

  it("should target the configured stream name", () => {
    expect(SYNTHETIC_RESULTS_STREAM).toBe("synthetics_results");
    expect(SYNTHETIC_FIELDS.duration).toBe("response_time_ms");
  });

  it("should escape single quotes in the monitor id to prevent injection", () => {
    const sql = buildKpiSql("mon'1");
    expect(sql).toContain(`${SYNTHETIC_FIELDS.monitorId} = 'mon''1'`);
  });
});

describe("bucketInterval", () => {
  it("should widen the bucket as the window grows", () => {
    expect(bucketInterval(60 * 60 * 1_000_000)).toBe("5 minutes"); // 1h window
    expect(bucketInterval(24 * 60 * 60 * 1_000_000)).toBe("30 minutes"); // 1d window
    expect(bucketInterval(14 * 24 * 60 * 60 * 1_000_000)).toBe("6 hours"); // 14d window
  });
});

describe("mapKpi", () => {
  it("should compute uptime from passed/total and map the last run", () => {
    const kpi = mapKpi(
      {
        total_runs: 288,
        passed_runs: 287,
        failed_runs: 1,
        p95_duration: 2940,
      },
      { status: "passed", ts: 1_700_000_000_000_000 },
    );
    expect(kpi.totalRuns).toBe(288);
    expect(kpi.failedRuns).toBe(1);
    expect(kpi.p95Ms).toBe(2940);
    expect(kpi.uptimePct).toBeCloseTo((287 / 288) * 100, 5);
    expect(kpi.lastRunStatus).toBe("passed");
    expect(kpi.lastRunAt).toBe(1_700_000_000_000); // micros → ms
  });

  it("should yield a zeroed kpi with null last run when there is no data", () => {
    const kpi = mapKpi(null, null);
    expect(kpi.uptimePct).toBe(0);
    expect(kpi.totalRuns).toBe(0);
    expect(kpi.lastRunStatus).toBe(null);
    expect(kpi.lastRunAt).toBe(null);
  });

  it("should coerce string field values from the search response", () => {
    const kpi = mapKpi(
      { total_runs: "10", passed_runs: "9", failed_runs: "1", p95_duration: "120" },
      null,
    );
    expect(kpi.totalRuns).toBe(10);
    expect(kpi.uptimePct).toBeCloseTo(90, 5);
  });
});

describe("mapRun", () => {
  it("should map a raw hit to the typed run model and normalise status", () => {
    const run = mapRun({
      ts: 1_700_000_000_000_000,
      status: "failed",
      duration: 1760,
      location: "ap-southeast-1",
      device: "desktop",
      error: "Timeout waiting for selector",
    });
    expect(run.timestamp).toBe(1_700_000_000_000);
    expect(run.status).toBe("failed");
    expect(run.durationMs).toBe(1760);
    expect(run.location).toBe("ap-southeast-1");
    expect(run.device).toBe("desktop");
    expect(run.error).toBe("Timeout waiting for selector");
  });

  it("should map probe status values to RunStatus", () => {
    expect(mapRun({ status: "passed" }).status).toBe("passed");
    expect(mapRun({ status: "warning" }).status).toBe("warning");
    expect(mapRun({ status: "failed" }).status).toBe("failed");
    expect(mapRun({ status: "error" }).status).toBe("error");
    expect(mapRun({ status: "unknown" }).status).toBe("failed");
  });
});

describe("mapHistogram", () => {
  const HOUR = 60 * 60 * 1_000_000;
  // A 1h window → 5-minute buckets → 12 slots.
  const start = 1_700_000_000_000_000;
  const end = start + HOUR;

  it("should zero-fill the full grid when the stream is sparse", () => {
    const buckets = mapHistogram([], start, end);
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets.every((b) => b.failedRuns === 0)).toBe(true);
    expect(buckets.every((b) => b.uptimePct === 100)).toBe(true);
    // Strictly time-ordered.
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].tsMs).toBeGreaterThan(buckets[i - 1].tsMs);
    }
  });

  it("should map populated buckets with per-bucket uptime and durations", () => {
    // Align a key to the 5-minute grid the builder uses.
    const stepMs = 5 * 60 * 1000;
    const slotMs = Math.floor(start / 1000 / stepMs) * stepMs;
    const key = new Date(slotMs).toISOString().slice(0, 19);
    const buckets = mapHistogram(
      [
        {
          ts: key,
          avg_duration: 1500,
          p95_duration: 2940,
          total_runs: 10,
          passed_runs: 8,
          failed_runs: 2,
        },
      ],
      start,
      end,
    );
    const populated = buckets.find((b) => b.failedRuns === 2);
    expect(populated).toBeTruthy();
    expect(populated?.avgMs).toBe(1500);
    expect(populated?.p95Ms).toBe(2940);
    expect(populated?.uptimePct).toBeCloseTo(80, 5);
  });
});
