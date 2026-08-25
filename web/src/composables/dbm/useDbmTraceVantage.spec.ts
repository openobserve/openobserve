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

import { hasDbmTraceVantage } from "./useDbmTraceVantage";

describe("hasDbmTraceVantage", () => {
  it("is false on an answered empty read — the zero-trace observation", () => {
    expect(hasDbmTraceVantage({ rows: [] })).toBe(false);
    expect(hasDbmTraceVantage({ series: [] })).toBe(false);
    expect(hasDbmTraceVantage({ rows: [], series: [] })).toBe(false);
  });

  it("is true when any trace signal is populated", () => {
    expect(hasDbmTraceVantage({ rows: [{}] })).toBe(true);
    expect(hasDbmTraceVantage({ series: [{}] })).toBe(true);
    // A fingerprint with samples but no ranked rollup row still has a caller
    // list worth showing — one populated signal is enough.
    expect(hasDbmTraceVantage({ rows: [{}], series: [] })).toBe(true);
    expect(hasDbmTraceVantage({ rows: [], series: [{}] })).toBe(true);
  });

  it("stays true on a FAILED read — a 500 is not evidence of absence", () => {
    expect(hasDbmTraceVantage({ rows: [], series: [], readFailed: true })).toBe(true);
  });

  it("stays true while the read is in flight, so sections do not flash out", () => {
    expect(hasDbmTraceVantage({ rows: [], loading: true })).toBe(true);
  });

  it("stays true when nothing was passed — silence is not evidence", () => {
    expect(hasDbmTraceVantage({})).toBe(true);
    expect(hasDbmTraceVantage({ rows: null, series: undefined })).toBe(true);
  });

  it("ignores a null signal but still answers off a sibling empty one", () => {
    // `rows: null` means "this surface has no row signal", not "zero rows";
    // the empty series is the observation that decides.
    expect(hasDbmTraceVantage({ rows: null, series: [] })).toBe(false);
  });
});
