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

import { afterEach, describe, expect, it } from "vitest";
import store from "@/stores";
import { gt } from "@/types/i18n";
import {
  formatClockTime,
  formatDataAge,
  formatRangeLength,
  formatRefreshFailed,
} from "./formatters";

const at = Date.UTC(2026, 10, 1, 5, 12, 7);

describe("formatClockTime", () => {
  it("formats a 24-hour clock time in the given zone", () => {
    expect(formatClockTime(at, "UTC")).toBe("05:12");
    expect(formatClockTime(at, "Asia/Calcutta")).toBe("10:42");
    expect(formatClockTime(at, "Asia/Calcutta", true)).toBe("10:42:07");
  });

  it("falls back to the browser zone for a zone the runtime rejects", () => {
    expect(formatClockTime(at, "Not/AZone")).toBe("05:12");
  });
});

describe("formatDataAge", () => {
  it("shows the clock time and keeps the zone for the tooltip and the refresh name", () => {
    expect(formatDataAge(gt, { at, timeZone: "Asia/Calcutta" })).toEqual({
      text: "Updated 10:42",
      time: "10:42",
      full: "Updated 10:42:07 · Asia/Calcutta",
      refreshName: "Refresh, updated 10:42 Asia/Calcutta",
    });
  });
});

describe("formatRefreshFailed", () => {
  const failedAt = Date.UTC(2026, 10, 1, 5, 17);

  it("names both times", () => {
    expect(formatRefreshFailed(gt, { failedAt, dataFrom: at, timeZone: "Asia/Calcutta" })).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
  });

  it("summarises several failed charts once for the page", () => {
    expect(
      formatRefreshFailed(gt, {
        failedAt,
        dataFrom: at,
        timeZone: "Asia/Calcutta",
        count: 3,
        total: 8,
      }),
    ).toBe("Refresh failed at 10:47 for 3 of 8 charts · showing data from 10:42");
    expect(
      formatRefreshFailed(gt, { failedAt, dataFrom: at, timeZone: "UTC", count: 1, total: 1 }),
    ).toBe("Refresh failed at 05:17 for 1 of 1 chart · showing data from 05:12");
  });
});

describe("data-age zone", () => {
  const before = store.state.timezone;
  afterEach(() => store.commit("setTimezone", before));

  it("uses the app's selected timezone, not the browser's, when no zone is given", () => {
    store.commit("setTimezone", "Asia/Calcutta");
    expect(formatDataAge(gt, { at })).toEqual({
      text: "Updated 10:42",
      time: "10:42",
      full: "Updated 10:42:07 · Asia/Calcutta",
      refreshName: "Refresh, updated 10:42 Asia/Calcutta",
    });
    expect(formatRefreshFailed(gt, { failedAt: at + 295_000, dataFrom: at })).toBe(
      "Refresh failed at 10:47 · showing data from 10:42",
    );
  });

  it("falls back to the browser zone when the stored one is the Browser Time label", () => {
    store.commit("setTimezone", "Browser Time (UTC)");
    expect(formatDataAge(gt, { at }).full).toBe("Updated 05:12:07 · UTC");
  });
});

describe("formatRangeLength", () => {
  it("names a window in the largest unit it fills, short and spoken", () => {
    expect(formatRangeLength(gt, 3600)).toBe("1 h");
    expect(formatRangeLength(gt, 6 * 3600)).toBe("6 h");
    expect(formatRangeLength(gt, 7 * 86400)).toBe("7 d");
    expect(formatRangeLength(gt, 15 * 60)).toBe("15 min");
    expect(formatRangeLength(gt, 90 * 60)).toBe("1.5 h");
    expect(formatRangeLength(gt, 3600, { spoken: true })).toBe("1 hour");
    expect(formatRangeLength(gt, 6 * 3600, { spoken: true })).toBe("6 hours");
    expect(formatRangeLength(gt, 30, { spoken: true })).toBe("30 seconds");
  });
});
