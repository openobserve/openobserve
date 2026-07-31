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
  mapRunDetail,
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
  buildStepDefsSql,
  buildRetryAttributionSql,
  buildAttemptViews,
  foldRetryAttribution,
  foldStepDefs,
  splitDelimited,
  STATUS_REASON,
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
    expect(sql).toContain("retry_history");
    expect(sql).toContain("attempts");
    expect(sql).toContain("LIMIT 500");
  });

  it("should NOT select recorded_steps on the wide tally query", () => {
    // ~4 KB per row, near-identical across rows of one config version. Selecting
    // it on 5000 rows was roughly 60% of the panel's payload; the definitions
    // come from buildStepDefsSql over a bounded subset instead.
    expect(buildRunsWithStepsSql("mon-1", 5000)).not.toContain("recorded_steps");
  });

  it("should fetch step definitions from a bounded row subset", () => {
    const sql = buildStepDefsSql("mon-1", 100);
    expect(sql).toContain("recorded_steps");
    expect(sql).toContain("LIMIT 100");
    expect(sql).toContain("ORDER BY");
    // Only the blob — nothing else is needed to build the lookup.
    expect(sql).not.toContain("last_attempt_steps");
  });
});

describe("foldStepDefs", () => {
  const row = (steps: unknown[]) => ({ recorded_steps: JSON.stringify(steps) });

  it("should build a step_id keyed lookup", () => {
    const defs = foldStepDefs([
      row([
        { id: "s1", name: "Open page" },
        { id: "s2", name: "Click login" },
      ]),
    ]);
    expect(defs.get("s1")?.name).toBe("Open page");
    expect(defs.get("s2")?.name).toBe("Click login");
  });

  it("should prefer the newest definition when a step was renamed", () => {
    // Rows arrive newest-first, so the first definition seen for an id wins —
    // a renamed step shows its current name while older rows still resolve.
    const defs = foldStepDefs([
      row([{ id: "s1", name: "Click sign in" }]), // newer
      row([{ id: "s1", name: "Click login" }]), // older
    ]);
    expect(defs.get("s1")?.name).toBe("Click sign in");
  });

  it("should fall back to the id when a definition has no name", () => {
    expect(foldStepDefs([row([{ id: "s9" }])]).get("s9")?.name).toBe("s9");
  });

  it("should tolerate rows with no recorded_steps", () => {
    expect(foldStepDefs([{}, { recorded_steps: "" }]).size).toBe(0);
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

describe("mapRunDetail — evidence the probe already writes (Phase 4)", () => {
  function hit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ts: 1_700_000_000_500_000,
      engine: "chromium",
      location: "us-east-1",
      device: "desktop",
      run_id: "run-1",
      execution_id: "exec-1",
      recorded_steps: JSON.stringify([{ id: "s1", name: "Sign in" }]),
      last_attempt_steps: JSON.stringify([
        { step_id: "s1", status: "ok", duration_ms: 10, error: "" },
      ]),
      ...overrides,
    };
  }

  it("keeps `skipped` as skipped instead of reporting it as a failure", () => {
    // An `optional` step exists precisely because it may not be there — a
    // cookie banner, a one-time popup. Collapsing it to `fail` reported a
    // correctly-skipped step as broken, the opposite of what the feature is for.
    const detail = mapRunDetail(
      hit({
        last_attempt_steps: JSON.stringify([
          { step_id: "s1", status: "ok", duration_ms: 5 },
          { step_id: "s2", status: "skipped", duration_ms: 1 },
          { step_id: "s3", status: "failed", duration_ms: 9 },
        ]),
      }),
    );
    expect(detail.lastAttemptSteps.map((s) => s.status)).toEqual(["ok", "skipped", "fail"]);
  });

  it("maps retry history instead of discarding it", () => {
    // The probe writes retry_history on every failed run; the mapper hardcoded
    // an empty array, so no component could ever read it. A step that failed
    // once and passed next attempt is transient by definition.
    const detail = mapRunDetail(
      hit({
        retry_history: [
          {
            attempt: 0,
            steps: [
              { step_id: "s1", status: "passed", duration_ms: 100 },
              { step_id: "s2", status: "failed", duration_ms: 400 },
            ],
          },
        ],
      }),
    );
    expect(detail.retryHistory).toHaveLength(1);
    expect(detail.retryHistory[0].attempt).toBe(0);
    // Derived, not invented: an entry exists only because that attempt failed.
    expect(detail.retryHistory[0].status).toBe("failed");
    expect(detail.retryHistory[0].durationMs).toBe(500);
    expect(detail.retryHistory[0].failedStep).toBe("s2");
  });

  it("maps the seven items of failure_detail", () => {
    const detail = mapRunDetail(
      hit({
        failure_detail: {
          step_id: "s2",
          step_name: "Profile visible",
          step_index: 2,
          error: "locator.waitFor: Timeout 60000ms exceeded",
          candidates_tried: [
            { kind: "test_attribute", value: '[data-test="x"]', outcome: "not_found" },
            { kind: "role", value: "internal:role=button", outcome: "matched" },
          ],
          settle_signals: [
            {
              kind: "response",
              signal: "response matching **/auth/login",
              status: "stale",
              required: false,
              waited_ms: 30000,
            },
          ],
          settle_ms: 41000,
          observed_duration_ms: 2300,
          screenshot_key: "k/shot.png",
          trace_key: "k/trace.zip",
        },
      }),
    );

    const fd = detail.failureDetail!;
    expect(fd.stepName).toBe("Profile visible");
    expect(fd.stepIndex).toBe(2);
    expect(fd.error).toContain("Timeout 60000ms");
    // Item 3 — which candidate matched answers "locator rot?" mechanically.
    expect(fd.candidatesTried.map((c) => c.outcome)).toEqual(["not_found", "matched"]);
    // Item 4 — a stale signal is the strongest application-is-at-fault
    // indicator already on the record, and it was invisible.
    expect(fd.settleSignals[0].status).toBe("stale");
    expect(fd.settleSignals[0].waitedMs).toBe(30000);
    // Item 5 — settled in 2.3s when recorded, 41s today.
    expect(fd.settleMs).toBe(41000);
    expect(fd.observedDurationMs).toBe(2300);
    expect(fd.screenshotKey).toBe("k/shot.png");
    expect(fd.traceKey).toBe("k/trace.zip");
  });

  it("returns null failure detail on a passing run", () => {
    expect(mapRunDetail(hit()).failureDetail).toBeNull();
  });

  it("degrades rather than throwing on a record written before these fields", () => {
    // Backwards compatibility: records predating the probe change carry none of
    // this, and must render as they did before rather than break the view.
    const detail = mapRunDetail(hit({ retry_history: undefined, failure_detail: undefined }));
    expect(detail.retryHistory).toEqual([]);
    expect(detail.failureDetail).toBeNull();
  });
});

// ── C3 · flaky and degraded are different failures ───────────────────────────

describe("KPI: warning is two unrelated things", () => {
  it("splits flaky from degraded when status_reason is in the schema", () => {
    const sql = buildKpiSql("mon-1", true, true);
    expect(sql).toContain("as flaky_runs");
    expect(sql).toContain("as degraded_runs");
    // Both clauses hang off the scan the query already performs.
    expect(sql.match(/FROM/g)).toHaveLength(1);
  });

  it("omits both clauses when the field is absent from the schema", () => {
    // The search API rejects a query naming a field the stream doesn't have,
    // which would take the whole KPI panel down rather than one tile.
    const sql = buildKpiSql("mon-1", true, false);
    expect(sql).not.toContain("status_reason");
  });

  it("counts flaky and degraded separately, against the execution denominator", () => {
    const kpi = mapKpi(
      {
        total_runs: 100,
        passed_runs: 80,
        warning_runs: 12,
        failed_runs: 5,
        error_runs: 3,
        flaky_runs: 4,
        degraded_runs: 8,
      },
      null,
    );
    // A TLS check inside its warning window is `warning` on every single run.
    // Folded together, it reported as ~100% flaky forever.
    expect(kpi.flakyExecutions).toBe(4);
    expect(kpi.degradedExecutions).toBe(8);
    // D4 — the denominator is executions, the grain of totalRuns.
    expect(kpi.totalRuns).toBe(100);
  });
});

// ── C7 · the flaky column without the 5000-row blob fetch ────────────────────

describe("retry attribution", () => {
  it("scans only the rows that actually retried", () => {
    const sql = buildRetryAttributionSql("mon-1");
    expect(sql).toContain("attempts > 1");
    expect(sql).toContain("retry_step_ids");
    // The point of the column is that no blob is read.
    expect(sql).not.toContain("retry_history");
    expect(sql).not.toContain("last_attempt_steps");
  });

  it("splits the delimited form back without empty members", () => {
    // The probe wraps in leading/trailing commas so LIKE '%,s2,%' cannot also
    // match s20. Splitting has to drop the segments that wrapping creates.
    expect(splitDelimited(",s2,s20,")).toEqual(["s2", "s20"]);
    expect(splitDelimited("")).toEqual([]);
    expect(splitDelimited(undefined)).toEqual([]);
  });

  it("reads recovery from the verdict, not from the row's presence", () => {
    // D2 — attribution is written on any retried execution. A run that retried
    // three times and still failed is attributed too, and must not be counted
    // as a step that recovers.
    const summary = foldRetryAttribution([
      {
        execution_id: "e1",
        status: STATUS_VALUES.warning,
        status_reason: STATUS_REASON.flaky,
        retry_step_ids: ",s3,",
        retry_error_classes: ",timeout,",
      },
      {
        execution_id: "e2",
        status: STATUS_VALUES.failed,
        status_reason: "",
        retry_step_ids: ",s3,",
        retry_error_classes: ",timeout,",
        retry_consistent: true,
      },
    ]);
    expect(summary.retriedExecutions).toBe(2);
    expect(summary.byStep.get("s3")).toEqual({ retriedExecutions: 2, flakyExecutions: 1 });
    expect(summary.byErrorClass.get("timeout")).toBe(2);
    expect(summary.consistentFailures).toBe(1);
    expect(summary.byExecution.get("e1")).toEqual(new Set(["s3"]));
  });

  it("treats an absent retry_consistent as unknown, never as false", () => {
    // D1 — the column is deliberately absent below two failing attempts.
    // Counting absent as `false` would report every recovered run as
    // non-deterministic, which is the opposite of what happened.
    const summary = foldRetryAttribution([
      {
        execution_id: "e1",
        status: STATUS_VALUES.warning,
        status_reason: STATUS_REASON.flaky,
        retry_step_ids: ",s1,",
      },
    ]);
    expect(summary.consistentFailures).toBe(0);
    expect(summary.retriedExecutions).toBe(1);
  });

  it("drives the flaky tally without any retry_history being present", () => {
    const attribution = foldRetryAttribution([
      {
        execution_id: "ex-1",
        status: STATUS_VALUES.warning,
        status_reason: STATUS_REASON.flaky,
        retry_step_ids: ",s1,",
      },
    ]);
    const stats = aggregateStepStats(
      [
        {
          ts: 1_700_000_000_000_000,
          execution_id: "ex-1",
          run_id: "r1",
          attempts: 2,
          // No retry_history column at all — that is the saving.
          last_attempt_steps: JSON.stringify([
            { step_id: "s1", status: "ok", duration_ms: 120 },
            { step_id: "s2", status: "ok", duration_ms: 80 },
          ]),
        },
      ],
      1_699_000_000_000_000,
      1_701_000_000_000_000,
      new Map([
        ["s1", { name: "Sign in", selector: ".btn" }],
        ["s2", { name: "Dashboard", selector: null }],
      ]),
      attribution,
    );
    const flaky = stats.flakySteps.find((f) => f.stepName === "Sign in");
    expect(flaky, "s1 failed on attempt 0 and passed on attempt 1").toBeTruthy();
    expect(stats.flakySteps.find((f) => f.stepName === "Dashboard")).toBeUndefined();
  });
});

// ── C2 · one uniform attempts list ───────────────────────────────────────────

describe("attempt views", () => {
  const detail = (over: Record<string, unknown> = {}) =>
    mapRunDetail({
      ts: 1_700_000_000_000_000,
      status: STATUS_VALUES.warning,
      duration: 1200,
      execution_id: "ex-1",
      run_id: "r1",
      attempts: 2,
      last_attempt_steps: JSON.stringify([{ step_id: "s1", status: "ok", duration_ms: 120 }]),
      trace_key: "traces/final.zip",
      ...over,
    })!;

  it("marks the last attempt as the deciding one and gives it the full detail", () => {
    const views = buildAttemptViews(
      detail({
        retry_history: [
          {
            attempt: 0,
            status: "failed",
            response_time_ms: 3400,
            steps: [{ step_id: "s1", status: "failed", duration_ms: 3000 }],
            artifacts: { trace_ref: "traces/attempt-1.zip" },
          },
          { attempt: 1, status: "passed", response_time_ms: 1200, steps: [] },
        ],
      }),
    );
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ decided: false, compact: true, status: "failed" });
    // A passing final attempt used to be reported as failed: the mapper
    // hard-coded the status on the reasoning that entries only exist for
    // failures. On a flaky run that is the one attempt that passed.
    expect(views[1]).toMatchObject({ decided: true, compact: false, status: "passed" });
    // The deciding attempt is what the record's top-level fields describe.
    expect(views[1].steps).toHaveLength(1);
    expect(views[1].traceKey).toBe("traces/final.zip");
    // A superseded attempt keeps its OWN artifacts, not the survivor's.
    expect(views[0].traceKey).toBe("traces/attempt-1.zip");
  });

  it("uses the probe's own duration rather than summing step durations", () => {
    // Summing steps misses everything between them — launch, settle waits, the
    // navigation a step triggers — which on a real journey is most of the time.
    const views = buildAttemptViews(
      detail({
        retry_history: [
          {
            attempt: 0,
            status: "failed",
            response_time_ms: 3400,
            steps: [{ step_id: "s1", status: "failed", duration_ms: 120 }],
          },
          { attempt: 1, status: "passed", response_time_ms: 1200, steps: [] },
        ],
      }),
    );
    expect(views[0].durationMs).toBe(3400);
  });

  it("shows a single attempt for a run that never retried", () => {
    const views = buildAttemptViews(detail({ retry_history: [], attempts: 1 }));
    expect(views).toHaveLength(1);
    expect(views[0].decided).toBe(true);
  });

  it("counts attempts from the field the probe actually writes", () => {
    // The mapper read `attempt`, which no record has ever carried, so the count
    // was 0 on every run and the retry chip never appeared.
    expect(detail({ attempts: 3 }).attempts).toBe(3);
  });
});

// ── C4/C5 · the two costs inside one duration ────────────────────────────────

describe("run timing breakdown", () => {
  it("separates queue delay from run duration", () => {
    const run = mapRun({
      ts: 1_700_000_002_200_000,
      scheduled_ts: 1_700_000_000_000_000,
      started_ts: 1_700_000_001_000_000,
      duration: 1200,
      init_ms: 900,
      status: STATUS_VALUES.passed,
    });
    expect(run.queueDelayMs).toBe(1000);
    // init is INSIDE duration — subtract it, never add it.
    expect(run.initMs).toBe(900);
    expect(run.durationMs).toBe(1200);
  });

  it("reports an unknown queue delay as null, not as zero", () => {
    // Rendering an unknown as 0 ms claims the scheduler was perfect on every
    // record written before started_ts existed.
    const run = mapRun({ ts: 1_700_000_002_200_000, scheduled_ts: 1_700_000_000_000_000 });
    expect(run.queueDelayMs).toBeNull();
  });

  it("never reports a negative delay", () => {
    // A start before the schedule is a clock artefact, not early execution.
    const run = mapRun({
      ts: 1_700_000_002_200_000,
      scheduled_ts: 1_700_000_001_000_000,
      started_ts: 1_700_000_000_000_000,
    });
    expect(run.queueDelayMs).toBe(0);
  });
});
