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
import { searchTimeZones, zoneSearchRank } from "./timeZoneSearch";

const ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone")];
const KOLKATA = ZONES.includes("Asia/Kolkata") ? "Asia/Kolkata" : "Asia/Calcutta";
// A winter instant, so New York is on EST and London on GMT.
const AT = Date.parse("2026-01-15T12:00:00Z");
const search = (query: string) => searchTimeZones(ZONES, query, undefined, AT);

describe("searchTimeZones [fresh#6]", () => {
  it.each(["IST", "india", "kolkata", "calcutta", "+5", "UTC+5", "5:30", "+05:30", "gmt+5:30"])(
    "finds the India zone first-class for %s",
    (query) => {
      const found = search(query);
      expect(found).toContain(KOLKATA);
      if (/^[a-z]/i.test(query) && !/\d/.test(query)) expect(found[0]).toBe(KOLKATA);
    },
  );

  it("puts the alias before names that merely contain the text", () => {
    expect(search("india")[0]).toBe(KOLKATA);
    expect(search("india").some((zone) => zone.startsWith("America/Indiana"))).toBe(true);
    expect(search("IST")[0]).toBe(KOLKATA);
  });

  it.each([
    ["PST", "America/Los_Angeles"],
    ["PDT", "America/Los_Angeles"],
    ["EST", "America/New_York"],
    ["edt", "America/New_York"],
    ["new york", "America/New_York"],
    ["New York", "America/New_York"],
    ["los angeles", "America/Los_Angeles"],
    ["GMT", "Europe/London"],
    ["utc", "UTC"],
  ])("finds %s as %s", (query, zone) => {
    expect(search(query)).toContain(zone);
    expect(search(query).indexOf(zone)).toBeLessThan(5);
  });

  it("reads a signed hour as an offset, never as the inverted Etc/GMT name", () => {
    const found = search("-8");
    expect(found).toContain("America/Los_Angeles");
    expect(found).not.toContain("Etc/GMT-8");
    expect(search("+5")).not.toContain("Etc/GMT+5");
  });

  it("narrows an hour by its minutes", () => {
    expect(zoneSearchRank(KOLKATA, "+5:30", AT)).toBe(3);
    expect(zoneSearchRank("Asia/Karachi", "+5:30", AT)).toBeNull();
    expect(zoneSearchRank("Asia/Karachi", "+5", AT)).toBe(3);
  });

  it.each([
    ["kolk", "Asia/Calcutta"],
    ["calc", "Asia/Kolkata"],
    ["beng", "Asia/Calcutta"],
    ["new y", "America/New_York"],
    ["san fr", "America/Los_Angeles"],
  ])("finds the zone a partial city %s names, under either name", (query, zone) => {
    const zones = ["UTC", "America/Indiana/Knox", zone];
    expect(searchTimeZones(zones, query, undefined, AT)[0]).toBe(zone);
  });

  it("keeps every option, in order, for an empty query", () => {
    expect(search("  ")).toEqual(ZONES);
  });

  it("maps a labelled option to its zone", () => {
    const options = [
      { label: "Browser Time", zone: KOLKATA },
      { label: "UTC", zone: "UTC" },
    ];
    expect(searchTimeZones(options, "india", (option) => option.zone, AT)).toEqual([options[0]]);
  });
});
