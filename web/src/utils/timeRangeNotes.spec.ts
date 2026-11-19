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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { parseTimeInput, suggestTimeInput, type TimeInputOptions } from "./dateTimeRangeParse";
import { formatReadingNote, readingNote } from "./timeRangeNotes";

const NOW = new Date(Date.UTC(2026, 10, 11, 12, 41, 53));
const OPTS: TimeInputOptions = { now: NOW, locale: "en-US", timeZone: "UTC" };
const NY = "America/New_York";
const echo = ((key: string, named?: Record<string, unknown>) =>
  `${key} ${JSON.stringify(named ?? {})}`) as unknown as TranslateFn;

const noteOf = (text: string, timezone = "UTC") => {
  const reading = parseTimeInput(text, { ...OPTS, timeZone: timezone });
  return reading ? readingNote(reading, timezone) : null;
};

describe("readingNote", () => {
  it("names the epoch unit a bare number was read in [#31]", () => {
    expect(noteOf("1762437600")).toEqual({ kind: "epoch", unit: "s" });
    expect(noteOf("1762437600123456")).toEqual({ kind: "epoch", unit: "µs" });
  });

  it("names the zone the text was typed in [#34]", () => {
    expect(noteOf("yesterday 9-17 UTC", "Asia/Calcutta")).toEqual({
      kind: "typedZone",
      zone: "UTC",
    });
  });

  it("reads no fiscal year, so notes none, until the org sets its start (O4)", () => {
    expect(noteOf("FY26")).toBeNull();
  });

  it("says a skipped DST time was moved forward [#10]", () => {
    const note = noteOf("2026-03-08 02:30", NY);
    expect(note).toMatchObject({ kind: "dstGap", typed: "02:30", used: "03:30" });
  });

  it("says nothing for a plain reading", () => {
    expect(noteOf("15m")).toBeNull();
    expect(noteOf("Nov 4 - 6")).toBeNull();
  });

  it("names the day/month order of a flipped reading [P10]", () => {
    const [, flipped] = suggestTimeInput("12/11/2026", OPTS);
    expect(readingNote(flipped, "UTC")).toEqual({ kind: "dayOrder", order: "dayMonth" });
  });

  it("marks a future zone reading", () => {
    expect(readingNote({ type: "timestamp", startMicros: 0, endMicros: 1, future: true })).toEqual({
      kind: "future",
    });
  });
});

describe("formatReadingNote head line [V2]", () => {
  const t = i18n.global.t as unknown as TranslateFn;
  const headOf = (text: string, timezone: string) =>
    String(formatReadingNote(noteOf(text, timezone)!, t, "en-US", timezone));

  it("words a pasted UTC stamp as the zone it was typed in", () => {
    expect(headOf("2026-11-15T14:32:10.250Z", "Asia/Calcutta")).toBe("Typed in UTC");
  });

  it("words a typed zone the same way", () => {
    expect(headOf("yesterday 9-17 UTC", "Asia/Calcutta")).toBe("Typed in UTC");
    expect(String(formatReadingNote({ kind: "typedZone", zone: "Europe/Berlin" }, t))).toBe(
      "Typed in Europe/Berlin",
    );
  });
});

describe("formatReadingNote", () => {
  it.each([
    [{ kind: "epoch", unit: "µs" } as const, 'dateTime.readAsEpoch {"unit":"µs"}'],
    [{ kind: "utc" } as const, 'dateTime.typedInZoneHead {"zone":"UTC"}'],
    [{ kind: "typedZone", zone: "UTC" } as const, 'dateTime.typedInZoneHead {"zone":"UTC"}'],
    [{ kind: "future" } as const, "dateTime.inTheFuture {}"],
    [{ kind: "dayOrder", order: "dayMonth" } as const, "dateTime.readAsDayMonth {}"],
    [{ kind: "dayOrder", order: "monthDay" } as const, "dateTime.readAsMonthDay {}"],
  ])("words %j", (note, expected) => {
    expect(formatReadingNote(note, echo)).toBe(expected);
  });

  it("words a DST gap with the day in the zone", () => {
    const note = {
      kind: "dstGap",
      typed: "02:30",
      used: "03:30",
      dateUs: Date.parse("2026-03-08T07:30:00Z") * 1000,
    } as const;
    expect(formatReadingNote(note, echo, "en-US", NY)).toBe(
      'dateTime.dstGap {"typed":"02:30","date":"Mar 8","used":"03:30"}',
    );
  });
});
