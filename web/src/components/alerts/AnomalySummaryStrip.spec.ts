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

import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AnomalySummaryStrip from "@/components/alerts/AnomalySummaryStrip.vue";
import type { AnomalyExploreResponse, AnomalyExploreSummary } from "@/types/anomalyExplore";

const MIN = 60_000_000;
const NOW = Date.parse("2026-11-16T19:10:00Z") * 1000;
const at = (hhmm: string) => Date.parse(`2026-11-16T${hhmm}:00Z`) * 1000;

const CONFIG = {
  enabled: true,
  is_trained: true,
  current_model_version: 7,
  schedule_interval: "5m",
  histogram_interval: "15m",
};

const summary = (over: Partial<AnomalyExploreSummary> = {}): AnomalyExploreSummary => ({
  kind: "value",
  actual: 208,
  expected: 138.8,
  expected_lower: 120.4,
  expected_upper: 157.2,
  change_percent: 49.8,
  started_us: at("18:00"),
  since_us: null,
  ...over,
});

const response = (over: Partial<AnomalyExploreResponse> = {}): AnomalyExploreResponse => ({
  url: "https://o2.example/web/logs?stream=k8s_logs",
  label: "View logs",
  target: "logs",
  filter_applied: true,
  name: "checkout-requests",
  measure: "count(*) per 15 min",
  stream: "k8s_logs",
  filter: null,
  state: "none",
  state_source: "buckets",
  summary: null,
  model_version: 7,
  last_detection_run: NOW - 2 * MIN,
  cursor_us: NOW - 5 * MIN,
  no_new_data_since_us: null,
  window: null,
  explore_start_us: 0,
  ...over,
});

let wrapper: ReturnType<typeof mount> | null = null;

const mountStrip = (props: Record<string, unknown>) => {
  wrapper = mount(AnomalySummaryStrip, {
    props: { response: null, loading: false, failed: false, config: CONFIG, nowUs: NOW, ...props },
    global: { plugins: [i18n] },
  });
  return wrapper;
};

const text = (w: ReturnType<typeof mount>, key: string) =>
  w.find(`[data-test="alerts-anomalysummarystrip-${key}"]`);

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("AnomalySummaryStrip", () => {
  it("shows a skeleton while the summary loads", () => {
    const w = mountStrip({ loading: true });
    expect(text(w, "loading").exists()).toBe(true);
    expect(text(w, "open").exists()).toBe(false);
  });

  it("shows the failure with Retry, which asks the parent to reload", async () => {
    const w = mountStrip({ failed: true });
    expect(text(w, "error").text()).toBe("Could not load the anomaly summary");
    await text(w, "retry").trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it("shows Ongoing in red with its start and the readings", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary(),
        window: { start_us: at("18:00"), end_us: at("18:45"), clipped: false },
      }),
    });
    const state = text(w, "state-ongoing");
    expect(state.text()).toBe("Ongoing since 18:00 UTC");
    expect(state.classes()).toContain("text-status-error-text");
    expect(text(w, "actual").text()).toContain("208.00");
    expect(text(w, "expected").text()).toContain("120.40-157.20");
    expect(text(w, "change").text()).toContain("+49.8%");
  });

  it("says Started before when the window is clipped", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary(),
        window: { start_us: at("18:00"), end_us: at("18:45"), clipped: true },
      }),
    });
    expect(text(w, "state-ongoing").text()).toBe("Ongoing, started before 18:00 UTC");
  });

  it("adds the gray No new data line under Ongoing during an absence, with no numbers", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary({
          kind: "absence",
          actual: null,
          expected: null,
          expected_lower: null,
          expected_upper: null,
          change_percent: null,
        }),
        no_new_data_since_us: at("18:00"),
        window: { start_us: at("18:00"), end_us: at("18:15"), clipped: false },
      }),
    });
    expect(text(w, "absence").text()).toBe("k8s_logs returned no data since 18:00 UTC");
    expect(text(w, "nonewdata").text()).toBe("No new data since 18:00 UTC");
    expect(text(w, "readings").exists()).toBe(false);
  });

  it("dates an absence after high values from the absence, not the episode start", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary({
          kind: "absence",
          actual: null,
          expected: null,
          expected_lower: null,
          expected_upper: null,
          change_percent: null,
          started_us: at("17:30"),
          since_us: at("18:15"),
        }),
        window: { start_us: at("17:30"), end_us: at("18:30"), clipped: false },
      }),
    });
    expect(text(w, "absence").text()).toBe("k8s_logs returned no data since 18:15 UTC");
    expect(text(w, "state-ongoing").text()).toContain("17:30");
  });

  it("shows a partial drop with the expected value and no range", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary({
          kind: "partial_drop",
          actual: 12,
          expected: 120,
          expected_lower: null,
          expected_upper: null,
        }),
        window: { start_us: at("18:00"), end_us: at("18:15"), clipped: false },
      }),
    });
    expect(text(w, "expected").text()).toContain("120.00");
    expect(text(w, "expected").text()).not.toContain("-");
  });

  it("shows the amber note while the newest bucket is still open", () => {
    const w = mountStrip({
      response: response({
        state: "ongoing",
        summary: summary(),
        window: { start_us: at("18:00"), end_us: NOW - 2 * MIN, clipped: false },
      }),
    });
    const note = text(w, "incomplete");
    expect(note.text()).toBe("Last point may be incomplete");
    expect(note.classes()).toContain("text-status-warning-text");
  });

  it("shows Back in range in a neutral colour with since, duration and peak", () => {
    const w = mountStrip({
      response: response({
        state: "back_in_range",
        summary: summary({ actual: 231, started_us: at("18:00"), since_us: at("21:45") }),
        last_detection_run: at("21:58"),
        no_new_data_since_us: null,
      }),
      nowUs: at("22:00"),
      config: { ...CONFIG },
    });
    const state = text(w, "state-back_in_range");
    expect(state.text()).toBe("Back in range since 21:45 UTC, lasted 3 h 45 m");
    expect(state.classes()).not.toContain("text-status-error-text");
    expect(text(w, "actual").text()).toContain("Peak");
    expect(text(w, "expected").exists()).toBe(false);
  });

  it.each([
    [{ enabled: false }, {}, "paused", "Detector is paused"],
    [
      {},
      { last_detection_run: at("18:05") },
      "no_recent_runs",
      "No recent runs, last run 18:05 UTC",
    ],
    [{}, { no_new_data_since_us: at("18:05") }, "no_new_data", "No new data since 18:05 UTC"],
    [
      { is_trained: false },
      { state: "no_runs", last_detection_run: null, model_version: 0 },
      "learning",
      "Learning normal behaviour. Alerts start after training.",
    ],
    [{}, {}, "none", "No anomalies in the last 7 days"],
  ])("shows the %s state", (config, over, state, copy) => {
    const w = mountStrip({
      response: response(over as Partial<AnomalyExploreResponse>),
      config: { ...CONFIG, ...config },
    });
    expect(text(w, `state-${state}`).text()).toBe(copy);
  });

  it("takes the primary button label and link from the endpoint", async () => {
    const w = mountStrip({ response: response() });
    const open = text(w, "open");
    expect(open.text()).toBe("View logs");
    await open.trigger("click");
    expect(w.emitted("open")?.[0]).toEqual(["https://o2.example/web/logs?stream=k8s_logs"]);
  });

  it("has no primary button when the endpoint has nothing to open", () => {
    const w = mountStrip({ response: response({ url: "" }) });
    expect(text(w, "open").exists()).toBe(false);
  });

  it("has no Ask AI button (AC1.10)", () => {
    expect(text(mountStrip({ response: response() }), "ask-ai").exists()).toBe(false);
  });
});
