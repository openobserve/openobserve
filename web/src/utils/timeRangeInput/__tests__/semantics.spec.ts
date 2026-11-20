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

import { loadTimeRangeLocale, parseTimeRangeInput } from "../index";
import type { GeneratedTables, LocalePack } from "../packs/schema";
import type { TimeRangeParseResult } from "../types";
import { baseContext } from "./helpers";

const hands = import.meta.glob<{ pack: LocalePack; tables: GeneratedTables }>(
  ["../packs/*.ts", "!../packs/schema.ts"],
  {
    eager: true,
  },
);
const COUNTS = [1, 2, 3, 5, 11, 21, 22, 101, 1000];
const ZONE = "Asia/Tokyo";
const NOW_MS = Date.UTC(2026, 10, 17, 12, 0, 0);
const FIXED: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5 };

// Test-only reference: Tokyo has no DST, so civil maths is Date.UTC on the +09:00 wall clock.
function referenceStart(n: number, unit: string, nowMs: number): number {
  if (FIXED[unit]) return (nowMs - n * FIXED[unit]) * 1000;
  const wall = new Date(nowMs + 9 * 36e5);
  const y = wall.getUTCFullYear();
  const mo = wall.getUTCMonth();
  const d = wall.getUTCDate();
  const t = nowMs + 9 * 36e5 - Date.UTC(y, mo, d);
  if (unit === "d" || unit === "w")
    return (Date.UTC(y, mo, d - n * (unit === "w" ? 7 : 1)) + t - 9 * 36e5) * 1000;
  const months = unit === "y" ? 12 * n : n;
  const target = Date.UTC(y, mo - months, 1);
  const last = new Date(Date.UTC(y, mo - months + 1, 0)).getUTCDate();
  return (target + (Math.min(d, last) - 1) * 864e5 + t - 9 * 36e5) * 1000;
}

function concrete(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "(") {
      const close = pattern.indexOf(")", i);
      out += pattern.slice(i + 1, close).split("|")[0];
      i = close;
    } else out += pattern[i];
  }
  return out;
}

function startOf(r: TimeRangeParseResult): number | string {
  return r.state === "valid" ? r.reading.startUs : JSON.stringify(r).slice(0, 200);
}

describe("pattern semantics against a reference", () => {
  for (const { pack: hand } of Object.values(hands)) {
    it(`reads every lastN and ago pattern of ${hand.key} for every unit and count`, async () => {
      const pack = await loadTimeRangeLocale(hand.key);
      for (const pattern of [...hand.patterns.lastN, ...hand.patterns.ago]) {
        if (!pattern.includes("{n}")) continue;
        for (const [unit, words] of Object.entries(hand.units)) {
          const word = words?.[words.length - 1];
          if (!word) continue;
          for (const n of COUNTS) {
            if (unit === "y" && n > 21) continue;
            const text = concrete(pattern).replace("{n}", String(n)).replace("{unit}", word);
            const r = parseTimeRangeInput(
              baseContext(pack, text, new Date(NOW_MS).toISOString(), ZONE),
            );
            expect(startOf(r), text).toBe(referenceStart(n, unit, NOW_MS));
          }
        }
      }
    });

    it(`reads the generated ago templates of ${hand.key}`, async () => {
      const pack = await loadTimeRangeLocale(hand.key);
      const tables = Object.values(hands).find((h) => h.pack.key === hand.key)?.tables;
      for (const [unit, templates] of Object.entries(tables?.ago ?? {})) {
        for (const t of templates ?? []) {
          for (const n of [1, 2, 5, 21]) {
            const text = t.replace("{n}", String(n));
            const r = parseTimeRangeInput(
              baseContext(pack, text, new Date(NOW_MS).toISOString(), ZONE),
            );
            // A unit word two units share (es narrow `m`) asks: minutes or months.
            const starts =
              r.state === "ambiguous" ? r.readings.map((x) => x.startUs) : [startOf(r)];
            expect(starts, text).toContain(referenceStart(n, unit, NOW_MS));
          }
        }
      }
    });
  }

  it("reads day words at 00:00 plus and minus one microsecond", async () => {
    const pack = await loadTimeRangeLocale("en-us");
    const midnight = Date.UTC(2026, 10, 17) * 1000 - 9 * 36e8;
    const at = (nowUs: number, text: string) =>
      parseTimeRangeInput({ ...baseContext(pack, text, "2026-11-17T00:00:00Z", ZONE), nowUs });
    const after = at(midnight + 1, "today");
    expect(after.state === "valid" && [after.reading.startUs, after.reading.endUs]).toEqual([
      midnight,
      midnight + 1,
    ]);
    const before = at(midnight - 1, "today");
    expect(before.state === "valid" && [before.reading.startUs, before.reading.endUs]).toEqual([
      midnight - 864e8,
      midnight - 1,
    ]);
    const yesterday = at(midnight - 1, "yesterday");
    expect(
      yesterday.state === "valid" && [yesterday.reading.startUs, yesterday.reading.endUs],
    ).toEqual([midnight - 2 * 864e8, midnight - 864e8]);
  });

  it("gives a calendar token only to day words, never to typed dates or weekdays", async () => {
    const pack = await loadTimeRangeLocale("en-us");
    const kindOf = (text: string) => {
      const r = parseTimeRangeInput(baseContext(pack, text, "2026-11-17T12:00:00Z", "UTC"));
      return r.state === "valid" ? [r.reading.kind, r.reading.calendarToken, r.reading.name] : r;
    };
    for (const text of ["2026-11-10", "2026-11-17", "nov 10", "monday", "11/16/2026"])
      expect(kindOf(text), text).toEqual(["absolute", undefined, undefined]);
    expect(kindOf("yesterday")).toEqual(["calendar", "calendar:day:-1", "yesterday"]);
    expect(kindOf("today")).toEqual(["calendar", "calendar:day:0", "today"]);
  });

  it("clamps month subtraction to the month end and crosses a year boundary", async () => {
    const pack = await loadTimeRangeLocale("en-us");
    const nowMs = Date.UTC(2026, 2, 31, 3);
    const r = parseTimeRangeInput(
      baseContext(pack, "last 1 month", new Date(nowMs).toISOString(), ZONE),
    );
    expect(startOf(r)).toBe(referenceStart(1, "M", nowMs));
    const y = parseTimeRangeInput(baseContext(pack, "last 2 months", "2027-01-01T06:30:00Z", ZONE));
    expect(startOf(y)).toBe(referenceStart(2, "M", Date.UTC(2027, 0, 1, 6, 30)));
  });
});
