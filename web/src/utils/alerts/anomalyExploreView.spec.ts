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
import type { AnomalyExploreResponse } from "@/types/anomalyExplore";
import {
  anomalyStripView,
  durationParts,
  formatAnomalyNumber,
  formatChangePercent,
  formatUtcHm,
  openAppUrl,
  pageModelVersion,
  stripConfigOf,
  type AnomalyStripConfig,
} from "@/utils/alerts/anomalyExploreView";

const MIN = 60_000_000;
const NOW = Date.parse("2026-11-16T19:10:00Z") * 1000;

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

// Every 5 min, 15 min buckets.
const CONFIG: AnomalyStripConfig = {
  enabled: true,
  isTrained: true,
  scheduleMs: 5 * 60_000,
  bucketMs: 15 * 60_000,
};

const ongoing = response({
  state: "ongoing",
  summary: {
    kind: "value",
    actual: 208,
    expected: 138.8,
    expected_lower: 120.4,
    expected_upper: 157.2,
    change_percent: 49.8,
    started_us: NOW - 70 * MIN,
    since_us: null,
  },
  window: { start_us: NOW - 70 * MIN, end_us: NOW - 25 * MIN, clipped: false },
});

describe("anomalyStripView", () => {
  it("shows Ongoing with the start and the summary values", () => {
    const view = anomalyStripView(ongoing, CONFIG, NOW);
    expect(view.state).toBe("ongoing");
    expect(view.startedUs).toBe(NOW - 70 * MIN);
    expect(view.startedBefore).toBe(false);
    expect(view.summary?.actual).toBe(208);
  });

  it("says the start is earlier when the 7-day search was clipped", () => {
    const view = anomalyStripView(
      { ...ongoing, window: { ...ongoing.window!, clipped: true } },
      CONFIG,
      NOW,
    );
    expect(view.startedBefore).toBe(true);
  });

  it("puts Ongoing before No new data, and keeps No new data as the second line", () => {
    const view = anomalyStripView(
      { ...ongoing, no_new_data_since_us: NOW - 70 * MIN },
      CONFIG,
      NOW,
    );
    expect(view.state).toBe("ongoing");
    expect(view.noNewDataSinceUs).toBe(NOW - 70 * MIN);
  });

  it("shows No new data as the main state when no episode is open", () => {
    const view = anomalyStripView(response({ no_new_data_since_us: NOW - 60 * MIN }), CONFIG, NOW);
    expect(view.state).toBe("no_new_data");
  });

  it("is not stale while the cursor is within three buckets", () => {
    const view = anomalyStripView(response({ no_new_data_since_us: NOW - 40 * MIN }), CONFIG, NOW);
    expect(view.state).toBe("none");
  });

  it("shows No recent runs when the last run is older than three schedule intervals", () => {
    const view = anomalyStripView(response({ last_detection_run: NOW - 16 * MIN }), CONFIG, NOW);
    expect(view.state).toBe("no_recent_runs");
    expect(view.lastRunUs).toBe(NOW - 16 * MIN);
  });

  it("shows neither stale state when the freshness fields are null, as on a peer cluster", () => {
    const view = anomalyStripView(
      response({ last_detection_run: null, cursor_us: null, no_new_data_since_us: null }),
      CONFIG,
      NOW,
    );
    expect(view.state).toBe("none");
  });

  it("shows the paused state for a disabled detector", () => {
    expect(anomalyStripView(ongoing, { ...CONFIG, enabled: false }, NOW).state).toBe("paused");
  });

  it("shows Learning while untrained, also for a detector that never ran", () => {
    const untrained = { ...CONFIG, isTrained: false };
    expect(anomalyStripView(response({ state: "none" }), untrained, NOW).state).toBe("learning");
    expect(
      anomalyStripView(
        response({ state: "no_runs", last_detection_run: null, model_version: 0 }),
        untrained,
        NOW,
      ).state,
    ).toBe("learning");
  });

  it("shows No recent runs, not No anomalies, for a trained detector that never ran", () => {
    const view = anomalyStripView(response({ state: "no_runs", cursor_us: null }), CONFIG, NOW);
    expect(view.state).toBe("no_recent_runs");
    expect(view.lastRunUs).toBe(NOW - 2 * MIN);
    const peer = response({ state: "no_runs", last_detection_run: null, cursor_us: null });
    expect(anomalyStripView(peer, CONFIG, NOW).state).toBe("none");
  });

  it("shows Back in range with since and duration", () => {
    const view = anomalyStripView(
      response({
        state: "back_in_range",
        summary: {
          kind: "value",
          actual: 231,
          expected: null,
          expected_lower: null,
          expected_upper: null,
          change_percent: null,
          started_us: NOW - 300 * MIN,
          since_us: NOW - 75 * MIN,
        },
      }),
      CONFIG,
      NOW,
    );
    expect(view.state).toBe("back_in_range");
    expect(view.lastedMs).toBe(225 * 60_000);
  });

  it("shows No anomalies when the endpoint has none", () => {
    expect(anomalyStripView(response(), CONFIG, NOW).state).toBe("none");
  });

  it("marks the last point incomplete while the newest bucket is under one interval old", () => {
    const recent = { ...ongoing, window: { ...ongoing.window!, end_us: NOW - 2 * MIN } };
    expect(anomalyStripView(recent, CONFIG, NOW).incomplete).toBe(true);
    expect(anomalyStripView(ongoing, CONFIG, NOW).incomplete).toBe(false);
    const normal = response({ state: "back_in_range", cursor_us: NOW - 2 * MIN });
    expect(anomalyStripView(normal, CONFIG, NOW).incomplete).toBe(true);
    expect(anomalyStripView(response({ cursor_us: NOW - 2 * MIN }), CONFIG, NOW).incomplete).toBe(
      true,
    );
    expect(anomalyStripView(response(), CONFIG, NOW).incomplete).toBe(false);
  });
});

describe("pageModelVersion", () => {
  it("is the current model when trained and 0 while training", () => {
    expect(pageModelVersion({ is_trained: true, current_model_version: 7 })).toBe(7);
    expect(pageModelVersion({ is_trained: false, current_model_version: 7 })).toBe(0);
    expect(pageModelVersion(null)).toBe(0);
  });
});

describe("stripConfigOf", () => {
  it("reads the schedule and bucket intervals from the config row", () => {
    expect(
      stripConfigOf({
        enabled: true,
        is_trained: true,
        schedule_interval: "5m",
        histogram_interval: "15m",
      }),
    ).toEqual(CONFIG);
  });
});

describe("formatters", () => {
  it("formats times to the minute in UTC", () => {
    expect(formatUtcHm(Date.parse("2026-11-16T18:00:00Z") * 1000)).toBe("18:00");
  });

  it("writes readings with two decimals and the change with a sign", () => {
    expect(formatAnomalyNumber(208)).toBe("208.00");
    expect(formatChangePercent(49.83)).toBe("+49.8%");
    expect(formatChangePercent(-12.04)).toBe("-12.0%");
  });

  it("splits a duration into hours and minutes", () => {
    expect(durationParts(225 * 60_000)).toEqual({ h: 3, m: 45 });
    expect(durationParts(30_000)).toBeNull();
  });
});

describe("openAppUrl", () => {
  it("routes a link into this app in place, without the router base", () => {
    const push = vi.fn();
    const router = { push, options: { history: { base: "/web" } } } as any;
    openAppUrl(router, `${window.location.origin}/web/logs?stream=a&from_anomaly=x`);
    expect(push).toHaveBeenCalledWith("/logs?stream=a&from_anomaly=x");
  });
});
