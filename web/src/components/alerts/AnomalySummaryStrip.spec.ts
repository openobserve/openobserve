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
    global: {
      plugins: [i18n],
      stubs: {
        OTooltip: { props: ["content"], template: '<span data-test="tip" :data-tip="content" />' },
      },
    },
  });
  return wrapper;
};

const NO_VALUES = {
  actual: null,
  expected: null,
  expected_lower: null,
  expected_upper: null,
  change_percent: null,
};

const ongoing = (over: Partial<AnomalyExploreResponse> = {}, clipped = false) =>
  response({
    state: "ongoing",
    summary: summary(),
    window: { start_us: at("18:00"), end_us: at("19:00"), clipped },
    ...over,
  });

const tip = (w: ReturnType<typeof mount>, key: string) =>
  text(w, key).find('[data-test="tip"]').attributes("data-tip");

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

  describe("state zone (AC1.31)", () => {
    it("shows the Ongoing chip, the duration, the start and the measure", () => {
      const w = mountStrip({ response: ongoing() });
      const chip = text(w, "chip");
      expect(chip.text()).toBe("Ongoing");
      expect(chip.classes().join(" ")).toContain("badge-error-soft");
      expect(text(w, "fact").text()).toBe("for 1 h");
      expect(text(w, "secondary").text()).toBe("since 18:00");
      expect(text(w, "measure").text()).toBe("count(*) per 15 min · k8s_logs");
    });

    it("writes hours and minutes of a longer anomaly", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({ started_us: at("16:15") }),
          window: { start_us: at("16:15"), end_us: at("19:00"), clipped: false },
        }),
      });
      expect(text(w, "fact").text()).toBe("for 2 h 45 min");
    });

    it("gives the UTC time of each strip time in its tooltip, with no UTC text in the strip", () => {
      const w = mountStrip({ response: ongoing() });
      expect(text(w, "secondary").text()).not.toContain("UTC");
      expect(tip(w, "secondary")).toBe("2026-11-16 18:00 UTC");
    });

    it("says started before and shows no duration when the window is clipped (AC1.26)", () => {
      const w = mountStrip({ response: ongoing({}, true) });
      expect(text(w, "fact").text()).toBe("started before 18:00");
      expect(text(w, "secondary").exists()).toBe(false);
      expect(w.text()).not.toContain("for ");
    });

    it("shows the date of a start on another day", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({ started_us: at("18:00") - 24 * 60 * MIN }),
          window: { start_us: at("18:00") - 24 * 60 * MIN, end_us: at("19:00"), clipped: true },
        }),
      });
      expect(text(w, "fact").text()).toMatch(/^started before \D+ ?15,? 18:00$/);
    });

    it("shows No new data, not Ongoing, for a value run whose query went quiet", () => {
      const w = mountStrip({ response: ongoing({ no_new_data_since_us: at("18:05") }) });
      expect(text(w, "state-no_new_data").exists()).toBe(true);
      expect(text(w, "chip").text()).toBe("No new data");
      expect(text(w, "fact").text()).toBe("since 18:05");
      expect(text(w, "message").text()).toBe(
        "The detector runs, but its query has returned no new data.",
      );
      expect(text(w, "readings").exists()).toBe(false);
    });
  });

  describe("readings zone", () => {
    it("shows Actual and Change in red with an arrow while Ongoing (AC1.31)", () => {
      const w = mountStrip({ response: ongoing() });
      const value = (key: string) =>
        text(w, key).find('[data-test="alerts-anomalysummarystrip-value"]');
      expect(value("actual").text()).toBe("208.00");
      expect(value("actual").classes()).toContain("text-status-error-text");
      expect(value("actual").classes()).toContain("text-lg");
      expect(value("expected").text()).toBe("120.40 – 157.20");
      expect(value("expected").classes()).toContain("text-text-heading");
      expect(value("change").text()).toBe("▲ +49.8%");
      expect(value("change").classes()).toContain("text-status-error-text");
    });

    it("shows a partial drop with one expected value and a down arrow", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({
            kind: "partial_drop",
            actual: 40,
            expected: 100,
            expected_lower: null,
            expected_upper: null,
            change_percent: -60,
          }),
        }),
      });
      expect(text(w, "expected").text()).toContain("100.00");
      expect(text(w, "expected").text()).not.toContain("–");
      expect(text(w, "change").text()).toContain("▼");
    });

    it("shows the absence text with no numbers and no second No new data line (AC1.16)", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({ kind: "absence", ...NO_VALUES, started_us: at("18:15") }),
          no_new_data_since_us: at("18:15"),
          window: { start_us: at("18:15"), end_us: at("19:00"), clipped: false },
        }),
      });
      expect(text(w, "message").text()).toBe("No data for this detector's query since 18:15");
      expect(tip(w, "message")).toBe("2026-11-16 18:15 UTC");
      expect(text(w, "state-ongoing").exists()).toBe(true);
      expect(text(w, "readings").exists()).toBe(false);
      expect(text(w, "fact").text()).toBe("for 45 min");
      expect(text(w, "measure").text()).toBe("count(*) per 15 min · k8s_logs");
    });

    it("dates an absence after high values from the absence, not the episode start", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({
            kind: "absence",
            ...NO_VALUES,
            started_us: at("17:30"),
            since_us: at("18:15"),
          }),
          window: { start_us: at("17:30"), end_us: at("18:30"), clipped: false },
        }),
      });
      expect(text(w, "message").text()).toBe("No data for this detector's query since 18:15");
      expect(text(w, "secondary").text()).toBe("since 17:30");
    });

    it("puts the incomplete note next to the Actual label", () => {
      const w = mountStrip({
        response: ongoing({
          window: { start_us: at("18:00"), end_us: NOW - 2 * MIN, clipped: false },
        }),
      });
      const note = text(w, "actual").find('[data-test="alerts-anomalysummarystrip-incomplete"]');
      expect(note.text()).toBe("may be incomplete");
      expect(note.classes()).toContain("text-status-warning-text");
      expect(w.findAll('[data-test="alerts-anomalysummarystrip-incomplete"]')).toHaveLength(1);
    });

    it("puts the incomplete note after the absence text (AC1.31)", () => {
      const w = mountStrip({
        response: ongoing({
          summary: summary({ kind: "absence", ...NO_VALUES }),
          window: { start_us: at("18:00"), end_us: NOW - 2 * MIN, clipped: false },
        }),
      });
      const note = text(w, "middle").find('[data-test="alerts-anomalysummarystrip-incomplete"]');
      expect(note.text()).toBe("Last point may be incomplete");
      expect(text(w, "readings").exists()).toBe(false);
    });
  });

  describe("Back in range", () => {
    const back = (clipped = false) =>
      mountStrip({
        response: response({
          state: "back_in_range",
          summary: summary({ actual: 231, change_percent: 66.4, since_us: at("21:45") }),
          window: { start_us: at("18:00"), end_us: at("21:45"), clipped },
          last_detection_run: at("21:58"),
        }),
        nowUs: at("22:00"),
      });

    it("shows since, lasted and the worst value, with no red", () => {
      const w = back();
      expect(text(w, "chip").text()).toBe("Back in range");
      expect(text(w, "fact").text()).toBe("since 21:45");
      expect(text(w, "secondary").text()).toBe("lasted 3 h 45 min");
      expect(text(w, "actual").text()).toContain("Worst value");
      expect(text(w, "expected").text()).toContain("120.40 – 157.20");
      expect(text(w, "change").text()).toContain("▲ +66.4%");
      expect(
        w
          .find('[data-test="alerts-anomalysummarystrip-readings"] .text-status-error-text')
          .exists(),
      ).toBe(false);
    });

    it("shows when the data returned for an absence, with no readings", () => {
      const w = mountStrip({
        response: response({
          state: "back_in_range",
          summary: summary({ kind: "absence", ...NO_VALUES, since_us: at("21:45") }),
          window: { start_us: at("18:00"), end_us: at("21:45"), clipped: false },
          last_detection_run: at("21:58"),
        }),
        nowUs: at("22:00"),
      });
      expect(text(w, "chip").text()).toBe("Back in range");
      expect(text(w, "fact").text()).toBe("since 21:45");
      expect(text(w, "secondary").text()).toBe("lasted 3 h 45 min");
      expect(text(w, "measure").text()).toBe("count(*) per 15 min · k8s_logs");
      expect(text(w, "message").text()).toBe("Data for this detector's query returned at 21:45");
      expect(tip(w, "message")).toBe("2026-11-16 21:45 UTC");
      expect(text(w, "readings").exists()).toBe(false);
    });

    it("keeps worst, one expected value and change in the heading colour for a partial drop", () => {
      const w = mountStrip({
        response: response({
          state: "back_in_range",
          summary: summary({
            kind: "partial_drop",
            actual: 40,
            expected: 100,
            expected_lower: null,
            expected_upper: null,
            change_percent: -60,
            since_us: at("21:45"),
          }),
          window: { start_us: at("18:00"), end_us: at("21:45"), clipped: false },
          last_detection_run: at("21:58"),
        }),
        nowUs: at("22:00"),
      });
      expect(text(w, "actual").text()).toContain("Worst value");
      expect(text(w, "expected").text()).toContain("100.00");
      expect(text(w, "change").text()).toContain("▼");
      expect(text(w, "message").exists()).toBe(false);
      expect(
        w
          .find('[data-test="alerts-anomalysummarystrip-readings"] .text-status-error-text')
          .exists(),
      ).toBe(false);
    });

    it("shows since and no lasted when the window is clipped", () => {
      const w = back(true);
      expect(text(w, "fact").text()).toBe("since 21:45");
      expect(text(w, "secondary").exists()).toBe(false);
    });
  });

  it.each([
    [{ enabled: false }, {}, "paused", "Paused", "Detector is paused", null],
    [
      {},
      { last_detection_run: at("18:05") },
      "no_recent_runs",
      "No recent runs",
      "The detector did not run in the last 3 schedule intervals.",
      "last run 18:05",
    ],
    [
      {},
      { no_new_data_since_us: at("18:05") },
      "no_new_data",
      "No new data",
      "The detector runs, but its query has returned no new data.",
      "since 18:05",
    ],

    [
      { is_trained: false },
      { state: "no_runs", last_detection_run: null, model_version: 0 },
      "learning",
      "Learning",
      "Learning normal behaviour. Alerts start after training.",
      null,
    ],
    [{}, {}, "none", "In range", "No anomalies in the last 7 days", null],
  ])(
    "shows the %s state with its chip, fact and sentence",
    (config, over, state, chip, copy, fact) => {
      const w = mountStrip({
        response: response(over as Partial<AnomalyExploreResponse>),
        config: { ...CONFIG, ...config },
      });
      expect(text(w, `state-${state}`).exists()).toBe(true);
      expect(text(w, "chip").text()).toBe(chip);
      expect(text(w, "message").text()).toBe(copy);
      if (fact) expect(text(w, "fact").text()).toBe(fact);
      else expect(text(w, "fact").exists()).toBe(false);
      expect(w.text()).not.toContain("UTC");
    },
  );

  it("uses the warning chip for the stale states and a neutral one for the rest", () => {
    const variant = (config: object, over: object) =>
      text(mountStrip({ response: response(over), config: { ...CONFIG, ...config } }), "chip")
        .classes()
        .join(" ");
    expect(variant({}, { no_new_data_since_us: at("18:05") })).toContain("warning");
    expect(variant({ enabled: false }, {})).not.toMatch(/warning|error/);
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

  it("has View logs as its only button and no Ask AI button (AC1.31)", () => {
    const w = mountStrip({ response: ongoing() });
    expect(text(w, "ask-ai").exists()).toBe(false);
    expect(w.findAll("button")).toHaveLength(1);
  });

  it("keeps the fixed height of 72 px on a wide page in each state", () => {
    for (const props of [{ loading: true }, { failed: true }, { response: ongoing() }]) {
      const root = mountStrip(props).find('[data-test="alerts-anomalysummarystrip"]');
      expect(root.classes()).toContain("h-18");
    }
  });
});
