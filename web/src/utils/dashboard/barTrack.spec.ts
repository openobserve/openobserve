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
  BAR_WIDTH_MAX,
  barStyleSeriesProps,
  barTrackMax,
  isBarWidthValid,
  mergeBarTrackMax,
  pinBarTrackAxis,
  seriesDataMax,
} from "./barTrack";

describe("barTrackMax", () => {
  it("uses a numeric y_axis_max as is", () => {
    expect(barTrackMax(50, 70)).toBe(50);
    expect(barTrackMax("50", 70)).toBe(50);
    expect(barTrackMax("", 70)).toBe(70);
  });

  it("falls back to the largest bar when y_axis_max is unset or cleared", () => {
    expect(barTrackMax(undefined, 70)).toBe(70);
    expect(barTrackMax(null, 70)).toBe(70);
  });

  it("leaves the axis automatic when there is no positive data", () => {
    expect(barTrackMax(undefined, -Infinity)).toBeUndefined();
    expect(barTrackMax(null, 0)).toBeUndefined();
  });
});

describe("mergeBarTrackMax", () => {
  it("sets the largest per-query max on every value axis of the target", () => {
    const target = { xAxis: [{ max: 10 }, { max: 10 }] };
    mergeBarTrackMax(target, [
      { options: { xAxis: { max: 10 } } },
      { options: { xAxis: { max: 30 } } },
      null,
    ]);
    expect(target.xAxis.map((axis) => axis.max)).toEqual([30, 30]);
  });

  it("leaves the target alone when no query has a numeric max", () => {
    const target = { xAxis: { max: undefined } };
    mergeBarTrackMax(target, [{ options: { xAxis: { max: "dataMax" } } }]);
    expect(target.xAxis.max).toBeUndefined();
  });
});

describe("isBarWidthValid", () => {
  it("accepts unset and whole widths from 1 to the max", () => {
    [null, undefined, "", 1, 13, BAR_WIDTH_MAX].forEach((width) =>
      expect(isBarWidthValid(width)).toBe(true),
    );
  });

  it("rejects widths below 1, above the max, fractional or non-numeric", () => {
    [0, -3, 12.6, BAR_WIDTH_MAX + 1, "abc"].forEach((width) =>
      expect(isBarWidthValid(width)).toBe(false),
    );
  });
});

describe("barStyleSeriesProps", () => {
  it("passes a valid width and drops an invalid one", () => {
    expect(barStyleSeriesProps({ bar_width: 12 }, { withTrack: true })).toEqual({ barWidth: 12 });
    expect(barStyleSeriesProps({ bar_width: -3 }, { withTrack: true })).toEqual({});
  });

  it("draws the track in a token colour only where the track applies", () => {
    const props: any = barStyleSeriesProps({ show_bar_track: true }, { withTrack: true });
    expect(props.showBackground).toBe(true);
    expect(props.backgroundStyle.color).toBeTruthy();
    expect(barStyleSeriesProps({ show_bar_track: true }, { withTrack: false })).toEqual({});
  });
});

describe("seriesDataMax", () => {
  it("returns the largest numeric value across series, reading { value } items too", () => {
    expect(
      seriesDataMax([
        { data: [3, null, "9", 7] },
        { data: [{ value: 11 }, -2] },
        { data: undefined },
      ]),
    ).toBe(11);
  });

  it("returns -Infinity when there is no numeric data", () => {
    expect(seriesDataMax([{ data: [] }])).toBe(-Infinity);
    expect(seriesDataMax(undefined)).toBe(-Infinity);
  });
});

describe("pinBarTrackAxis", () => {
  it("sets the max and hides an overlapping last label on every axis", () => {
    const axes: any[] = [{ axisLabel: { color: "red" } }, {}];
    pinBarTrackAxis(axes, 1003);
    expect(axes.map((axis) => axis.max)).toEqual([1003, 1003]);
    expect(axes[0].axisLabel).toEqual({ color: "red", hideOverlap: true });
    expect(axes[1].axisLabel).toEqual({ hideOverlap: true });
  });
});
