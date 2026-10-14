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
import { freshTimeFromAppliedRange, resolveAppliedRangeNow } from "./dashboardFreshPanelTime";

const MINUTE_MICROS = 60_000_000;
const lastRefreshEnd = (Date.now() - 45 * 60_000) * 1000;

describe("resolveAppliedRangeNow", () => {
  it("moves a relative range up to now and keeps its length", () => {
    const askedAt = Date.now() * 1000;

    const time = resolveAppliedRangeNow({
      valueType: "relative",
      relativeTimePeriod: "15m",
      startTime: lastRefreshEnd - 15 * MINUTE_MICROS,
      endTime: lastRefreshEnd,
    });

    expect(time!.end_time.getTime()).toBeGreaterThanOrEqual(askedAt);
    expect(time!.end_time.getTime() - time!.start_time.getTime()).toBe(15 * MINUTE_MICROS);
  });

  it("returns an absolute range unchanged", () => {
    const time = resolveAppliedRangeNow({
      valueType: "absolute",
      startTime: lastRefreshEnd - 30 * MINUTE_MICROS,
      endTime: lastRefreshEnd,
    });

    expect(time).toEqual({
      start_time: new Date(lastRefreshEnd - 30 * MINUTE_MICROS),
      end_time: new Date(lastRefreshEnd),
    });
  });

  it.each([
    ["no range yet", null],
    ["a relative range with no period and no times", { valueType: "relative" }],
    ["an absolute range with unreadable times", { startTime: "soon", endTime: "later" }],
  ])("resolves nothing for %s, so the handed time stands", (_case, appliedRange) => {
    expect(resolveAppliedRangeNow(appliedRange)).toBeUndefined();
  });
});

describe("freshTimeFromAppliedRange", () => {
  const appliedRange = { valueType: "relative", relativeTimePeriod: "15m" };

  it("resolves the view's applied range while Auto Run is on", () => {
    const resolve = freshTimeFromAppliedRange(
      () => true,
      () => appliedRange,
    );

    const time = resolve("p-1");

    expect(time!.end_time.getTime() - time!.start_time.getTime()).toBe(15 * MINUTE_MICROS);
  });

  it("resolves nothing while Auto Run is off", () => {
    const resolve = freshTimeFromAppliedRange(
      () => false,
      () => appliedRange,
    );

    expect(resolve("p-1")).toBeUndefined();
  });
});
