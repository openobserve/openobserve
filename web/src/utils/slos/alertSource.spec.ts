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

import { type AlertEvalInterval, smallestLegalSlice, uptimeBands } from "@/utils/slos/alertSource";

const MICROS = 1_000_000;

const interval = (
  level: string | null,
  fromSecs: number,
  toSecs: number,
  frequencySecs = 60,
): AlertEvalInterval => ({
  level,
  frequency_secs: frequencySecs,
  from_us: fromSecs * MICROS,
  to_us: toSecs * MICROS,
});

describe("smallestLegalSlice", () => {
  // The whole point of the default is that the common path never reaches the
  // AlertSliSourceTooInfrequent rejection.
  it("picks 60 for any cadence up to a minute", () => {
    expect(smallestLegalSlice(1)).toBe(60);
    expect(smallestLegalSlice(30)).toBe(60);
    expect(smallestLegalSlice(60)).toBe(60);
  });

  it("picks 300 for a cadence between 61 and 300 seconds", () => {
    expect(smallestLegalSlice(61)).toBe(300);
    expect(smallestLegalSlice(120)).toBe(300);
    expect(smallestLegalSlice(300)).toBe(300);
  });

  // Slices are pinned to 60/300 (S-4), so a slower source has no legal grid at
  // all — not "the next coarser one".
  it("has nothing legal above 300 seconds", () => {
    expect(smallestLegalSlice(301)).toBeNull();
    expect(smallestLegalSlice(600)).toBeNull();
  });

  it("has nothing legal for a non-positive cadence", () => {
    expect(smallestLegalSlice(0)).toBeNull();
    expect(smallestLegalSlice(-60)).toBeNull();
  });
});

describe("uptimeBands", () => {
  it("draws one good band across a fully covered range", () => {
    const bands = uptimeBands([interval("ok", 0, 3600 - 60)], 0, 3600);
    expect(bands).toHaveLength(1);
    expect(bands[0].state).toBe("good");
    expect(bands[0].startPct).toBeCloseTo(0);
    expect(bands[0].widthPct).toBeCloseTo(100);
  });

  it("draws a firing run as a bad band", () => {
    const bands = uptimeBands([interval("critical", 0, 3600 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["bad"]);
  });

  it("treats warning as bad, matching good = Ok and nothing else", () => {
    const bands = uptimeBands([interval("warning", 0, 3600 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["bad"]);
  });

  // The grey bands are the point: a pause is neither good nor bad, and drawing
  // it as either is the failure the whole feature exists to avoid.
  it("puts a grey unmeasured band in the middle of a pause", () => {
    const bands = uptimeBands(
      [interval("ok", 0, 900 - 60), interval("ok", 2700, 3600 - 60)],
      0,
      3600,
    );
    expect(bands.map((b) => b.state)).toEqual(["good", "unmeasured", "good"]);
    expect(bands[1].startPct).toBeCloseTo(25);
    expect(bands[1].widthPct).toBeCloseTo(50);
  });

  it("pads the leading and trailing edges of the range as unmeasured", () => {
    const bands = uptimeBands([interval("ok", 900, 2700 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["unmeasured", "good", "unmeasured"]);
    expect(bands[0].widthPct).toBeCloseTo(25);
    expect(bands[2].widthPct).toBeCloseTo(25);
  });

  it("reads an empty ledger as one unmeasured band over the whole range", () => {
    const bands = uptimeBands([], 0, 3600);
    expect(bands).toHaveLength(1);
    expect(bands[0].state).toBe("unmeasured");
    expect(bands[0].widthPct).toBeCloseTo(100);
  });

  // §5.3: an evaluation is an assessment that stands until the next one is due.
  it("extends each run forward by one cadence", () => {
    const bands = uptimeBands([interval("ok", 0, 1740, 60)], 0, 3600);
    expect(bands[0].state).toBe("good");
    // 1740 + 60 = 1800, which is half the range.
    expect(bands[0].widthPct).toBeCloseTo(50);
  });

  // 3300 + 600 would reach 3900; unclamped it would report a band wider than
  // the range and claim time that has not happened yet.
  it("clamps the forward extension at the range end", () => {
    const bands = uptimeBands([interval("ok", 0, 3300, 600)], 0, 3600);
    expect(bands).toHaveLength(1);
    expect(bands[0].widthPct).toBeCloseTo(100);
  });

  // A run's tail must never outlive the level change that closed it: without
  // the clamp the OK band would run to 1500 and paint over the firing run.
  it("clamps the forward extension at the next run's start", () => {
    const bands = uptimeBands(
      [interval("ok", 0, 900, 600), interval("critical", 1200, 3600 - 60, 60)],
      0,
      3600,
    );
    expect(bands.map((b) => b.state)).toEqual(["good", "bad"]);
    expect(bands[0].widthPct).toBeCloseTo((1200 / 3600) * 100);
    expect(bands[1].startPct).toBeCloseTo((1200 / 3600) * 100);
  });

  // The other side of the same rule: where the extension does NOT reach the
  // next run, the untouched middle stays grey.
  it("leaves the middle grey when the extension falls short of the next run", () => {
    const bands = uptimeBands(
      [interval("ok", 0, 600, 60), interval("critical", 1800, 3600 - 60, 60)],
      0,
      3600,
    );
    expect(bands.map((b) => b.state)).toEqual(["good", "unmeasured", "bad"]);
    expect(bands[1].startPct).toBeCloseTo((660 / 3600) * 100);
    expect(bands[1].widthPct).toBeCloseTo((1140 / 3600) * 100);
  });

  // §5.2: "could not tell" is a gap, not downtime.
  it("draws a NoData run as unmeasured, not bad", () => {
    const bands = uptimeBands([interval("no_data", 0, 3600 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["unmeasured"]);
  });

  // An unmeasured run still BOUNDS its predecessor: a run exists at that
  // instant, so the previous one had ended. Skipping it when looking for the
  // successor would let the OK tail run 600s into the gap.
  it("lets an unmeasured run truncate the tail before it", () => {
    const bands = uptimeBands(
      [interval("ok", 0, 900, 600), interval("no_data", 1200, 3600 - 60, 60)],
      0,
      3600,
    );
    expect(bands.map((b) => b.state)).toEqual(["good", "unmeasured"]);
    expect(bands[0].widthPct).toBeCloseTo((1200 / 3600) * 100);
  });

  // A level this build cannot interpret must not be coloured green.
  it("draws an unknown level as unmeasured", () => {
    const bands = uptimeBands([interval(null, 0, 3600 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["unmeasured"]);
  });

  it("clips a run that starts before the range", () => {
    const bands = uptimeBands([interval("ok", -3600, 1800 - 60)], 0, 3600);
    expect(bands.map((b) => b.state)).toEqual(["good", "unmeasured"]);
    expect(bands[0].startPct).toBeCloseTo(0);
    expect(bands[0].widthPct).toBeCloseTo(50);
  });

  it("returns nothing for a degenerate range rather than dividing by zero", () => {
    expect(uptimeBands([interval("ok", 0, 60)], 3600, 3600)).toEqual([]);
    expect(uptimeBands([], 3600, 0)).toEqual([]);
  });
});
