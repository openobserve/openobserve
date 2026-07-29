// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";

import { buildAttemptViews, mapRunDetail } from "./syntheticResultsSchema";

// ── Driven by a real ingested row, not a hand-tuned fixture ─────────────────
//
// The attempts view was built twice and shipped twice without appearing: once
// because the run-detail query never selected `attempts` or `retry_history`, and
// once because `mapRetryHistory` guarded on `Array.isArray` while the search API
// returns blob columns as JSON STRINGS — so it returned [] for every real record.
// `mapRunDetail` also read `rawHit.attempt`, a field no record has ever carried.
//
// All three were invisible to a test built around a purpose-made object and were
// only caught from a screenshot. So the input here is the shape the stream
// actually returns, column aliases and all, pushed through the real mapper.

/** One execution of `intro test (expect fail)`, retries=1, as ingested. */
function ingestedRow(over: Record<string, unknown> = {}) {
  const base =
    "synthetics/default/3HAzRCdLOfBKPUm6Rg4Pvr9Ocig/2026/07/29/RUN/EXEC/";
  return {
    ts: 1785356358235000,
    status: "failed",
    duration: 58341,
    scheduled_ts: 1785356234814690,
    started_ts: 1785356236773000,
    init_ms: 118,
    attempts: 2,
    total_attempt_ms: 121229,
    run_id: "RUN",
    execution_id: "EXEC",
    synthetics_name: "intro test (expect fail)",
    trace_key: `${base}attempt-1-trace.zip`,
    evidence_key: `${base}attempt-1-evidence.ndjson`,
    // The deciding attempt's steps, which is what `buildAttemptViews` substitutes
    // for its compact timeline. The probe stamps `screenshot_key` here too, under
    // the deciding attempt's own prefix.
    last_attempt_steps: JSON.stringify([
      {
        step_id: "s1",
        status: "passed",
        duration_ms: 5065,
        screenshot_key: `${base}attempt-1-screenshot-s1.png`,
      },
      {
        step_id: "fa1",
        status: "failed",
        duration_ms: 5005,
        error: "Timeout 5000ms exceeded",
        screenshot_key: `${base}attempt-1-screenshot-fa1.png`,
      },
    ]),
    // The API returns this as a string, not an array. Passing an array here
    // would test a shape production never produces.
    retry_history: JSON.stringify([
      {
        attempt: 0,
        status: "failed",
        response_time_ms: 57795,
        init_ms: 188,
        steps: [
          { step_id: "s1", status: "passed", duration_ms: 5046, screenshot_key: `${base}screenshot-s1.png` },
          { step_id: "fa1", status: "failed", duration_ms: 5003, screenshot_key: `${base}screenshot-fa1.png` },
        ],
        failure_detail: { step_id: "fa1", step_name: "Assert visible", step_index: 20, error: "Timeout" },
        artifacts: {
          screenshot_refs: [{ step_id: "fa1", key: `${base}screenshot-fa1.png` }],
          trace_ref: `${base}trace.zip`,
          evidence_ref: `${base}evidence.ndjson`,
        },
      },
      {
        attempt: 1,
        status: "failed",
        response_time_ms: 58341,
        init_ms: 118,
        steps: [
          { step_id: "s1", status: "passed", duration_ms: 5065, screenshot_key: `${base}attempt-1-screenshot-s1.png` },
          { step_id: "fa1", status: "failed", duration_ms: 5005, screenshot_key: `${base}attempt-1-screenshot-fa1.png` },
        ],
        failure_detail: { step_id: "fa1", step_name: "Assert visible", step_index: 20, error: "Timeout" },
        artifacts: {
          screenshot_refs: [{ step_id: "fa1", key: `${base}attempt-1-screenshot-fa1.png` }],
          trace_ref: `${base}attempt-1-trace.zip`,
          evidence_ref: `${base}attempt-1-evidence.ndjson`,
        },
      },
    ]),
    ...over,
  };
}

const viewsFor = (over: Record<string, unknown> = {}) =>
  buildAttemptViews(mapRunDetail(ingestedRow(over))!);

describe("attempt views", () => {
  it("yields one view per attempt, so the selector has something to select", () => {
    // A single-attempt run yields exactly one view; the caller hides the
    // selector rather than rendering a control with one option.
    expect(viewsFor()).toHaveLength(2);
    expect(viewsFor({ attempts: 1, retry_history: "" })).toHaveLength(1);
  });

  it("marks the last attempt as the one that decided the run", () => {
    const views = viewsFor();
    expect(views.map((v) => v.decided)).toEqual([false, true]);
    // `decided` describes the ATTEMPT, not the run: on a flaky run the deciding
    // attempt passed while the run reports `warning`.
    expect(views[1].compact).toBe(false);
    expect(views[0].compact).toBe(true);
  });

  it("keeps each attempt's own artifacts rather than the survivor's", () => {
    const views = viewsFor();
    // The regression this guards: a superseded attempt's screenshots live under
    // an `attempt-N-` key, and falling back to the record's would show the
    // deciding attempt's pixels under the failing attempt's label.
    expect(views[0].screenshotKeys.get("fa1")).toContain("/screenshot-fa1.png");
    expect(views[0].traceKey).toContain("/trace.zip");
    expect(views[0].traceKey).not.toContain("attempt-1-");
    expect(views[1].screenshotKeys.get("fa1")).toContain("attempt-1-screenshot-fa1.png");
    expect(views[1].traceKey).toContain("attempt-1-trace.zip");
  });

  it("reports each attempt's own duration, not a sum of step durations", () => {
    // Summing steps misses launch, settle waits and the navigation a step
    // triggers — most of the wall clock on a real journey.
    const views = viewsFor();
    expect(views[0].durationMs).toBe(57795);
    expect(views[1].durationMs).toBe(58341);
  });

  it("counts attempts from the field the record actually carries", () => {
    // `mapRunDetail` read `rawHit.attempt`, which no record has; the count was 0
    // on every run and the retry chip never appeared.
    expect(mapRunDetail(ingestedRow())!.attempts).toBe(2);
    // And falls back to the history length when `attempts` is absent.
    expect(mapRunDetail(ingestedRow({ attempts: 0 }))!.attempts).toBe(2);
  });
});

// ── Each attempt keeps its own screenshots and its own evidence bundle ───────

describe("per-attempt artifacts", () => {
  it("normalises the compact timeline's step statuses", () => {
    // The probe writes `passed`/`failed` on the compact timeline while
    // `StepExecution` declares `ok`/`fail`, and every consumer tests for `fail`.
    // Passed through raw, a superseded attempt's FAILING step rendered as a
    // pass — a green tick on the step that actually broke.
    const [superseded] = viewsFor();
    expect(superseded.steps.map((s) => s.status)).toEqual(["ok", "fail"]);
  });

  it("keeps `skipped` distinct from `fail`", () => {
    // An `optional` step exists because it may not be there; collapsing it to
    // `fail` reports a correctly-skipped step as a broken one.
    const rows = viewsFor({
      retry_history: JSON.stringify([
        { attempt: 0, status: "failed", steps: [{ step_id: "opt", status: "skipped", duration_ms: 1 }] },
        { attempt: 1, status: "failed", steps: [] },
      ]),
    });
    expect(rows[0].steps[0].status).toBe("skipped");
  });

  it("resolves screenshots per attempt, from that attempt's own keys", () => {
    const [a0, a1] = viewsFor();
    // Attempt 0 keeps the bare key; retries are `attempt-N-` prefixed. Falling
    // back to the record's key would show the deciding attempt's pixels under
    // the failing attempt's label.
    expect(a0.steps.find((s) => s.step_id === "fa1")!.screenshot_key).toContain(
      "/screenshot-fa1.png",
    );
    expect(a0.steps.find((s) => s.step_id === "fa1")!.screenshot_key).not.toContain("attempt-1-");
    expect(a1.steps.find((s) => s.step_id === "fa1")!.screenshot_key).toContain(
      "attempt-1-screenshot-fa1.png",
    );
    // And the same via the refs map the step table reads.
    expect(a0.screenshotKeys.get("fa1")).not.toContain("attempt-1-");
    expect(a1.screenshotKeys.get("fa1")).toContain("attempt-1-");
  });

  it("gives every attempt its own evidence bundle and trace", () => {
    const [a0, a1] = viewsFor();
    expect(a0.evidenceKey).toBe("…/evidence.ndjson".replace("…/", a0.evidenceKey!.slice(0, a0.evidenceKey!.lastIndexOf("/") + 1)));
    expect(a0.evidenceKey).not.toContain("attempt-1-");
    expect(a1.evidenceKey).toContain("attempt-1-evidence.ndjson");
    expect(a0.traceKey).not.toContain("attempt-1-");
    expect(a1.traceKey).toContain("attempt-1-trace.zip");
  });
});
