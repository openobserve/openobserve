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

import { isZone, offsetAtInstant, offsetLabel } from "../zone";

const ZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Bangkok",
  "Asia/Ho_Chi_Minh",
  "Asia/Riyadh",
  "Asia/Tehran",
  "Asia/Kabul",
  "Asia/Colombo",
  "Australia/Lord_Howe",
  "Australia/Sydney",
  "Australia/Adelaide",
  "Australia/Eucla",
  "Pacific/Apia",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
  "Pacific/Honolulu",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Antarctica/Troll",
];

// Reference written independently of zone.ts: a fresh formatter per call, wall clock rebuilt in UTC.
function reference(zone: string, us: number): number {
  const ms = Math.floor(us / 1000);
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const get = (t: string) => Number(f.formatToParts(ms).find((p) => p.type === t)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 1000);
}

describe("offsetAtInstant", () => {
  it("matches a brute-force formatter reference for 40 zones across 1970..2255", () => {
    const start = Date.UTC(1970, 0, 1) * 1000;
    const end = Date.UTC(2255, 0, 1) * 1000;
    for (const zone of ZONES) {
      for (let i = 0; i <= 60; i++) {
        const us = start + Math.floor(((end - start) / 60) * i);
        expect(offsetAtInstant(zone, us), `${zone} ${us}`).toBe(reference(zone, us));
      }
    }
  });

  it("reads Lord Howe at 15:15Z and 15:45Z on 2026-10-03 in either order", () => {
    const a = Date.UTC(2026, 9, 3, 15, 15) * 1000;
    const b = Date.UTC(2026, 9, 3, 15, 45) * 1000;
    expect([
      offsetAtInstant("Australia/Lord_Howe", a),
      offsetAtInstant("Australia/Lord_Howe", b),
    ]).toEqual([37800, 39600]);
    expect([
      offsetAtInstant("Australia/Lord_Howe", b),
      offsetAtInstant("Australia/Lord_Howe", a),
    ]).toEqual([39600, 37800]);
  });

  it("keeps seconds-level historic offsets and prints them", () => {
    const us = Date.UTC(1850, 0, 1) * 1000;
    const seconds = offsetAtInstant("Europe/Amsterdam", us);
    expect(seconds).toBe(reference("Europe/Amsterdam", us));
    expect(seconds % 60).not.toBe(0);
    expect(offsetLabel(seconds)).toMatch(/^[+-]\d{2}:\d{2}:\d{2}$/);
    expect(offsetLabel(-12600)).toBe("-03:30");
  });
});

describe("zone formatter cache (fix brief U)", () => {
  it("accepts every ASCII case spelling and keeps answering after many distinct ones", () => {
    const name = "America/Argentina/ComodRivadavia";
    for (let i = 0; i < 300; i++) {
      const spelled = [...name]
        .map((c, j) => ((i >> (j % 9)) & 1 ? c.toUpperCase() : c.toLowerCase()))
        .join("");
      expect(isZone(spelled), spelled).toBe(true);
    }
    expect(offsetAtInstant("america/new_york", Date.UTC(2026, 0, 1) * 1000)).toBe(-5 * 3600);
  });

  it("caches failures without poisoning a valid spelling that folds alike outside ASCII", () => {
    expect(isZone("Asia/Kolkatx")).toBe(false);
    expect(isZone("Asia/Kolkatx")).toBe(false);
    expect(isZone("Asia/\u212Aolkata")).toBe(false);
    expect(isZone("Asia/Kolkata")).toBe(true);
    expect(isZone("Asia/\u212Aolkata")).toBe(false);
  });
});
