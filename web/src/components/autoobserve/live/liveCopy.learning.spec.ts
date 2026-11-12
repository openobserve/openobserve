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
import "@/locales";
import { gt } from "@/types/i18n";
import type { AutoObserveCoverage, AutoObserveLearning } from "@/services/autoobserve";
import { learningEmpty, learningLine, streamLearning } from "./liveCopy";
import { toCoverageSource } from "./liveAdapter";

const zone = { locale: "en-US", timeZone: "UTC" };
const NOW_MS = Date.UTC(2026, 10, 10, 12, 0);
const NOV_24_US = Date.UTC(2026, 10, 24, 8, 0) * 1000;

const learning = (over: Partial<AutoObserveLearning> = {}): AutoObserveLearning => ({
  streams_learning: 9,
  streams_ready: 10,
  history_days_needed: 14,
  next_ready_at: NOV_24_US,
  ...over,
});

describe("learning lines (W3)", () => {
  it("absent keys or nothing learning say nothing", () => {
    expect(learningLine(gt, zone, undefined)).toBeNull();
    expect(learningLine(gt, zone, null)).toBeNull();
    expect(learningLine(gt, zone, learning({ streams_learning: 0 }))).toBeNull();
    expect(learningEmpty(gt, zone, undefined)).toBeNull();
  });

  it("one stream", () => {
    expect(learningLine(gt, zone, learning({ streams_learning: 1 }))).toBe(
      "Learning 1 stream. It is ready on Nov 24; AutoObserve needs 14 days of history to judge a stream.",
    );
  });

  it("many streams name the first ready date", () => {
    expect(learningLine(gt, zone, learning({ streams_learning: 1200 }))).toBe(
      "Learning 1,200 streams. The first is ready on Nov 24; AutoObserve needs 14 days of history to judge a stream.",
    );
  });

  it("no known date drops the date clause", () => {
    expect(learningLine(gt, zone, learning({ next_ready_at: null }))).toBe(
      "Learning 9 streams; AutoObserve needs 14 days of history to judge a stream.",
    );
  });

  it("an org with no ready stream says what AutoObserve waits for", () => {
    expect(learningEmpty(gt, zone, learning({ streams_ready: 0, streams_learning: 12 }))).toEqual({
      title: "Learning your streams",
      desc: "AutoObserve needs 14 days of history to judge a stream. The first of 12 streams is ready on Nov 24.",
    });
    expect(learningEmpty(gt, zone, learning({ streams_ready: 0, streams_learning: 1 }))?.desc).toBe(
      "AutoObserve needs 14 days of history to judge a stream. The stream is ready on Nov 24.",
    );
    expect(learningEmpty(gt, zone, learning())).toBeNull();
  });

  it("one learning stream is one sentence with its date", () => {
    const streams = [
      { type: "logs", name: "app_logs", learning_until: NOV_24_US },
      { type: "metrics", name: "ready_metrics", learning_until: null },
    ];
    expect(streamLearning(gt, zone, streams, NOW_MS)).toEqual({
      summary: "Learning until Nov 24 · app_logs (logs)",
      rows: [],
    });
  });

  it("each of several streams keeps its own date, soonest first, even when dates repeat (D10)", () => {
    const day = (d: number) => Date.UTC(2026, 10, d, 8, 0) * 1000;
    const streams = [23, 20, 21, 22, 21].map((d, i) => ({
      type: "logs",
      name: `s${i}`,
      learning_until: day(d),
    }));
    const result = streamLearning(gt, zone, streams, NOW_MS);
    expect(result?.summary).toBe("Learning 5 streams");
    expect(result?.rows.map((r) => [r.stream, r.until])).toEqual([
      ["s1 (logs)", "until Nov 20"],
      ["s2 (logs)", "until Nov 21"],
      ["s4 (logs)", "until Nov 21"],
      ["s3 (logs)", "until Nov 22"],
      ["s0 (logs)", "until Nov 23"],
    ]);
  });

  it("past or absent learning_until says nothing", () => {
    expect(streamLearning(gt, zone, [{ type: "logs", name: "a" }], NOW_MS)).toBeNull();
    expect(
      streamLearning(gt, zone, [{ type: "logs", name: "a", learning_until: 1 }], NOW_MS),
    ).toBeNull();
  });

  it("the coverage source carries the learning block and each stream's date", () => {
    const data: AutoObserveCoverage = {
      view: "strict",
      pass_at: null,
      refreshed_at: null,
      quality: null,
      classes: [],
      rows: [
        {
          service_id: "s1",
          service_name: "svc-a",
          cluster: null,
          namespace: null,
          streams: [{ type: "logs", name: "app_logs", learning_until: NOV_24_US }],
          traffic_per_hour: null,
          cells: {},
        },
      ],
      learning: learning(),
    };
    const source = toCoverageSource(gt, data, { status: "ready", retry: () => {} }, "en-US");
    expect(source.learning?.streams_learning).toBe(9);
    expect(source.rows[0].identity?.streams[0].learning_until).toBe(NOV_24_US);
    const { learning: _drop, ...older } = data;
    expect(
      toCoverageSource(gt, older, { status: "ready", retry: () => {} }, "en-US").learning,
    ).toBeNull();
  });
});
