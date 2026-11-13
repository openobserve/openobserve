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
  currentSearchAroundUser,
  searchAroundSecondsLabel,
  searchAroundTimeOptions,
  windowQueryForRun,
  type WindowQuery,
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

describe("search-around labels", () => {
  const t = ((key: string, named?: Record<string, unknown>) =>
    `${key}:${named?.n}`) as unknown as Parameters<typeof searchAroundSecondsLabel>[1];

  it("names seconds below a minute and minutes above", () => {
    expect(searchAroundSecondsLabel(30, t)).toBe("dateTime.aroundSeconds:30");
    expect(searchAroundSecondsLabel(300, t)).toBe("dateTime.aroundMinutes:5");
  });

  it("offers every time window as a stored choice", () => {
    expect(searchAroundTimeOptions(t).map((option) => option.value)).toEqual([
      "s5",
      "s30",
      "t1",
      "t5",
      "t15",
    ]);
    expect(searchAroundTimeOptions(t)[3].label).toBe("dateTime.aroundMinutes:5");
  });

  it("keys the remembered choice by the signed-in email", () => {
    expect(currentSearchAroundUser({ userInfo: { email: "a@x" } })).toBe("a@x");
    expect(currentSearchAroundUser({})).toBe("");
  });
});

describe("window query bound to its window", () => {
  const armed: WindowQuery = {
    query: "",
    typedQuery: "level = 'error'",
    view: "logs",
    startUs: 1_000_500,
    endUs: 9_000_500,
    pinned: false,
  };
  const run = { query: "level = 'error'", view: "logs", startUs: 1_000_000, endUs: 5_000_000 };

  it("pins to the range the picker applied, which may be cut short at now", () => {
    expect(windowQueryForRun(armed, run)).toEqual({
      ...armed,
      startUs: 1_000_000,
      endUs: 5_000_000,
      pinned: true,
    });
  });

  it("keeps a pinned window only for that exact range, view and typed query", () => {
    const pinned = windowQueryForRun(armed, run);
    expect(windowQueryForRun(pinned, run)).toEqual(pinned);
    expect(windowQueryForRun(pinned, { ...run, endUs: 5_000_001 })).toBeNull();
    expect(windowQueryForRun(pinned, { ...run, view: "patterns" })).toBeNull();
    expect(windowQueryForRun(pinned, { ...run, query: "level = 'warn'" })).toBeNull();
    expect(windowQueryForRun(pinned, { ...run, startUs: null, endUs: null })).toBeNull();
  });

  it("refuses a first run that does not start where the window starts", () => {
    expect(windowQueryForRun(armed, { ...run, startUs: 2_000_000 })).toBeNull();
    expect(windowQueryForRun(armed, { ...run, endUs: 9_002_000 })).toBeNull();
    expect(windowQueryForRun(null, run)).toBeNull();
  });
});
