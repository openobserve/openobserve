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

import {
  addDays,
  addMonths,
  dayStart,
  isValidDate,
  wallUs,
  weekStartOf,
  US_PER_H,
  US_PER_MIN,
  US_PER_S,
  type Civil,
} from "./civil";
import { isZone, offsetAtInstant, offsetLabel, resolveCivil, wallAt } from "./zone";
import type { Alt, AmbiguityReason, ClockValue, Point, UnitKey } from "./types";

export interface Scanned<T> {
  end: number;
  alts: Alt<T>[];
}

export type ZoneAlt = { zone: string } | { offsetSec: number };

/** The marked readings of a stamp clock that ends at `at`, each with the end of its mark. */
export type Marker = (at: number, c: ClockValue) => [number, ClockValue][];

/** What a zone suffix follows: 0 a phrase clock or hand-typed stamp, 1 an ISO stamp, 2 a `T` or seconds. */
export type ZoneHost = 0 | 1 | 2;

export interface MathPoint {
  end: number;
  /** One instant, or both readings when a calendar step lands in a repeated hour. */
  alts: Alt<Point>[];
  snapped: boolean;
  offsets: { sign: number; n: number; unit: UnitKey }[];
}

const EN_MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
// Letter abbreviations as offsets (minutes); several ask. A DST pair keeps its own fixed offset, so
// `EST` in summer is still UTC-5 and two stamps never disagree with their written abbreviations.
const ZONE_ABBREVIATIONS: Record<string, number[]> = {
  IST: [330, 120, 60],
  BST: [60, 360],
  AST: [-240, 180],
  EST: [-300],
  EDT: [-240],
  CST: [-360],
  CDT: [-300],
  MST: [-420],
  MDT: [-360],
  PST: [-480],
  PDT: [-420],
  AKST: [-540],
  AKDT: [-480],
  HST: [-600],
  WET: [0],
  WEST: [60],
  CET: [60],
  CEST: [120],
  EET: [120],
  EEST: [180],
  MSK: [180],
  SAST: [120],
  PKT: [300],
  NPT: [345],
  ICT: [420],
  SGT: [480],
  HKT: [480],
  AWST: [480],
  JST: [540],
  KST: [540],
  ACST: [570],
  AEST: [600],
  AEDT: [660],
  NZST: [720],
  NZDT: [780],
  ART: [-180],
};
export const UNIT_US: Partial<Record<UnitKey, number>> = {
  s: US_PER_S,
  m: US_PER_MIN,
  h: US_PER_H,
};
export const WINDOW_US = 5 * US_PER_MIN;
// A year-less Feb 29 can lie up to eight years back (2096 to 2104).
export const YEARS_BACK = 8;

export function isDigit(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c >= 48 && c <= 57;
}

function isUpper(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c >= 65 && c <= 90;
}

function isAlpha(text: string, i: number): boolean {
  const c = text.charCodeAt(i) | 32;
  return c >= 97 && c <= 122;
}

/** Exactly `n` digits at `pos`, or -1. */
export function fixedDigits(text: string, pos: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) {
    if (!isDigit(text, pos + i)) return -1;
    v = v * 10 + text.charCodeAt(pos + i) - 48;
  }
  return v;
}

export function digitRun(text: string, pos: number): number {
  let i = pos;
  while (isDigit(text, i)) i++;
  return i - pos;
}

/** `HH:MM[:SS[.f]]` with 1-2 hour digits and up to 9 fraction digits, truncated to microseconds. */
export function scanColonClock(text: string, pos: number): { end: number; c: ClockValue } | null {
  const hl = digitRun(text, pos);
  if (hl < 1 || hl > 2 || text[pos + hl] !== ":") return null;
  const h = fixedDigits(text, pos, hl);
  const mi = fixedDigits(text, pos + hl + 1, 2);
  if (mi < 0 || isDigit(text, pos + hl + 3) || h > 23 || mi > 59) return null;
  let end = pos + hl + 3;
  let s = 0;
  let us = 0;
  if (text[end] === ":" && fixedDigits(text, end + 1, 2) >= 0 && !isDigit(text, end + 3)) {
    s = fixedDigits(text, end + 1, 2);
    if (s > 59) return null;
    end += 3;
    if ((text[end] === "." || text[end] === ",") && isDigit(text, end + 1)) {
      const fl = digitRun(text, end + 1);
      if (fl > 9) return null;
      const frac = text.slice(end + 1, end + 1 + fl).padEnd(9, "0");
      us = Number(frac.slice(0, 6));
      end += 1 + fl;
    }
  }
  return { end, c: { h, mi, s, us, word: false, ...(end > pos + hl + 3 ? { sec: true } : {}) } };
}

/** A signed offset in the real range: -12:00..+14:00, minutes 00, 30 or 45. */
export function scanOffset(text: string, pos: number): { end: number; sec: number } | null {
  const sign = text[pos] === "+" ? 1 : text[pos] === "-" ? -1 : 0;
  if (sign === 0) return null;
  const hl = digitRun(text, pos + 1);
  let h = -1;
  let mi = 0;
  let end = pos + 1 + hl;
  if (hl === 4) {
    h = fixedDigits(text, pos + 1, 2);
    mi = fixedDigits(text, pos + 3, 2);
  } else if (hl === 1 || hl === 2) {
    h = fixedDigits(text, pos + 1, hl);
    if (text[end] === ":" && digitRun(text, end + 1) === 2) {
      mi = fixedDigits(text, end + 1, 2);
      end += 3;
    }
  }
  const top = sign > 0 ? 14 : 12;
  if (h < 0 || h > top || (h === top && mi !== 0) || (mi !== 0 && mi !== 30 && mi !== 45))
    return null;
  return { end, sec: sign * (h * 3600 + mi * 60) };
}

/** One tag per family, space-joined; combine.ts `sameTag` reads them. */
export function joinTags(a: string | undefined, b: string | undefined): string | undefined {
  return a && b ? `${a} ${b}` : (a ?? b);
}

/** A zone suffix: `Z`, `±hh[:mm]`, `UTC`/`GMT[±h]`, an IANA name, or a known abbreviation. */
export function scanZone(text: string, pos: number): Scanned<ZoneAlt>[] {
  const out: Scanned<ZoneAlt>[] = [];
  const bounded = (end: number): boolean => end >= text.length || !isAlpha(text, end);
  if (text[pos] === "Z" && bounded(pos + 1))
    out.push({ end: pos + 1, alts: [{ v: { offsetSec: 0 } }] });
  const off = scanOffset(text, pos);
  if (off && !isDigit(text, off.end))
    out.push({ end: off.end, alts: [{ v: { offsetSec: off.sec } }] });
  const word = text.slice(pos, pos + 3);
  if ((word === "UTC" || word === "GMT") && bounded(pos + 3)) {
    out.push({ end: pos + 3, alts: [{ v: { offsetSec: 0 } }] });
    const tail = scanOffset(text, pos + 3);
    if (tail && !isDigit(text, tail.end))
      out.push({ end: tail.end, alts: [{ v: { offsetSec: tail.sec } }] });
  }
  let i = pos;
  while (isUpper(text, i)) i++;
  const abbr = ZONE_ABBREVIATIONS[text.slice(pos, i)];
  if (i - pos >= 2 && abbr !== undefined && bounded(i)) {
    const why: AmbiguityReason | undefined = abbr.length > 1 ? "zone-abbreviation" : undefined;
    const alts: Alt<ZoneAlt>[] = abbr.map((m) => ({
      v: { offsetSec: m * 60 },
      why,
      tag: why && `z${m}`,
    }));
    out.push({ end: i, alts });
  }
  if (isAlpha(text, pos)) {
    let j = pos;
    let slash = false;
    while (isAlpha(text, j) || isDigit(text, j) || "_/+-".includes(text[j])) {
      slash = slash || text[j] === "/";
      j++;
    }
    const name = text.slice(pos, j);
    if (slash && isZone(name)) out.push({ end: j, alts: [{ v: { zone: name } }] });
  }
  return out;
}

/** Where a zone suffix after a clock may start; a `phrase` clock admits an attached `-hh:mm`. */
export function zoneStart(text: string, at: number, host: ZoneHost, phrase = false): number | null {
  const gap = text[at] === " ";
  const pos = gap ? at + 1 : at;
  if (text[pos] !== "-") return pos;
  return minusOffset(text, pos, gap, host, phrase) ? pos : null;
}

// The only rule for a `-` after a clock: offset or range end (design 4.5.3). Every path reaches it
// through `zoneStart`; regressions.spec.ts crosses each host with each tail.
function minusOffset(
  text: string,
  pos: number,
  gap: boolean,
  host: ZoneHost,
  phrase: boolean,
): boolean {
  const off = scanOffset(text, pos);
  if (!off) return false;
  const run = digitRun(text, pos + 1);
  if (run === 4) return true;
  if (run === 2 && text[pos + 3] === ":")
    return (phrase && !gap) || (host > 0 && (!gap || off.sec !== 0));
  return run === 2 && !gap && host > 1;
}

/** Applies a zone suffix to a wall clock; a fixed offset gives an instant with a `converted` note. */
export function zonedPoint(
  y: number,
  mo: number,
  d: number,
  clock: ClockValue,
  zone: ZoneAlt,
): Point {
  if ("zone" in zone) return { p: "wall", y, mo, d, clock: { ...clock, zone: zone.zone } };
  const c: Civil = { y, mo, d, h: clock.h, mi: clock.mi, s: clock.s, us: clock.us };
  const us = wallUs(c, zone.offsetSec * US_PER_S);
  return {
    p: "instant",
    us,
    notes: [{ kind: "converted", fromOffset: offsetLabel(zone.offsetSec) }],
    clock: { ...clock, offsetSec: zone.offsetSec },
  };
}

function withZone(
  text: string,
  at: number,
  y: number,
  mo: number,
  d: number,
  clock: ClockValue,
  out: Scanned<Point>[],
  host: ZoneHost,
  mark?: Marker,
): void {
  // A mark binds to the clock before any zone, so a year-less date picks its year after the mark.
  for (const [end, c] of [[at, clock] as const, ...(mark?.(at, clock) ?? [])]) {
    out.push({ end, alts: [{ v: { p: "wall", y, mo, d, clock: c } }] });
    const from = zoneStart(text, end, host);
    for (const z of from === null ? [] : scanZone(text, from)) {
      out.push({
        end: z.end,
        alts: z.alts.map((a) => ({ v: zonedPoint(y, mo, d, c, a.v), why: a.why, tag: a.tag })),
      });
    }
  }
}

/** ISO dates and stamps: `YYYY-MM-DD`, `T` or space, a clock, then an optional zone. */
export function scanIso(text: string, pos: number, mark?: Marker): Scanned<Point>[] {
  const y = fixedDigits(text, pos, 4);
  const sep = text[pos + 4];
  if (y < 0 || (sep !== "-" && sep !== "/") || isDigit(text, pos - 1)) return [];
  if (sep === "-" && text[pos + 5] === "W") return scanIsoWeek(text, pos, y);
  const mo = fixedDigits(text, pos + 5, 2);
  const d = fixedDigits(text, pos + 8, 2);
  if (mo < 0 || d < 0 || text[pos + 7] !== sep || isDigit(text, pos + 10)) return [];
  if (!isValidDate(y, mo, d)) return [];
  const out: Scanned<Point>[] = [{ end: pos + 10, alts: [{ v: { p: "day", y, mo, d } }] }];
  const t = text[pos + 10];
  if (t !== "T" && t !== " ") return out;
  const clock = scanColonClock(text, pos + 11);
  if (!clock) return out;
  withZone(text, clock.end, y, mo, d, clock.c, out, t === "T" || clock.c.sec ? 2 : 1, mark);
  return out;
}

function scanIsoWeek(text: string, pos: number, y: number): Scanned<Point>[] {
  const w = fixedDigits(text, pos + 6, 2);
  if (w < 1 || w > 53 || isDigit(text, pos + 8)) return [];
  const start = addDays(weekStartOf(dayStart(y, 1, 4), 1), (w - 1) * 7);
  // Week 53 exists only when its Thursday still falls in year `y`.
  if (addDays(start, 3).y !== y) return [];
  return [
    { end: pos + 8, alts: [{ v: { p: "day", y: start.y, mo: start.mo, d: start.d, days: 7 } }] },
  ];
}

function monthIndex(text: string, pos: number): number {
  return EN_MONTHS.indexOf(text.slice(pos, pos + 3).toLowerCase()) + 1;
}

/** `[16/Nov/2026:09:12:33 +0100]`, the common log format stamp. */
function scanClf(text: string, pos: number): Scanned<Point>[] {
  const open = text[pos] === "[" ? 1 : 0;
  const p = pos + open;
  const d = fixedDigits(text, p, 2);
  const mo = monthIndex(text, p + 3);
  const y = fixedDigits(text, p + 7, 4);
  if (
    d < 0 ||
    mo < 1 ||
    y < 0 ||
    text[p + 2] !== "/" ||
    text[p + 6] !== "/" ||
    text[p + 11] !== ":"
  )
    return [];
  const clock = scanColonClock(text, p + 12);
  if (!clock || text[clock.end] !== " " || !isValidDate(y, mo, d)) return [];
  const off = scanOffset(text, clock.end + 1);
  if (!off) return [];
  const end = open && text[off.end] === "]" ? off.end + 1 : off.end;
  if (open && end === off.end) return [];
  return [{ end, alts: [{ v: zonedPoint(y, mo, d, clock.c, { offsetSec: off.sec }) }] }];
}

/** `Nov 16 09:12:33` (syslog, no year) and `Nov 16, 2026 09:12:33[.f] [zone]` (the app's display). */
function scanMonthFirst(
  text: string,
  pos: number,
  nowUs: number,
  zone: string,
  mark?: Marker,
): Scanned<Point>[] {
  const mo = monthIndex(text, pos);
  if (mo < 1 || text[pos + 3] !== " " || isAlpha(text, pos - 1)) return [];
  const dl = digitRun(text, pos + 4);
  if (dl < 1 || dl > 2) return [];
  const d = fixedDigits(text, pos + 4, dl);
  let at = pos + 4 + dl;
  let y = -1;
  if (text[at] === "," && text[at + 1] === " ") {
    y = fixedDigits(text, at + 2, 4);
    if (y < 0) return [];
    at += 6;
  }
  if (text[at] !== " ") return [];
  const clock = scanColonClock(text, at + 1);
  if (!clock) return [];
  const read = (yr: number): Scanned<Point>[] => {
    const out: Scanned<Point>[] = [];
    if (isValidDate(yr, mo, d))
      withZone(text, clock.end, yr, mo, d, clock.c, out, clock.c.sec ? 2 : 0, mark);
    return out;
  };
  if (y >= 0) return read(y);
  // Each reading (one per zone suffix and abbreviation meaning) takes the latest year whose instant
  // is not after now; `yw` keeps a range from pairing it with a phrase date's year (`yd`).
  const year = wallAt(zone, nowUs).y;
  // Readings are keyed by their place in the list, since two marks can end at the same place.
  const best: { end: number; alts: (Alt<Point> | undefined)[] }[] = [];
  const done = (): boolean =>
    best.length > 0 && best.every((slots) => slots.alts.every((a) => a !== undefined));
  for (let yr = year + 1; yr >= year - YEARS_BACK && !done(); yr--) {
    read(yr).forEach((s, k) => {
      const slots = (best[k] ??= { end: s.end, alts: s.alts.map(() => undefined) }).alts;
      s.alts.forEach((a, i) => {
        if (!slots[i] && !ahead(a.v, nowUs, zone)) slots[i] = { ...a, tag: joinTags(a.tag, "yw") };
      });
    });
  }
  return best
    .map(({ end, alts }) => ({ end, alts: alts.filter((a): a is Alt<Point> => a !== undefined) }))
    .filter((s) => s.alts.length > 0);
}

function ahead(p: Point, nowUs: number, zone: string): boolean {
  if (p.p === "instant") return p.us > nowUs;
  // The earliest real instant decides: a fold's first pass or a gap's shifted time, never the wall.
  return p.p === "wall" && firstInstant({ ...p, ...p.clock }, p.clock.zone ?? zone) > nowUs;
}

/** Every machine point at `pos`: ISO, CLF, syslog and the app's display format. */
export function scanStamp(
  text: string,
  pos: number,
  nowUs: number,
  zone: string,
  mark?: Marker,
): Scanned<Point>[] {
  return [
    ...scanIso(text, pos, mark),
    ...scanClf(text, pos),
    ...scanMonthFirst(text, pos, nowUs, zone, mark),
  ];
}

/** Exactly 10/13/16/19 digits read as s/ms/µs/ns; `null` when beyond the safe-integer range. */
export function epochUs(digits: string): number | null | undefined {
  const scale: Record<number, bigint> = { 10: 1_000_000n, 13: 1_000n, 16: 1n };
  const big = BigInt(digits);
  const us =
    digits.length === 19
      ? big / 1000n
      : scale[digits.length]
        ? big * scale[digits.length]
        : undefined;
  if (us === undefined) return undefined;
  return us > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(us);
}

export function scanEpoch(text: string, pos: number): Scanned<Point>[] {
  if (isDigit(text, pos - 1)) return [];
  const n = digitRun(text, pos);
  const us = n > 0 ? epochUs(text.slice(pos, pos + n)) : undefined;
  if (us === undefined || us === null) return [];
  return [{ end: pos + n, alts: [{ v: { p: "instant", us, notes: [] } }] }];
}

export function readMathUnit(ch: string | undefined): UnitKey | null {
  if (ch === "M") return "M";
  const lower = ch?.toLowerCase();
  return lower === "s" ||
    lower === "m" ||
    lower === "h" ||
    lower === "d" ||
    lower === "w" ||
    lower === "y"
    ? lower
    : null;
}

function shiftInstant(
  us: number,
  sign: number,
  n: number,
  unit: UnitKey,
  zone: string,
): [number, number] {
  const fixed = UNIT_US[unit];
  if (fixed) return [us + sign * n * fixed, us + sign * n * fixed];
  const c = wallAt(zone, us);
  const shifted =
    unit === "d"
      ? addDays(c, sign * n)
      : unit === "w"
        ? addDays(c, sign * n * 7)
        : addMonths(c, sign * n * (unit === "y" ? 12 : 1));
  const r = resolveCivil(shifted, zone);
  return !r ? [NaN, NaN] : r.kind !== "fold" ? [r.us, r.us] : [r.earlier, r.later];
}

export function firstInstant(c: Civil, zone: string): number {
  const r = resolveCivil(c, zone);
  if (!r) return NaN;
  return r.kind === "fold" ? r.earlier : r.us;
}

function floorInstant(us: number, unit: UnitKey, zone: string): number {
  const c = wallAt(zone, us);
  if (unit === "s" || unit === "m") {
    const size = UNIT_US[unit] ?? US_PER_S;
    const offset = offsetAtInstant(zone, us) * US_PER_S;
    return Math.floor((us + offset) / size) * size - offset;
  }
  if (unit === "h") {
    // Half-hour DST shifts: the hour starts at the latest instant of its wall hour not after `us`.
    const r = resolveCivil({ ...c, mi: 0, s: 0, us: 0 }, zone);
    return !r ? NaN : r.kind !== "fold" ? r.us : r.later <= us ? r.later : r.earlier;
  }
  const day = dayStart(c.y, c.mo, c.d);
  if (unit === "d") return firstInstant(day, zone);
  // `/w` snaps to the rail's `calendar:week`, which starts on Monday in every locale.
  if (unit === "w") return firstInstant(weekStartOf(day, 1), zone);
  if (unit === "M") return firstInstant(dayStart(c.y, c.mo, 1), zone);
  return firstInstant(dayStart(c.y, 1, 1), zone);
}

/** `now`, `now-1h`, `now-1d/d`, `now/w+9h`; `null` when it starts like date math but breaks the grammar. */
export function scanDateMath(
  text: string,
  pos: number,
  nowUs: number,
  zone: string,
): MathPoint | null | undefined {
  if (text.slice(pos, pos + 3).toLowerCase() !== "now" || isAlpha(text, pos + 3)) return undefined;
  let i = pos + 3;
  // Two chains: one takes the earlier instant at every repeated hour, one the later, so a chain of
  // any length and step mix holds at most two readings.
  let chains = [nowUs, nowUs];
  let snapped = false;
  const offsets: MathPoint["offsets"] = [];
  while (i < text.length) {
    const j = text[i] === " " ? i + 1 : i;
    const ch = text[j];
    if (ch === "+" || ch === "-") {
      const k = text[j + 1] === " " ? j + 2 : j + 1;
      const n = digitRun(text, k);
      // Nine digits hold any rolling span the formatter writes (ten years in seconds).
      if (n < 1 || n > 9) return null;
      const value = fixedDigits(text, k, n);
      const unit = readMathUnit(text[k + n]);
      if (!unit || value < 1 || isAlpha(text, k + n + 1)) return null;
      const sign = ch === "-" ? -1 : 1;
      // Equal chains share one zone lookup; they split only where a step lands in a repeated hour.
      const [a, b] = chains;
      const first = shiftInstant(a, sign, value, unit, zone);
      chains = a === b ? first : [first[0], shiftInstant(b, sign, value, unit, zone)[1]];
      offsets.push({ sign, n: value, unit });
      i = k + n + 1;
    } else if (ch === "/" && !snapped) {
      const unit = readMathUnit(text[j + 1]);
      if (!unit || isAlpha(text, j + 2)) return null;
      const [a, b] = chains;
      const first = floorInstant(a, unit, zone);
      chains = [first, a === b ? first : floorInstant(b, unit, zone)];
      snapped = true;
      i = j + 2;
    } else break;
    // Every step stays in the safe range, so offsets that cancel cannot hide a rounding loss.
    if (!chains.every(Number.isSafeInteger)) return null;
  }
  const alts: Alt<Point>[] = [...new Set(chains)].map((us, _, all) => ({
    v: { p: "instant", us, notes: [] },
    why: all.length > 1 ? "repeated-hour" : undefined,
  }));
  return { end: i, alts, snapped, offsets };
}
