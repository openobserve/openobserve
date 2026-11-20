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
import type { TimeRangeLocale } from "../types";
import { baseContext, isoUs } from "./helpers";

const NOW = "2026-11-17T12:00:00Z";
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60_000_000],
  ["hour", 3_600_000_000],
];

async function check(locale: TimeRangeLocale, bcp47: string, counts: number[]): Promise<void> {
  const pack = await loadTimeRangeLocale(locale);
  for (const style of ["long", "short"] as const) {
    const rtf = new Intl.RelativeTimeFormat(`${bcp47}-u-nu-latn`, { numeric: "always", style });
    for (const [unit, size] of UNITS) {
      for (const n of counts) {
        const text = rtf.format(-n, unit);
        const r = parseTimeRangeInput(baseContext(pack, text, NOW, "UTC"));
        expect(r.state, `${locale} ${text}`).toBe("valid");
        if (r.state === "valid") expect(r.reading.endUs - r.reading.startUs, text).toBe(n * size);
      }
    }
  }
}

describe("Intl literal and plural forms", () => {
  it("reads Arabic one, two, few, many and other forms, including the numeral-free one and two", async () => {
    await check("ar", "ar-SA", [1, 2, 3, 11, 100]);
  });

  it("reads Arabic day forms", async () => {
    const pack = await loadTimeRangeLocale("ar");
    const rtf = new Intl.RelativeTimeFormat("ar-SA-u-nu-latn", { numeric: "always" });
    for (const n of [1, 2, 3, 11]) {
      const r = parseTimeRangeInput(baseContext(pack, rtf.format(-n, "day"), NOW, "UTC"));
      expect(r.state === "valid" && r.reading.endUs - r.reading.startUs).toBe(n * 86_400_000_000);
    }
  });

  it("reads unseen counts in ar, ru and pl", async () => {
    await check("ar", "ar-SA", [7, 23, 104]);
    await check("ru", "ru-RU", [7, 23, 104]);
    await check("pl", "pl-PL", [7, 23, 104]);
  });

  it("rejects a zero count", async () => {
    const pack = await loadTimeRangeLocale("ar");
    const r = parseTimeRangeInput(baseContext(pack, "قبل 0 دقيقة", NOW, "UTC"));
    expect(r.state).not.toBe("valid");
    expect(isoUs(NOW)).toBeGreaterThan(0);
  });
});
