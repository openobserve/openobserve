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

/**
 * The list→detail row hand-off. What matters is not that a row can be passed —
 * it is the guards: a seed must only ever paint under the exact org,
 * fingerprint and window it was fetched for, and must be consumable ONCE. Every
 * rejected guard is a silent fall-through to the cold fetch, never an error.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDbmQueryDetailSeed,
  sameDbmRange,
  setDbmQueryDetailSeed,
  takeDbmQueryDetailSeed,
} from "./dbmQueryDetailSeed";
import type { DbmRange } from "./useDbmScope";
import type { QueryStatsRow } from "@/services/db_monitoring";

const relative = (period: string): DbmRange => ({
  type: "relative",
  relativeTimePeriod: period,
  startTime: 0,
  endTime: 0,
});

const absolute = (startTime: number, endTime: number): DbmRange => ({
  type: "absolute",
  relativeTimePeriod: null,
  startTime,
  endTime,
});

const row = (fingerprint: string): QueryStatsRow => ({
  fingerprint,
  db_system: "postgresql",
  db_instance: "orders-db",
  calls: 120,
  p95_ns: 4_000_000,
});

describe("takeDbmQueryDetailSeed", () => {
  beforeEach(() => clearDbmQueryDetailSeed());

  it("hands the row over when org, fingerprint and window all match", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toEqual(row("fp1"));
  });

  /** A deep link or a reload set nothing — the cold fetch is the answer. */
  it("returns null when nothing was handed off", () => {
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toBeNull();
  });

  /**
   * THE staleness guard: the row was fetched under the list's window, so under
   * any other window it is an answer to a different question. A near-miss must
   * fall through to the fetch, not paint.
   */
  it("rejects a seed fetched under a different window", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("12h"))).toBeNull();
  });

  it("rejects a relative seed against an absolute window, and vice versa", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("acme", "fp1", absolute(1_000, 2_000))).toBeNull();

    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: absolute(1_000, 2_000) });
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toBeNull();
  });

  it("rejects an absolute seed whose bounds moved", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: absolute(1_000, 2_000) });
    expect(takeDbmQueryDetailSeed("acme", "fp1", absolute(1_000, 3_000))).toBeNull();
  });

  it("rejects a seed for another fingerprint or another org", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("acme", "fp2", relative("1h"))).toBeNull();

    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("other", "fp1", relative("1h"))).toBeNull();
  });

  /**
   * One shot, on BOTH outcomes. A claimed seed must not resurface on the next
   * mount, and a rejected one is not going to become valid later — leaving it
   * behind would let some future navigation inherit a row it never asked for.
   */
  it("consumes the slot on a successful take", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    takeDbmQueryDetailSeed("acme", "fp1", relative("1h"));
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toBeNull();
  });

  it("consumes the slot on a rejected take too", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    takeDbmQueryDetailSeed("acme", "fp1", relative("12h"));
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toBeNull();
  });

  /** A second navigation replaces the first — last click wins. */
  it("keeps only the latest hand-off", () => {
    setDbmQueryDetailSeed({ row: row("fp1"), org: "acme", range: relative("1h") });
    setDbmQueryDetailSeed({ row: row("fp2"), org: "acme", range: relative("1h") });
    expect(takeDbmQueryDetailSeed("acme", "fp1", relative("1h"))).toBeNull();
  });
});

describe("sameDbmRange", () => {
  /**
   * Relative ranges compare by PERIOD, never by bounds: the microsecond bounds
   * re-anchor on every load by design (see `useDbmScope`), so comparing them
   * could never match and the seed would be dead code that still looked right —
   * the exact trap `dbmTabCountsKey` documents.
   */
  it("matches relative ranges on the period alone", () => {
    const a = relative("15m");
    const b = { ...relative("15m"), startTime: 5, endTime: 9 };
    expect(sameDbmRange(a, b)).toBe(true);
  });

  it("matches absolute ranges on their exact bounds", () => {
    expect(sameDbmRange(absolute(1, 2), absolute(1, 2))).toBe(true);
    expect(sameDbmRange(absolute(1, 2), absolute(1, 3))).toBe(false);
  });
});
