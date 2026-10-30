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
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

type Row = [input: number, value: string, unit: string];

// Named rates read "1.23K req/s"; the generic ones attach like a unit symbol, "1.23K/s".
const RATE_SUFFIXES: Record<string, string> = {
  "req-per-sec": " req/s",
  "ops-per-sec": " ops/s",
  "events-per-sec": " events/s",
  "req-per-min": " req/min",
  "ops-per-min": " ops/min",
  "events-per-min": " events/min",
  "per-sec": "/s",
  "per-min": "/min",
};

const GENERIC_RATES = ["per-sec", "per-min"];
const NAMED_RATES = Object.keys(RATE_SUFFIXES).filter((key) => !GENERIC_RATES.includes(key));

const RATE_ROWS: [input: number, value: string, scale: string][] = [
  [0, "0.00", ""],
  [0.02, "0.02", ""],
  [1, "1.00", ""],
  [999.5, "999.50", ""],
  [1000, "1.00", "K"],
  [1234, "1.23", "K"],
  [2500000, "2.50", "M"],
  [5000000000, "5.00", "B"],
  [1000000000000, "1.00", "T"],
  [32000000000000000, "32.00", "Q"],
  [-0.5, "-0.50", ""],
  [-1234, "-1.23", "K"],
];

const SCALED: Record<string, Row[]> = {
  "bytes-si": [
    [0, "0.00", "B"],
    [0.5, "0.50", "B"],
    [1, "1.00", "B"],
    [999, "999.00", "B"],
    [1000, "1.00", "kB"],
    [1024, "1.02", "kB"],
    [1500000, "1.50", "MB"],
    [5000000000, "5.00", "GB"],
    [2500000000000, "2.50", "TB"],
    [32000000000000000, "32.00", "PB"],
    [-1500, "-1.50", "kB"],
  ],
  "kilobytes-si": [
    [0, "0.00", "kB"],
    [0.0004, "0.40", "B"],
    [0.5, "500.00", "B"],
    [1, "1.00", "kB"],
    [1500, "1.50", "MB"],
    [5000000, "5.00", "GB"],
    [2500000000, "2.50", "TB"],
    [32000000000000, "32.00", "PB"],
    [-2500, "-2.50", "MB"],
  ],
  "megabytes-si": [
    [0, "0.00", "MB"],
    [0.0000005, "0.50", "B"],
    [0.5, "500.00", "kB"],
    [1, "1.00", "MB"],
    [1500, "1.50", "GB"],
    [5000000, "5.00", "TB"],
    [2500000000, "2.50", "PB"],
    [-1500, "-1.50", "GB"],
  ],
  bits: [
    [0, "0.00", "bit"],
    [1, "1.00", "bit"],
    [999, "999.00", "bit"],
    [1500, "1.50", "kbit"],
    [2500000, "2.50", "Mbit"],
    [1000000000, "1.00", "Gbit"],
    [4000000000000, "4.00", "Tbit"],
    [3000000000000000, "3.00", "Pbit"],
    [-1500, "-1.50", "kbit"],
  ],
  "bps-si": [
    [0, "0.00", "B/s"],
    [1, "1.00", "B/s"],
    [1500, "1.50", "kB/s"],
    [2000000, "2.00", "MB/s"],
    [5000000000, "5.00", "GB/s"],
    [1000000000000, "1.00", "TB/s"],
    [1000000000000000, "1.00", "PB/s"],
    [-2000000, "-2.00", "MB/s"],
  ],
  "bits-per-sec": [
    [0, "0.00", "bit/s"],
    [1, "1.00", "bit/s"],
    [1500, "1.50", "kbit/s"],
    [100000000, "100.00", "Mbit/s"],
    [10000000000, "10.00", "Gbit/s"],
    [1000000000000, "1.00", "Tbit/s"],
    [1000000000000000, "1.00", "Pbit/s"],
    [-1000000, "-1.00", "Mbit/s"],
  ],
  minutes: [
    [0, "0.00", "m"],
    [0.00001, "600.00", "μs"],
    [0.5, "30.00", "s"],
    [1, "1.00", "m"],
    [45, "45.00", "m"],
    [90, "1.50", "h"],
    [1440, "1.00", "D"],
    [43200, "1.00", "M"],
    [525600, "1.00", "Y"],
    [-90, "-1.50", "h"],
  ],
  hours: [
    [0, "0.00", "h"],
    [0.001, "3.60", "s"],
    [0.5, "30.00", "m"],
    [1, "1.00", "h"],
    [24, "1.00", "D"],
    [36, "1.50", "D"],
    [720, "1.00", "M"],
    [8760, "1.00", "Y"],
    [-36, "-1.50", "D"],
  ],
  days: [
    [0, "0.00", "D"],
    [0.001, "1.44", "m"],
    [0.5, "12.00", "h"],
    [1, "1.00", "D"],
    [30, "1.00", "M"],
    [45, "1.50", "M"],
    [365, "1.00", "Y"],
    [730, "2.00", "Y"],
    [-0.5, "-12.00", "h"],
  ],
};

const OWN_UNIT: Record<string, string> = {
  "bytes-si": "B",
  "kilobytes-si": "kB",
  "megabytes-si": "MB",
  bits: "bit",
  "bps-si": "B/s",
  "bits-per-sec": "bit/s",
  minutes: "m",
  hours: "h",
  days: "D",
  ...Object.fromEntries(Object.entries(RATE_SUFFIXES)),
};

const NEW_UNIT_KEYS = Object.keys(OWN_UNIT);

describe("getUnitValue for the unit keys added with the grouped unit list", () => {
  it("covers all 17 new keys", () => {
    expect(NEW_UNIT_KEYS).toHaveLength(17);
  });

  describe.each(Object.entries(SCALED))("%s", (unit, rows) => {
    it.each(rows)("%j -> %j %j", (input, value, unitOut) => {
      expect(getUnitValue(input, unit, "")).toEqual({ value, unit: unitOut });
    });
  });

  describe.each(Object.entries(RATE_SUFFIXES))("%s", (unit, suffix) => {
    it.each(RATE_ROWS)("%j -> %j with scale %j", (input, value, scale) => {
      expect(getUnitValue(input, unit, "")).toEqual({ value, unit: `${scale}${suffix}` });
    });
  });

  describe.each(NEW_UNIT_KEYS)("%s with a value that is not a number", (unit) => {
    it("returns NaN untouched with no unit", () => {
      const result = getUnitValue(NaN, unit, "");
      expect(Number.isNaN(result.value)).toBe(true);
      expect(result.unit).toBe("");
    });

    it("shows a dash for an empty string", () => {
      expect(getUnitValue("", unit, "")).toEqual({ value: "-", unit: "" });
    });

    it("returns text and undefined untouched with no unit", () => {
      expect(getUnitValue("abc", unit, "")).toEqual({ value: "abc", unit: "" });
      expect(getUnitValue(undefined, unit, "")).toEqual({ value: undefined, unit: "" });
    });

    it("keeps null in the unit the panel is set to, as zero is", () => {
      expect(getUnitValue(null, unit, "")).toEqual({ value: "0.00", unit: OWN_UNIT[unit] });
    });

    it("ignores the custom unit", () => {
      expect(getUnitValue(0, unit, "widgets")).toEqual({ value: "0.00", unit: OWN_UNIT[unit] });
    });
  });

  it("scales a numeric string like the number it holds", () => {
    expect(getUnitValue("1500", "bytes-si", "")).toEqual({ value: "1.50", unit: "kB" });
    expect(getUnitValue("1234", "req-per-sec", "")).toEqual({ value: "1.23", unit: "K req/s" });
    expect(getUnitValue("90", "minutes", "")).toEqual({ value: "1.50", unit: "h" });
  });

  it("applies the decimals argument", () => {
    expect(getUnitValue(1234.5678, "req-per-sec", "", 0)).toEqual({ value: "1", unit: "K req/s" });
    expect(getUnitValue(1234.5678, "req-per-sec", "", 3)).toEqual({
      value: "1.235",
      unit: "K req/s",
    });
    expect(getUnitValue(0.002, "ops-per-min", "", 3)).toEqual({ value: "0.002", unit: " ops/min" });
    expect(getUnitValue(1536, "bytes-si", "", 0)).toEqual({ value: "2", unit: "kB" });
    expect(getUnitValue(1536, "bits-per-sec", "", 3)).toEqual({ value: "1.536", unit: "kbit/s" });
    expect(getUnitValue(90, "minutes", "", 1)).toEqual({ value: "1.5", unit: "h" });
  });

  it("keeps the 1024-based keys on their own scale and labels", () => {
    expect(formatUnitValue(getUnitValue(5000000000, "bytes", ""))).toBe("4.66GB");
    expect(formatUnitValue(getUnitValue(5000000000, "bytes-si", ""))).toBe("5.00GB");
    expect(formatUnitValue(getUnitValue(1500, "bps", ""))).toBe("1.46KB/s");
    expect(formatUnitValue(getUnitValue(1500, "bps-si", ""))).toBe("1.50kB/s");
  });
});

describe("formatUnitValue with the new unit keys", () => {
  it.each([
    ["req-per-sec", 1234, "1.23K req/s"],
    ["req-per-sec", 12, "12.00 req/s"],
    ["req-per-sec", 0.02, "0.02 req/s"],
    ["ops-per-sec", 2500000, "2.50M ops/s"],
    ["events-per-sec", -1234, "-1.23K events/s"],
    ["req-per-min", 0, "0.00 req/min"],
    ["ops-per-min", 999.5, "999.50 ops/min"],
    ["events-per-min", 5000000000, "5.00B events/min"],
    ["per-sec", 1234, "1.23K/s"],
    ["per-sec", 0, "0.00/s"],
    ["per-sec", 0.02, "0.02/s"],
    ["per-min", 12, "12.00/min"],
    ["per-min", -2500000, "-2.50M/min"],
    ["bytes-si", 5000000000, "5.00GB"],
    ["kilobytes-si", 1500, "1.50MB"],
    ["megabytes-si", 0.5, "500.00kB"],
    ["bits", 2500000, "2.50Mbit"],
    ["bps-si", 1500, "1.50kB/s"],
    ["bits-per-sec", 100000000, "100.00Mbit/s"],
    ["minutes", 90, "1.50h"],
    ["hours", 36, "1.50D"],
    ["days", 0.5, "12.00h"],
  ])("%s %j prints %j", (unit, input, text) => {
    expect(formatUnitValue(getUnitValue(input, unit, ""))).toBe(text);
  });

  it.each(NAMED_RATES)("puts exactly one space before the %s suffix at every scale", (unit) => {
    for (const [input] of RATE_ROWS) {
      const scaled = getUnitValue(input, unit, "");
      const text = formatUnitValue(scaled);
      expect(text.match(/ /g)).toHaveLength(1);
      expect(text).toBe(`${scaled.value}${scaled.unit}`);
      expect(text.endsWith(RATE_SUFFIXES[unit])).toBe(true);
    }
  });

  it.each(GENERIC_RATES)("joins %s to the number with no space at every scale", (unit) => {
    for (const [input] of RATE_ROWS) {
      const text = formatUnitValue(getUnitValue(input, unit, ""));
      expect(text).not.toContain(" ");
      expect(text.endsWith(RATE_SUFFIXES[unit])).toBe(true);
    }
  });

  it.each(Object.keys(SCALED))("joins %s without a space, as the existing units do", (unit) => {
    for (const [input] of SCALED[unit]) {
      expect(formatUnitValue(getUnitValue(input, unit, ""))).not.toContain(" ");
    }
  });
});
