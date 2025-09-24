// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { dateBin } from "@/utils/dashboard/datetimeStartPoint";
import { differenceInSeconds, subSeconds } from "date-fns";

// Mock date-fns functions
vi.mock("date-fns", () => ({
  differenceInSeconds: vi.fn(),
  subSeconds: vi.fn(),
}));

// Cast the mocked functions to access mock methods
const mockedDifferenceInSeconds = vi.mocked(differenceInSeconds);
const mockedSubSeconds = vi.mocked(subSeconds);

describe("dateBin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: Basic functionality test
  it("should return correct date bin for basic case", () => {
    const interval = 60; // 1 minute interval
    const date = new Date("2023-01-01T10:05:30Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:05:00Z");

    // Mock the date-fns functions
    mockedDifferenceInSeconds.mockReturnValue(330); // 5.5 minutes = 330 seconds
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 30); // 330 % 60 = 30
    expect(result).toEqual(expectedResult);
  });

  // Test 2: Zero remainder case - date already on interval boundary
  it("should return same date when remainder is zero", () => {
    const interval = 300; // 5 minute interval
    const date = new Date("2023-01-01T10:05:00Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:05:00Z");

    // Mock: exactly 5 minutes difference, no remainder
    mockedDifferenceInSeconds.mockReturnValue(300); // exactly 5 minutes
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 0); // 300 % 300 = 0
    expect(result).toEqual(expectedResult);
  });

  // Test 3: Large remainder case
  it("should handle large remainder correctly", () => {
    const interval = 60; // 1 minute interval
    const date = new Date("2023-01-01T10:05:59Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:05:00Z");

    // Mock: 359 seconds = 5 minutes 59 seconds
    mockedDifferenceInSeconds.mockReturnValue(359);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 59); // 359 % 60 = 59
    expect(result).toEqual(expectedResult);
  });

  // Test 4: Different interval sizes
  it("should work with different interval sizes", () => {
    const interval = 3600; // 1 hour interval
    const date = new Date("2023-01-01T12:30:45Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T12:00:00Z");

    // Mock: 2.5 hours = 9045 seconds
    mockedDifferenceInSeconds.mockReturnValue(9045);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 1845); // 9045 % 3600 = 1845
    expect(result).toEqual(expectedResult);
  });

  // Test 5: Small interval (seconds)
  it("should work with small intervals", () => {
    const interval = 30; // 30 second interval
    const date = new Date("2023-01-01T10:00:45Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:00:30Z");

    // Mock: 45 seconds difference
    mockedDifferenceInSeconds.mockReturnValue(45);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 15); // 45 % 30 = 15
    expect(result).toEqual(expectedResult);
  });

  // Test 6: Edge case - very small remainder
  it("should handle very small remainder", () => {
    const interval = 60; // 1 minute interval
    const date = new Date("2023-01-01T10:05:01Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:05:00Z");

    // Mock: 301 seconds = 5 minutes 1 second
    mockedDifferenceInSeconds.mockReturnValue(301);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 1); // 301 % 60 = 1
    expect(result).toEqual(expectedResult);
  });

  // Test 7: Large interval (daily)
  it("should work with large intervals", () => {
    const interval = 86400; // 1 day interval
    const date = new Date("2023-01-03T15:30:00Z");
    const origin = new Date("2023-01-01T00:00:00Z");
    const expectedResult = new Date("2023-01-03T00:00:00Z");

    // Mock: 2.65 days = 228600 seconds
    mockedDifferenceInSeconds.mockReturnValue(228600);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 55800); // 228600 % 86400 = 55800
    expect(result).toEqual(expectedResult);
  });

  // Test 8: Date equals origin
  it("should handle when date equals origin", () => {
    const interval = 300; // 5 minute interval
    const date = new Date("2023-01-01T10:00:00Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:00:00Z");

    // Mock: 0 seconds difference
    mockedDifferenceInSeconds.mockReturnValue(0);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 0); // 0 % 300 = 0
    expect(result).toEqual(expectedResult);
  });

  // Test 9: Negative difference (date before origin)
  it("should handle negative difference when date is before origin", () => {
    const interval = 60; // 1 minute interval
    const date = new Date("2023-01-01T09:58:30Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T09:58:00Z");

    // Mock: negative difference (date-fns handles this)
    mockedDifferenceInSeconds.mockReturnValue(-90); // -1.5 minutes
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, -30); // -90 % 60 = -30 (JavaScript modulo)
    expect(result).toEqual(expectedResult);
  });

  // Test 10: Single second interval
  it("should work with single second intervals", () => {
    const interval = 1; // 1 second interval
    const date = new Date("2023-01-01T10:00:00.500Z");
    const origin = new Date("2023-01-01T10:00:00Z");
    const expectedResult = new Date("2023-01-01T10:00:00Z");

    // Mock: 0 seconds difference (sub-second precision lost in differenceInSeconds)
    mockedDifferenceInSeconds.mockReturnValue(0);
    mockedSubSeconds.mockReturnValue(expectedResult);

    const result = dateBin(interval, date, origin);

    expect(mockedDifferenceInSeconds).toHaveBeenCalledWith(date, origin);
    expect(mockedSubSeconds).toHaveBeenCalledWith(date, 0); // 0 % 1 = 0
    expect(result).toEqual(expectedResult);
  });
});