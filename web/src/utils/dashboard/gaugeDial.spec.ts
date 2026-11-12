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
  alignGaugeValueFonts,
  gaugeAutoRange,
  gaugeColorDomain,
  isGaugeFixedRangeValid,
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
    expect(gaugeAutoRange([null, undefined, "", "abc", 7, 9])).toEqual({ min: 0, max: 9 });
    expect(gaugeAutoRange([null, undefined])).toBeNull();
    expect(gaugeAutoRange([])).toBeNull();
  });

  it("gives a single dial a round max above its value, so it is not always full", () => {
    expect(gaugeAutoRange([7])).toEqual({ min: 0, max: 10 });
    expect(gaugeAutoRange([296.625])).toEqual({ min: 0, max: 500 });
    expect(gaugeAutoRange([100])).toEqual({ min: 0, max: 200 });
    expect(gaugeAutoRange([0.4])).toEqual({ min: 0, max: 0.5 });
  });

  it("spans a single dial's raw samples, and ignores samples once there are several dials", () => {
    expect(gaugeAutoRange([30], ["10", "1200", "NaN", "30"])).toEqual({ min: 0, max: 2000 });
    expect(gaugeAutoRange([30], ["-20", "30"])).toEqual({ min: -20, max: 50 });
    expect(gaugeAutoRange([30, 60], ["1200"])).toEqual({ min: 0, max: 60 });
  });
});

describe("isGaugeFixedRangeValid", () => {
  it("needs a finite min below max, reading blanks as 0 and 100", () => {
    expect(isGaugeFixedRangeValid({ min: 0, max: 100 })).toBe(true);
    expect(isGaugeFixedRangeValid({ min: -50, max: 0 })).toBe(true);
    expect(isGaugeFixedRangeValid({})).toBe(true);
    expect(isGaugeFixedRangeValid({ min: 20, max: 10 })).toBe(false);
    expect(isGaugeFixedRangeValid({ min: 0, max: 0 })).toBe(false);
    expect(isGaugeFixedRangeValid({ min: 150 })).toBe(false);
    expect(isGaugeFixedRangeValid({ min: "abc", max: 10 })).toBe(false);
  });

  it("does not check the min and max of an auto range", () => {
    expect(isGaugeFixedRangeValid({ range_mode: "auto", min: 20, max: 10 })).toBe(true);
  });
});

describe("gaugeColorDomain", () => {
  it("spans the finite dial values", () => {
    expect(gaugeColorDomain([4, null, 9])).toEqual([4, 9]);
    expect(gaugeColorDomain([null])).toEqual([Infinity, -Infinity]);
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

  it("shows an instant sample as is, whatever reducer was saved", () => {
    expect(promqlGaugeValue({ value: [1, "42"] }, "count")).toBe(42);
    expect(promqlGaugeValue({ value: [1, "42"] }, "diff")).toBe(42);
  });

  it("skips non-numeric samples before reducing", () => {
    const metric = {
      values: [
        [1, "10"],
        [2, "NaN"],
        [3, "30"],
      ],
    };
    expect(promqlGaugeValue(metric, "max")).toBe(30);
    expect(promqlGaugeValue(metric, "avg")).toBe(20);
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
    // 13 glyphs at 0.7em must fit the ring inner diameter of 190px.
    expect(long.detail * 0.7 * 13).toBeLessThanOrEqual(190);
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
      min: 0,
      max: 100,
      axisLabel: { show: true, formatter: String },
      data: [{ value: 75, detail: { formatter: (v: number) => `${v}%` } }],
    };
    sizeGaugeDial(gauge, 300, 400);
    expect(gauge.radius).toBe("145px");
    expect(gauge.progress).toEqual({ show: true, roundCap: true, width: "50" });
    expect(gauge.axisLine.lineStyle).toEqual({ color: [[1, "#000"]], width: "50" });
    expect(gauge.title).toMatchObject({ color: "red", fontSize: 24, width: "400" });
    expect(gauge.detail).toEqual({ valueAnimation: true, fontSize: 60 });
    expect(gauge.axisLabel).toEqual({ show: true, formatter: String, fontSize: 14, distance: 34 });
  });

  const labelled = (max: number) => ({
    min: 0,
    max,
    axisLabel: { show: true, formatter: (v: number) => `${v.toFixed(2)}%` },
    data: [{ value: 1 }],
  });

  it("never pushes end labels outward onto the ring of a small dial", () => {
    const gauge: any = labelled(100);
    sizeGaugeDial(gauge, 60, 60);
    expect(gauge.axisLabel.distance).toBe(0);
  });

  it("hides end labels that would collide, and shows them again once the dial is big enough", () => {
    const gauge: any = labelled(100);
    sizeGaugeDial(gauge, 100, 100);
    expect(gauge.axisLabel.show).toBe(false);
    sizeGaugeDial(gauge, 400, 400);
    expect(gauge.axisLabel.show).toBe(true);
  });

  it("hides end labels whose combined width overruns the chord between the arc ends", () => {
    const gauge: any = labelled(1e12);
    sizeGaugeDial(gauge, 200, 200);
    expect(gauge.axisLabel.show).toBe(false);
  });

  it("hides short end labels that would run into the value text", () => {
    const gauge: any = {
      min: 0,
      max: 1,
      axisLabel: { show: true, formatter: String },
      data: [{ value: 1 }],
    };
    sizeGaugeDial(gauge, 100, 100);
    expect(gauge.axisLabel.show).toBe(false);
    sizeGaugeDial(gauge, 160, 160);
    expect(gauge.axisLabel.show).toBe(true);
  });

  it("shrinks long end labels to fit a normal-size panel instead of hiding them", () => {
    const gauge: any = {
      min: 0,
      max: 50000,
      axisLabel: { show: true, formatter: (v: number) => v.toFixed(2) },
      data: [{ value: 34567, detail: { formatter: (v: number) => v.toFixed(2) } }],
    };
    sizeGaugeDial(gauge, 263, 428);
    expect(gauge.axisLabel.show).toBe(true);
    expect(gauge.axisLabel.fontSize).toBeLessThan(gauge.title.fontSize);
  });

  it("leaves hidden end labels alone", () => {
    const gauge: any = { axisLabel: { show: false }, data: [{ value: 1 }] };
    sizeGaugeDial(gauge, 300, 300);
    expect(gauge.axisLabel).toEqual({ show: false });
  });
});

describe("alignGaugeValueFonts", () => {
  it("gives every dial the smallest value font", () => {
    const dials: any[] = [
      { data: [{ value: 5 }] },
      { data: [{ value: 12345.67, detail: { formatter: (v: number) => `${v} ms` } }] },
    ];
    for (const dial of dials) sizeGaugeDial(dial, 300, 300);
    expect(dials[0].detail.fontSize).toBeGreaterThan(dials[1].detail.fontSize);
    alignGaugeValueFonts(dials, 300);
    expect(dials[0].detail.fontSize).toBe(dials[1].detail.fontSize);
  });
});
