// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import AttemptStrip from "./AttemptStrip.vue";
import {
  buildAttemptViews,
  mapRunDetail,
} from "@/composables/synthetics/syntheticResultsSchema";

// ── Driven by a real ingested row, not a hand-tuned fixture ─────────────────
//
// This component has been built twice and shipped twice without rendering: once
// because the run-detail query never selected `attempts` or `retry_history`, and
// once because `mapRunDetail` read `rawHit.attempt` (a field no record has ever
// carried) so the count was 0 and the visibility guard hid the strip forever.
//
// Both faults were invisible to a component test using a purpose-built props
// object, and both were only caught by looking at a screenshot. So the input
// here is the shape the stream actually returns — column aliases and all,
// `retry_history` as the JSON STRING the search API hands back — pushed through
// the real mapper and the real fold.

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
    last_attempt_steps: JSON.stringify([
      { step_id: "s1", status: "passed", duration_ms: 5065 },
      { step_id: "fa1", status: "failed", duration_ms: 5005, error: "Timeout 5000ms exceeded" },
    ]),
    // The API returns this as a string, not an array. Passing an array here
    // would test a shape production never produces.
    retry_history: JSON.stringify([
      {
        attempt: 0,
        status: "failed",
        response_time_ms: 57795,
        init_ms: 188,
        steps: [{ step_id: "fa1", status: "failed", duration_ms: 5003 }],
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
        steps: [{ step_id: "fa1", status: "failed", duration_ms: 5005 }],
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

function mountStrip(over: Record<string, unknown> = {}, selected?: number) {
  const attempts = viewsFor(over);
  return mount(AttemptStrip, {
    props: { attempts, selected: selected ?? attempts.length - 1 },
    global: { plugins: [i18n] },
  });
}

describe("AttemptStrip", () => {
  it("renders one button per attempt from an ingested row", () => {
    const wrapper = mountStrip();
    expect(wrapper.find('[data-test="synthetics-attempt-strip"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-test^="synthetics-attempt-"]').length).toBeGreaterThanOrEqual(2);
    expect(wrapper.find('[data-test="synthetics-attempt-0"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="synthetics-attempt-1"]').exists()).toBe(true);
  });

  it("is hidden entirely on a run that never retried", () => {
    // Not "renders an empty strip" — a single-attempt run has nothing to switch
    // between, and an empty container still costs vertical space in a dense drawer.
    const wrapper = mountStrip({ attempts: 1, retry_history: "" });
    expect(wrapper.find('[data-test="synthetics-attempt-strip"]').exists()).toBe(false);
  });

  it("marks the last attempt as the one that decided the run", () => {
    const views = viewsFor();
    expect(views.map((v) => v.decided)).toEqual([false, true]);
    // `decided` describes the ATTEMPT, not the run: on a flaky run the deciding
    // attempt passed while the run reports `warning`.
    expect(views[1].compact).toBe(false);
    expect(views[0].compact).toBe(true);
  });

  it("selects the deciding attempt by default and emits the index on click", async () => {
    const wrapper = mountStrip();
    expect(wrapper.find('[data-test="synthetics-attempt-1"]').attributes("aria-pressed")).toBe(
      "true",
    );
    await wrapper.find('[data-test="synthetics-attempt-0"]').trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([0]);
  });

  it("explains the reduced detail on a superseded attempt only", () => {
    const sel = "[data-test='synthetics-attempt-reduced-detail']";
    expect(mountStrip({}, 0).find(sel).exists()).toBe(true);
    expect(mountStrip({}, 1).find(sel).exists()).toBe(false);
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
