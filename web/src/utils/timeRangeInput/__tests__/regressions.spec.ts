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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { examplesFor } from "../examples";
import { EN_US_TIME_RANGE_PACK, parseTimeRangeInput } from "../index";
import { normalize, textToRaw } from "../normalize";
import type { RangeLimits, TimeRangeParseResult, TimeRangeReading } from "../types";
import { baseContext, isoUs, LOCALE_KEYS, matches, packFor } from "./helpers";

const NOW = "2026-11-17T12:00:00Z";

async function valid(locale: string, text: string, zone: string): Promise<[number, number]> {
  const r = parseTimeRangeInput(baseContext(await packFor(locale), text, NOW, zone));
  if (r.state !== "valid") throw new Error(`${text}: ${JSON.stringify(r)}`);
  return [r.reading.startUs, r.reading.endUs];
}

// Inputs that an earlier prototype answered with a confident but wrong range.
describe("silent-wrong regressions", () => {
  it("reads Freitag as the most recent past Friday", async () => {
    expect(await valid("de-DE", "Freitag", "Europe/Berlin")).toEqual([
      isoUs("2026-11-13T00:00:00+01:00"),
      isoUs("2026-11-14T00:00:00+01:00"),
    ]);
  });

  it("reads Arabic-Indic digits in آخر ٥ دقائق", async () => {
    expect(await valid("ar-SA", "آخر ٥ دقائق", "Asia/Riyadh")).toEqual([
      isoUs("2026-11-17T14:55:00+03:00"),
      isoUs("2026-11-17T15:00:00+03:00"),
    ]);
  });

  it("reads laatste 2 uur as two hours", async () => {
    expect(await valid("nl-NL", "laatste 2 uur", "Europe/Amsterdam")).toEqual([
      isoUs("2026-11-17T11:00:00+01:00"),
      isoUs("2026-11-17T13:00:00+01:00"),
    ]);
  });

  it("reads the Thai Buddhist-era date 13/11/2569 as 2026-11-13 and keeps ISO Gregorian", async () => {
    expect(await valid("th-TH", "13/11/2569", "Asia/Bangkok")).toEqual([
      isoUs("2026-11-13T00:00:00+07:00"),
      isoUs("2026-11-14T00:00:00+07:00"),
    ]);
    expect(await valid("th-TH", "2026-11-13", "Asia/Bangkok")).toEqual([
      isoUs("2026-11-13T00:00:00+07:00"),
      isoUs("2026-11-14T00:00:00+07:00"),
    ]);
  });

  it("reads <ISO> bis <ISO> as the range, not a log line", async () => {
    expect(
      await valid("de-DE", "2026-11-16T09:00:00Z bis 2026-11-16T10:00:00Z", "Europe/Berlin"),
    ).toEqual([isoUs("2026-11-16T09:00:00Z"), isoUs("2026-11-16T10:00:00Z")]);
  });

  it.each([
    "2026-11-16 09:12:33 -0500",
    "2026-11-16 09:12:33 -05:00",
    "2026-11-16 09:12:33 -0500 GET /api",
    "2026-11-16 09:12:33 -05:00 GET /api",
  ])("keeps the negative offset after a space in %s", async (text) => {
    const [start, end] = await valid("en-US", text, "UTC");
    expect((start + end) / 2).toBe(isoUs("2026-11-16T14:12:33Z"));
  });

  it("reads a spaced dash before an hour above 14 as a range, and up to 14 as an offset", async () => {
    expect(await valid("en-US", "2026-11-16 09:00 -17:00", "UTC")).toEqual([
      isoUs("2026-11-16T09:00:00Z"),
      isoUs("2026-11-16T17:00:00Z"),
    ]);
    const [start, end] = await valid("en-US", "2026-11-16 09:00 -11:30", "UTC");
    expect((start + end) / 2).toBe(isoUs("2026-11-16T20:30:00Z"));
  });

  it.each(["3+4", "today 5+3", "today 5 +0300"])(
    "gives a bare digit hour in %s no signed offset",
    async (text) => {
      const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, "UTC"));
      expect(r.state, JSON.stringify(r)).toBe("invalid");
    },
  );

  // Spaced `-hh:mm` after a stamp: an offset only in the real range -12:00..-00:30 with minutes 00/30/45.
  it.each([
    ["-12:00", "offset", "2026-11-16T21:00:00Z"],
    ["-11:30", "offset", "2026-11-16T20:30:00Z"],
    ["-03:30", "offset", "2026-11-16T12:30:00Z"],
    ["-00:30", "offset", "2026-11-16T09:30:00Z"],
    ["-12:30", "range", "2026-11-16T12:30:00Z"],
    ["-13:00", "range", "2026-11-16T13:00:00Z"],
    ["-14:00", "range", "2026-11-16T14:00:00Z"],
    ["-17:00", "range", "2026-11-16T17:00:00Z"],
    ["-03:17", "invalid", ""],
    ["-00:00", "invalid", ""],
  ])("reads 2026-11-16 09:00 %s as %s", async (suffix, kind, at) => {
    const text = `2026-11-16 09:00 ${suffix}`;
    const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, "UTC"));
    if (kind === "invalid") {
      expect(r.state, JSON.stringify(r)).toBe("invalid");
      return;
    }
    if (r.state !== "valid") throw new Error(`${text}: ${JSON.stringify(r)}`);
    const window = r.reading.notes.find((n) => n.kind === "instant-window");
    if (kind === "offset")
      expect(window?.kind === "instant-window" && window.instantUs).toBe(isoUs(at));
    else
      expect([r.reading.startUs, r.reading.endUs]).toEqual([
        isoUs("2026-11-16T09:00:00Z"),
        isoUs(at),
      ]);
  });

  it.each([
    ["2026-11-16 14:30:00-05", "2026-11-16T19:30:00Z", "UTC"],
    ["2026-11-16T03:00:00-05", "2026-11-16T08:00:00Z", "UTC"],
    ["2026-11-16 09:00 -0000", "2026-11-16T09:00:00Z", "Europe/Berlin"],
    ["2026-11-16 09:00:00.5-05", "2026-11-16T14:00:00.500Z", "UTC"],
    ["Nov 16, 2026 14:30:00-05", "2026-11-16T19:30:00Z", "UTC"],
    ["Nov 16, 2026 14:30:00 -05:00", "2026-11-16T19:30:00Z", "UTC"],
    ["Nov 16 09:12:33-11", "2026-11-16T20:12:33Z", "UTC"],
    ["2026-11-16 03:00:00,123-05", "2026-11-16T08:00:00.123Z", "UTC"],
  ])("reads the offset of %s, not a range or the picker zone", async (text, at, zone) => {
    const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, zone));
    if (r.state !== "valid") throw new Error(`${text}: ${JSON.stringify(r)}`);
    const window = r.reading.notes.find((n) => n.kind === "instant-window");
    expect(window?.kind === "instant-window" && window.instantUs).toBe(isoUs(at));
    expect(r.reading.notes.some((n) => n.kind === "converted")).toBe(true);
  });

  it("reads an unspaced 2026-11-16 09:00-13:00 as a range", async () => {
    expect(await valid("en-US", "2026-11-16 09:00-13:00", "UTC")).toEqual([
      isoUs("2026-11-16T09:00:00Z"),
      isoUs("2026-11-16T13:00:00Z"),
    ]);
  });

  // An unspaced hour-only tail after a stamp without seconds is a range end, whatever the hour.
  it.each([
    ["2026-11-16 09:00-11", "2026-11-16T11:00:00Z"],
    ["2026-11-16 09:00-12", "2026-11-16T12:00:00Z"],
    ["2026-11-16 09:00-13", "2026-11-16T13:00:00Z"],
  ])("reads the unspaced hour tail of %s as a range end", async (text, end) => {
    expect(await valid("en-US", text, "UTC")).toEqual([isoUs("2026-11-16T09:00:00Z"), isoUs(end)]);
  });

  it.each(["2026-11-16 09:00-5", "2026-11-16 09:00:00-5"])(
    "reads no one-digit offset in %s",
    async (text) => {
      const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, "UTC"));
      expect(r.state, JSON.stringify(r)).toBe("invalid");
    },
  );

  // Every stamp form crossed with every minus tail; O is the instant at that offset, R the range to its hour.
  const TAILS = ["-05", "-0500", "-05:00", "-5", "-11:00", "-17:00"];
  it.each([
    ["2026-11-16T03:00", "2026-11-16T03:00:00Z", "OOOROR|ROOROR"],
    ["2026-11-16 03:00", "2026-11-16T03:00:00Z", "ROOROR|ROOROR"],
    ["2026-11-16T03:00:00", "2026-11-16T03:00:00Z", "OOOROR|ROOROR"],
    ["2026-11-16 03:00:00", "2026-11-16T03:00:00Z", "OOOROR|ROOROR"],
    ["2026-11-16 03:00:00.5", "2026-11-16T03:00:00.500Z", "OOOROR|ROOROR"],
    ["2026-11-16 03:00:00,5", "2026-11-16T03:00:00.500Z", "OOOROR|ROOROR"],
    ["Nov 16, 2026 03:00", "2026-11-16T03:00:00Z", "RORRRR|RORRRR"],
    ["Nov 16, 2026 03:00:00", "2026-11-16T03:00:00Z", "OOOROR|ROOROR"],
    ["Nov 16 03:00:00", "2026-11-16T03:00:00Z", "OOOROR|ROOROR"],
    ["nov 16 3:00", "2026-11-16T03:00:00Z", "RORRRR|RORRRR"],
    ["16 nov 2026 03:00", "2026-11-16T03:00:00Z", "RORRRR|RORRRR"],
    ["11/16/2026 03:00", "2026-11-16T03:00:00Z", "RORRRR|RORRRR"],
    ["03:00", "2026-11-17T03:00:00Z", "RORRRR|RORRRR"],
    ["today 03:00", "2026-11-17T03:00:00Z", "RORRRR|RORRRR"],
  ])("offset grammar after %s", async (host, start, codes) => {
    const pack = await packFor("en-US");
    const [unspaced, spaced] = codes.split("|");
    const got: string[] = [];
    const want: string[] = [];
    for (const [gap, row] of [
      ["", unspaced],
      [" ", spaced],
    ]) {
      TAILS.forEach((tail, i) => {
        const r = parseTimeRangeInput(
          baseContext(pack, `${host}${gap}${tail}`, "2026-11-17T20:00:00Z", "UTC"),
        );
        const hours = Number(tail.slice(1, tail.length === 2 ? 2 : 3));
        const window =
          r.state === "valid" && r.reading.notes.find((n) => n.kind === "instant-window");
        got.push(
          `${gap}${tail} ${
            r.state !== "valid"
              ? r.state
              : window && window.kind === "instant-window"
                ? `O ${window.instantUs}`
                : `R ${r.reading.startUs} ${r.reading.endUs}`
          }`,
        );
        want.push(
          `${gap}${tail} ${
            row[i] === "O"
              ? `O ${isoUs(start) + hours * 3_600_000_000}`
              : `R ${isoUs(start)} ${isoUs(`${start.slice(0, 11)}${String(hours).padStart(2, "0")}:00:00Z`)}`
          }`,
        );
      });
    }
    expect(got).toEqual(want);
  });

  it.each([
    ["2026-11-16 09:00:00-05 ERROR x", "O", "2026-11-16T14:00:00Z"],
    ["2026-11-16T09:00-05 ERROR x", "invalid", ""],
    ["Nov 16 09:12:33-05 sshd[1]: x", "O", "2026-11-16T14:12:33Z"],
    ["2026-11-16 09:00-11 ERROR x", "invalid", ""],
    ["2026-11-16 03:00:00-05 to 2026-11-16 04:00:00-05", "R", "2026-11-16T08:00:00Z"],
    ["2026-11-16T03:00-05 to 2026-11-16T04:00-05", "R", "2026-11-16T08:00:00Z"],
    ["2026-11-16 03:00-05 to 2026-11-16 04:00-05", "invalid", ""],
    ["2026-11-16 03:00-5 to 2026-11-16 04:00-5", "invalid", ""],
  ])(
    "reads the minus tail of %s as the grammar says on the log-line and range paths",
    async (text, kind, at) => {
      const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, "UTC"));
      if (kind === "invalid") {
        expect(r.state, JSON.stringify(r)).toBe("invalid");
        return;
      }
      if (r.state !== "valid") throw new Error(`${text}: ${JSON.stringify(r)}`);
      const window = r.reading.notes.find((n) => n.kind === "instant-window");
      if (kind === "O")
        expect(window?.kind === "instant-window" && window.instantUs).toBe(isoUs(at));
      else
        expect([r.reading.startUs, r.reading.endUs]).toEqual([
          isoUs(at),
          isoUs(at) + 3_600_000_000,
        ]);
    },
  );

  it.each([
    ["nov 16 9:00-11:00", "2026-11-16T09:00:00Z", "2026-11-16T11:00:00Z"],
    ["Nov 16 09:00-11:00", "2026-11-16T09:00:00Z", "2026-11-16T11:00:00Z"],
    ["Nov 16, 2026 09:00-10:30", "2026-11-16T09:00:00Z", "2026-11-16T10:30:00Z"],
  ])("reads the hand-typed month-name range %s as a range", async (text, start, end) => {
    expect(await valid("en-US", text, "UTC")).toEqual([isoUs(start), isoUs(end)]);
  });

  it.each(["today 10:00+02", "11/16/2026 10:00+2", "today 10:00 +02"])(
    "reads the plus offset in %s",
    async (text) => {
      const [start, end] = await valid("en-US", text, "UTC");
      const day = text.startsWith("today") ? "2026-11-17" : "2026-11-16";
      expect((start + end) / 2).toBe(isoUs(`${day}T08:00:00Z`));
    },
  );

  it("reads a spaced ` - ` after a stamp as a range join, not an offset", async () => {
    expect(await valid("en-US", "2026-11-16 09:00 - 10:00", "UTC")).toEqual([
      isoUs("2026-11-16T09:00:00Z"),
      isoUs("2026-11-16T10:00:00Z"),
    ]);
  });

  it.each([
    ["en-US", "a", "incomplete"],
    ["en-US", "an", "incomplete"],
    ["en-US", "A", "incomplete"],
    ["en-US", "at a", "incomplete"],
    ["en-US", "yesterday at a", "incomplete"],
    ["en-US", "a nov", "invalid"],
    ["de-DE", "ein", "incomplete"],
    ["de-DE", "um ein", "incomplete"],
    ["nl-NL", "een", "incomplete"],
    ["fr-FR", "à", "incomplete"],
    ["fr-FR", "hier à", "incomplete"],
    ["pt-PT", "hoje à", "incomplete"],
  ])(
    "does not read the %s article in %s as a number of the clock or date",
    async (locale, text, state) => {
      for (const now of [NOW, "2026-11-17T14:00:00Z"]) {
        const r = parseTimeRangeInput(baseContext(await packFor(locale), text, now, "UTC"));
        expect(r.state, JSON.stringify(r)).toBe(state);
      }
    },
  );

  it.each(["van één tot drie", "van Eén tot drie", "van ÉÉN tot drie"])(
    "keeps the accented Dutch numeral in %s as an hour",
    async (text) => {
      const pack = await packFor("nl-NL");
      const r = parseTimeRangeInput(baseContext(pack, text, NOW, "UTC"));
      expect(r.state === "valid" && span(r.reading), JSON.stringify(r)).toEqual([
        isoUs("2026-11-17T01:00:00Z"),
        isoUs("2026-11-17T03:00:00Z"),
      ]);
    },
  );

  it("still reads an article as the hour inside a clock affix", async () => {
    const pack = await packFor("de-DE");
    const r = parseTimeRangeInput(baseContext(pack, "gestern um ein Uhr", NOW, "Europe/Berlin"));
    expect(r.state === "ambiguous" && r.reason).toBe("am-pm");
    expect(r.state === "ambiguous" && r.readings[0].notes[0]).toEqual({
      kind: "instant-window",
      instantUs: isoUs("2026-11-16T01:00:00+01:00"),
      halfWidthUs: 300_000_000,
    });
  });

  it("still reads a count article in a phrase", async () => {
    expect(await valid("en-US", "an hour ago", "UTC")).toEqual([
      isoUs("2026-11-17T11:00:00Z"),
      isoUs("2026-11-17T12:00:00Z"),
    ]);
  });

  it.each([
    ["11/16/99", "1999-11-16T00:00:00Z"],
    ["11/16/26", "2026-11-16T00:00:00Z"],
    ["11/16/70", "1970-11-16T00:00:00Z"],
  ])("reads the two-digit year in %s inside [Y-80, Y+19]", async (text, start) => {
    const [s] = await valid("en-US", text, "UTC");
    expect(s).toBe(isoUs(start));
  });

  it.each([
    ["11/18/26", "2026-11-18T00:00:00Z"],
    ["11/16/45", "2045-11-16T00:00:00Z"],
  ])(
    "blocks a two-digit year in %s that lands after today, never moving it back",
    async (text, start) => {
      const r = parseTimeRangeInput(baseContext(await packFor("en-US"), text, NOW, "UTC"));
      expect(r.state === "blocked" && [r.reason, r.reading.startUs]).toEqual([
        "future",
        isoUs(start),
      ]);
    },
  );

  it.each([
    ["13/11/69", "2026-11-13T00:00:00+07:00"],
    ["13/11/26", "1983-11-13T00:00:00+07:00"],
  ])(
    "reads the Thai two-digit year in %s as Buddhist era in the same window",
    async (text, start) => {
      const [s] = await valid("th-TH", text, "Asia/Bangkok");
      expect(s).toBe(isoUs(start));
    },
  );

  it("maps CST to America/Chicago, as the US abbreviation table in the design says", async () => {
    const [start, end] = await valid("zh-CN", "2026-11-16 09:00:00 CST", "Asia/Shanghai");
    expect((start + end) / 2).toBe(isoUs("2026-11-16T09:00:00-06:00"));
  });

  it.each([
    ["9am to 5", "2026-11-17T09:00:00Z", "2026-11-17T17:00:00Z"],
    ["10am-2", "2026-11-17T10:00:00Z", "2026-11-17T14:00:00Z"],
    ["9am to 11", "2026-11-17T09:00:00Z", "2026-11-17T11:00:00Z"],
    ["9am to 12", "2026-11-17T09:00:00Z", "2026-11-17T12:00:00Z"],
    ["11am to 12:30", "2026-11-17T11:00:00Z", "2026-11-17T12:30:00Z"],
    ["yesterday from 9am to 5", "2026-11-16T09:00:00Z", "2026-11-16T17:00:00Z"],
  ])("reads the bare end hour of %s after the start", async (text, start, end) => {
    const r = parseTimeRangeInput(
      baseContext(await packFor("en-US"), text, "2026-11-17T20:00:00Z", "UTC"),
    );
    expect(r.state === "valid" && [r.reading.startUs, r.reading.endUs]).toEqual([
      isoUs(start),
      isoUs(end),
    ]);
  });

  // The whole domain of the end-hour rule: only a bare unpadded 1-11 end without its own date takes the
  // start's day part, flipping to the afternoon when that would reverse; every other end is literal.
  it.each([
    ["9am to 5", "2026-11-17T09:00:00Z", "2026-11-17T17:00:00Z"],
    ["10am-2", "2026-11-17T10:00:00Z", "2026-11-17T14:00:00Z"],
    ["8am to 1", "2026-11-17T08:00:00Z", "2026-11-17T13:00:00Z"],
    ["9am to 11", "2026-11-17T09:00:00Z", "2026-11-17T11:00:00Z"],
    ["9pm to 11", "2026-11-17T21:00:00Z", "2026-11-17T23:00:00Z"],
    ["yesterday from 9am to 5", "2026-11-16T09:00:00Z", "2026-11-16T17:00:00Z"],
    ["9am to 12", "2026-11-17T09:00:00Z", "2026-11-17T12:00:00Z"],
    ["9am to 13", "2026-11-17T09:00:00Z", "2026-11-17T13:00:00Z"],
    ["9am to 5pm", "2026-11-17T09:00:00Z", "2026-11-17T17:00:00Z"],
    ["nov 16 9am to nov 17 06:30", "2026-11-16T09:00:00Z", "2026-11-17T06:30:00Z"],
    ["yesterday 10pm to 2026-11-17 06:30", "2026-11-16T22:00:00Z", "2026-11-17T06:30:00Z"],
    ["from 3 in the afternoon to 7", "2026-11-17T15:00:00Z", "2026-11-17T19:00:00Z"],
    ["9am to 5 yesterday", null, null],
    ["9am to 05", null, null],
    ["9am to 5:00", null, null],
    ["9am to 05:00", null, null],
    ["9am to 00:30", null, null],
    ["9am to 0", null, null],
    ["9am to 5am", null, null],
    ["9pm to 10:00", null, null],
    ["9pm to 5", null, null],
    ["09:00 to 5", null, null],
  ])("end-hour rule: %s", async (text, start, end) => {
    const pack = await packFor("en-US");
    const r = parseTimeRangeInput(baseContext(pack, text, "2026-11-17T23:30:00Z", "UTC"));
    if (start === null || end === null) {
      expect(r.state, JSON.stringify(r)).toBe("invalid");
      return;
    }
    expect(r.state === "valid" && [r.reading.startUs, r.reading.endUs], JSON.stringify(r)).toEqual([
      isoUs(start),
      isoUs(end),
    ]);
  });

  // A night day part cannot hold the end hour; an end already after the start keeps its typed hour.
  it.each([
    [
      "ja-JP",
      "深夜1時から5時",
      "Asia/Tokyo",
      "2026-11-18T01:00:00+09:00",
      "2026-11-18T05:00:00+09:00",
    ],
    ["de-DE", "von 2 Uhr nachts bis 7 Uhr", "UTC", "2026-11-17T02:00:00Z", "2026-11-17T07:00:00Z"],
    ["ru-RU", "с 2 ночи до 6", "UTC", "2026-11-17T02:00:00Z", "2026-11-17T06:00:00Z"],
    [
      "de-DE",
      "von 2 Uhr nachts bis sieben Uhr",
      "UTC",
      "2026-11-17T02:00:00Z",
      "2026-11-17T07:00:00Z",
    ],
  ])("end-hour rule after a night start: %s %s", async (locale, text, zone, start, end) => {
    const pack = await packFor(locale);
    const r = parseTimeRangeInput(baseContext(pack, text, "2026-11-17T23:30:00Z", zone));
    expect(r.state === "valid" && [r.reading.startUs, r.reading.endUs], JSON.stringify(r)).toEqual([
      isoUs(start),
      isoUs(end),
    ]);
  });
});

async function run(
  locale: string,
  text: string,
  now: string,
  zone = "UTC",
  limits: RangeLimits = { allowFuture: false },
): Promise<TimeRangeParseResult> {
  return parseTimeRangeInput({
    ...baseContext(await packFor(locale), text, now, zone),
    limits,
  });
}

function span(r: TimeRangeReading): [number, number] {
  return [r.startUs, r.endUs];
}

function center(r: TimeRangeParseResult): number | null {
  return r.state === "valid" ? (r.reading.startUs + r.reading.endUs) / 2 : null;
}

function spans(r: TimeRangeParseResult): [number, number][] {
  return r.state === "ambiguous" ? r.readings.map(span) : [];
}

const FUTURE: RangeLimits = { allowFuture: true };
const GENERATOR = readFileSync(
  join(__dirname, "../../../../scripts/gen-time-range-intl.mjs"),
  "utf8",
);
const TYPES = readFileSync(join(__dirname, "../types.ts"), "utf8");

// Repro inputs of the post-loop code, security and performance reviews (fix brief items A-Z).
describe("post-loop review fixes", () => {
  it("A: rolls a year-less stamp back by its instant, not its wall clock", async () => {
    const at = "2026-11-19T12:00:00Z";
    expect(center(await run("en-US", "Nov 19 13:00:00 +0200", at))).toBe(
      isoUs("2026-11-19T11:00:00Z"),
    );
    expect(center(await run("en-US", "Nov 19 13:00:00", at))).toBe(isoUs("2025-11-19T13:00:00Z"));
    const log = await run("en-US", "Nov 17 13:00:00 +0200 daemon", "2026-11-17T12:00:00Z");
    expect(center(log)).toBe(isoUs("2026-11-17T11:00:00Z"));
  });

  it("B: an ISO start with a missing or broken end is a range, never a log line", async () => {
    expect((await run("en-US", "2026-11-16T09:00:00Z to", NOW)).state).toBe("incomplete");
    expect((await run("en-US", "2026-11-16T09:00:00Z to 25:00", NOW)).state).toBe("invalid");
    const broken = "2025-01-01T00:00:00Z to 2025-01-02T25:00:00Z";
    expect((await run("en-US", broken, NOW)).state).toBe("invalid");
    expect((await run("en-US", "2026-11-16 09:12:33 - INFO started", NOW)).state).toBe("invalid");
  });

  it.each([
    ["ja-JP", "1時 JST", "1時 Asia/Tokyo", "2026-11-17T20:00:00Z"],
    ["ko-KR", "1시 KST", "1시 Asia/Seoul", "2026-11-17T20:00:00Z"],
    ["en-US", "09:00+14:00", "09:00 Pacific/Kiritimati", "2026-11-19T12:00:00Z"],
    ["en-US", "09:00 UTC-05:00", "09:00 America/Bogota", "2026-11-19T22:00:00Z"],
  ])("C: %s %s takes today in its own offset, like %s", async (locale, fixed, iana, at) => {
    const a = center(await run(locale, fixed, at, "UTC", FUTURE));
    expect(a).not.toBeNull();
    expect(a).toBe(center(await run(locale, iana, at, "UTC", FUTURE)));
  });

  it.each([
    ["de-DE", "gestern 24 Uhr"],
    ["en-US", "yesterday at 24"],
    ["fr-FR", "hier 24 heures"],
  ])("D: hour 24 in %s %s carries to the next day", async (locale, text) => {
    expect(center(await run(locale, text, NOW))).toBe(isoUs("2026-11-17T00:00:00Z"));
  });

  it("D: a bare 24h shorthand stays the last 24 hours", async () => {
    const r = await run("fr-FR", "24h", NOW);
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2026-11-16T12:00:00Z"),
      isoUs(NOW),
    ]);
  });

  it("E: now-1d to now asks across a repeated hour, like bare now-1d", async () => {
    const at = "2026-11-02T06:30:00Z";
    const range = await run("en-US", "now-1d to now", at, "America/New_York");
    const bare = await run("en-US", "now-1d", at, "America/New_York");
    expect(range.state === "ambiguous" && range.reason).toBe("repeated-hour");
    expect(spans(range)).toEqual(spans(bare));
    expect(spans(range).map(([s]) => s)).toEqual([
      isoUs("2026-11-01T05:30:00Z"),
      isoUs("2026-11-01T06:30:00Z"),
    ]);
  });

  it.each([
    ["2026-04-04T15:15:00Z", "2026-04-04T14:00:00Z"],
    ["2026-10-03T15:40:00Z", "2026-10-03T15:30:00Z"],
  ])("F: now/h at %s in Lord Howe starts at the true hour start", async (at, start) => {
    const r = await run("en-US", "now/h", at, "Australia/Lord_Howe");
    expect(r.state === "valid" && r.reading.startUs).toBe(isoUs(start));
  });

  it("G: rejects week 53 in a 52-week year and keeps it in a 53-week year", async () => {
    expect((await run("en-US", "2025-W53", NOW)).state).toBe("invalid");
    const r = await run("en-US", "2020-W53", NOW);
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2020-12-28T00:00:00Z"),
      isoUs("2021-01-04T00:00:00Z"),
    ]);
  });

  it("H: a UTC-hh:mm suffix is an offset, never a range end", async () => {
    expect(center(await run("en-US", "2026-11-16 03:00 UTC-05:00", NOW))).toBe(
      isoUs("2026-11-16T08:00:00Z"),
    );
    const r = await run(
      "en-US",
      "2026-11-16T23:00:00-05:00 to 23:30 UTC-05:00",
      "2026-11-19T12:00:00Z",
    );
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2026-11-17T04:00:00Z"),
      isoUs("2026-11-17T04:30:00Z"),
    ]);
  });

  it("H (F41): an attached -hh:mm reads as an offset when another join splits the range", async () => {
    const r = await run("en-US", "today 09:00-05:00 to today 10:00-05:00", NOW, "UTC", FUTURE);
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2026-11-17T14:00:00Z"),
      isoUs("2026-11-17T15:00:00Z"),
    ]);
    for (const [text, start, end] of [
      ["today 9:00-10:00", "2026-11-17T09:00:00Z", "2026-11-17T10:00:00Z"],
      ["Nov 16 9:00-11:00", "2026-11-16T09:00:00Z", "2026-11-16T11:00:00Z"],
    ]) {
      const range = await run("en-US", text, NOW);
      expect(range.state === "valid" && span(range.reading), text).toEqual([
        isoUs(start),
        isoUs(end),
      ]);
    }
  });

  it("H (F42): a short -hh after a phrase clock with seconds is an offset, as after an ISO stamp", async () => {
    for (const text of ["11/16/2026 03:00:00-05", "2026-11-16 03:00:00-05"]) {
      expect(center(await run("en-US", text, NOW)), text).toBe(isoUs("2026-11-16T08:00:00Z"));
    }
  });

  it.each([
    ["ja-JP", "Asia/Tokyo", "2026-01-05T00:00:00+09:00"],
    ["zh-CN", "Asia/Shanghai", "2026-01-05T00:00:00+08:00"],
    ["ko-KR", "Asia/Seoul", "2026-01-05T00:00:00+09:00"],
  ])("I: %s reads its native numeric date 2026/1/5", async (locale, zone, start) => {
    const r = await run(locale, "2026/1/5", NOW, zone);
    expect(r.state === "valid" && r.reading.startUs).toBe(isoUs(start));
  });

  it("J: strips Arabic direction marks inside a numeric date only", async () => {
    const r = await run(
      "ar-SA",
      "\u0661\u0666\u200f/\u0661\u0661\u200f/\u0662\u0660\u0662\u0666",
      NOW,
      "Asia/Riyadh",
    );
    expect(r.state === "valid" && r.reading.startUs).toBe(isoUs("2026-11-16T00:00:00+03:00"));
    for (const text of ["\u200f16/11/2026", "16\u202e/11/2026", "16/11/2026\u200f"]) {
      expect((await run("ar-SA", text, NOW, "Asia/Riyadh")).state, text).toBe("invalid");
    }
  });

  it("K: the generator pins the Gregorian calendar on every date formatter", () => {
    const calls = GENERATOR.split("new Intl.DateTimeFormat(").slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.slice(0, call.indexOf("})")), call).toMatch(/calendar/);
  });

  it("L: a rolling max-span fix starts where typing its label starts", async () => {
    const limits = { allowFuture: false, maxSpanUs: 86_400_000_000 };
    const spring = "2026-03-08T18:00:00Z";
    const r = await run("en-US", "last 3 days", spring, "America/New_York", limits);
    const typed = await run("en-US", "1d", spring, "America/New_York");
    expect(r.state === "blocked" && r.fix?.rolling).toEqual({ value: 1, unit: "d" });
    expect(r.state === "blocked" && r.fix && span(r.fix)).toEqual(
      typed.state === "valid" && span(typed.reading),
    );
    const fall = await run(
      "en-US",
      "last 3 days",
      "2026-11-01T18:00:00Z",
      "America/New_York",
      limits,
    );
    expect(fall.state === "blocked" && [fall.fix?.rolling, fall.fix?.fixedToNow]).toEqual([
      undefined,
      true,
    ]);
  });

  it("M: 2/29 without a year is the most recent February 29", async () => {
    const r = await run("en-US", "2/29", NOW);
    expect(r.state === "valid" && r.reading.startUs).toBe(isoUs("2024-02-29T00:00:00Z"));
  });

  it("N: a word end hour after a dated start reads like its digit", async () => {
    const word = await run("en-US", "11/12/2026 1am to three", NOW);
    expect(word.state === "ambiguous" && word.reason).toBe("day-month-order");
    expect(spans(word)).toEqual(spans(await run("en-US", "11/12/2026 1am to 3", NOW)));
  });

  it("O: a malformed Chinese numeral is invalid, never a shorter number", async () => {
    expect((await run("zh-CN", "过去二十三十四分钟", NOW)).state).toBe("invalid");
    const r = await run("zh-CN", "过去二十三分钟", NOW);
    expect(r.state === "valid" && r.reading.rolling).toEqual({ value: 23, unit: "m" });
  });

  it.each(["fr-FR", "es-ES", "pt-PT", "vi-VN"])(
    "P: %s bare 15h asks clock or duration",
    async (locale) => {
      const r = await run(locale, "15h", NOW, "UTC", FUTURE);
      expect(r.state === "ambiguous" && r.reason).toBe("bare-duration");
      expect(spans(r)).toEqual([
        [isoUs("2026-11-16T21:00:00Z"), isoUs(NOW)],
        [isoUs("2026-11-17T14:55:00Z"), isoUs("2026-11-17T15:05:00Z")],
      ]);
    },
  );

  it("P: en-US 15h stays the last 15 hours", async () => {
    const r = await run("en-US", "15h", NOW);
    expect(r.state === "valid" && r.reading.rolling).toEqual({ value: 15, unit: "h" });
  });

  it("Q: since 5 asks am or pm, like since five", async () => {
    const at = "2026-11-17T20:00:00Z";
    const digit = await run("en-US", "since 5", at);
    expect(digit.state === "ambiguous" && digit.reason).toBe("am-pm");
    expect(spans(digit)).toEqual(spans(await run("en-US", "since five", at)));
  });

  it("R: no two-digit-year ambiguity reason exists", () => {
    expect(TYPES.includes("two-digit-year")).toBe(false);
  });

  it("S: vi 2 giờ asks duration or clock; 2 tiếng is a duration", async () => {
    const r = await run("vi-VN", "2 giờ", NOW);
    expect(r.state === "ambiguous" && r.reason).toBe("bare-duration");
    expect(spans(r)).toEqual([
      [isoUs("2026-11-17T10:00:00Z"), isoUs(NOW)],
      [isoUs("2026-11-17T01:55:00Z"), isoUs("2026-11-17T02:05:00Z")],
    ]);
    const hours = await run("vi-VN", "2 tiếng", NOW);
    expect(hours.state === "valid" && hours.reading.rolling).toEqual({ value: 2, unit: "h" });
  });

  it("T (F39): keeps the pm twin of a word hour with minutes after a day-part start", async () => {
    const r = await run("ko-KR", "오전 9시부터 다섯시 30분까지", NOW, "UTC", FUTURE);
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2026-11-17T09:00:00Z"),
      isoUs("2026-11-17T17:30:00Z"),
    ]);
  });

  it("V: rejects date math whose intermediate value leaves the safe range", () => {
    const r = parseTimeRangeInput({
      ...baseContext(EN_US_TIME_RANGE_PACK, "now+999999h+999999h+999999h-999999h-999999h-999999h"),
      nowUs: 1794916800000001,
      zone: "UTC",
    });
    expect(r.state).toBe("invalid");
  });

  it("W: maps an expanding character back to its raw position in one pass", () => {
    const raw = "\ufb00".repeat(512);
    const text = raw.normalize("NFKC");
    const { toRaw } = textToRaw(raw, text);
    expect(toRaw).toEqual([...text].map((_, j) => Math.floor(j / 2)));
  });

  it("X: rejects an over-long paste by length before counting code points", () => {
    expect(normalize("a".repeat(5_000_000), "en-US", "latin")).toBe("too-long");
    expect(normalize("\u{1F600}".repeat(512), "en-US", "latin")).not.toBe("too-long");
    expect(normalize("\u{1F600}".repeat(513), "en-US", "latin")).toBe("too-long");
  });

  it("Y: completions hold each reading once", async () => {
    for (const text of ["t", "y", "th"]) {
      const r = await run("en-US", text, NOW);
      const keys =
        r.state === "incomplete" ? r.completions.map((c) => `${c.startUs}:${c.endUs}`) : [];
      expect(keys.length, text).toBeGreaterThan(0);
      expect(new Set(keys).size, text).toBe(keys.length);
    }
  });

  it("Z: the examples memo survives a clock tick and misses when fixed bounds move", () => {
    let calls = 0;
    const parse = (c: Parameters<typeof parseTimeRangeInput>[0]) => {
      calls++;
      return parseTimeRangeInput(c);
    };
    const base = baseContext(EN_US_TIME_RANGE_PACK, "", NOW, "UTC");
    const first = examplesFor(base, parse);
    calls = 0;
    expect(examplesFor({ ...base, nowUs: base.nowUs + 1_000_000 }, parse)).toEqual(first);
    expect(calls).toBe(0);
    const bounded = { ...base, limits: { allowFuture: false, retentionStartUs: 0 } };
    examplesFor({ ...bounded, nowUs: base.nowUs + 1_000_000 }, parse);
    calls = 0;
    examplesFor({ ...bounded, nowUs: base.nowUs + 2_000_000 }, parse);
    expect(calls).toBe(0);
    examplesFor({ ...bounded, limits: { ...bounded.limits, retentionStartUs: 1 } }, parse);
    expect(calls).toBeGreaterThan(0);
  });
});

describe("round-9 review fixes", () => {
  it("F43: date math that lands in a repeated hour on every other step stays two readings", async () => {
    const text = `now/y+10M+1h${"-1d+1d".repeat(80)}`;
    const r = await run("en-US", text, NOW, "America/New_York");
    expect(r.state === "ambiguous" && r.reason).toBe("repeated-hour");
    expect(spans(r).map(([s]) => s)).toEqual([
      isoUs("2026-11-01T05:00:00Z"),
      isoUs("2026-11-01T06:00:00Z"),
    ]);
  });

  // `now-23d-11h` is 02:00 CET on 2026-10-25 in Berlin, inside the repeated hour, and uses no snap.
  it.each([
    ["now-23d-11h", "-1d+1d", "ambiguous"],
    ["now-23d-11h", "+1h-1d+1d", "valid"],
    ["now-23d-11h", "-1h+1d-1d", "ambiguous"],
    ["now-23d-11h", "+1M-1M", "ambiguous"],
    ["now-23d-11h", "+30m-1w+1w", "ambiguous"],
    ["now-23d-11h", "+1y-1y", "ambiguous"],
    ["now-23d-11h", "+1d-24h", "valid"],
    ["now-23d-11h/h", "+1d-1d", "ambiguous"],
  ])(
    "F51: %s then %s to 512 code points is %s with at most two readings",
    async (pre, cycle, state) => {
      const text = pre + cycle.repeat(Math.floor((512 - pre.length) / cycle.length));
      const r = await run("en-US", text, NOW, "Europe/Berlin");
      expect(r.state, text).toBe(state);
      expect(r.state === "ambiguous" ? r.readings.length : 1).toBeLessThanOrEqual(2);
    },
  );

  it("F51 policy: one chain takes every earlier instant, one every later; mixed readings are dropped", async () => {
    const r = await run("en-US", "now/y+9M+24d+2h+1h-1d+1d+1h-1d+1d", NOW, "Europe/Berlin");
    expect(r.state === "ambiguous" && r.reason).toBe("repeated-hour");
    expect(spans(r).map(([s]) => s)).toEqual([
      isoUs("2026-10-25T00:00:00Z"),
      isoUs("2026-10-25T02:00:00Z"),
    ]);
  });

  it.each(["from 9:00-10:00", "since 9:00-11:00", "starting 9:00-10:30"])(
    "F44: %s is never a since reading at an attached offset",
    async (text) => {
      expect((await run("en-US", text, "2026-11-17T20:00:00Z")).state).toBe("invalid");
    },
  );

  it.each([
    "from 9:00-10:00 to now",
    "from 9:00-10:00 to 11:00",
    "9:00-10:00 to 11:00",
    "today 9:00-10:00 until now",
    "today 09:00-05:00",
    "9:00-10:00 to 11:00-12:00",
    "today 09:00-05:00 to 10:00-06:00",
  ])(
    "F53: %s never reads an attached offset opposite a plain side or another offset",
    async (text) => {
      expect((await run("en-US", text, "2026-11-17T20:00:00Z")).state).toBe("invalid");
    },
  );

  it.each([
    "today 09:00-05:00 to today 10:00-05:00",
    "today 09:00-05:00 to 10:00-05:00",
    "2026-11-16T09:00:00-05:00 to 10:00-05:00",
    "today 09:00-05:00 to 10:00 EST",
  ])("F53: %s keeps the attached offset opposite a zoned side", async (text) => {
    const r = await run("en-US", text, "2026-11-17T20:00:00Z");
    const day = text.startsWith("2026") ? "2026-11-16" : "2026-11-17";
    expect(r.state === "valid" && span(r.reading), text).toEqual([
      isoUs(`${day}T14:00:00Z`),
      isoUs(`${day}T15:00:00Z`),
    ]);
  });

  it("F44: a since clock with seconds or a four-digit offset keeps its attached offset", async () => {
    for (const text of ["since 09:00:00-05:00", "since 9:00-0500"]) {
      const r = await run("en-US", text, "2026-11-17T20:00:00Z");
      expect(r.state === "valid" && r.reading.startUs, text).toBe(isoUs("2026-11-17T14:00:00Z"));
    }
  });

  it("F45: since 15 IST asks which zone, like since 15:00 IST", async () => {
    const at = "2026-11-17T20:00:00Z";
    const digit = await run("en-US", "since 15 IST", at);
    expect(digit.state === "ambiguous" && digit.reason).toBe("zone-abbreviation");
    expect(spans(digit)).toEqual(spans(await run("en-US", "since 15:00 IST", at)));
  });

  it.each([
    ["en-US", "2026-11-16T09:00:00Z to 17"],
    ["en-US", "2026-11-16 09:00:00 to 2026"],
    ["en-US", "2026-11-16 09:00:00 to 202"],
    ["en-US", "2026-11-16T09:00:00Z to 2"],
    ["en-US", "2026-11-16 09:00:00 to 2026-"],
    ["en-US", "2026-11-16T09:00:00Z ~ 17"],
    ["en-US", "2026-11-16T09:00:00Z .. 17"],
    ["en-US", "2026-11-16T09:00:00Z → 17"],
    ["en-US", "2026-11-16T09:00:00Z – 17"],
    ["de-DE", "2026-11-16T09:00:00Z bis 17"],
    ["fr-FR", "2026-11-16T09:00:00Z à 17"],
    ["en-US", "2026-11-16T09:00:00Z - 17"],
    ["en-US", "2026-11-16T09:00:00Z - 2026"],
    ["en-US", "2026-11-16T09:00:00Z -"],
    ["en-US", "2026-11-16T09:00:00Z - 0"],
    ["en-US", "2026-11-16T09:00:00Z -1"],
    ["es-ES", "2026-11-16T09:00:00Z a 17"],
    ["zh-CN", "2026-11-16T09:00:00Z 到 17"],
  ])("F50: %s %s is a broken range, never a log line", async (locale, text) => {
    const r = await run(locale, text, NOW);
    expect(r.state === "valid" && r.reading.origin.form, JSON.stringify(r)).not.toBe("log-line");
  });

  it.each([
    "- 200",
    "- 10.0.0.5:8080",
    "- INFO up",
    "- 503 12ms",
    "- 8080 200 15",
    "– 200",
    "tomorrow 5",
  ])("F57: a stamp followed by %s could start a range, so it is refused", async (tail) => {
    const r = await run("en-US", `2026-11-16T09:00:00Z ${tail}`, NOW);
    expect(r.state, JSON.stringify(r)).toBe("invalid");
  });

  it.each([
    ["es-ES", "at 10.0.0.5:8080"],
    ["it-IT", "at 10.0.0.5:8080"],
    ["pt-PT", "at 10.0.0.5:8080"],
  ])("F57: %s a stamp followed by %s stays a log line", async (locale, tail) => {
    const r = await run(locale, `2026-11-16T09:00:00Z ${tail}`, NOW);
    expect(center(r)).toBe(isoUs("2026-11-16T09:00:00Z"));
  });

  // Every join but the log separators `-` and `–` is a range join, whatever its script.
  it.each(
    (
      [
        ["zh-CN", ["到", "至"]],
        ["zh-TW", ["到", "至"]],
        ["th-TH", ["ถึง", "จนถึง"]],
        ["ja-JP", ["から", "より"]],
        ["ko-KR", ["부터", "에서"]],
        ["en-US", ["~", "..", "→", "—", "/", "until"]],
      ] as [string, string[]][]
    ).flatMap(([locale, joins]) =>
      joins.flatMap((join) =>
        [" 2", " 20", " 202", " 2026", " 9.30", " 173", " 200 0.004"].map((tail) => [
          locale,
          `2026-11-16T09:00:00Z ${join}${tail}`,
        ]),
      ),
    ),
  )("F60: %s %s is a broken range, never a log line", async (locale, text) => {
    const r = await run(locale, text, NOW);
    expect(r.state === "valid" && r.reading.origin.form, JSON.stringify(r)).not.toBe("log-line");
  });

  it("F61: each meaning of a zone abbreviation takes its own year", async () => {
    const r = await run("en-US", "Jan 1 00:30:00 IST msg", "2026-12-31T23:00:00Z");
    expect(r.state === "ambiguous" && r.reason).toBe("zone-abbreviation");
    expect(spans(r).map(([s, e]) => (s + e) / 2)).toEqual([
      isoUs("2026-12-31T19:00:00Z"),
      isoUs("2026-12-31T22:30:00Z"),
      isoUs("2025-12-31T23:30:00Z"),
    ]);
  });

  it("F46: folded joins end a stamp as a range, and short numeric log messages stay log lines", async () => {
    expect((await run("fr-FR", "2026-11-16T09:00:00Z à", NOW)).state).toBe("incomplete");
    expect((await run("fr-FR", "2026-11-16T09:00:00Z à 25:00", NOW)).state).toBe("invalid");
    for (const text of ["2026-11-16 09:12:33 - 200", "2026-11-16T09:12:33Z - 10.0.0.5:8080"]) {
      expect((await run("en-US", text, NOW)).state, text).toBe("invalid");
    }
  });

  it.each([
    ["Dec 31 23:30:00 -0500 msg", "2027-01-01T00:10:00Z", "UTC", "2026-01-01T04:30:00Z"],
    ["Dec 31 23:30:00 msg", "2027-01-01T00:10:00Z", "UTC", "2026-12-31T23:30:00Z"],
    ["Feb 29 10:00:00 -12:00 msg", "2028-02-29T15:00:00Z", "UTC", "2024-02-29T22:00:00Z"],
    ["Feb 29 10:00:00 +14:00 msg", "2028-02-29T15:00:00Z", "UTC", "2028-02-28T20:00:00Z"],
    ["Jan 1 09:00:00 +10:00 msg", "2026-12-31T23:30:00Z", "UTC", "2026-12-31T23:00:00Z"],
    [
      "Jan 1 00:30:00 +0100 msg",
      "2026-12-31T23:45:00Z",
      "America/Los_Angeles",
      "2026-12-31T23:30:00Z",
    ],
    ["Jan 1 09:00:00 msg", "2026-12-31T23:30:00Z", "UTC", "2026-01-01T09:00:00Z"],
  ])("F54/F56: %s at %s in %s keeps its own year", async (text, at, zone, expected) => {
    expect(center(await run("en-US", text, at, zone))).toBe(isoUs(expected));
  });

  it.each([
    ["2029-01-15T12:00:00Z", "2028-02-29T10:00:00Z"],
    ["2028-01-15T12:00:00Z", "2024-02-29T10:00:00Z"],
  ])("F47: a year-less Feb 29 log stamp at %s reads in its leap year", async (at, expected) => {
    expect(center(await run("en-US", "Feb 29 10:00:00 sshd[1]: ok", at))).toBe(isoUs(expected));
  });

  it("F48: a dated word-hour range pairs meridiems like the undated one", async () => {
    const r = await run("en-US", "11/12 three to five", NOW);
    expect(r.state === "ambiguous" && r.reason).toBe("day-month-order");
    expect(spans(r)).toEqual([
      [isoUs("2026-11-12T03:00:00Z"), isoUs("2026-11-12T05:00:00Z")],
      [isoUs("2026-11-12T15:00:00Z"), isoUs("2026-11-12T17:00:00Z")],
      [isoUs("2025-12-11T03:00:00Z"), isoUs("2025-12-11T05:00:00Z")],
      [isoUs("2025-12-11T15:00:00Z"), isoUs("2025-12-11T17:00:00Z")],
    ]);
  });

  it.each([
    ["11/12 from three to five", 4],
    ["11/12 three to five", 4],
    ["11/12 from 9:00 to 17:00", 2],
    ["11/12 9:00 to 17:00", 2],
  ])("F52: %s pairs only readings of one date order", async (text, count) => {
    const r = await run("en-US", text, NOW);
    expect(r.state).toBe("ambiguous");
    const sameDay = spans(r).every(([s, e]) => e - s < 86_400_000_000);
    expect([spans(r).length, sameDay]).toEqual([count, true]);
  });
});

describe("review gate regressions", () => {
  const AT = "2026-11-19T12:00:00Z";

  it.each([
    ["en-US", "2026-11-16T09:00:00Z to November 32, 2026"],
    ["fr-FR", "2026-11-16T09:00:00Z à 17 novembre 2026 25:00"],
  ])("G1: %s broken named-date range %s is no log window", async (locale, text) => {
    expect((await run(locale, text, AT)).state).not.toBe("valid");
  });

  it("G2: three to five keeps one meridiem after pruning the future start", async () => {
    const r = await run("en-US", "three to five", AT);
    expect(r.state === "valid" && span(r.reading)).toEqual([
      isoUs("2026-11-19T03:00:00Z"),
      isoUs("2026-11-19T05:00:00Z"),
    ]);
  });

  it("G3: a word-hour start is past-filtered on the date it inherits", async () => {
    const r = await run("en-US", "three to yesterday five", AT);
    expect(spans(r)).toEqual([
      [isoUs("2026-11-18T03:00:00Z"), isoUs("2026-11-18T05:00:00Z")],
      [isoUs("2026-11-18T15:00:00Z"), isoUs("2026-11-18T17:00:00Z")],
    ]);
  });

  it("G5: examples stay valid when now crosses the epoch floor within one day", () => {
    const ctx = baseContext(EN_US_TIME_RANGE_PACK, "", "1970-01-01T01:00:00Z", "UTC");
    examplesFor(ctx, parseTimeRangeInput);
    const early = { ...ctx, nowUs: 0 };
    for (const text of examplesFor(early, parseTimeRangeInput)) {
      expect(parseTimeRangeInput({ ...early, text }).state, text).toBe("valid");
    }
  });

  it.each([
    [
      "Nov 1 01:30:00 worker started",
      "2026-11-01T06:15:00Z",
      "America/New_York",
      "2026-11-01T05:30:00Z",
    ],
    ["Mar 8 02:30:00 America/New_York msg", "2026-03-08T07:15:00Z", "UTC", "2025-03-08T07:30:00Z"],
  ])(
    "R1: yearless %s at %s picks its year by resolved instant",
    async (text, at, zone, expected) => {
      const r = await run("en-US", text, at, zone);
      const rows = r.state === "valid" ? [r.reading] : r.state === "ambiguous" ? r.readings : [];
      const instants = rows.flatMap((x) =>
        x.notes.flatMap((n) => (n.kind === "instant-window" ? [n.instantUs] : [])),
      );
      expect(instants, JSON.stringify(r)).toContain(isoUs(expected));
    },
  );

  it.each([false, true])(
    "R2: a calendar day clipped by maxEndUs is absolute (allowFuture=%s)",
    async (allowFuture) => {
      const r = await run("en-US", "yesterday", "2026-11-17T12:00:00Z", "UTC", {
        allowFuture,
        maxEndUs: isoUs("2026-11-16T12:00:00Z"),
      });
      expect(
        r.state === "valid" && [r.reading.kind, r.reading.calendarToken, span(r.reading)],
      ).toEqual([
        "absolute",
        undefined,
        [isoUs("2026-11-16T00:00:00Z"), isoUs("2026-11-16T12:00:00Z")],
      ]);
    },
  );

  it.each([
    ["2026-11-16T01:00+09:00 to 20:00 UTC", "2026-11-15T16:00:00Z", "2026-11-15T20:00:00Z"],
    ["2026-11-16T01:00 Asia/Tokyo to 20:00 UTC", "2026-11-15T16:00:00Z", "2026-11-15T20:00:00Z"],
    ["2026-11-16T23:00-05:00 to 06:00 UTC", "2026-11-17T04:00:00Z", "2026-11-17T06:00:00Z"],
    [
      "2026-11-16T23:00 America/New_York to 06:00 UTC",
      "2026-11-17T04:00:00Z",
      "2026-11-17T06:00:00Z",
    ],
  ])("H1: %s dates the end clock in its own zone", async (text, start, end) => {
    const r = await run("en-US", text, AT);
    expect(r.state === "valid" && span(r.reading), JSON.stringify(r)).toEqual([
      isoUs(start),
      isoUs(end),
    ]);
  });

  it("H2: a lowercase IANA suffix is a zone, not log text", async () => {
    const r = await run("en-US", "2026-11-16T09:00 america/new_york", AT);
    expect(center(r), JSON.stringify(r)).toBe(isoUs("2026-11-16T14:00:00Z"));
  });

  it("H4: a positive offset keeps the microsecond of a safe now", () => {
    const nowUs = Number.MAX_SAFE_INTEGER;
    const ctx = { ...baseContext(EN_US_TIME_RANGE_PACK, "1d", AT, "Asia/Tokyo"), nowUs };
    const r = parseTimeRangeInput(ctx);
    expect(r.state === "valid" && span(r.reading), JSON.stringify(r)).toEqual([
      nowUs - 86_400_000_000,
      nowUs,
    ]);
  });

  it("H5: grading rejects an instant reading whose query window misses the instant", () => {
    const stamp = "2026-11-16T09:00:00Z";
    const r = parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, stamp, AT, "UTC"));
    if (r.state !== "valid") throw new Error(JSON.stringify(r));
    expect(matches(r.reading, { start: stamp, end: stamp })).toBe(true);
    const wrong = {
      ...r.reading,
      startUs: isoUs(stamp) + 3_600_000_000,
      endUs: isoUs(stamp) + 7_200_000_000,
    };
    expect(matches(wrong, { start: stamp, end: stamp })).toBe(false);
  });

  it("G6: a safe instant is valid even when its offset wall clock is not", async () => {
    expect((await run("en-US", "2255-06-05T22:00:00Z", AT, "UTC", FUTURE)).state).toBe("valid");
    const r = await run("en-US", "2255-06-06T00:00:00+02:00", AT, "UTC", FUTURE);
    expect(r.state === "valid" && center(r)).toBe(isoUs("2255-06-05T22:00:00Z"));
  });
});

// Phase 2: the two known wrong readings and the gaps a picker-polish spike found.
describe("phase 2 fixes", () => {
  it.each([
    ["ja-JP", "Asia/Tokyo", "午後1時から05時", "午後1時から5時"],
    ["ko-KR", "Asia/Seoul", "오후 1시부터 05시까지", "오후 1시부터 5시까지"],
    ["zh-CN", "Asia/Shanghai", "下午1点到05点", "下午1点到5点"],
    ["zh-TW", "Asia/Taipei", "下午1點到05點", "下午1點到5點"],
    ["fr-FR", "Europe/Paris", "1h de l'après-midi - 05h", "1h de l'après-midi - 5h"],
    ["es-ES", "Europe/Madrid", "1h de la tarde - 05h", "1h de la tarde - 5h"],
    ["pt-PT", "Europe/Lisbon", "1h da tarde - 05h", "1h da tarde - 5h"],
    ["vi-VN", "Asia/Ho_Chi_Minh", "1 giờ chiều - 05 giờ", "1 giờ chiều - 5 giờ"],
    ["th-TH", "Asia/Bangkok", "บ่าย1โมงถึง05โมง", "บ่าย1โมงถึง5โมง"],
  ])(
    "R1 %s: a zero-padded affixed end hour is a 24-hour clock",
    async (locale, zone, padded, bare) => {
      const r = await run(locale, padded, NOW, zone);
      expect(r.state === "invalid" && r.reason, JSON.stringify(r)).toBe("reversed");
      const plain = await run(locale, bare, NOW, zone);
      const reading = plain.state === "valid" || plain.state === "blocked" ? plain.reading : null;
      expect(reading && reading.endUs - reading.startUs, JSON.stringify(plain)).toBe(
        4 * 3_600_000_000,
      );
    },
  );

  it.each([
    [
      "22:00 UTC to 2026-11-18 08:00",
      "Asia/Tokyo",
      ["2026-11-17T22:00:00Z", "2026-11-17T23:00:00Z"],
    ],
    [
      "22:00 UTC to 2026-11-17T23:00:00Z",
      "Asia/Tokyo",
      ["2026-11-17T22:00:00Z", "2026-11-17T23:00:00Z"],
    ],
    ["23:00 Asia/Tokyo to 2026-11-18 20:00", "UTC", null],
  ])("R2: %s dates the start clock in its own zone", async (text, zone, want) => {
    const r = await run("en-US", text, "2026-11-19T12:00:00Z", zone);
    if (want === null)
      expect(r.state === "invalid" && r.reason, JSON.stringify(r)).toBe("reversed");
    else expect(r.state === "valid" && span(r.reading), JSON.stringify(r)).toEqual(want.map(isoUs));
  });

  it.each([
    ["calendar:day:0", "2026-11-17T00:00:00+01:00", NOW],
    ["calendar:day:-1", "2026-11-16T00:00:00+01:00", "2026-11-17T00:00:00+01:00"],
    ["calendar:week:0", "2026-11-16T00:00:00+01:00", NOW],
    ["calendar:week:-1", "2026-11-09T00:00:00+01:00", "2026-11-16T00:00:00+01:00"],
    ["calendar:month:-1", "2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00"],
    ["calendar:quarter:0", "2026-10-01T00:00:00+02:00", NOW],
    ["calendar:quarter:-1", "2026-07-01T00:00:00+02:00", "2026-10-01T00:00:00+02:00"],
    ["calendar:year:-1", "2025-01-01T00:00:00+01:00", "2026-01-01T00:00:00+01:00"],
  ])("B1: the token %s reads as its calendar period", async (token, start, end) => {
    for (const text of [token, `?period=${token}`]) {
      const r = await run("en-US", text, NOW, "Europe/Berlin");
      expect(r.state === "valid" && [r.reading.calendarToken, span(r.reading)], text).toEqual([
        token,
        [isoUs(start), isoUs(end)],
      ]);
    }
  });

  it.each(["calendar:week:1", "calendar:day:-01", "calendar:hour:0", "calendar:day:0:0"])(
    "B1: %s is not a calendar token",
    async (text) => {
      expect((await run("en-US", text, NOW)).state).toBe("invalid");
    },
  );

  it.each([
    ["en-US", "last 3M"],
    ["en-US", "past 3M"],
    ["en-US", "3M ago"],
    ["de-DE", "letzte 3M"],
  ])("B2 %s: %s asks minutes or months", async (locale, text) => {
    const r = await run(locale, text, NOW, "Europe/Berlin");
    expect(r.state === "ambiguous" && [r.reason, r.readings.map((x) => x.rolling)]).toEqual([
      "unit-case",
      [
        { value: 3, unit: "m" },
        { value: 3, unit: "M" },
      ],
    ]);
  });

  it("B2: now-3M and last 3m stay exact", async () => {
    const months = await run("en-US", "now-3M", NOW);
    expect(months.state === "valid" && months.reading.rolling).toEqual({ value: 3, unit: "M" });
    const minutes = await run("en-US", "last 3m", NOW);
    expect(minutes.state === "valid" && minutes.reading.rolling).toEqual({ value: 3, unit: "m" });
  });

  it.each(["3mo", "3Mo"])("B3: de %s reads as three months, not a Monday hour", async (text) => {
    const r = await run("de-DE", text, NOW, "Europe/Berlin");
    expect(r.state === "valid" && r.reading.rolling, JSON.stringify(r)).toEqual({
      value: 3,
      unit: "M",
    });
  });

  it.each([
    "10:00 to 09:00",
    "2026-11-16 to 2026-11-15",
    "10:00Z - 09:00Z",
    '{"start_date":1794823200000000,"end_date":1794819600000000}',
    "https://x.example/?from=2026-11-16T10:00:00Z&to=2026-11-16T09:00:00Z",
  ])("B4: %s is invalid/reversed over the whole input", async (text) => {
    const r = await run("en-US", text, NOW);
    expect(r.state === "invalid" && [r.reason, r.at]).toEqual(["reversed", [0, text.length]]);
  });

  it.each(Object.entries(LOCALE_KEYS).filter(([tag]) => tag !== "und"))(
    "B5 %s: this and last quarter read as calendar quarters",
    async (tag) => {
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      for (const [offset, start, end] of [
        [0, "2026-10-01T00:00:00+02:00", NOW],
        [-1, "2026-07-01T00:00:00+02:00", "2026-10-01T00:00:00+02:00"],
      ] as const) {
        const text = rtf.format(offset, "quarter");
        const r = await run(tag, text, NOW, "Europe/Berlin");
        expect(r.state === "valid" && [r.reading.calendarToken, span(r.reading)], text).toEqual([
          `calendar:quarter:${offset}`,
          [isoUs(start), isoUs(end)],
        ]);
      }
    },
  );
});

describe("round 14 review fixes", () => {
  it.each([
    [
      "nine to five",
      "2026-11-19T14:00:00Z",
      "blocked",
      ["2026-11-19T09:00:00Z", "2026-11-19T14:00:00Z"],
    ],
    [
      "nine to five",
      "2026-11-19T18:00:00Z",
      "valid",
      ["2026-11-19T09:00:00Z", "2026-11-19T17:00:00Z"],
    ],
    [
      "ten to two",
      "2026-11-19T15:00:00Z",
      "valid",
      ["2026-11-19T10:00:00Z", "2026-11-19T14:00:00Z"],
    ],
    [
      "eleven to one",
      "2026-11-19T23:30:00Z",
      "valid",
      ["2026-11-19T11:00:00Z", "2026-11-19T13:00:00Z"],
    ],
  ])("F65: %s at %s pairs across noon", async (text, at, state, want) => {
    const r = await run("en-US", text, at);
    const got = r.state === "blocked" ? r.fix : r.state === "valid" ? r.reading : null;
    expect([r.state, got && span(got)], JSON.stringify(r)).toEqual([state, want.map(isoUs)]);
  });

  it.each([
    ["en-US", "/api/v1/users 200"],
    ["en-US", "GET /api 200"],
    ["en-US", "Midnight Commander started"],
  ])("F66: %s a stamp followed by %s stays a log line", async (locale, tail) => {
    const r = await run(locale, `2026-11-16T09:00:00Z ${tail}`, NOW);
    expect(center(r), JSON.stringify(r)).toBe(isoUs("2026-11-16T09:00:00Z"));
  });

  it.each([
    ["en-US", "...retrying"],
    ["en-US", "to upstream failed"],
    ["es-ES", "a usuario conectado"],
  ])(
    "F66: %s a stamp followed by %s could start a range, so it is refused",
    async (locale, tail) => {
      const r = await run(locale, `2026-11-16T09:00:00Z ${tail}`, NOW);
      expect(r.state, JSON.stringify(r)).toBe("invalid");
    },
  );

  it.each([
    ["nine to nine", "2026-11-19T22:00:00Z", "zero-length"],
    ["five to three", "2026-11-19T22:00:00Z", "reversed"],
    ["five to three", "2026-11-19T14:00:00Z", "reversed"],
    ["nine to eight", "2026-11-19T22:00:00Z", "reversed"],
  ])("F70: %s at %s never crosses noon", async (text, at, reason) => {
    const r = await run("en-US", text, at);
    expect(r.state === "invalid" && r.reason, JSON.stringify(r)).toBe(reason);
  });

  it("F70: digit hours never cross noon without a meridiem", async () => {
    const r = await run("en-US", "9 to 5", "2026-11-19T22:00:00Z");
    expect(r.state === "invalid" && r.reason).toBe("reversed");
  });

  it.each([
    ["calendar:month:-1", "Last month"],
    ["calendar:quarter:0", "This quarter"],
    ["calendar:year:-1", "Last year"],
    ["calendar:day:0", "Today"],
    ["calendar:week:0", "This week"],
  ])("F69/B8: %s keeps its sentence-case name %s", async (token, name) => {
    const r = await run("en-US", token, NOW, "Europe/Berlin");
    expect(r.state === "valid" && r.reading.name).toBe(name);
  });

  it("B8: typed calendar words still match in any case", async () => {
    for (const text of ["this quarter", "THIS QUARTER", "This Quarter", "today", "TODAY"]) {
      const r = await run("en-US", text, NOW, "Europe/Berlin");
      expect(r.state === "valid" && r.reading.kind, text).toBe("calendar");
    }
  });

  it.each([
    ["en-US", "this week", "calendar:week:0"],
    ["en-US", "last week", "calendar:week:-1"],
    ["pt-PT", "esta semana", "calendar:week:0"],
    ["ja-JP", "先週", "calendar:week:-1"],
    ["de-DE", "letzte Woche", "calendar:week:-1"],
  ])("B2: %s typed %s reads as the rail's %s", async (locale, text, token) => {
    const typed = await run(locale, text, NOW, "Europe/Berlin");
    const rail = await run(locale, token, NOW, "Europe/Berlin");
    const pick = (r: TimeRangeParseResult) =>
      r.state === "valid" && [r.reading.kind, r.reading.calendarToken, span(r.reading)];
    expect(pick(typed)).toEqual(pick(rail));
    expect(pick(typed)).toEqual(["calendar", token, expect.any(Array)]);
  });

  it.each(["en-US", "ja-JP", "de-DE"])(
    "B2 %s: now/w starts on the rail's Monday",
    async (locale) => {
      const math = await run(locale, "now/w", NOW, "Europe/Berlin");
      const rail = await run(locale, "calendar:week:0", NOW, "Europe/Berlin");
      expect(math.state === "valid" && math.reading.startUs).toBe(
        rail.state === "valid" ? rail.reading.startUs : NaN,
      );
    },
  );

  it("F68: a token week carries the same name as the typed week words", async () => {
    const en = await run("en-US", "calendar:week:-1", NOW, "Europe/Berlin");
    expect(en.state === "valid" && [en.reading.calendarToken, en.reading.name]).toEqual([
      "calendar:week:-1",
      "Last week",
    ]);
    const de = await run("de-DE", "calendar:week:-1", NOW, "Europe/Berlin");
    const typed = await run("de-DE", "letzte Woche", NOW, "Europe/Berlin");
    expect(de.state === "valid" && typed.state === "valid" && de.reading.name).toBe(
      typed.state === "valid" ? typed.reading.name : "",
    );
  });
});

describe("review findings", () => {
  const en = (text: string, limits: Partial<RangeLimits> = {}): TimeRangeParseResult => {
    const ctx = baseContext(EN_US_TIME_RANGE_PACK, text, NOW, "Europe/Berlin");
    return parseTimeRangeInput({ ...ctx, limits: { ...ctx.limits, ...limits } });
  };

  it("keeps a malformed range with a zone suffix invalid (P1)", () => {
    for (const zone of ["Europe/Berlin", "UTC"]) {
      const r = en(`2026-11-15 12:00:00 - 2026-11-31 13:00:00 ${zone}`);
      expect(r.state, zone).toBe("invalid");
    }
  });

  it("never mixes month-first and day-first readings in one range (P3)", () => {
    const r = en("12/31/2025 to 01/05/2026");
    expect(r.state === "valid" && r.reading.endUs).toBe(isoUs("2026-01-06T00:00:00+01:00"));
  });

  it("reports a future start ending in now as reversed (P6)", () => {
    const r = en("2026-11-21T10:00:00Z to now", { allowFuture: true });
    expect(r.state === "invalid" && r.reason).toBe("reversed");
  });
});

describe("zone abbreviation ranges", () => {
  const HOUR = 3_600_000_000;

  it.each([
    ["Jan 1 00:30:00 IST to Jan 1 01:30:00 IST", "2026-12-31T23:00:00Z"],
    ["Nov 16 09:00:00 IST to Nov 16 10:00:00 IST", NOW],
    ["2026-11-16 09:00:00 IST to 2026-11-16 10:00:00 IST", NOW],
    ["today 09:00 IST to today 10:00 IST", "2026-11-17T20:00:00Z"],
  ])("F64: %s reads both sides with one meaning", async (text, now) => {
    const r = await run("en-US", text, now);
    expect(r.state === "ambiguous" && r.reason, text).toBe("zone-abbreviation");
    expect(
      spans(r).map(([s, e]) => e - s),
      text,
    ).toEqual(spans(r).map(() => HOUR));
  });

  it("F64: a word range across noon keeps one abbreviation meaning", async () => {
    const r = await run("en-US", "nine IST to five IST", "2026-11-17T20:00:00Z");
    expect(spans(r).map(([s, e]) => e - s)).toEqual(spans(r).map(() => 8 * HOUR));
  });

  it("F64: pairs a stamp's year only with a year read by the same rule", async () => {
    const r = await run(
      "en-US",
      "Jan 1 00:30:00 IST to Jan 1 01:30:00 IST",
      "2026-12-31T23:00:00Z",
    );
    expect(spans(r)).toEqual([
      [isoUs("2026-12-31T19:00:00Z"), isoUs("2026-12-31T20:00:00Z")],
      [isoUs("2025-12-31T23:30:00Z"), isoUs("2026-01-01T00:30:00Z")],
      [isoUs("2025-12-31T19:00:00Z"), isoUs("2025-12-31T20:00:00Z")],
      [isoUs("2025-12-31T22:30:00Z"), isoUs("2025-12-31T23:30:00Z")],
    ]);
  });
});

describe("perf review fixes", () => {
  it("P6: the fallback alignment keeps its tie-breaks", () => {
    expect(textToRaw("e\u0301ee", "\u00e9e").toRaw).toEqual([-1, 3]);
    expect(textToRaw("aa\u0301b", "a\u00e1b").toRaw).toEqual([0, -1, 3]);
    expect(textToRaw("\uff76\uff9ea", "\u30ac" + "a").toRaw).toEqual([-1, 2]);
    const raw = `e\u0301${"x".repeat(510)}`;
    const { toRaw } = textToRaw(raw, raw.normalize("NFKC"));
    expect(toRaw).toEqual([-1, ...Array.from({ length: 510 }, (_, j) => j + 2)]);
  });

  it("P7: a day-step chain with no repeated hour resolves each step once", () => {
    const proto = Intl.DateTimeFormat.prototype;
    const original = proto.formatToParts;
    let calls = 0;
    proto.formatToParts = function (this: Intl.DateTimeFormat, date?: Date | number) {
      calls++;
      return original.call(this, date);
    };
    try {
      const text = `now${"+1d".repeat(169)}`;
      parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, text, NOW, "America/New_York"));
    } finally {
      proto.formatToParts = original;
    }
    // Two chains resolving every step made 1,697 calls.
    expect(calls).toBeLessThan(1000);
  });

  it("P9: bounded examples hit the memo within a minute and match a fresh run", () => {
    let calls = 0;
    const parse = (c: Parameters<typeof parseTimeRangeInput>[0]) => {
      calls++;
      return parseTimeRangeInput(c);
    };
    const base = baseContext(EN_US_TIME_RANGE_PACK, "", NOW, "UTC");
    // "15m" turns valid once now passes the bound by 15 minutes, 30 s after the base.
    const minStartUs = base.nowUs - 15 * 60_000_000 + 30_000_000;
    const at = (nowUs: number) => ({ ...base, nowUs, limits: { allowFuture: false, minStartUs } });
    examplesFor(at(base.nowUs + 1_000), parse);
    calls = 0;
    examplesFor(at(base.nowUs + 20_000_000), parse);
    expect(calls).toBe(0);
    const seen = new Set<string>();
    for (const step of [29_999_999, 30_000_000, 30_000_001, 89_999_999, 90_000_000]) {
      const memo = examplesFor(at(base.nowUs + step), parse);
      examplesFor({ ...base, zone: "Asia/Tokyo" }, parse);
      expect(memo, String(step)).toEqual(examplesFor(at(base.nowUs + step), parse));
      seen.add(memo.join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("typed-clock review fixes", () => {
  const LATER = "2026-11-21T12:00:00Z";
  const spans = (text: string, zone = "America/New_York") => {
    const r = parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, text, LATER, zone));
    if (r.state === "valid")
      return { state: r.state, spans: [[r.reading.startUs, r.reading.endUs]] };
    if (r.state === "ambiguous")
      return {
        state: r.state,
        reason: r.reason,
        spans: r.readings.map((x) => [x.startUs, x.endUs]),
      };
    return { state: r.state };
  };

  it.each([
    ["2026-11-20 9am", "Nov 20 9am"],
    ["2026-11-20 9:30pm", "Nov 20 9:30pm"],
    ["2026/11/20 9am", "Nov 20 9am"],
    ["2026-11-20 9 am", "Nov 20 9 am"],
    ["2026-11-20 at 9am", "Nov 20 at 9am"],
    ["2026-11-20 9am-5pm", "Nov 20 9am-5pm"],
    ["2026-11-20 9am to 2026-11-20 5pm", "Nov 20 9am to Nov 20 5pm"],
    ["2026-11-01 1:30am", "Nov 1 1:30am"],
    ["2026-03-08 2:30am", "2026-03-08 02:30"],
  ])("C1: an ISO date takes a 12-hour clock: %s reads like %s", (iso, phrase) => {
    const got = spans(iso);
    expect(got.state).not.toBe("invalid");
    expect(got).toEqual(spans(phrase));
  });

  it("C1: a 12-hour clock in a repeated hour after an ISO date asks which pass", () => {
    expect(spans("2026-11-01 1:30am")).toEqual({
      state: "ambiguous",
      reason: "repeated-hour",
      spans: [
        [isoUs("2026-11-01T01:25:00-04:00"), isoUs("2026-11-01T01:35:00-04:00")],
        [isoUs("2026-11-01T01:25:00-05:00"), isoUs("2026-11-01T01:35:00-05:00")],
      ],
    });
    expect(spans("2026-11-20 9am to 2026-11-20 5pm")).toEqual({
      state: "valid",
      spans: [[isoUs("2026-11-20T09:00:00-05:00"), isoUs("2026-11-20T17:00:00-05:00")]],
    });
  });

  it.each(["13:30pm", "13pm", "0am", "00:30am", "0:30 pm", "Nov 20 13:30pm", "2026-11-20 13pm"])(
    "C4: an hour above 12 or 0 with am/pm is invalid: %s",
    (text) => {
      expect(spans(text).state).toBe("invalid");
    },
  );

  it.each(["12am", "12:30am", "1pm", "13:30 in the afternoon"])("C4: keeps %s readable", (text) => {
    expect(spans(text).state).not.toBe("invalid");
  });
});

describe("typed-clock review fixes, round 2", () => {
  const LATER = "2026-11-21T12:00:00Z";
  const read = async (text: string, locale = "en-US") => {
    const r = parseTimeRangeInput(baseContext(await packFor(locale), text, LATER, "UTC"));
    if (r.state === "valid") return { state: r.state, span: [r.reading.startUs, r.reading.endUs] };
    return { state: r.state };
  };
  const at = (from: string, to: string) => ({ state: "valid", span: [isoUs(from), isoUs(to)] });

  it.each([
    ["2026-11-20 9:30 PM", "2026-11-20T21:25:00Z", "2026-11-20T21:35:00Z"],
    ["2026-11-20 9:30 pm", "2026-11-20T21:25:00Z", "2026-11-20T21:35:00Z"],
    ["Nov 20 9:30 PM", "2026-11-20T21:25:00Z", "2026-11-20T21:35:00Z"],
  ])("P1: a spaced pm after a dated clock is kept: %s", async (text, from, to) => {
    expect(await read(text)).toEqual(at(from, to));
  });

  it.each(["2026-11-20 00:30 am", "2026-11-20 13:30 pm", "2026-11-20 09:30 - 13pm", "PM 13:30"])(
    "P1/P3/P7: a refused mark is never dropped: %s is invalid",
    async (text) => {
      expect((await read(text)).state).toBe("invalid");
    },
  );

  it("P2: an offset stamp with a space still ends on a bare clock", async () => {
    expect(await read("2026-11-20 00:30+05:00 to 20:30")).toEqual(
      at("2026-11-19T19:30:00Z", "2026-11-20T15:30:00Z"),
    );
  });

  it.each([
    ["昨日午後0:30", "2026-11-20T12:25:00Z", "2026-11-20T12:35:00Z"],
    ["昨日午前0:30", "2026-11-20T00:25:00Z", "2026-11-20T00:35:00Z"],
    ["昨日午後12:30", "2026-11-20T12:25:00Z", "2026-11-20T12:35:00Z"],
  ])("P4: ja marks take the hour 0 that Intl prints: %s", async (text, from, to) => {
    expect(await read(text, "ja-JP")).toEqual(at(from, to));
  });

  it("P5: an ar day-part word keeps a 24-hour clock", async () => {
    expect(await read("أمس ١٦:٣٠ عصرا", "ar-SA")).toEqual(
      at("2026-11-20T16:25:00Z", "2026-11-20T16:35:00Z"),
    );
  });

  it.each(["2026-11-20 from 2026-10-02 to 2026-10-05", "Nov 20 from 2026-10-02 to 2026-10-05"])(
    "P6: a leading day with no clock to land on is not dropped: %s",
    async (text) => {
      expect((await read(text)).state).not.toBe("valid");
    },
  );

  it("property: an added date, mark or range end never leaves the reading unchanged", async () => {
    const days = ["2026-11-20", "Nov 20", "2026/11/20", "11/20/2026"];
    const bases: string[] = [];
    for (const d of days)
      for (const h of [1, 4, 9, 11]) for (const mi of ["00", "30"]) bases.push(`${d} ${h}:${mi}`);
    bases.push("2026-10-02 to 2026-10-05", "Oct 2 to Oct 5", "yesterday 9:30");
    for (const base of bases) {
      const plain = await read(base);
      const decorated = [
        `${base} pm`,
        `${base} PM`,
        `2026-11-19 ${base}`,
        `${base} - 13pm`,
        `${base} pm2 x`,
        `${base} - 13:30 PM`,
        `${base}Z PM: x`,
      ];
      for (const text of decorated) {
        const got = await read(text);
        if (plain.state === "valid" && got.state === "valid")
          expect({ text, span: got.span }).not.toEqual({ text, span: plain.span });
      }
    }
  });

  it("property: a range tail after a marked stamp is never dropped, and a log date is text", async () => {
    for (const day of ["2026-11-20 ", "2026-11-20T", "Nov 20 "]) {
      for (const clock of ["9:30:15", "09:30:00", "13:30", "09:30"]) {
        const bare = await read(day + clock);
        const zoned = await read(`${day}${clock} +05:30 INFO`);
        expect(await read(`${day}${clock} +05:30, INFO`), clock).toEqual(zoned);
        if (zoned.state === "valid") expect(zoned).not.toEqual(bare);
        for (const mark of [" PM", " am", "", " PM,", " PM."]) {
          const stamp = day + clock + mark;
          const refs = [bare, await read(stamp)].filter((r) => r.state === "valid");
          for (const tail of [
            " to 16:30",
            " - 13pm+05:30",
            " to noon",
            " - 11 pm",
            " to 11 UTC",
            " to p.m.",
          ]) {
            const got = await read(stamp + tail);
            for (const ref of refs)
              expect({ stamp, tail, got }).not.toEqual({ stamp, tail, got: ref });
          }
          expect((await read(`${stamp} 2026-11-19 INFO`)).state, stamp).toBe("invalid");
        }
      }
    }
  });
});

describe("log-line rule", () => {
  const LATER = "2026-11-21T12:00:00Z";
  it("property: a log-line reading spans exactly its leading stamp alone", async () => {
    const stamps = [
      "2026-11-20 09:30:15",
      "2026-11-20T09:30:15.123Z",
      "2026-11-20 09:30:15 PM",
      "2026-11-20 09:30:15 +05:30",
      "2026-11-20 09:30:15 PM UTC",
      "2026-11-20 09:30:15 IST",
      "2026/11/20 21:30:15",
      "Nov 20 09:30:15",
      "Nov 21 9:30:15 PM",
      "Nov 20, 2026 09:30:15",
      "[20/Nov/2026:09:30:15 +0100]",
    ];
    const tails = [
      " INFO started",
      ", worker",
      ": suspend",
      " pm2 restarted",
      " PM_worker",
      " noon check",
      " Midnight Commander",
      " GET /api 200",
      " to upstream",
      " - 200",
      " 2026-11-19 x",
      " tomorrow",
      " a user",
      "\nnext line",
    ];
    let logLines = 0;
    for (const zone of ["UTC", "Asia/Tokyo", "America/New_York", "Asia/Kolkata"]) {
      for (const stamp of stamps) {
        const alone = parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, stamp, LATER, zone));
        for (const tail of tails) {
          const r = parseTimeRangeInput(
            baseContext(EN_US_TIME_RANGE_PACK, stamp + tail, LATER, zone),
          );
          const readings =
            r.state === "valid" ? [r.reading] : r.state === "ambiguous" ? r.readings : [];
          if (!readings.some((x) => x.origin.form === "log-line")) continue;
          logLines++;
          const want =
            alone.state === "valid"
              ? [alone.reading]
              : alone.state === "ambiguous"
                ? alone.readings
                : [];
          expect({ stamp, tail, zone, got: readings.map(span) }).toEqual({
            stamp,
            tail,
            zone,
            got: want.map(span),
          });
        }
      }
    }
    expect(logLines).toBeGreaterThan(200);
  });
});

describe("meridiem rule: a mark binds only to the clock beside it, and no text is dropped", () => {
  const LATER = "2026-11-21T12:00:00Z";
  const NIGHT = "2026-11-21T23:00:00Z";
  const point = (iso: string): [string, string] => [iso, iso];
  type Want = "invalid" | "incomplete" | "blocked" | "ambiguous" | [string, string];
  const ZONES = ["UTC", "Asia/Tokyo", "Asia/Kolkata", "America/New_York"];
  const everywhere = (text: string, want: Want): [string, string, Want, string, string][] =>
    ZONES.map((zone) => ["en-US", text, want, LATER, zone]);
  const rows: [string, string, Want, string?, string?][] = [
    // Round 4: a bare end after a zoned start is read in the start's zone, whatever the viewer's.
    ...everywhere("2026-11-20 09:30Z - 11", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]),
    ...everywhere("2026-11-20 09:30Z to 11", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]),
    ...everywhere("2026-11-20T09:30Z - 11", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]),
    ...everywhere("2026-11-20T09:30Z to 11", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]),
    ...everywhere("2026-11-20T09:30Z – 11 UTC", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]),
    ...everywhere("2026-11-20 09:30+05:30 - 11", ["2026-11-20T04:00:00Z", "2026-11-20T05:30:00Z"]),
    ...everywhere("09:30+05:30 - 11", ["2026-11-21T04:00:00Z", "2026-11-21T05:30:00Z"]),
    ...everywhere("09:30+05:30 to 23:59", "blocked"),
    ...everywhere("9am IST to 5pm", "ambiguous"),
    ...everywhere("9am IST - 11pm", "blocked"),
    ...everywhere("2026-11-20 09:30 Asia/Tokyo - 11", [
      "2026-11-20T00:30:00Z",
      "2026-11-20T02:00:00Z",
    ]),
    // Round 4: a mark binds before the zone, and a year-less stamp picks its year after the mark.
    ["en-US", "2026-11-20 09:30:00 PM +05:30", point("2026-11-20T16:00:00Z")],
    [
      "en-US",
      "2026-11-20 09:30:00 PM +05:30",
      point("2026-11-20T16:00:00Z"),
      LATER,
      "America/New_York",
    ],
    ["en-US", "2026-11-20 09:30:00 PM America/Los_Angeles", point("2026-11-21T05:30:00Z")],
    ["en-US", "2026-11-20 09:30 PM +05:30", point("2026-11-20T16:00:00Z")],
    ["en-US", "Feb 29 12:30:00 AM sshd", point("2024-02-29T00:30:00Z"), "2024-02-29T06:00:00Z"],
    [
      "en-US",
      "Feb 29 12:30:00 AM sshd",
      point("2024-02-29T05:30:00Z"),
      "2024-02-29T06:00:00Z",
      "America/New_York",
    ],
    ["en-US", "Nov 21 9:30:15 PM INFO x", point("2025-11-21T21:30:15Z")],
    ["en-US", "Nov 21 9:30:15 PM INFO x", point("2025-11-21T12:30:15Z"), LATER, "Asia/Tokyo"],
    ["en-US", "Nov 21 9:30:15 PM INFO x", point("2025-11-22T02:30:15Z"), LATER, "America/New_York"],
    ["en-US", "Nov 21 21:30:15 INFO x", point("2025-11-21T21:30:15Z")],
    // Round 4: a log line starts only with a timed machine stamp and never hides a range end.
    ["en-US", "2026-11-20T13:30 PM to 16:30", "invalid"],
    ["en-US", "2026-11-20T09:30Z - 13pm+05:30", "invalid"],
    ["en-US", "2026-11-20 09:30:00 PM to noon", "invalid"],
    ["en-US", "2026-11-20T09:30Z to noon", "invalid"],
    ["zh-CN", "2026-11-20 20:30:00 昨晚 故障", point("2026-11-20T20:30:00Z")],
    ["zh-TW", "2026-11-20 20:30:00 昨晚 故障", point("2026-11-20T20:30:00Z")],
    ["en-US", "2026-W46 UTC error", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z 2026-11-19 INFO", "invalid"],
    ...["en-US", "ja-JP", "ko-KR", "zh-CN", "ar-SA", "es-ES"].map(
      (locale): [string, string, Want] => [
        locale,
        "2026-11-20 09:30:00 PM_worker ready",
        point("2026-11-20T09:30:00Z"),
      ],
    ),
    ["en-US", "[20/Nov/2026:9:30:15 +0000] INFO", point("2026-11-20T09:30:15Z")],
    ["en-US", "[20/Nov/2026:09:30 +0000] INFO", "invalid"],
    ["en-US", "2026-11-20T13:30:00\nPM", point("2026-11-20T13:30:00Z")],
    ["en-US", "2026-11-20T13:30:00 PM", "invalid"],
    ["de-DE", "gestern abends 3", "invalid"],
    ["th-TH", "เมื่อวาน เช้า 3", "invalid"],
    ["en-US", "hţtps://x/?period=1h", "invalid"],
    ["en-US", "HTTPS://x/?period=1h", ["2026-11-21T11:00:00Z", "2026-11-21T12:00:00Z"]],
    ["en-US", '{"start_date":300,"start_date":100,"end_date":200}', "invalid"],
    // Round 5: a stamp or mark ends at punctuation, and a zone the end takes is its own reading's.
    [
      "en-US",
      "Nov 21 11:30:00 +05:30, INFO",
      point("2026-11-21T06:00:00Z"),
      "2026-11-21T10:00:00Z",
    ],
    [
      "ja-JP",
      "2026-11-20 09:30 Asia/Tokyo から 11",
      ["2026-11-20T00:30:00Z", "2026-11-20T02:00:00Z"],
    ],
    ["ja-JP", "2026-11-20 09:30 IST から 11", "ambiguous"],
    ["en-US", "2026-11-20T09:30:00Z to p.m.", "invalid"],
    ["zh-CN", "2026-11-20T09:30:00Z 到中午", "invalid"],
    ...["PM, worker", "PM. done", "PM; x", "PM) x", "PM: suspend", "PM.", "PM | x"].map(
      (tail): [string, string, Want] => [
        "en-US",
        `2026-11-20 09:30:15 ${tail}`,
        point("2026-11-20T21:30:15Z"),
      ],
    ),
    ["en-US", "2026-11-20 09:30:15 PM_worker", point("2026-11-20T09:30:15Z")],
    ["en-US", "2026-11-20 09:30:15 pm2 restart", point("2026-11-20T09:30:15Z")],
    // Round 6: text after a stamp that could start a range is refused, never read as message text.
    ["en-US", "2026-11-20 09:30:15 until restart", "invalid"],
    ["en-US", "2026-11-20 09:30:15 to do", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z through gateway", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z to upstream", "invalid"],
    ["es-ES", "2026-11-20T09:30:00Z a usuario", "invalid"],
    ["es-ES", "2026-11-20T09:30:00Z al servidor", "invalid"],
    ["it-IT", "2026-11-20T09:30:00Z a server", "invalid"],
    ["pt-PT", "2026-11-20T09:30:00Z a servidor", "invalid"],
    ["fr-FR", "2026-11-20T09:30:00Z à serveur", "invalid"],
    ["es-ES", "2026-11-20T21:30:15Z a.m. x", "invalid"],
    [
      "en-US",
      '{"\\u0073tart_date":100,"end_date":200}',
      ["1970-01-01T00:00:00.0001Z", "1970-01-01T00:00:00.0002Z"],
    ],
    ["en-US", '{"start_date":300,"\\u0073tart_date":100,"end_date":200}', "invalid"],
    [
      "en-US",
      '{"\\u0073tart_date":{"x":"start_date"},"\\u0073tart_date":100,"end_date":200}',
      "invalid",
    ],
    ["en-US", "2026-11-20T09:30:00Z - 7 200", "invalid"],
    ["en-US", "2026-11-20T09:30 AM-10:00", ["2026-11-20T09:30:00Z", "2026-11-20T10:00:00Z"]],
    ["en-US", "2026-11-20 9:30 AM-10:30", ["2026-11-20T09:30:00Z", "2026-11-20T10:30:00Z"]],
    ["en-US", "2026-11-20T09:30 AM-10:00 INFO", "invalid"],
    ["en-US", "2026-11-01 from 00:30 America/New_York to 01:30", "ambiguous"],
    ["en-US", "2026-11-20T13:30:00 PM +05:30 to 16:30", "invalid"],
    ["en-US", "2026-11-20T13:30:00 PM, to 16:30", "invalid"],
    ["en-US", "2026-11-20 09:30:15 PM, to 16:30", "invalid"],
    ["zh-CN", "2026-11-20 20:30:00 昨晚", point("2026-11-20T20:30:00Z")],
    ["en-US", "2026-11-20T09:30:00Z - 25:00UTC", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z to noon UTC", "invalid"],
    ["de-DE", "2026-11-20 09:30:00 PM to noon", "invalid"],
    ["en-US", "Nov 21 09:30:00\n+05:30", point("2025-11-21T09:30:00Z"), "2026-11-21T08:00:00Z"],
    [
      "en-US",
      "Nov 21 09:30:00\n+05:30 INFO",
      point("2025-11-21T09:30:00Z"),
      "2026-11-21T08:00:00Z",
    ],
    ["en-US", "ｈｔｔｐｓ://x/?period=1h", "invalid"],
    ["en-US", "2026-11-20 09:30:15 to 12 noon", ["2026-11-20T09:30:15Z", "2026-11-20T12:00:00Z"]],
    // Round 6: a log line is its leading seconds stamp; a truncated stamp or glued sign is refused.
    ["en-US", "2026-11-20T09:30:00Z..", "incomplete"],
    ["en-US", "2026-11-20T09:30:00Z→25:00", "invalid"],
    ["en-US", "2026-11-20 13:30:15 p. m. to 16:00", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z - 11 PM.", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z - 11 PM", ["2026-11-20T09:30:00Z", "2026-11-20T23:00:00Z"]],
    ["en-US", "2026-11-20T09:30:00+05:3", "invalid"],
    ["en-US", "2026-11-20T09:30:00+05:3 INFO", "invalid"],
    ["en-US", "2026-11-20T09:30:5Z", "invalid"],
    ["en-US", "2026-11-20T09:30:00Z, 2026-11-20T11:30:00Z", "invalid"],
    ["ja-JP", "2026-11-20 09:30:15 PM𠮷田", point("2026-11-20T09:30:15Z")],
    ["en-US", "2026-11-20 12:00:00 Midnight Commander started", point("2026-11-20T12:00:00Z")],
    ["de-DE", "2026-11-20 12:00:00 Midnight Commander gestartet", point("2026-11-20T12:00:00Z")],
    ...(
      [
        ["es-ES", "a un servidor"],
        ["fr-FR", "à un serveur"],
        ["pt-PT", "a um servidor"],
        ["de-DE", "bis zwei Knoten antworten"],
        ["ja-JP", "より朝刊を配信"],
        ["zh-CN", "到下午茶服务"],
        ["ko-KR", "에서 세션 종료"],
        ["en-US", "to PM_worker"],
        ["en-US", "to one node"],
        ["en-US", "until today's backup"],
        ["en-US", "to upstream HTTP 503"],
        ["en-US", "to November"],
        ["en-US", "to Nov"],
        ["es-ES", "a las"],
      ] as [string, string][]
    ).map(([locale, tail]): [string, string, Want] => [
      locale,
      `2026-11-20T09:30:00Z ${tail}`,
      "invalid",
    ]),
    ["en-US", "\nNov 21 21:30:15", point("2025-11-21T21:30:15Z"), "2026-11-21T16:00:00Z"],
    ["en-US", "2026-11-20 09:30:15 PM+15:00", "invalid"],
    ["en-US", "2026-11-20T09:30:15\n+05:30 to 11", point("2026-11-20T09:30:15Z")],
    ["en-US", '{"start_date":1794913200000000.1,"end_date":1794916800000000}', "invalid"],
    ...(
      [
        ["fr-FR", "à midi"],
        ["fr-FR", "à minuit"],
        ["es-ES", "a mediodía"],
        ["es-ES", "a medianoche"],
        ["de-DE", "bis Mittag"],
        ["it-IT", "a mezzogiorno"],
        ["nl-NL", "tot middag"],
        ["ru-RU", "до полудня"],
      ] as [string, string][]
    ).map(([locale, tail]): [string, string, Want] => [
      locale,
      `2026-11-20 09:30:15 ${tail}`,
      "invalid",
    ]),
    ["en-US", "12:30 noon", "invalid"],
    ["en-US", "12 noon", point("2026-11-21T12:00:00Z"), NIGHT],
    ["en-US", "12:00 noon", point("2026-11-21T12:00:00Z"), NIGHT],
    ["en-US", "12 midnight", point("2026-11-21T00:00:00Z"), NIGHT],
    ["en-US", "00:00 midnight", point("2026-11-21T00:00:00Z"), NIGHT],
    ["en-US", "0:30 midnight", "invalid"],
    ...["PM-worker", "PM/api", "PM–x", "p.m.-x"].map((tail): [string, string, Want] => [
      "en-US",
      `2026-11-20 09:30:15 ${tail}`,
      "invalid",
    ]),
    ...["PMx ready", "PMé ready", "PM_worker ready"].map((tail): [string, string, Want] => [
      "en-US",
      `2026-11-20 09:30:15 ${tail}`,
      point("2026-11-20T09:30:15Z"),
    ]),
    // Ranges never drop an end.
    ["en-US", "2026-11-20 09:30Z - 11 UTC", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]],
    ["en-US", "2026-11-20 09:30Z to 11 UTC", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]],
    ["en-US", "2026-11-20 09:30Z - 11", ["2026-11-20T09:30:00Z", "2026-11-20T11:00:00Z"]],
    ["en-US", "2026-11-20 09:30 - 13:30 PM", "invalid"],
    ["en-US", "2026-11-20 09:30 - PM 13:30", "invalid"],
    ["en-US", "2026-11-20 09:30 - 13pm", "invalid"],
    ["en-US", "9:30 - 13pm", "invalid"],
    ["en-US", "2026-11-20 9:30 pm-noon", "invalid"],
    ["en-US", "2026-11-20 10:00 2026-11-20 9:30 PM", "invalid"],
    ["en-US", "2026-11-20 00:30+05:00 to 20:30", ["2026-11-19T19:30:00Z", "2026-11-20T15:30:00Z"]],
    ["en-US", "2026-11-20 00:30+05:00 to 21:00", ["2026-11-19T19:30:00Z", "2026-11-20T16:00:00Z"]],
    [
      "en-US",
      "Nov 20, 2026 00:30+05:00 to 20:30",
      ["2026-11-19T19:30:00Z", "2026-11-20T15:30:00Z"],
    ],
    ["en-US", "2026-11-20 from 2026-10-02 to 2026-10-05", "invalid"],
    ["en-US", "Nov 20 from 2026-10-02 to 2026-10-05", "invalid"],
    [
      "en-US",
      "2026-11-20 09:00 - 2026-11-20 17:00",
      ["2026-11-20T14:00:00Z", "2026-11-20T22:00:00Z"],
      LATER,
      "America/New_York",
    ],
    // Pasted log lines: a mark binds to a zoneless 12-hour stamp, else it is message text.
    ["en-US", "2026-11-20 9:30:15 PM INFO started", point("2026-11-20T21:30:15Z")],
    ["en-US", "2026-11-20T09:30:00Z PM: suspend entry", "invalid"],
    ["en-US", "2026-11-20 21:30:15 pm2 restarted app", point("2026-11-20T21:30:15Z")],
    ["en-US", "2026-11-20 21:30:15 AM radio up", "invalid"],
    ["en-US", "2026-11-20T21:30:15Z pm worker", "invalid"],
    ["ja-JP", "2026/11/20 21:30:15 午後のバッチ開始", point("2026-11-20T21:30:15Z")],
    ["ko-KR", "2026-11-20 21:30:15 오후 작업 시작", "invalid"],
    ["en-US", "2026-11-20T13:30:00 PM", "invalid"],
    // A mark next to a clock, Latin AM/PM in every pack.
    ["en-US", "2026-11-20 9am", point("2026-11-20T09:00:00Z")],
    ["en-US", "2026-11-20 9", point("2026-11-20T09:00:00Z")],
    ["en-US", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["en-US", "2026-11-20 9:30 pm", point("2026-11-20T21:30:00Z")],
    ["en-US", "Nov 20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["en-US", "2026-11-20T09:30 PM", point("2026-11-20T21:30:00Z")],
    ["en-US", "2026-11-20T09:30:00 PM", point("2026-11-20T21:30:00Z")],
    ["en-US", "9:30 PM", point("2026-11-21T21:30:00Z"), NIGHT],
    ["en-US", "12am", point("2026-11-21T00:00:00Z"), NIGHT],
    ["en-US", "12pm", point("2026-11-21T12:00:00Z"), NIGHT],
    ["en-US", "13:30 in the afternoon", point("2026-11-21T13:30:00Z"), NIGHT],
    ["es-ES", "2026-11-20 9:30 p.m.", point("2026-11-20T21:30:00Z")],
    ["es-ES", "9:30 p.m.", point("2026-11-21T21:30:00Z"), NIGHT],
    ["ja-JP", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["ko-KR", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["zh-CN", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["tr-TR", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ["ar-SA", "2026-11-20 9:30 PM", point("2026-11-20T21:30:00Z")],
    ...["de-DE", "ja-JP", "ko-KR", "zh-CN", "tr-TR", "ar-SA"].map(
      (locale): [string, string, Want, string] => [
        locale,
        "9:30 PM",
        point("2026-11-21T21:30:00Z"),
        NIGHT,
      ],
    ),
    // Year-less month-first stamps take no mark outside a log line, and de reads no month-first date.
    ["de-DE", "Nov 20 9:30 AM", "invalid"],
    ["ja-JP", "昨日午後0:30", point("2026-11-20T12:30:00Z")],
    ["ja-JP", "昨日午前0:30", point("2026-11-20T00:30:00Z")],
    ["ja-JP", "昨日午前0:00", point("2026-11-20T00:00:00Z")],
    ["en-US", "2026-11-20 00:30 am", "invalid"],
    ["en-US", "2026-11-20 0:30 pm", "invalid"],
    ["en-US", "2026-11-20 13:30 pm", "invalid"],
    ["en-US", "2026-11-20 13:30 am", "invalid"],
    ["en-US", "PM 13:30", "invalid"],
    // Day parts keep an explicit 24-hour clock only inside their range.
    ["ar-SA", "أمس ١٦:٣٠ عصرا", point("2026-11-20T16:30:00Z")],
    ["ar-SA", "أمس 16:30 عصرا", point("2026-11-20T16:30:00Z")],
    ["ar-SA", "أمس ٠٠:٣٠ عصرا", "invalid"],
    ["ar-SA", "أمس ٠٠:٣٠ ظهرا", "invalid"],
    ["ar-SA", "أمس 0:30 ظهرا", "invalid"],
    ["ar-SA", "أمس ٢٣:٣٠ ظهرا", "invalid"],
    ["th-TH", "เมื่อวาน เช้า 1:00", "invalid"],
    ["de-DE", "gestern  nachmittags9:00", "invalid"],
    ["ru-RU", "вчера  утра13:00", "invalid"],
    // A refused one-digit hour typed last can still grow into a fit.
    ["en-US", "yesterday PM 0", "incomplete"],
    ["en-US", "PM 0", "incomplete"],
    ["de-DE", "gestern abends 2", "incomplete"],
    ["ko-KR", "어제 오후 0", "incomplete"],
    ["th-TH", "เมื่อวาน เช้า 0", "incomplete"],
    ["en-US", "2026-11-20 9p", "incomplete"],
    ["en-US", "2026112009", "blocked"],
    ["en-US", "1763600000", point("2025-11-20T00:53:20Z")],
  ];

  it.each(rows)("%s %s", async (locale, text, want, now = LATER, zone = "UTC") => {
    const r = parseTimeRangeInput(baseContext(await packFor(locale), text, now, zone));
    if (typeof want === "string") {
      expect(r.state, JSON.stringify(r)).toBe(want);
      return;
    }
    if (r.state !== "valid") throw new Error(`${text}: ${JSON.stringify(r)}`);
    const [from, to] = want.map(isoUs);
    const window = from === to ? 300_000_000 : 0;
    expect([r.reading.startUs, r.reading.endUs]).toEqual([from - window, to + window]);
  });

  it.each(["2026-11-20 09:30 IST から 11", "2026-11-20 from 09:30 IST to 11"])(
    "C2: each start meaning gives one range, ending in its own zone: %s",
    async (text) => {
      const spans = async (t: string, locale: string) => {
        const r = parseTimeRangeInput(baseContext(await packFor(locale), t, LATER, "UTC"));
        return r.state === "ambiguous" ? r.readings.map((x) => [x.startUs, x.endUs]) : r.state;
      };
      const joined = await spans("2026-11-20 09:30 IST - 11", "en-US");
      expect(joined).toHaveLength(3);
      expect(await spans(text, text.includes("から") ? "ja-JP" : "en-US")).toEqual(joined);
    },
  );
});
