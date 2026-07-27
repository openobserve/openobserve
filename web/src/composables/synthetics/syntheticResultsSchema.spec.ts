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
  aggregateStepStats,
  bucketInterval,
  buildHistogramSql,
  buildKpiSql,
  buildLastRunSql,
  buildRunsSql,
  buildRunsWithStepsSql,
  deviceIconName,
  deviceLabel,
  mapHistogram,
  mapKpi,
  mapRun,
} from "./syntheticResultsSchema";

describe("syntheticResultsSchema query builders", () => {
  it("should reference the configured stream and fields in the KPI SQL", () => {
    const sql = buildKpiSql("mon-1");
    expect(sql).toContain(`FROM "${SYNTHETIC_RESULTS_STREAM}"`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.monitorId} = 'mon-1'`);
    expect(sql).toContain(`FILTER (WHERE ${SYNTHETIC_FIELDS.status} = '${STATUS_VALUES.passed}')`);
    expect(sql).toContain(`FILTER (WHERE ${SYNTHETIC_FIELDS.status} = '${STATUS_VALUES.warning}')`);
    expect(sql).toContain(`FILTER (WHERE ${SYNTHETIC_FIELDS.status} = '${STATUS_VALUES.failed}')`);
    expect(sql).toContain(`FILTER (WHERE ${SYNTHETIC_FIELDS.status} = '${STATUS_VALUES.error}')`);
    expect(sql).toContain(`approx_percentile_cont(${SYNTHETIC_FIELDS.duration}, 0.95)`);
  });

  it("should include retried_runs clause when attempts field exists in schema", () => {
    const sql = buildKpiSql("mon-1", true);
    expect(sql).toContain("WHERE attempts > 1");
    expect(sql).toContain("retried_runs");
  });

  it("should omit retried_runs clause when attempts field is absent from schema", () => {
    const sql = buildKpiSql("mon-1", false);
    expect(sql).not.toContain("attempts");
    expect(sql).not.toContain("retried_runs");
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
    const sql = buildRunsSql("mon-1", 50, null);
    expect(sql).toContain("LIMIT 50");
    expect(sql).toContain(`${SYNTHETIC_FIELDS.location} as location`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.device} as device`);
    expect(sql).toContain(`${SYNTHETIC_FIELDS.error} as error`);
  });

  it("should select typed literals for columns absent from the stream schema", () => {
    // The schema only contains fields some ingested row has carried
    // (device/engine are browser-only, error appears after a first failure);
    // naming an absent field makes the search API reject the whole query.
    const sql = buildRunsSql(
      "mon-1",
      50,
      new Set(["_timestamp", "status", "response_time_ms", "location"]),
    );
    expect(sql).toContain(`${SYNTHETIC_FIELDS.timestamp} as ts`);
    expect(sql).toContain("status as status");
    expect(sql).toContain(`${SYNTHETIC_FIELDS.location} as location`);
    expect(sql).toContain("'' as device");
    expect(sql).toContain("'' as engine");
    expect(sql).toContain("'' as error");
    expect(sql).toContain("0 as scheduled_ts");
    expect(sql).not.toContain(`${SYNTHETIC_FIELDS.error} as error`);
    // Empty set (schema unavailable) — every optional column is a literal.
    const minimal = buildRunsSql("mon-1", 50, new Set());
    expect(minimal).toContain("0 as ts");
    expect(minimal).toContain("'' as status");
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

describe("buildRunsWithStepsSql", () => {
  it("should include the JSON step columns needed for client-side aggregation", () => {
    const sql = buildRunsWithStepsSql("mon-1", 500);
    expect(sql).toContain(`FROM "${SYNTHETIC_RESULTS_STREAM}"`);
    expect(sql).toContain("last_attempt_steps");
    expect(sql).toContain("recorded_steps");
    expect(sql).toContain("retry_history");
    expect(sql).toContain("attempts");
    expect(sql).toContain("LIMIT 500");
  });
});

describe("aggregateStepStats", () => {
  const HOUR = 60 * 60 * 1_000_000;
  const start = 1_700_000_000_000_000;
  const end = start + HOUR;

  function makeHit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ts: 1_700_000_000_500_000,
      engine: "chromium",
      location: "us-east-1",
      device: "desktop",
      error: "",
      run_id: "run-1",
      execution_id: "exec-1",
      attempts: 1,
      recorded_steps: JSON.stringify([
        { id: "step-1", name: "Open homepage", selector: "css=.hero" },
        { id: "step-2", name: "Click login", selector: "css=.login-btn" },
      ]),
      last_attempt_steps: JSON.stringify([
        { step_id: "step-1", status: "ok", duration_ms: 200, error: "" },
        {
          step_id: "step-2",
          status: "fail",
          duration_ms: 5000,
          error: "Timeout waiting for selector",
        },
      ]),
      retry_history: "[]",
      ...overrides,
    };
  }

  it("should compute correct fail rates and duration per step", () => {
    const result = aggregateStepStats([makeHit(), makeHit()], start, end);

    expect(result.stepGroups).toHaveLength(2);
    const login = result.stepGroups.find((g) => g.name === "Click login");
    expect(login).toBeTruthy();
    expect(login!.totalExecutions).toBe(2);
    expect(login!.failCount).toBe(2);
    expect(login!.failRate).toBeCloseTo(1, 5);
    expect(login!.avgDurationMs).toBe(5000);

    const home = result.stepGroups.find((g) => g.name === "Open homepage");
    expect(home).toBeTruthy();
    expect(home!.totalExecutions).toBe(2);
    expect(home!.failCount).toBe(0);
    expect(home!.failRate).toBe(0);
  });

  it("should detect flaky steps when a retry fixes a prior failure", () => {
    const hit = makeHit({
      attempts: 2,
      last_attempt_steps: JSON.stringify([
        { step_id: "step-1", status: "ok", duration_ms: 200, error: "" },
        { step_id: "step-2", status: "ok", duration_ms: 800, error: "" },
      ]),
      retry_history: JSON.stringify([
        {
          attempt: 1,
          status: "failed",
          durationMs: 5200,
          steps: [
            { step_id: "step-1", status: "ok", duration_ms: 200, error: "" },
            { step_id: "step-2", status: "fail", duration_ms: 5000, error: "Timeout" },
          ],
        },
      ]),
    });

    const result = aggregateStepStats([hit], start, end);
    const login = result.stepGroups.find((g) => g.name === "Click login");
    expect(login).toBeTruthy();
    expect(login!.flakyCount).toBe(1);
    expect(login!.flakyRate).toBeGreaterThan(0);
    expect(login!.failCount).toBe(0); // passed on final attempt
  });

  it("should NOT count step as flaky when it fails on all attempts", () => {
    const hit = makeHit({
      attempts: 2,
      last_attempt_steps: JSON.stringify([
        { step_id: "step-1", status: "ok", duration_ms: 200, error: "" },
        { step_id: "step-2", status: "fail", duration_ms: 5000, error: "Timeout" },
      ]),
      retry_history: JSON.stringify([
        {
          attempt: 1,
          status: "failed",
          durationMs: 5200,
          steps: [
            { step_id: "step-1", status: "ok", duration_ms: 200, error: "" },
            { step_id: "step-2", status: "fail", duration_ms: 5000, error: "Timeout" },
          ],
        },
      ]),
    });

    const result = aggregateStepStats([hit], start, end);
    const login = result.stepGroups.find((g) => g.name === "Click login");
    expect(login).toBeTruthy();
    expect(login!.flakyCount).toBe(0);
    expect(login!.failCount).toBe(1);
  });

  it("should break down failures by browser and location", () => {
    const chrome = makeHit({ engine: "chromium", location: "us-east-1" });
    const firefox = makeHit({
      engine: "firefox",
      location: "eu-west-1",
      run_id: "run-2",
      execution_id: "exec-2",
    });

    const result = aggregateStepStats([chrome, firefox], start, end);
    const login = result.stepGroups.find((g) => g.name === "Click login");
    expect(login).toBeTruthy();

    const chromStats = login!.browserStats.find((s) => s.name === "chromium");
    expect(chromStats).toBeTruthy();
    expect(chromStats!.total).toBe(1);
    expect(chromStats!.failures).toBe(1);

    const ffStats = login!.browserStats.find((s) => s.name === "firefox");
    expect(ffStats).toBeTruthy();
    expect(ffStats!.total).toBe(1);
    expect(ffStats!.failures).toBe(1);
  });

  it("should generate failure instances for failed and flaky steps", () => {
    const result = aggregateStepStats([makeHit()], start, end);
    expect(result.failureInstances.length).toBeGreaterThan(0);
    const loginFi = result.failureInstances.find((fi) => fi.stepName === "Click login");
    expect(loginFi).toBeTruthy();
    expect(loginFi!.isFlaky).toBe(false);
    expect(loginFi!.browser).toBe("chromium");
  });

  it("should handle empty input gracefully", () => {
    const result = aggregateStepStats([], start, end);
    expect(result.stepGroups).toEqual([]);
    expect(result.stepFailures).toEqual([]);
    expect(result.stepDurations).toEqual([]);
    expect(result.flakySteps).toEqual([]);
    expect(result.failureInstances).toEqual([]);
    expect(result.trendBuckets).toEqual([]);
  });

  it("should fall back to step_id when recorded_steps is missing", () => {
    const hit = makeHit({
      recorded_steps: "[]",
      last_attempt_steps: JSON.stringify([
        { id: "custom-step", status: "ok", duration_ms: 200, error: "" },
      ]),
    });

    const result = aggregateStepStats([hit], start, end);
    expect(result.stepGroups).toHaveLength(1);
    expect(result.stepGroups[0].name).toBe("custom-step");
    expect(result.stepGroups[0].sub).toBeNull();
  });

  it("should generate flakiest steps ranked by flaky count", () => {
    const flakyHit = makeHit({
      run_id: "run-a",
      execution_id: "exec-a",
      attempts: 2,
      last_attempt_steps: JSON.stringify([
        { step_id: "step-2", status: "ok", duration_ms: 800, error: "" },
      ]),
      retry_history: JSON.stringify([
        {
          attempt: 1,
          status: "failed",
          durationMs: 5200,
          steps: [{ step_id: "step-2", status: "fail", duration_ms: 5000, error: "Timeout" }],
        },
      ]),
    });

    const result = aggregateStepStats([flakyHit], start, end);
    expect(result.flakySteps).toHaveLength(1);
    expect(result.flakySteps[0].stepName).toBe("Click login");
    expect(result.flakySteps[0].flakyCount).toBe(1);
  });

  it("should generate trend buckets per step for the duration chart", () => {
    const result = aggregateStepStats([makeHit()], start, end);
    expect(result.trendBuckets.length).toBeGreaterThan(0);
    const loginBuckets = result.trendBuckets.filter((b) => b.stepName === "Click login");
    expect(loginBuckets.length).toBeGreaterThan(0);
    expect(loginBuckets[0].avgDurationMs).toBeGreaterThan(0);
  });
});

describe("deviceIconName", () => {
  it("should return the correct icon for desktop", () => {
    expect(deviceIconName("desktop")).toBe("computer");
  });

  it("should return the correct icon for tablet", () => {
    expect(deviceIconName("tablet")).toBe("tablet");
  });

  it("should return the correct icon for mobile", () => {
    expect(deviceIconName("mobile")).toBe("smartphone");
  });

  it("should fall back to 'devices' icon for an unknown device ID", () => {
    expect(deviceIconName("unknown_device")).toBe("devices");
  });

  it("should fall back to 'devices' icon for an empty string", () => {
    expect(deviceIconName("")).toBe("devices");
  });
});

describe("deviceLabel", () => {
  it("should return the correct label for desktop", () => {
    expect(deviceLabel("desktop")).toBe("Desktop");
  });

  it("should return the correct label for tablet", () => {
    expect(deviceLabel("tablet")).toBe("Tablet");
  });

  it("should return the correct label for mobile", () => {
    expect(deviceLabel("mobile")).toBe("Mobile");
  });

  it("should fall back to the raw device ID for an unknown device", () => {
    expect(deviceLabel("some_custom_device")).toBe("some_custom_device");
  });

  it("should fall back to the raw ID for an empty string", () => {
    expect(deviceLabel("")).toBe("");
  });
});
