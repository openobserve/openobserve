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
  FORECAST_WINDOWS,
  buildForecastAlertPromql,
  forecastRowTemplate,
  isForecastHorizonValid,
  parseForecastAlertPromql,
  type ForecastAlert,
} from "./forecastAlert";

const DISK = "1 - node_filesystem_avail_bytes / node_filesystem_size_bytes";
const condition = (value: number, operator = "<=") => ({ column: "value", operator, value });

describe("buildForecastAlertPromql", () => {
  it("writes the rises-to expression on one line", () => {
    expect(buildForecastAlertPromql({ U: DISK, T: 0.9, direction: "rises", W: "2d" })).toBe(
      `((${DISK}) >= 0.9) * 0` +
        ` or clamp_min(ceil((0.9 - (${DISK})) / (deriv((${DISK})[2d:15m]) > 0) / 8640) / 10, 0)` +
        ` or ((${DISK}) * 0 + 36500)`,
    );
  });

  it("flips the crossed check and the slope filter for falls-to", () => {
    expect(buildForecastAlertPromql({ U: "free_bytes", T: 100, direction: "falls", W: "1d" })).toBe(
      "((free_bytes) <= 100) * 0" +
        " or clamp_min(ceil((100 - (free_bytes)) / (deriv((free_bytes)[1d:8m]) < 0) / 8640) / 10, 0)" +
        " or ((free_bytes) * 0 + 36500)",
    );
  });

  it("steps each history window about 192 times, in whole minutes", () => {
    const stepOf = (W: (typeof FORECAST_WINDOWS)[number]) =>
      /\[(\w+):(\w+)\]/
        .exec(buildForecastAlertPromql({ U: "x", T: 1, direction: "rises", W }))!
        .slice(1)
        .join(":");
    expect(FORECAST_WINDOWS.map(stepOf)).toEqual(["6h:2m", "1d:8m", "2d:15m", "7d:53m"]);
  });
});

describe("isForecastHorizonValid", () => {
  it("accepts whole days from 1 to 30 only", () => {
    expect([1, 7, 30].map(isForecastHorizonValid)).toEqual([true, true, true]);
    expect([0, 31, 2.5, -1, Number.NaN].map(isForecastHorizonValid)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("parseForecastAlertPromql", () => {
  const roundTrip = (alert: ForecastAlert) =>
    parseForecastAlertPromql(buildForecastAlertPromql(alert), condition(alert.H));

  it("recognises its own output for both directions and every window", () => {
    for (const direction of ["rises", "falls"] as const) {
      for (const W of FORECAST_WINDOWS) {
        const alert: ForecastAlert = { U: DISK, T: 0.9, direction, W, H: 7 };
        expect(roundTrip(alert)).toEqual(alert);
      }
    }
  });

  it("keeps a quoted label value with a space in it intact", () => {
    const alert: ForecastAlert = {
      U: 'avg(disk_used{mount="disk one"})',
      T: -2.5,
      direction: "falls",
      W: "6h",
      H: 30,
    };
    expect(roundTrip(alert)).toEqual(alert);
  });

  it("ignores surrounding whitespace only", () => {
    const text = buildForecastAlertPromql({ U: DISK, T: 0.9, direction: "rises", W: "2d" });
    expect(parseForecastAlertPromql(`  ${text}\n`, condition(7))?.U).toBe(DISK);
  });

  it("rejects hand-edited text", () => {
    const text = buildForecastAlertPromql({
      U: 'avg(disk_used{mount="disk one"})',
      T: 0.9,
      direction: "rises",
      W: "2d",
    });
    expect(parseForecastAlertPromql(text.replace("disk one", "diskone"), condition(7))).toBeNull();
    expect(parseForecastAlertPromql(text.replace(" or ", "  or "), condition(7))).toBeNull();
    expect(parseForecastAlertPromql(text.replace("36500", "36501"), condition(7))).toBeNull();
    expect(parseForecastAlertPromql("up > 1", condition(7))).toBeNull();
  });

  it("rejects text whose occurrences of U differ", () => {
    const text = buildForecastAlertPromql({ U: "disk_a", T: 0.9, direction: "rises", W: "2d" });
    const mismatched = text.replace("deriv((disk_a)", "deriv((disk_b)");
    expect(parseForecastAlertPromql(mismatched, condition(7))).toBeNull();
  });

  it("rejects any condition but value <= H with H in range", () => {
    const text = buildForecastAlertPromql({ U: DISK, T: 0.9, direction: "rises", W: "2d" });
    expect(parseForecastAlertPromql(text, condition(7, "<"))).toBeNull();
    expect(parseForecastAlertPromql(text, condition(7, ">="))).toBeNull();
    expect(parseForecastAlertPromql(text, condition(0))).toBeNull();
    expect(parseForecastAlertPromql(text, condition(31))).toBeNull();
    expect(parseForecastAlertPromql(text, null)).toBeNull();
  });
});

describe("forecastRowTemplate", () => {
  it("writes the threshold in, since no template variable carries it", () => {
    expect(forecastRowTemplate(0.9)).toBe("reaches 0.9 in {value} days");
  });
});
