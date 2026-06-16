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

import { describe, it, expect } from "vitest";
import {
  queryParamsToSelectedDate,
  selectedDateToQueryParams,
  refreshLabelToInterval,
  refreshIntervalToLabel,
} from "./urlTimeParams";

describe("urlTimeParams · queryParamsToSelectedDate", () => {
  it("maps `period` to a relative selection", () => {
    expect(queryParamsToSelectedDate({ period: "1h" })).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "1h",
    });
  });

  it("maps `from`+`to` to an absolute selection", () => {
    expect(queryParamsToSelectedDate({ from: "1000", to: "2000" })).toEqual({
      valueType: "absolute",
      startTime: "1000",
      endTime: "2000",
      relativeTimePeriod: "15m",
    });
  });

  it("defaults to relative 15m when neither is present", () => {
    expect(queryParamsToSelectedDate({})).toEqual({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });
  });

  it("prefers `period` when both period and from/to are present", () => {
    const r = queryParamsToSelectedDate({
      period: "5m",
      from: "1000",
      to: "2000",
    });
    expect(r.valueType).toBe("relative");
    expect(r.relativeTimePeriod).toBe("5m");
  });

  it("falls back to relative default when only `from` is present (no `to`)", () => {
    const r = queryParamsToSelectedDate({ from: "1000" });
    expect(r.valueType).toBe("relative");
    expect(r.relativeTimePeriod).toBe("15m");
  });
});

describe("urlTimeParams · selectedDateToQueryParams", () => {
  it("returns {} for null/undefined", () => {
    expect(selectedDateToQueryParams(null)).toEqual({});
    expect(selectedDateToQueryParams(undefined)).toEqual({});
  });

  it("relative -> { period }", () => {
    expect(
      selectedDateToQueryParams({
        valueType: "relative",
        relativeTimePeriod: "1h",
        startTime: null,
        endTime: null,
      }),
    ).toEqual({ period: "1h" });
  });

  it("absolute -> { from, to }", () => {
    expect(
      selectedDateToQueryParams({
        valueType: "absolute",
        startTime: 1000,
        endTime: 2000,
        relativeTimePeriod: "",
      }),
    ).toEqual({ from: 1000, to: 2000 });
  });

  it("falls back to { period } when valueType is missing but relativeTimePeriod is set", () => {
    expect(
      selectedDateToQueryParams({
        relativeTimePeriod: "30m",
      } as any),
    ).toEqual({ period: "30m" });
  });

  it("falls back to { from, to } when valueType is missing but start/end are set", () => {
    expect(
      selectedDateToQueryParams({
        startTime: 10,
        endTime: 20,
      } as any),
    ).toEqual({ from: 10, to: 20 });
  });

  it("returns {} for an empty selection", () => {
    expect(selectedDateToQueryParams({} as any)).toEqual({});
  });

  it("round-trips with queryParamsToSelectedDate (relative)", () => {
    const params = { period: "1h" };
    expect(
      selectedDateToQueryParams(queryParamsToSelectedDate(params)),
    ).toEqual(params);
  });
});

describe("urlTimeParams · refreshLabelToInterval", () => {
  it("parses a label to seconds", () => {
    expect(refreshLabelToInterval("30s")).toBe(30);
    expect(refreshLabelToInterval("1m")).toBe(60);
    expect(refreshLabelToInterval("1h")).toBe(3600);
  });

  it("parses larger units (d/w)", () => {
    expect(refreshLabelToInterval("1d")).toBe(86400);
    expect(refreshLabelToInterval("1w")).toBe(604800);
  });

  it("clamps to 0 (off) when below the configured minimum", () => {
    expect(refreshLabelToInterval("3s", 5)).toBe(0);
  });

  it("keeps the value when at/above the minimum", () => {
    expect(refreshLabelToInterval("10s", 5)).toBe(10);
    expect(refreshLabelToInterval("5s", 5)).toBe(5);
  });

  it("returns 0 for empty/nullish labels", () => {
    expect(refreshLabelToInterval("")).toBe(0);
    expect(refreshLabelToInterval(null)).toBe(0);
    expect(refreshLabelToInterval(undefined)).toBe(0);
  });

  it("returns 0 for an unparseable label like 'Off'", () => {
    expect(refreshLabelToInterval("Off")).toBe(0);
  });

  it("does not clamp when no minimum is given", () => {
    expect(refreshLabelToInterval("3s")).toBe(3);
  });
});

describe("urlTimeParams · refreshIntervalToLabel", () => {
  it("formats seconds to a label", () => {
    expect(refreshIntervalToLabel(30)).toBe("30s");
    expect(refreshIntervalToLabel(60)).toBe("1m");
  });

  it("formats 0 as Off", () => {
    expect(refreshIntervalToLabel(0)).toBe("Off");
  });

  it("round-trips with refreshLabelToInterval for non-zero values", () => {
    expect(refreshLabelToInterval(refreshIntervalToLabel(300))).toBe(300);
  });
});
