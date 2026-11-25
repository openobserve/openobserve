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

import {
  EN_US_TIME_RANGE_PACK,
  formatTimeRangeInput,
  loadTimeRangeLocale,
  parseTimeRangeInput,
} from "../index";
import type { TimeRangePack, TimeRangeParseResult, TimeRangeReading } from "../types";
import { ALL_LOCALES, baseContext, isoUs } from "./helpers";
import { prng } from "./prng";

const SEED = 20261120;
const NOW = "2026-11-18T13:32:00Z";
const ZONES = [
  "Europe/Berlin",
  "America/New_York",
  "Asia/Kolkata",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "America/St_Johns",
  "UTC",
];
// The paste and copy inputs of the picker-polish spike, read in en-us and written back.
const SPIKE = [
  "15m",
  "last 15m",
  "Past 15 Minutes",
  "90m",
  "2h",
  "7d",
  "2w",
  "last 3 months",
  "now-15m",
  "now-3M",
  "now-15m to now",
  "45s",
  "today",
  "yesterday",
  "this week",
  "last week",
  "this month",
  "last month",
  "this quarter",
  "last quarter",
  "calendar:day:0",
  "calendar:week:-1",
  "2026-11-18T14:17:00+01:00 – 2026-11-18T14:32:00+01:00",
  "2026-11-18T14:17:00+01:00/2026-11-18T14:32:00+01:00",
  "2026-11-17T09:14:03.120456+01:00 – 2026-11-17T09:19:03.5+01:00",
  "2026-11-18 14:17:00 Europe/Berlin – 14:32:00 Europe/Berlin",
  "2026-10-25T02:30:00+02:00 – 2026-10-25T04:00:00+01:00",
  "2026-10-25T02:30:00+01:00 – 2026-10-25T04:00:00+01:00",
  '{"start_date":1795000000000000,"end_date":1795000900000000}',
];

function parse(pack: TimeRangePack, text: string, zone: string): TimeRangeParseResult {
  return parseTimeRangeInput({ ...baseContext(pack, text, NOW, zone), source: "paste" });
}

function key(r: TimeRangeReading) {
  return [r.kind, r.startUs, r.endUs, r.rolling, r.calendarToken];
}

function randomRange(
  rnd: () => number,
): Pick<TimeRangeReading, "kind" | "startUs" | "endUs" | "rolling" | "calendarToken"> {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const kind = pick(["rolling", "calendar", "absolute"] as const);
  if (kind === "rolling") {
    const unit = pick(["s", "m", "h", "d", "w", "M"] as const);
    return { kind, startUs: 0, endUs: 0, rolling: { value: 1 + Math.floor(rnd() * 99), unit } };
  }
  if (kind === "calendar") {
    const unit = pick(["day", "week", "month", "quarter", "year"]);
    return {
      kind,
      startUs: 0,
      endUs: 0,
      calendarToken: `calendar:${unit}:${-Math.floor(rnd() * 4)}`,
    };
  }
  const now = isoUs(NOW);
  const startUs = Math.floor(rnd() * now);
  const fraction = rnd() < 0.5 ? 0 : Math.floor(rnd() * 1_000_000);
  const endUs = Math.min(
    now,
    startUs + 1 + Math.floor(rnd() * 400 * 86_400) * 1_000_000 + fraction,
  );
  return { kind, startUs, endUs };
}

describe("formatTimeRangeInput", () => {
  it("writes rolling, calendar and absolute ranges in their documented forms", () => {
    const zone = { zone: "Europe/Berlin" };
    const at = (iso: string) => isoUs(iso);
    expect(
      formatTimeRangeInput(
        { kind: "rolling", startUs: 0, endUs: 0, rolling: { value: 3, unit: "M" } },
        zone,
      ),
    ).toBe("now-3M");
    expect(
      formatTimeRangeInput(
        { kind: "calendar", startUs: 0, endUs: 0, calendarToken: "calendar:day:0" },
        zone,
      ),
    ).toBe("calendar:day:0");
    expect(
      formatTimeRangeInput(
        {
          kind: "absolute",
          startUs: at("2026-11-17T08:14:03.120456Z"),
          endUs: at("2026-07-01T10:00:00Z"),
        },
        zone,
      ),
    ).toBe("2026-11-17T09:14:03.120456+01:00 - 2026-07-01T12:00:00+02:00");
    expect(
      formatTimeRangeInput({ kind: "absolute", startUs: 0, endUs: 1 }, { zone: "Not/AZone" }),
    ).toBeNull();
    expect(
      formatTimeRangeInput({ kind: "absolute", startUs: 0, endUs: Number.NaN }, zone),
    ).toBeNull();
  });

  it("reads the spike inputs back as the same range in every pack and zone", async () => {
    const packs = await Promise.all(ALL_LOCALES.map((l) => loadTimeRangeLocale(l)));
    for (const text of SPIKE) {
      for (const zone of ZONES) {
        const first = parse(packs[0], text, zone);
        if (first.state !== "valid") throw new Error(`${zone} ${text}: ${JSON.stringify(first)}`);
        const written = formatTimeRangeInput(first.reading, { zone });
        expect(written, text).not.toBeNull();
        for (const pack of packs) {
          const again = parse(pack, written ?? "", zone);
          const label = `${pack.locale} ${zone} ${text} -> ${written}`;
          expect(again.state === "valid" && key(again.reading), label).toEqual(key(first.reading));
        }
      }
    }
  });

  it("round-trips seeded ranges in all packs and zones", async () => {
    const rnd = prng(SEED);
    const packs = await Promise.all(ALL_LOCALES.map((l) => loadTimeRangeLocale(l)));
    for (let i = 0; i < 1500; i++) {
      const zone = ZONES[Math.floor(rnd() * ZONES.length)];
      const pack = packs[Math.floor(rnd() * packs.length)];
      const range = randomRange(rnd);
      const written = formatTimeRangeInput(range, { zone }) ?? "";
      const r = parse(pack, written, zone);
      const label = `seed ${SEED} case ${i}: ${pack.locale} ${zone} ${written}`;
      if (r.state !== "valid") throw new Error(`${label}: ${JSON.stringify(r)}`);
      if (range.kind === "absolute")
        expect(key(r.reading), label).toEqual(key({ ...r.reading, ...range }));
      else {
        expect([r.reading.kind, r.reading.rolling, r.reading.calendarToken], label).toEqual([
          range.kind,
          range.rolling,
          range.calendarToken,
        ]);
        expect(formatTimeRangeInput(r.reading, { zone }), label).toBe(written);
      }
    }
  });
});

describe("formatTimeRangeInput round trips (review findings)", () => {
  const ctx = (text: string, zone = "UTC", now = NOW) => ({
    ...baseContext(EN_US_TIME_RANGE_PACK, text, now, zone),
    limits: { allowFuture: true },
  });

  it("pastes back a rolling range over 999999 units (P2)", () => {
    const r = parseTimeRangeInput(ctx("12d1s"));
    if (r.state !== "valid") throw new Error(JSON.stringify(r));
    const text = formatTimeRangeInput(r.reading, { zone: "UTC" });
    const back = parseTimeRangeInput(ctx(text ?? ""));
    expect(back.state === "valid" && back.reading.rolling).toEqual(r.reading.rolling);
  });

  it("pastes back an absolute range at a historical -10:40 offset (P5)", () => {
    const zone = "Pacific/Kiritimati";
    const range = {
      kind: "absolute" as const,
      startUs: isoUs("1975-01-01T12:00:00Z"),
      endUs: isoUs("1975-01-01T13:00:00Z"),
    };
    const text = formatTimeRangeInput(range, { zone });
    expect(text).not.toContain("-10:40");
    const back = parseTimeRangeInput(ctx(text ?? "", zone));
    expect(back.state === "valid" && [back.reading.startUs, back.reading.endUs]).toEqual([
      range.startUs,
      range.endUs,
    ]);
  });
});
