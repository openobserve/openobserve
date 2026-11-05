// Copyright 2026 OpenObserve Inc.
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

import { describe, expect, it } from "vitest";
import { dateBin } from "@/utils/dashboard/datetimeStartPoint";

const bin = (interval: number, date: string, origin: string) =>
  dateBin(interval, new Date(date), new Date(origin)).toISOString();

describe("dateBin", () => {
  it.each([
    ["inside a bucket", 60, "2023-01-01T10:05:30Z", "2023-01-01T10:05:00.000Z"],
    ["on a bucket edge", 300, "2023-01-01T10:05:00Z", "2023-01-01T10:05:00.000Z"],
    ["at the last second of a bucket", 60, "2023-01-01T10:05:59Z", "2023-01-01T10:05:00.000Z"],
    ["at the first second of a bucket", 60, "2023-01-01T10:05:01Z", "2023-01-01T10:05:00.000Z"],
    ["with an hour width", 3600, "2023-01-01T12:30:45Z", "2023-01-01T12:00:00.000Z"],
    ["with a 30 second width", 30, "2023-01-01T10:00:45Z", "2023-01-01T10:00:30.000Z"],
    ["with a day width", 86400, "2023-01-03T15:30:00Z", "2023-01-03T10:00:00.000Z"],
    ["at the origin", 300, "2023-01-01T10:00:00Z", "2023-01-01T10:00:00.000Z"],
    ["with a part of a second", 1, "2023-01-01T10:00:00.500Z", "2023-01-01T10:00:00.000Z"],
  ])("rounds down %s", (_name, interval, date, expected) => {
    expect(bin(interval, date, "2023-01-01T10:00:00Z")).toBe(expected);
  });

  it.each([
    ["inside a bucket", 60, "2023-01-01T09:58:30Z", "2023-01-01T09:58:00.000Z"],
    ["on a bucket edge", 60, "2023-01-01T09:58:00Z", "2023-01-01T09:58:00.000Z"],
    ["with a part of a second", 60, "2023-01-01T09:58:29.500Z", "2023-01-01T09:58:00.000Z"],
  ])("rounds down before the origin %s", (_name, interval, date, expected) => {
    expect(bin(interval, date, "2023-01-01T10:00:00Z")).toBe(expected);
  });

  it("gives the histogram bucket of a date before 2001", () => {
    expect(bin(7 * 86400, "2000-12-28T12:00:00Z", "2001-01-01T00:00:00Z")).toBe(
      "2000-12-25T00:00:00.000Z",
    );
  });
});
