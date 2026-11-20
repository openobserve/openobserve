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

import { EN_US_TIME_RANGE_PACK, loadTimeRangeLocale, parseTimeRangeInput } from "../index";
import { normalize, rawSpan, textToRaw } from "../normalize";
import { check } from "../policy";
import type { ParseContext, TimeRangeParseResult, TimeRangeReading } from "../types";
import { offsetAtInstant, offsetLabel } from "../zone";
import { ALL_LOCALES, baseContext } from "./helpers";
import { prng } from "./prng";

const SEED = 20261119;
const STATES = ["empty", "incomplete", "invalid", "ambiguous", "valid", "blocked"];
const PIECES = [
  "last ",
  "15",
  "2",
  "m",
  "M",
  "h",
  "d",
  " to ",
  "-",
  "–",
  ":",
  "/",
  "..",
  "~",
  "2026-11-16",
  "T09:00:00",
  "Z",
  "+05:30",
  "yesterday",
  "gestern",
  "昨日",
  "어제",
  "前",
  "分",
  "١٥",
  "๑๕",
  "１５",
  "ｍ",
  "𝟙",
  "now",
  "/d",
  " ",
  "\t",
  "\n",
  "́",
  "가",
  "😀",
  "\ud800",
  "\udc00",
  "IST",
  "Uhr",
  "seit ",
  "von ",
  " bis ",
  "{",
  '"start_date":',
  "?period=",
  "ago",
  "il y a ",
  "منذ ",
  "آخر ",
  "ย้อนหลัง ",
  "最近",
  "1794819600",
];

function randomText(rnd: () => number): string {
  const target = Math.floor(rnd() * 600);
  let text = "";
  while (text.length < target) text += PIECES[Math.floor(rnd() * PIECES.length)];
  return rnd() < 0.5 ? text.slice(0, Math.floor(rnd() * 40)) : text;
}

function selectable(r: TimeRangeParseResult): TimeRangeReading[] {
  if (r.state === "valid") return [r.reading];
  if (r.state === "ambiguous") return r.readings.filter((x) => !x.blocked);
  if (r.state === "incomplete") return r.completions;
  if (r.state === "blocked") return r.fix ? [r.fix] : [];
  return [];
}

function assertReading(r: TimeRangeReading, ctx: ParseContext, seed: string): void {
  expect(r.startUs < r.endUs, seed).toBe(true);
  expect(Number.isSafeInteger(r.startUs) && Number.isSafeInteger(r.endUs), seed).toBe(true);
  expect(r.startOffset, seed).toBe(offsetLabel(offsetAtInstant(ctx.zone, r.startUs)));
  expect(r.endOffset, seed).toBe(offsetLabel(offsetAtInstant(ctx.zone, r.endUs)));
  const again = check(
    { startUs: r.startUs, endUs: r.endUs, softEnd: false, kind: r.kind, notes: [] },
    ctx,
  );
  expect(again.reasons, seed).toEqual([]);
}

describe("normalize properties", () => {
  it("is idempotent, keeps fold aligned with text and maps offsets monotonically", () => {
    const rnd = prng(SEED);
    for (let i = 0; i < 2000; i++) {
      const raw = randomText(rnd).slice(0, 120);
      const n = normalize(raw, "tr-TR", "latin");
      if (typeof n === "string") continue;
      const again = normalize(n.text, "tr-TR", "latin");
      expect(
        typeof again === "string" ? again : [again.text, again.fold],
        `seed ${SEED} case ${i}`,
      ).toEqual([n.text, n.fold]);
      expect(n.fold.length).toBe(n.text.length);
      const matched = textToRaw(raw, n.text).toRaw.filter((x) => x >= 0);
      expect(matched, `seed ${SEED} case ${i}`).toEqual([...matched].sort((a, b) => a - b));
    }
  });

  it("maps text code-unit offsets after an astral character to the raw span", () => {
    const raw = "😀😀 ab";
    expect(rawSpan(raw, raw, 5, 6)).toEqual([5, 6]);
    expect(rawSpan(raw, raw, 4, 6)).toEqual([4, 6]);
  });

  it("composes decomposed Hangul and halfwidth kana in one pass", () => {
    const hangul = normalize("어제".normalize("NFD"), "ko-KR", "other");
    expect(typeof hangul !== "string" && hangul.text).toBe("어제");
    const kana = normalize("ｶﾞ", "ja-JP", "other");
    expect(typeof kana !== "string" && kana.text).toBe("ガ");
  });
});

describe("parser properties", () => {
  it("never throws, returns one of six states and keeps every offered reading sound", async () => {
    const rnd = prng(SEED);
    const packs = await Promise.all(ALL_LOCALES.map((l) => loadTimeRangeLocale(l)));
    const zones = [
      "Europe/Berlin",
      "America/New_York",
      "Australia/Lord_Howe",
      "Asia/Kolkata",
      "UTC",
    ];
    for (let i = 0; i < 2000; i++) {
      const ctx: ParseContext = {
        ...baseContext(packs[Math.floor(rnd() * packs.length)], randomText(rnd)),
        zone: zones[Math.floor(rnd() * zones.length)],
      };
      const r = parseTimeRangeInput(ctx);
      expect(STATES, `seed ${SEED} case ${i}`).toContain(r.state);
      for (const reading of selectable(r)) assertReading(reading, ctx, `seed ${SEED} case ${i}`);
    }
  });

  it("keeps the case of month and minute units through the whole pipeline; a URL `M` is months", () => {
    const parse = (text: string) => parseTimeRangeInput(baseContext(EN_US_TIME_RANGE_PACK, text));
    const m15 = parse("15M");
    expect(m15.state === "ambiguous" && m15.readings.map((r) => r.rolling?.unit)).toEqual([
      "m",
      "M",
    ]);
    const url = parse("?period=15M");
    expect(url.state === "valid" && url.reading.rolling).toEqual({ value: 15, unit: "M" });
    const urlMinutes = parse("?period=15m");
    expect(urlMinutes.state === "valid" && urlMinutes.reading.rolling).toEqual({
      value: 15,
      unit: "m",
    });
    const minutes = parse("15m");
    expect(minutes.state === "valid" && minutes.reading.rolling).toEqual({ value: 15, unit: "m" });
    const month = parse("now-1M/M");
    expect(month.state === "valid" && new Date(month.reading.startUs / 1000).toISOString()).toBe(
      "2026-09-30T22:00:00.000Z",
    );
  });
});
