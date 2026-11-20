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

import { getInputExamples, loadTimeRangeLocale, parseTimeRangeInput } from "../index";
import type { ParseContext } from "../types";
import { ALL_LOCALES, isoUs } from "./helpers";

const HOSTS: [string, Omit<ParseContext, "text" | "pack">][] = [
  [
    "default",
    {
      nowUs: isoUs("2026-11-17T12:00:00Z"),
      zone: "Europe/Berlin",
      units: ["s", "m", "h", "d", "w", "M"],
      kinds: { relative: true, calendar: true, absolute: true },
      limits: { allowFuture: false },
    },
  ],
  [
    "restrictive",
    {
      nowUs: isoUs("2026-11-17T00:20:00Z"),
      zone: "Asia/Tokyo",
      units: ["m", "h", "d", "w", "M"],
      kinds: { relative: false, calendar: true, absolute: true },
      limits: { allowFuture: false, maxSpanUs: 3_600_000_000 },
    },
  ],
];

describe("getInputExamples", () => {
  for (const locale of ALL_LOCALES) {
    for (const [name, host] of HOSTS) {
      it(`gives only valid examples for ${locale} on the ${name} host`, async () => {
        const pack = await loadTimeRangeLocale(locale);
        const examples = getInputExamples({ ...host, pack });
        expect(examples.length).toBeGreaterThan(0);
        for (const text of examples)
          expect(parseTimeRangeInput({ ...host, pack, text }).state, text).toBe("valid");
      });
    }
  }
});

// examplesFor keys its memo on the local date and whole minutes from fixed bounds; that holds only while
// every example is a span ending now in whole minutes or hours, or a whole calendar day.
describe("example shapes", () => {
  for (const locale of ALL_LOCALES) {
    it(`keeps ${locale} examples to now-anchored m/h spans and calendar days`, async () => {
      const [, host] = HOSTS[0];
      const pack = await loadTimeRangeLocale(locale);
      for (const text of getInputExamples({ ...host, pack })) {
        const r = parseTimeRangeInput({ ...host, pack, text });
        if (r.state !== "valid") throw new Error(`${text}: ${r.state}`);
        const { kind, rolling, calendarToken, endUs } = r.reading;
        const ok =
          (kind === "rolling" &&
            ["m", "h"].includes(rolling?.unit ?? "") &&
            endUs === host.nowUs) ||
          (kind === "calendar" && calendarToken?.startsWith("calendar:day:") === true);
        expect(ok, text).toBe(true);
      }
    });
  }
});
