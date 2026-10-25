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
  gaugeAutoRange,
  gaugeEndLabels,
  gaugeTextSizes,
  gaugeValueText,
  isGaugeAutoRange,
  promqlGaugeValue,
  sizeGaugeDial,
} from "@/utils/dashboard/gaugeDial";

const plainUnit = { unit: "default", unitCustom: "", decimals: 2 };

describe("isGaugeAutoRange", () => {
  it("is true only for range_mode auto", () => {
    expect(isGaugeAutoRange({ range_mode: "auto" })).toBe(true);
    expect(isGaugeAutoRange({ range_mode: "fixed" })).toBe(false);
    expect(isGaugeAutoRange({})).toBe(false);
    expect(isGaugeAutoRange(undefined)).toBe(false);
  });
});

describe("gaugeAutoRange", () => {
  it("runs from 0 to the largest value for positive data", () => {
    expect(gaugeAutoRange([120, 4500, "30"])).toEqual({ min: 0, max: 4500 });
  });

  it("starts at the smallest value when it is negative", () => {
    expect(gaugeAutoRange([-40, 10])).toEqual({ min: -40, max: 10 });
    expect(gaugeAutoRange([-40, -10])).toEqual({ min: -40, max: -10 });
  });

  it("widens a zero span to 1", () => {
    expect(gaugeAutoRange([0, 0])).toEqual({ min: 0, max: 1 });
    expect(gaugeAutoRange([-5])).toEqual({ min: -5, max: -4 });
  });

  it("ignores missing and non-numeric values, and is null when none are left", () => {
    expect(gaugeAutoRange([null, undefined, "", "abc", 7])).toEqual({ min: 0, max: 7 });
    expect(gaugeAutoRange([null, undefined])).toBeNull();
    expect(gaugeAutoRange([])).toBeNull();
  });
});

describe("promqlGaugeValue", () => {
  it("takes the latest point of a range series by default", () => {
    const metric = {
      values: [
        [3, "30"],
        [1, "10"],
        [2, "20"],
      ],
    };
    expect(promqlGaugeValue(metric, undefined)).toBe(30);
  });

  it("does not reorder the response in place", () => {
    const values = [
      [2, "20"],
      [1, "10"],
    ];
    promqlGaugeValue({ values }, "last");
    expect(values[0][0]).toBe(2);
  });

  it("applies the chosen reducer", () => {
    const metric = {
      values: [
        [1, "10"],
        [2, "30"],
        [3, "20"],
      ],
    };
    expect(promqlGaugeValue(metric, "avg")).toBe(20);
    expect(promqlGaugeValue(metric, "max")).toBe(30);
    expect(promqlGaugeValue(metric, "first")).toBe(10);
  });

  it("reads the single value pair of an instant query", () => {
    expect(promqlGaugeValue({ value: [1700000000, "42.5"] }, "last")).toBe(42.5);
  });

  it("is null for a series without points or with a non-finite value", () => {
    expect(promqlGaugeValue({ values: [] }, "last")).toBeNull();
    expect(promqlGaugeValue({ metric: {} }, "last")).toBeNull();
    expect(promqlGaugeValue({ value: [1, "NaN"] }, "last")).toBeNull();
  });
});

describe("gaugeValueText", () => {
  it("formats the value with the unit", () => {
    expect(gaugeValueText(1536, null, { unit: "bytes", unitCustom: "", decimals: 1 })).toBe(
      "1.5KB",
    );
  });

  it("shows a dash when there is no value", () => {
    expect(gaugeValueText(null, null, plainUnit)).toBe("-");
    expect(gaugeValueText(undefined, null, plainUnit)).toBe("-");
    expect(gaugeValueText(NaN, null, plainUnit)).toBe("-");
  });

  it("prefers the mapped text", () => {
    expect(gaugeValueText(2, { text: "DOWN" }, plainUnit)).toBe("DOWN");
    expect(gaugeValueText(2, { text: "", color: "#f00" }, plainUnit)).toBe("2.00");
  });
});

describe("gaugeEndLabels", () => {
  it("adds nothing when the option is off or unset", () => {
    expect(gaugeEndLabels(undefined, plainUnit)).toEqual({});
    expect(gaugeEndLabels(false, plainUnit)).toEqual({});
  });

  it("labels only min and max, formatted with the unit", () => {
    const labels = gaugeEndLabels(true, { unit: "percent", unitCustom: "", decimals: 0 });
    expect(labels.splitNumber).toBe(1);
    expect(labels.axisLabel.show).toBe(true);
    expect(labels.axisLabel.formatter(100)).toBe("100%");
  });
});

describe("gaugeTextSizes", () => {
  it("keeps the old 12/10 sizes on small dials", () => {
    expect(gaugeTextSizes(40, "12.00")).toEqual({ detail: 12, title: 10 });
  });

  it("grows the value and title with the dial", () => {
    const sizes = gaugeTextSizes(300, "75");
    expect(sizes.detail).toBe(60);
    expect(sizes.title).toBe(24);
  });

  it("shrinks long values so they fit inside the ring", () => {
    const short = gaugeTextSizes(300, "75");
    const long = gaugeTextSizes(300, "1234567.89 ms");
    expect(long.detail).toBeLessThan(short.detail);
    // 13 glyphs at 0.6em must fit the ring's inner diameter of 190px.
    expect(long.detail * 0.6 * 13).toBeLessThanOrEqual(190);
  });

  it("caps very large dials", () => {
    expect(gaugeTextSizes(2000, "7")).toEqual({ detail: 72, title: 24 });
  });
});

describe("sizeGaugeDial", () => {
  it("sizes the ring and text from the cell and keeps other settings", () => {
    const gauge: any = {
      progress: { show: true, roundCap: true },
      axisLine: { lineStyle: { color: [[1, "#000"]] } },
      title: { color: "red" },
      detail: { valueAnimation: true },
      axisLabel: { show: true },
      data: [{ value: 75, detail: { formatter: (v: number) => `${v}%` } }],
    };
    sizeGaugeDial(gauge, 300, 400);
    expect(gauge.radius).toBe("145px");
    expect(gauge.progress).toEqual({ show: true, roundCap: true, width: "50" });
    expect(gauge.axisLine.lineStyle).toEqual({ color: [[1, "#000"]], width: "50" });
    expect(gauge.title).toMatchObject({ color: "red", fontSize: 24, width: "400" });
    expect(gauge.detail).toEqual({ valueAnimation: true, fontSize: 60 });
    expect(gauge.axisLabel.fontSize).toBe(24);
  });

  it("leaves hidden end labels alone", () => {
    const gauge: any = { axisLabel: { show: false }, data: [{ value: 1 }] };
    sizeGaugeDial(gauge, 300, 300);
    expect(gauge.axisLabel).toEqual({ show: false });
  });
});
