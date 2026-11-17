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
import type { VolumeBucket, VolumeSeries } from "@/services/autoobserveVolume";
import { baselineStates, issueBaselineNote, toIssueBaseline, usualBetween } from "./issueBaseline";

const T0 = Date.UTC(2026, 10, 10, 16, 0);
const Q = 15 * 60_000;
const w = { startMs: T0, endMs: T0 + 8 * Q, detectedMs: T0 + 4 * Q, fixed: true };

const bucket = (ms: number, over: Partial<VolumeBucket> = {}): VolumeBucket => ({
  t: ms * 1000,
  actual: 100,
  expected: 400,
  lower: 200,
  upper: 600,
  expected_present: true,
  class: "normal",
  ...over,
});

const series = (over: Partial<VolumeSeries> = {}): VolumeSeries => ({
  stream_type: "logs",
  stream_name: "pay_api",
  width_secs: 900,
  status: "volume",
  rows_per_day: 9600,
  exact: true,
  days: [],
  buckets: [],
  forecast: [],
  markers: [],
  ...over,
});

describe("toIssueBaseline", () => {
  it("spreads an hourly bucket over its quarters and clips to the window", () => {
    const b = toIssueBaseline(
      series({ width_secs: 3600, buckets: [bucket(T0 - 4 * Q), bucket(T0), bucket(T0 + 4 * Q)] }),
      w,
    );
    expect(b.expected.map((p) => [p.t - T0, p.v])).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i * Q, 100]),
    );
    expect(b.band[0]).toEqual({ t: T0, lower: 50, upper: 150 });
  });

  it("shades the buckets judged outside the usual range as merged spans, and an unjudged one breaks the line", () => {
    const b = toIssueBaseline(
      series({
        buckets: [
          bucket(T0, { class: "low" }),
          bucket(T0 + Q, { class: "missing" }),
          bucket(T0 + 2 * Q, { class: "spread" }),
          bucket(T0 + 3 * Q, { expected: null, lower: null, upper: null, class: null }),
          bucket(T0 + 4 * Q, { class: "high" }),
        ],
      }),
      w,
    );
    expect(b.outside).toEqual([
      { from: T0, to: T0 + 2 * Q },
      { from: T0 + 4 * Q, to: T0 + 5 * Q },
    ]);
    expect(b.expected.map((p) => p.v)).toEqual([400, 400, 400, null, 400]);
    expect(b.band).toHaveLength(4);
    expect(usualBetween(b, T0 + 2 * Q, T0 + 5 * Q)).toBe(400);
    expect(usualBetween(b, T0 + 3 * Q, T0 + 4 * Q)).toBeNull();
  });

  it("a series with no judged level draws no line", () => {
    const b = toIssueBaseline(
      series({ status: "warmup", buckets: [bucket(T0, { expected: null })] }),
      w,
    );
    expect(b.expected).toEqual([]);
  });
});

it("reads each asked stream from the answer, denied ids as denied and unanswered ones as unavailable", () => {
  const streams = ["pay_api", "secret", "gone"].map((name) => ({ type: "logs", name }));
  const states = baselineStates(streams, {
    series: [series({ status: "irregular" })],
    denied: ["logs/secret"],
  });
  expect([...states.values()].map((s) => s.kind)).toEqual(["irregular", "denied", "unavailable"]);
});

describe("issueBaselineNote", () => {
  it.each([
    ["unavailable", "neutral"],
    ["failed", "error"],
    ["denied", "error"],
    ["presence_only", "neutral"],
    ["warmup", "neutral"],
    ["irregular", "neutral"],
    ["no_data", "neutral"],
  ] as const)("%s says why there is no usual level, %s", (kind, tone) => {
    const state =
      kind === "unavailable" || kind === "failed" || kind === "denied"
        ? { kind }
        : { kind, series: series({ status: kind }) };
    const note = issueBaselineNote(gt, state, "pay_api");
    expect(note?.tone).toBe(tone);
    expect(String(note?.text)).not.toMatch(/presence_only|no_data|warmup/);
  });

  it("a drawn level needs no note unless it is approximate", () => {
    expect(issueBaselineNote(gt, { kind: "volume", series: series() }, "pay_api")).toBeNull();
    expect(
      issueBaselineNote(gt, { kind: "volume", series: series({ exact: false }) }, "pay_api")?.tone,
    ).toBe("neutral");
  });
});
