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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseOffsetQuery,
  timezoneKeywords,
  timezoneMatchesQuery,
  timezoneSearchMatcher,
} from "./timezoneSearch";

const zones = Intl.supportedValuesOf("timeZone");

// Offset search follows today's offset, so every case runs in northern winter.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 0, 15, 12)));
});
afterAll(() => vi.useRealTimers());
const find = (query: string) => ["UTC", ...zones].filter((z) => timezoneMatchesQuery(z, query));

describe("parseOffsetQuery", () => {
  it.each([
    ["UTC+5:30", 330],
    ["utc+05:30", 330],
    ["GMT+5:30", 330],
    ["GMT + 05:30", 330],
    ["+5:30", 330],
    ["+0530", 330],
    ["+530", 330],
    ["UTC+5", 300],
    ["GMT-8", -480],
    ["UTC-08:00", -480],
    ["UTC", 0],
    ["gmt", 0],
  ])("reads %s as %i minutes", (query, minutes) => {
    expect(parseOffsetQuery(query)).toBe(minutes);
  });

  it("is null for names and out-of-range offsets", () => {
    expect(parseOffsetQuery("IST")).toBeNull();
    expect(parseOffsetQuery("Asia/Kolkata")).toBeNull();
    expect(parseOffsetQuery("+25")).toBeNull();
    expect(parseOffsetQuery("+5:75")).toBeNull();
  });
});

describe("timezoneMatchesQuery", () => {
  it("finds India by its abbreviation and every offset spelling", () => {
    for (const query of [
      "IST",
      "ist",
      "UTC+5:30",
      "UTC+05:30",
      "GMT+5:30",
      "GMT+05:30",
      "+5:30",
      "+0530",
    ]) {
      expect(find(query), query).toContain("Asia/Calcutta");
      expect(timezoneMatchesQuery("Asia/Kolkata", query), query).toBe(true);
    }
  });

  it("finds Los Angeles by standard and daylight abbreviations and its winter offset", () => {
    expect(find("PST")).toContain("America/Los_Angeles");
    expect(find("PDT")).toContain("America/Los_Angeles");
    expect(find("GMT-8")).toContain("America/Los_Angeles");
  });

  it("matches a typed offset against today's offset only, not the other season's", () => {
    expect(find("UTC-07:00")).not.toContain("America/Los_Angeles");
    expect(find("GMT-8")).not.toContain("America/Anchorage");
    expect(find("GMT-9")).toContain("America/Anchorage");
  });

  it("finds Central European zones by CET and CEST", () => {
    expect(find("CET")).toContain("Europe/Paris");
    expect(find("CEST")).toContain("Europe/Berlin");
  });

  it("treats a bare UTC or GMT as zero offset only", () => {
    const utc = find("UTC");
    expect(utc).toContain("UTC");
    expect(utc).toContain("Europe/London");
    expect(utc).not.toContain("Asia/Calcutta");
    expect(find("GMT")).toContain("UTC");
  });

  it("reads Etc/GMT+8 as the UTC-8 zone it is, not by its name", () => {
    expect(timezoneMatchesQuery("Etc/GMT+8", "GMT-8")).toBe(true);
    expect(timezoneMatchesQuery("Etc/GMT+8", "GMT+8")).toBe(false);
    expect(find("GMT+8")).toContain("Asia/Shanghai");
  });

  it("still matches names, legacy names and partly typed input", () => {
    expect(find("kolkata")).toContain("Asia/Calcutta");
    expect(find("new york")).toContain("America/New_York");
    expect(find("+5:3")).toContain("Asia/Calcutta");
    expect(find("xyzzy")).toEqual([]);
  });

  it("computes a zone's keywords once", () => {
    expect(timezoneKeywords("Asia/Tokyo")).toBe(timezoneKeywords("Asia/Tokyo"));
    expect(timezoneKeywords("Asia/Tokyo").abbreviations).toContain("jst");
  });
});

describe("timezoneSearchMatcher", () => {
  it("matches the visible label, but not an offset the label merely contains", () => {
    const browser = timezoneSearchMatcher("Asia/Kolkata", "Browser Time (Asia/Kolkata)");
    expect(browser("browser")).toBe(true);
    expect(browser("ist")).toBe(true);
    const tokyo = timezoneSearchMatcher("Asia/Tokyo", "Asia/Tokyo (UTC+09:00)");
    expect(tokyo("utc")).toBe(false);
    expect(tokyo("utc+9")).toBe(true);
  });
});
