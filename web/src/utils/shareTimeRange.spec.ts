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
  dashboardTimeUs,
  fixedShareLabel,
  linkWithRangeText,
  shareTimeKinds,
  withRollingPeriod,
} from "./shareTimeRange";

describe("share link kinds", () => {
  it("swaps fixed bounds for the rolling period and keeps every other parameter", () => {
    const fixed = "https://o2.example/web/logs?stream=default&from=1&to=2&org_identifier=default";
    const rolling = new URL(withRollingPeriod(fixed, "15m")!);
    expect(rolling.searchParams.get("period")).toBe("15m");
    expect(rolling.searchParams.has("from")).toBe(false);
    expect(rolling.searchParams.has("to")).toBe(false);
    expect(rolling.searchParams.get("stream")).toBe("default");
    expect(rolling.pathname).toBe("/web/logs");
  });

  it("has no rolling link without a period", () => {
    expect(withRollingPeriod("https://o2.example/web/logs?from=1&to=2", null)).toBeNull();
    expect(withRollingPeriod("", "15m")).toBeNull();
  });

  it("lists the page default first, and only fixed when the range is already fixed", () => {
    expect(shareTimeKinds("fixed", true)).toEqual(["fixed", "live"]);
    expect(shareTimeKinds("live", true)).toEqual(["live", "fixed"]);
    expect(shareTimeKinds("live", false)).toEqual(["fixed"]);
  });

  it("copies the link and one line naming the page, range and kind", () => {
    expect(
      linkWithRangeText({
        url: "https://o2.example/short/abc",
        context: "Logs · default",
        range: "2026-11-12 15:42:10 – 15:44:30 UTC",
        kind: "fixed",
      }),
    ).toBe(
      "https://o2.example/short/abc\nLogs · default · 2026-11-12 15:42:10 – 15:44:30 UTC · fixed",
    );
  });

  it("reads a dashboard time object's microsecond Dates as microseconds, not milliseconds", () => {
    const startUs = Date.UTC(2026, 9, 1) * 1000;
    const endUs = Date.UTC(2026, 10, 12, 15, 54) * 1000;
    const bounds = dashboardTimeUs({ start_time: new Date(startUs), end_time: new Date(endUs) });
    expect(bounds).toEqual({ startUs, endUs });
    expect(new Date(bounds!.endUs / 1000).getUTCFullYear()).toBe(2026);
    expect(
      dashboardTimeUs({ start_time: new Date(endUs), end_time: new Date(startUs) }),
    ).toBeNull();
    expect(dashboardTimeUs(null)).toBeNull();
  });

  it("names a fixed window with its zone, and nothing for an empty one", () => {
    const startUs = Date.UTC(2026, 10, 12, 15, 42) * 1000;
    const endUs = Date.UTC(2026, 10, 12, 15, 44) * 1000;
    expect(fixedShareLabel(startUs, endUs, "UTC")).toMatch(/15:42 – 15:44 UTC$/);
    expect(fixedShareLabel(startUs, endUs, "Asia/Kolkata")).toMatch(/21:12 – 21:14 UTC\+05:30$/);
    expect(fixedShareLabel(endUs, startUs, "UTC")).toBe("");
  });
});
