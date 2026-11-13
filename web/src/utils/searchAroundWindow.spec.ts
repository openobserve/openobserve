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

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_AROUND,
  parseSearchAroundChoice,
  readSearchAroundChoice,
  searchAroundAnchorId,
  searchAroundKey,
  searchAroundTimeChoice,
  searchAroundWindow,
  SEARCH_AROUND_SECONDS,
  writeSearchAroundChoice,
} from "./searchAroundWindow";

describe("search around a row", () => {
  beforeEach(() => localStorage.clear());

  it("opens the given seconds either side of the row's timestamp", () => {
    const ts = 1_762_845_120_000_000;
    expect(searchAroundWindow(ts, 300)).toEqual({
      startUs: ts - 300_000_000,
      endUs: ts + 300_000_000,
    });
    expect(searchAroundWindow(ts, 5)).toEqual({ startUs: ts - 5_000_000, endUs: ts + 5_000_000 });
  });

  it("offers ± 5 s and ± 30 s below the minute windows, kept minutes still read", () => {
    expect(SEARCH_AROUND_SECONDS.map(searchAroundTimeChoice)).toEqual([
      "s5",
      "s30",
      "t1",
      "t5",
      "t15",
    ]);
    expect(parseSearchAroundChoice("s5")).toEqual({ kind: "time", seconds: 5 });
    expect(parseSearchAroundChoice("s30")).toEqual({ kind: "time", seconds: 30 });
    expect(parseSearchAroundChoice("t15")).toEqual({ kind: "time", seconds: 900 });
    expect(parseSearchAroundChoice("s60")).toBeNull();
    expect(parseSearchAroundChoice("s10")).toBeNull();
  });

  it("maps a remembered window to the picker's anchor row", () => {
    expect(searchAroundAnchorId("s5")).toBe("5s");
    expect(searchAroundAnchorId("t1")).toBe("1m");
    expect(searchAroundAnchorId("t5")).toBe("5m");
    expect(searchAroundAnchorId("t15")).toBeNull();
    expect(searchAroundAnchorId("r20")).toBeNull();
  });

  it("reads only the offered choices", () => {
    expect(parseSearchAroundChoice("t1")).toEqual({ kind: "time", seconds: 60 });
    expect(parseSearchAroundChoice("r100")).toEqual({ kind: "records", count: 100 });
    expect(parseSearchAroundChoice("t7")).toBeNull();
    expect(parseSearchAroundChoice("r1000")).toEqual({ kind: "records", count: 1000 });
    expect(parseSearchAroundChoice("r2000")).toBeNull();
    expect(parseSearchAroundChoice(5)).toBeNull();
  });

  it("defaults to ± 5 minutes and remembers the last choice per user", () => {
    expect(readSearchAroundChoice("a@x")).toBe(DEFAULT_SEARCH_AROUND);
    writeSearchAroundChoice("a@x", "r20");
    expect(readSearchAroundChoice("a@x")).toBe("r20");
    expect(readSearchAroundChoice("b@x")).toBe("t5");
    localStorage.setItem(searchAroundKey("a@x"), "t99");
    expect(readSearchAroundChoice("a@x")).toBe("t5");
  });
});
