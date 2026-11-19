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

import { rangeExceedsGuard, readOrgTimeRangeSettings } from "@/utils/orgTimeRangeSettings";

const DAY_US = 86_400_000_000;

describe("readOrgTimeRangeSettings", () => {
  it("maps unset, zero and missing settings to null", () => {
    for (const settings of [
      undefined,
      null,
      {},
      { fiscal_year_start_month: 0, range_guard_days: 0 },
    ]) {
      expect(readOrgTimeRangeSettings(settings)).toEqual({
        fiscalYearStartMonth: null,
        rangeGuardDays: null,
      });
    }
  });

  it("reads a set fiscal year start and guard, including numeric strings", () => {
    expect(readOrgTimeRangeSettings({ fiscal_year_start_month: 4, range_guard_days: 90 })).toEqual({
      fiscalYearStartMonth: 4,
      rangeGuardDays: 90,
    });
    expect(
      readOrgTimeRangeSettings({ fiscal_year_start_month: "1", range_guard_days: "30" }),
    ).toEqual({ fiscalYearStartMonth: 1, rangeGuardDays: 30 });
  });

  it("ignores values the server would refuse", () => {
    expect(
      readOrgTimeRangeSettings({ fiscal_year_start_month: 13, range_guard_days: 3651 }),
    ).toEqual({ fiscalYearStartMonth: null, rangeGuardDays: null });
    expect(
      readOrgTimeRangeSettings({ fiscal_year_start_month: 2.5, range_guard_days: -1 }),
    ).toEqual({ fiscalYearStartMonth: null, rangeGuardDays: null });
  });
});

describe("rangeExceedsGuard", () => {
  it("never holds a range when the org has no guard", () => {
    expect(rangeExceedsGuard(0, 10_000 * DAY_US, null)).toBe(false);
  });

  it("holds only ranges strictly longer than the guard", () => {
    expect(rangeExceedsGuard(0, 90 * DAY_US, 90)).toBe(false);
    expect(rangeExceedsGuard(0, 90 * DAY_US + 1, 90)).toBe(true);
  });
});
