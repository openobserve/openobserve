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
import type { TranslateFn } from "@/types/i18n";
import { parseTimeInput, type TimeInputOptions } from "./dateTimeRangeParse";
import {
  ANCHOR_WINDOWS,
  DEFAULT_ANCHOR_WINDOW,
  anchorRows,
  anchorWindowLabel,
  readingAnchorMicros,
} from "./timeRangeAnchor";

const NOW = new Date(Date.UTC(2026, 10, 12, 15, 54, 10));
const OPTS: TimeInputOptions = { now: NOW, locale: "en-US", timeZone: "UTC" };
const echo = ((key: string, named?: Record<string, unknown>) =>
  `${key} ${JSON.stringify(named ?? {})}`) as unknown as TranslateFn;
const us = (iso: string) => Date.parse(iso) * 1000;

describe("anchorRows [#31]", () => {
  it("lists ± 5 min, ± 1 min, ± 30 s, ± 5 s, then from here to now", () => {
    const centre = us("2026-11-12T15:43:49.948Z");
    const rows = anchorRows(centre, NOW.getTime() * 1000);
    expect(rows.map((row) => row.id)).toEqual(["5m", "1m", "30s", "5s", "to-now"]);
    expect(rows[2]).toEqual({
      id: "30s",
      startUs: centre - 30_000_000,
      endUs: centre + 30_000_000,
    });
    expect(rows[4]).toEqual({ id: "to-now", startUs: centre, endUs: NOW.getTime() * 1000 });
    expect(DEFAULT_ANCHOR_WINDOW).toBe(ANCHOR_WINDOWS[0].id);
  });

  it("offers no from-here-to-now row for an instant that is not in the past", () => {
    const rows = anchorRows(NOW.getTime() * 1000, NOW.getTime() * 1000);
    expect(rows.map((row) => row.id)).not.toContain("to-now");
  });
});

describe("readingAnchorMicros", () => {
  it("finds the instant of a pasted epoch, a stamp and a typed civil time", () => {
    const epoch = parseTimeInput("1762962229948", OPTS);
    const stamp = parseTimeInput("2026-11-12T15:43:49.948Z", OPTS);
    const civil = parseTimeInput("2026-11-12 21:13:49", OPTS);
    expect(epoch && readingAnchorMicros(epoch, "UTC")).toBe(1762962229948000);
    expect(stamp && readingAnchorMicros(stamp, "UTC")).toBe(us("2026-11-12T15:43:49.948Z"));
    expect(civil && readingAnchorMicros(civil, "Asia/Calcutta")).toBe(us("2026-11-12T15:43:49Z"));
  });

  it("is null for ranges and rolling periods", () => {
    for (const text of ["15m", "Nov 4 - 6", "yesterday 9-17"]) {
      const reading = parseTimeInput(text, OPTS);
      expect(reading && readingAnchorMicros(reading, "UTC")).toBeNull();
    }
  });
});

describe("anchorWindowLabel", () => {
  it.each([
    ["5m", 'dateTime.aroundMinutes {"n":5}'],
    ["1m", 'dateTime.aroundMinutes {"n":1}'],
    ["30s", 'dateTime.aroundSeconds {"n":30}'],
    ["to-now", "dateTime.fromHereToNow {}"],
  ] as const)("%s → %s", (id, expected) => {
    expect(anchorWindowLabel(id, echo)).toBe(expected);
  });
});
