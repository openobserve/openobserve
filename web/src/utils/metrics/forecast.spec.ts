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
  buildForecastQueries,
  forecastHorizonOptions,
  forecastHorizonSeconds,
  forecastSeries,
  isForecastHorizon,
} from "./forecast";

const HOUR = 3600;
const vector = (...points: [Record<string, string>, number][]) => ({
  resultType: "vector",
  result: points.map(([metric, v]) => ({ metric, value: [1_000, String(v)] })),
});

describe("buildForecastQueries", () => {
  it("fits a line over the visible range and reads it at T and at T + H", () => {
    expect(buildForecastQueries("avg(disk)", "linear", 6 * HOUR, 60, 5400)).toEqual([
      "predict_linear((avg(disk))[21600s:60s], 0)",
      "predict_linear((avg(disk))[21600s:60s], 5400)",
    ]);
  });

  it("fits the smoothed trend over the last ten steps for Smoothed trend", () => {
    expect(buildForecastQueries("avg(disk)", "smoothed", 6 * HOUR, 60, 5400)).toEqual([
      "predict_linear(holt_winters((avg(disk))[600s:60s], 0.3, 0.1)[21600s:60s], 0)",
      "predict_linear(holt_winters((avg(disk))[600s:60s], 0.3, 0.1)[21600s:60s], 5400)",
    ]);
  });
});

describe("forecastSeries", () => {
  it("draws the straight line between the two fits on the step grid, ending at T + H", () => {
    const out = forecastSeries(vector([{ pod: "a" }, 1]), vector([{ pod: "a" }, 3]), 1000, 100, 30);
    expect(out).toEqual({
      resultType: "matrix",
      result: [
        {
          metric: { pod: "a" },
          values: [
            [1000, "1"],
            [1030, "1.6"],
            [1060, "2.2"],
            [1090, "2.8"],
            [1100, "3"],
          ],
        },
      ],
    });
  });

  it("matches the two fits by label set and drops a series either one lacks", () => {
    const out = forecastSeries(
      vector([{ pod: "a", job: "x" }, 0], [{ pod: "b" }, 5]),
      vector([{ job: "x", pod: "a" }, 10], [{ pod: "c" }, 1]),
      0,
      60,
      60,
    );
    expect(out.result).toEqual([
      {
        metric: { pod: "a", job: "x" },
        values: [
          [0, "0"],
          [60, "10"],
        ],
      },
    ]);
  });

  it("skips a series whose fit is not a finite number", () => {
    const out = forecastSeries(
      vector([{ pod: "a" }, Number.NaN]),
      vector([{ pod: "a" }, 1]),
      0,
      60,
      60,
    );
    expect(out.result).toEqual([]);
  });
});

describe("the horizon", () => {
  it("defaults to a quarter of the visible range", () => {
    expect(forecastHorizonSeconds(null, 6 * HOUR)).toBe(5400);
  });

  it("uses a preset only when it is no longer than the visible range", () => {
    expect(forecastHorizonSeconds("1h", 6 * HOUR)).toBe(HOUR);
    expect(forecastHorizonSeconds("1d", 6 * HOUR)).toBe(5400);
  });

  it("offers only the presets the visible range can train", () => {
    expect(forecastHorizonOptions(6 * HOUR)).toEqual(["1h", "6h"]);
    expect(forecastHorizonOptions(30 * 60)).toEqual([]);
    expect(forecastHorizonOptions(7 * 24 * HOUR)).toEqual(["1h", "6h", "1d", "1w"]);
  });

  it("accepts exactly 1h, 6h, 1d or 1w", () => {
    expect(["1h", "6h", "1d", "1w"].every(isForecastHorizon)).toBe(true);
    expect(["2h", "1mo", "1D", "", "6h,1d", undefined].some(isForecastHorizon)).toBe(false);
  });
});
