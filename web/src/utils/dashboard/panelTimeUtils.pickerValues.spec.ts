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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  arePickerValuesEqual,
  isUsablePickerValue,
  pickerValueToTimeObj,
  toPickerSavedDate,
} from "./panelTimeUtils";

const MINUTE = 60 * 1_000_000;

describe("arePickerValuesEqual", () => {
  it("compares relative ranges by period only", () => {
    expect(
      arePickerValuesEqual(
        { valueType: "relative", relativeTimePeriod: "15m", startTime: 1 },
        { type: "relative", relativeTimePeriod: "15m", startTime: 9 },
      ),
    ).toBe(true);
    expect(
      arePickerValuesEqual(
        { valueType: "relative", relativeTimePeriod: "15m" },
        { valueType: "relative", relativeTimePeriod: "1h" },
      ),
    ).toBe(false);
  });

  it("compares absolute ranges by value, whether read from the URL or the picker", () => {
    expect(
      arePickerValuesEqual(
        { valueType: "absolute", startTime: "100", endTime: "200" },
        { valueType: "absolute", startTime: 100, endTime: 200 },
      ),
    ).toBe(true);
    expect(
      arePickerValuesEqual(
        { valueType: "absolute", startTime: 100, endTime: 200 },
        { valueType: "absolute", startTime: 100, endTime: 300 },
      ),
    ).toBe(false);
  });

  it("never equates a relative and an absolute range, or a range and nothing", () => {
    expect(
      arePickerValuesEqual(
        { valueType: "relative", relativeTimePeriod: "15m" },
        { valueType: "absolute", startTime: 1, endTime: 2 },
      ),
    ).toBe(false);
    expect(arePickerValuesEqual(null, { valueType: "relative" })).toBe(false);
    expect(arePickerValuesEqual(null, null)).toBe(true);
  });
});

describe("isUsablePickerValue", () => {
  it.each([
    [{ valueType: "relative", relativeTimePeriod: "15m" }, true],
    [{ valueType: "relative", relativeTimePeriod: "2w" }, true],
    [{ valueType: "relative", relativeTimePeriod: "0m" }, false],
    [{ valueType: "relative", relativeTimePeriod: "" }, false],
    [{ valueType: "absolute", startTime: 100, endTime: 200 }, true],
    [{ valueType: "absolute", startTime: "100", endTime: "200" }, true],
    [{ valueType: "absolute", startTime: NaN, endTime: 200 }, false],
    [{ valueType: "absolute", startTime: 100, endTime: undefined }, false],
    [{ valueType: "absolute", startTime: 200, endTime: 100 }, false],
    [{ valueType: "absolute", startTime: 200, endTime: 200 }, false],
    [null, false],
  ])("%o is usable: %s", (value, usable) => {
    expect(isUsablePickerValue(value)).toBe(usable);
  });
});

describe("toPickerSavedDate", () => {
  const startMicros = Date.UTC(2026, 9, 13, 18, 25, 22) * 1000;
  const endMicros = Date.UTC(2026, 9, 13, 18, 50, 30) * 1000;

  it("passes a relative range as its period", () => {
    expect(toPickerSavedDate({ valueType: "relative", relativeTimePeriod: "1h" }, "UTC")).toEqual({
      type: "relative",
      relativeTimePeriod: "1h",
    });
  });

  it("writes an absolute range as wall clock in the dashboard's time zone", () => {
    expect(
      toPickerSavedDate(
        { valueType: "absolute", startTime: startMicros, endTime: endMicros },
        "UTC",
      ),
    ).toEqual({
      type: "absolute",
      selectedDate: { from: "2026/10/13", to: "2026/10/13" },
      selectedTime: { startTime: "18:25:22", endTime: "18:50:30" },
    });
  });

  it("follows a non-UTC zone across midnight, and reads URL text", () => {
    expect(
      toPickerSavedDate(
        { valueType: "absolute", startTime: String(startMicros), endTime: String(endMicros) },
        "Asia/Kolkata",
      ),
    ).toEqual({
      type: "absolute",
      selectedDate: { from: "2026/10/13", to: "2026/10/14" },
      selectedTime: { startTime: "23:55:22", endTime: "00:20:30" },
    });
  });
});

describe("pickerValueToTimeObj", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a relative range from now, in the dashboard's microsecond dates", () => {
    const time = pickerValueToTimeObj({ valueType: "relative", relativeTimePeriod: "15m" })!;

    expect(time.end_time.getTime()).toBe(Date.now() * 1000);
    expect(time.end_time.getTime() - time.start_time.getTime()).toBe(15 * MINUTE);
  });

  it("keeps an absolute range, including one read from the URL as text", () => {
    const time = pickerValueToTimeObj({ valueType: "absolute", startTime: "100", endTime: "200" })!;

    expect(time.start_time.getTime()).toBe(100);
    expect(time.end_time.getTime()).toBe(200);
  });

  it("returns nothing for a relative range without a period", () => {
    expect(pickerValueToTimeObj({ valueType: "relative", relativeTimePeriod: "" })).toBeNull();
    expect(pickerValueToTimeObj(null)).toBeNull();
  });
});
