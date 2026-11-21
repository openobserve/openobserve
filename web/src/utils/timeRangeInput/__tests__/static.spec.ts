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

import { posix } from "node:path";
import { describe, expect, it } from "vitest";

const sources = import.meta.glob<string>(["../**/*.ts", "!../__tests__/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function code(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (source[i] === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2) + 1;
    } else out += source[i];
  }
  return out;
}

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s+"([^"]+)"/g, /\bimport\s*\(\s*"([^"]+)"/g, /\bimport\s+"([^"]+)"/g]) {
    for (const m of source.matchAll(re)) out.push(m[1]);
  }
  for (const m of source.matchAll(/import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|"[^"]*")/g)) {
    for (const s of m[1].matchAll(/"!?([^"]+)"/g)) out.push(s[1]);
  }
  return out;
}

const BANNED: [string, RegExp][] = [
  ["new Date() or new Date(a, b, ...)", /new\s+Date\s*\(\s*(\)|[^)]*,)/],
  ["new Date(string)", /new\s+Date\s*\(\s*["'`]/],
  ["Date.now", /\bDate\.now\b/],
  ["Date.parse", /\bDate\.parse\b/],
  [
    "local date getters and setters",
    /\.(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
  ],
  ["getTimezoneOffset", /getTimezoneOffset/],
  ["toLocale*String on dates", /\.toLocale(Date|Time)?String\s*\(/],
  ["toDateString/toTimeString", /\.to(Date|Time)String\s*\(/],
  ["resolvedOptions", /resolvedOptions/],
  ["navigator", /\bnavigator\b/],
  ["Temporal.Now", /Temporal\.Now/],
];

describe("static ban", () => {
  it("scans every parser source", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(30);
  });

  for (const [file, source] of Object.entries(sources)) {
    it(`${file} imports only from inside timeRangeInput and uses no browser clock or zone`, () => {
      const dir = posix.dirname(file);
      for (const spec of specifiers(source)) {
        expect(spec.startsWith("./") || spec.startsWith("../"), `${file}: ${spec}`).toBe(true);
        const resolved = posix.normalize(posix.join("timeRangeInput/__tests__", dir, spec));
        expect(resolved.startsWith("timeRangeInput/"), `${file}: ${spec}`).toBe(true);
        expect(spec.includes("date-fns"), `${file}: ${spec}`).toBe(false);
      }
      const body = code(source);
      for (const [name, re] of BANNED) expect(re.test(body), `${file}: ${name}`).toBe(false);
      const made = [...body.matchAll(/new\s+Intl\.DateTimeFormat\b/g)].map((m) => m.index ?? 0);
      if (file !== "../zone.ts") {
        expect(/DateTimeFormat/.test(body), `${file}: DateTimeFormat outside formatterFor`).toBe(
          false,
        );
      } else {
        const from = body.indexOf("function formatterFor");
        const to = body.indexOf("\n}\n", from);
        expect(made.length).toBe(1);
        expect(made[0] > from && made[0] < to, "the one DateTimeFormat sits in formatterFor").toBe(
          true,
        );
      }
    });
  }
});
