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

import { addDays, civilOfWall, dayStart, isValidDate, wallUs, US_PER_H } from "./civil";
import {
  hourIn,
  rangeDrafts,
  rollingDrafts,
  singleDrafts,
  sinceDrafts,
  spanDrafts,
  today,
  weekdayDate,
  type Env,
} from "./combine";
import {
  digitRun,
  fixedDigits,
  isDigit,
  joinTags,
  scanColonClock,
  scanDateMath,
  scanEpoch,
  scanIso,
  scanOffset,
  scanStamp,
  scanZone,
  YEARS_BACK,
  zoneStart,
  type Scanned,
} from "./machine";
import type { Elem, Slot, Words } from "./packs/schema";
import type { Alt, ClockMod, ClockValue, Draft, Outcome, Point, UnitKey } from "./types";

export interface DateVal {
  y: number;
  mo: number;
  d: number;
  /** Set only by day words, whose meaning moves with today, so only they get a calendar token. */
  rel?: boolean;
}

interface NumberHit {
  v: number;
  word: boolean;
  article?: boolean;
  /** Two digits with a leading zero (`05`): a 24-hour clock that takes no day part. */
  padded?: boolean;
}

interface Caps {
  n?: number;
  unit?: { unit: UnitKey; count?: number };
  start?: Alt<Point>[];
  end?: Alt<Point>[];
  day?: Alt<DateVal>[];
  date?: Alt<DateVal>[];
  clock?: Alt<ClockValue>[];
  weekday?: number;
  h?: number;
  hWord?: boolean;
  hPadded?: boolean;
  mi?: number;
  d?: number;
  m?: number;
  y?: number;
  ry?: number;
  month?: number;
}

type Hit<T> = [number, T];

interface Memo<T> {
  hits: Hit<T>[];
  partial: boolean;
}

export interface Scan {
  text: string;
  fold: string;
  len: number;
  env: Env;
  steps: number;
  partial: boolean;
  wantUnit?: number;
  rangeOpen: boolean;
  furthest: number;
  memo: Map<string, Memo<unknown>>;
}

export class BudgetExceeded extends Error {}

const STEP_LIMIT = 150_000;
export const UNIVERSAL_JOINS = ["to", "–", "—", "~", "..", "→", "-", "/"];
const JOIN_LIMIT = 8;
const DAY_PREFIX: Elem = { k: "slot", s: "day" };
const BARE: Elem[] = [
  { k: "slot", s: "n" },
  { k: "slot", s: "unit" },
];

export function newScan(text: string, fold: string, env: Env): Scan {
  return {
    text,
    fold,
    len: fold.length,
    env,
    steps: 0,
    partial: false,
    rangeOpen: false,
    furthest: 0,
    memo: new Map(),
  };
}

function tick(sc: Scan): void {
  if (++sc.steps > STEP_LIMIT) throw new BudgetExceeded();
}

// Letters of scripts written with spaces; a literal may not start or end inside such a word.
export function wordy(c: number): boolean {
  return (
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0xdf && c <= 0x24f && c !== 0xf7) ||
    (c >= 0x1e00 && c <= 0x1eff) ||
    (c >= 0x430 && c <= 0x45f) ||
    (c >= 0x621 && c <= 0x652) ||
    (c >= 0x671 && c <= 0x6d3)
  );
}

/** End of literal `s` at `pos`, where a space in `s` matches zero or one input space; -1 if none. */
function litEnd(sc: Scan, pos: number, s: string): number {
  let i = pos;
  for (let j = 0; j < s.length; j++) {
    if (s[j] === " ") {
      if (sc.fold[i] === " ") i++;
      continue;
    }
    if (i >= sc.len) {
      sc.partial = sc.partial || i > pos;
      return -1;
    }
    if (sc.fold[i] !== s[j]) return -1;
    i++;
  }
  return i;
}

function litAt(sc: Scan, pos: number, s: string): number {
  tick(sc);
  if (pos > 0 && wordy(s.charCodeAt(0)) && wordy(sc.fold.charCodeAt(pos - 1))) return -1;
  const end = litEnd(sc, pos, s);
  if (end < 0) return -1;
  if (end < sc.len && wordy(s.charCodeAt(s.length - 1)) && wordy(sc.fold.charCodeAt(end)))
    return -1;
  sc.furthest = Math.max(sc.furthest, end);
  return end;
}

// A cached hit list replays the partial flag its first computation raised.
function memo<T>(sc: Scan, table: string, pos: number, compute: () => Hit<T>[]): Hit<T>[] {
  const key = table + pos;
  const hit = sc.memo.get(key) as Memo<T> | undefined;
  if (hit) {
    sc.partial = sc.partial || hit.partial;
    return hit.hits;
  }
  const before = sc.partial;
  sc.partial = false;
  const hits = compute();
  sc.memo.set(key, { hits, partial: sc.partial });
  sc.partial = before || sc.partial;
  return hits;
}

function words<T>(sc: Scan, pos: number, list: Words<T>): Hit<T>[] {
  const out: Hit<T>[] = [];
  for (const w of list.get(sc.fold[pos]) ?? []) {
    const end = litAt(sc, pos, w.s);
    if (end >= 0) out.push([end, w.value]);
  }
  return out;
}

function numberHits(sc: Scan, pos: number, maxDigits: number, cjk = true): Hit<NumberHit>[] {
  const out: Hit<NumberHit>[] = [];
  const n = digitRun(sc.text, pos);
  if (n >= 1 && n <= maxDigits && !isDigit(sc.text, pos - 1)) {
    out.push([
      pos + n,
      { v: fixedDigits(sc.text, pos, n), word: false, padded: n === 2 && sc.text[pos] === "0" },
    ]);
  }
  const { articles, hooks } = sc.env.pack;
  for (const [end, v] of words(sc, pos, sc.env.pack.numberWords)) {
    const folded = sc.fold.slice(pos, end);
    const article = articles.has(folded) && !hooks.marked?.(sc.text.slice(pos, end), folded);
    out.push([end, { v, word: true, ...(article ? { article } : {}) }]);
  }
  const numeral = cjk ? hooks.numeral?.(sc.fold, pos) : null;
  if (numeral) out.push([numeral[0], { v: numeral[1], word: n === 0 }]);
  return out;
}

// A typed capital `M` read as minutes may also mean months, so it asks like the shorthand `3M`.
function unitHits(sc: Scan, pos: number): Hit<Partial<Caps>>[] {
  const out: Hit<Partial<Caps>>[] = words(sc, pos, sc.env.pack.units).map(([e, unit]) => [
    e,
    { unit },
  ]);
  const minute = out.some(([e, c]) => e === pos + 1 && c.unit?.unit === "m");
  if (sc.text[pos] === "M" && minute) out.push([pos + 1, { unit: { unit: "M" } }]);
  return out;
}

// Articles count (`an hour`) and name an hour only before an affix word (`ein Uhr`); no other slot takes them.
function ranged(hits: Hit<NumberHit>[], lo: number, hi: number) {
  return hits.filter(([, x]) => x.v >= lo && x.v <= hi && !x.article);
}

function slotHits(sc: Scan, s: Slot, pos: number): Hit<Partial<Caps>>[] {
  switch (s) {
    case "n":
      return numberHits(sc, pos, 6)
        .filter(([, x]) => x.v >= 1 && x.v <= 999_999)
        .map(([e, x]) => [e, { n: x.v }]);
    case "unit":
      return unitHits(sc, pos);
    case "h":
      return ranged(numberHits(sc, pos, 2), 0, 24).map(([e, x]) => [
        e,
        { h: x.v, hWord: x.word, hPadded: x.padded },
      ]);
    case "mi":
      return ranged(numberHits(sc, pos, 2), 0, 59).map(([e, x]) => [e, { mi: x.v }]);
    case "d":
      return ranged(numberHits(sc, pos, 2), 1, 31).map(([e, x]) => [e, { d: x.v }]);
    case "m":
      return ranged(numberHits(sc, pos, 2), 1, 12).map(([e, x]) => [e, { m: x.v }]);
    case "y":
      return numberHits(sc, pos, 4)
        .filter(([e, x]) => e - pos === 4 && x.v >= 1000 && !x.article)
        .map(([e, x]) => [e, { y: x.v }]);
    case "ry":
      return ranged(numberHits(sc, pos, 3), 1, 999).map(([e, x]) => [e, { ry: x.v }]);
    case "month":
      return words(sc, pos, sc.env.pack.months).map(([e, month]) => [e, { month }]);
    case "weekday":
      return words(sc, pos, sc.env.pack.weekdays).map(([e, weekday]) => [e, { weekday }]);
    case "date":
      return plainDayHits(sc, pos).map(([e, date]) => [e, { date }]);
    case "day":
      return dayHits(sc, pos).map(([e, day]) => [e, { day }]);
    case "clock":
      return coreClockHits(sc, pos).map(([e, clock]) => [e, { clock }]);
    case "start":
      return pointHits(sc, pos).map(([e, start]) => [e, { start }]);
    case "end":
      return pointHits(sc, pos).map(([e, end]) => [e, { end }]);
    default:
      return [];
  }
}

function elemHits(sc: Scan, e: Elem, pos: number): Hit<Partial<Caps> | null>[] {
  if (e.k === "slot") return slotHits(sc, e.s, pos);
  const out: Hit<null>[] = [];
  for (const alt of e.alts) {
    const end = litAt(sc, pos, alt);
    if (end >= 0) out.push([end, null]);
  }
  return out;
}

function run(sc: Scan, elems: Elem[], i: number, pos: number, caps: Caps, out: Hit<Caps>[]): void {
  tick(sc);
  if (i === elems.length) {
    out.push([pos, caps]);
    return;
  }
  if (pos >= sc.len) {
    if (i > 0) {
      sc.partial = true;
      const e = elems[i];
      if (e.k === "slot" && e.s === "unit" && caps.n !== undefined) sc.wantUnit = caps.n;
    }
    return;
  }
  for (const [end, val] of elemHits(sc, elems[i], pos)) {
    if (val?.clock?.[0]?.v.article && elems[i + 1]?.k !== "lit") continue;
    const next = val ? { ...caps, ...val } : caps;
    run(sc, elems, i + 1, end, next, out);
    if (i + 1 < elems.length && sc.fold.charCodeAt(end) === 32)
      run(sc, elems, i + 1, end + 1, next, out);
  }
}

export function matchAt(sc: Scan, elems: Elem[], pos: number): Hit<Caps>[] {
  const out: Hit<Caps>[] = [];
  run(sc, elems, 0, pos, {}, out);
  return out;
}

function whole(sc: Scan, elems: Elem[]): Caps[] {
  return matchAt(sc, elems, 0)
    .filter(([end]) => end === sc.len)
    .map(([, caps]) => caps);
}

/** A typed year as Gregorian; a two-digit year sits in [Y-80, Y+19], in the pack's era if it has one. */
function fullYear(sc: Scan, y: number, slot: "y" | "yy" | "ry"): number {
  const nowY = today(sc.env).y;
  const low = nowY - 80;
  return (
    sc.env.pack.hooks.year?.(y, slot, nowY) ??
    (slot === "yy" ? low + ((((y - low) % 100) + 100) % 100) : y)
  );
}

/** A year-less date is the most recent one not after today. */
function dated(sc: Scan, y: number | undefined, mo: number, d: number): DateVal | null {
  const now = today(sc.env);
  let year = y ?? now.y;
  const after = (): boolean =>
    !isValidDate(year, mo, d) ||
    wallUs(dayStart(year, mo, d)) > wallUs(dayStart(now.y, now.mo, now.d));
  while (y === undefined && year > now.y - YEARS_BACK && after()) year--;
  return isValidDate(year, mo, d) ? { y: year, mo, d } : null;
}

function numericDateHits(sc: Scan, pos: number): Hit<Alt<DateVal>[]>[] {
  const t = sc.text;
  const a = digitRun(t, pos);
  const sep = t[pos + a];
  if (a < 1 || a > 2 || isDigit(t, pos - 1) || (sep !== "/" && sep !== "." && sep !== "-"))
    return [];
  const b = digitRun(t, pos + a + 1);
  if (b < 1 || b > 2) return [];
  const p = fixedDigits(t, pos, a);
  const q = fixedDigits(t, pos + a + 1, b);
  let end = pos + a + 1 + b;
  let y: number | undefined;
  if (sep === "." && t[end] === "." && digitRun(t, end + 1) === 0) end++;
  else if (t[end] === sep) {
    const c = digitRun(t, end + 1);
    if (c !== 2 && c !== 4) return [];
    const raw = fixedDigits(t, end + 1, c);
    y = fullYear(sc, raw, c === 2 ? "yy" : "y");
    end += 1 + c;
  } else if (sep === "-") return [];
  if (isDigit(t, end)) return [];
  const yd = y === undefined ? "yd" : undefined;
  const dmy = dated(sc, y, q, p);
  const mdy = dated(sc, y, p, q);
  const pack = sc.env.pack;
  if (sep === "." || (sep === "-" && pack.slashOrder === "dmy"))
    return dmy ? [[end, [{ v: dmy, tag: yd }]]] : [];
  const first = pack.slashOrder === "dmy" ? dmy : mdy;
  const second = pack.slashOrder === "dmy" ? mdy : dmy;
  const alts: Alt<DateVal>[] = [];
  // A date that fits one order only fixes that order for the other side of a range.
  const other = pack.slashOrder === "dmy" ? "mdy" : "dmy";
  const only = pack.slashAmbiguous && p !== q && !second;
  if (first) alts.push({ v: first, tag: joinTags(only ? pack.slashOrder : undefined, yd) });
  if (pack.slashAmbiguous && second && first && p !== q) {
    alts[0] = { v: first, why: "day-month-order", tag: joinTags(pack.slashOrder, yd) };
    alts.push({
      v: second,
      why: "day-month-order",
      tag: joinTags(other, yd),
    });
  }
  return alts.length > 0 ? [[end, alts]] : [];
}

function patternDateHits(sc: Scan, pos: number): Hit<Alt<DateVal>[]>[] {
  const out: Hit<Alt<DateVal>[]>[] = [];
  for (const elems of sc.env.pack.datePatterns) {
    for (const [end, c] of matchAt(sc, elems, pos)) {
      const mo = c.month ?? c.m;
      if (mo === undefined || c.d === undefined) continue;
      const y =
        c.ry !== undefined
          ? fullYear(sc, c.ry, "ry")
          : c.y !== undefined
            ? fullYear(sc, c.y, "y")
            : undefined;
      const v = dated(sc, y, mo, c.d);
      if (v) out.push([end, [{ v, tag: y === undefined ? "yd" : undefined }]]);
    }
  }
  return out;
}

function baseDateHits(sc: Scan, pos: number): Hit<Alt<DateVal>[]>[] {
  return memo(sc, "date", pos, () => [...numericDateHits(sc, pos), ...patternDateHits(sc, pos)]);
}

function civilDate(c: { y: number; mo: number; d: number }): DateVal {
  return { y: c.y, mo: c.mo, d: c.d };
}

function dayHits(sc: Scan, pos: number): Hit<Alt<DateVal>[]>[] {
  return memo(sc, "day", pos, () => {
    const out = plainDayHits(sc, pos);
    for (const elems of sc.env.pack.pointAffixes) {
      for (const [end, c] of matchAt(sc, elems, pos)) if (c.date) out.push([end, c.date]);
    }
    return out;
  });
}

/** Day words, weekdays and dates; a point affix wraps one of these, never another affix. */
function plainDayHits(sc: Scan, pos: number): Hit<Alt<DateVal>[]>[] {
  return memo(sc, "plain", pos, () => {
    const env = sc.env;
    const now = today(env);
    const out: Hit<Alt<DateVal>[]>[] = [];
    for (const [end, offset] of words(sc, pos, env.pack.dayWords)) {
      const date = civilDate(addDays(dayStart(now.y, now.mo, now.d), offset));
      out.push([end, [{ v: { ...date, rel: true } }]]);
    }
    for (const [end, wd] of words(sc, pos, env.pack.weekdays))
      out.push([end, [{ v: civilDate(weekdayDate(wd, env)) }]]);
    for (const p of env.pack.weekdayOfWeek) {
      for (const [end, c] of matchAt(sc, p.elems, pos)) {
        if (c.weekday !== undefined)
          out.push([end, [{ v: civilDate(weekdayDate(c.weekday, env, p.value)) }]]);
      }
    }
    out.push(...baseDateHits(sc, pos));
    // An ISO date is a day like any other, so it takes the same clocks (`2026-11-20 9am`).
    for (const s of scanIso(sc.text, pos)) {
      const v = s.alts[0].v;
      if (v.p === "day" && !v.days) out.push([s.end, [{ v: civilDate(v) }]]);
    }
    return out;
  });
}

function wordHours(v: ClockValue): Alt<ClockValue>[] {
  if (!v.word || v.mod || v.h < 1 || v.h > 12) return [{ v }];
  const am = v.h === 12 ? 0 : v.h;
  return [
    { v: { ...v, h: am }, why: "am-pm", tag: "am" },
    { v: { ...v, h: am + 12 }, why: "am-pm", tag: "pm" },
  ];
}

function coreClockHits(sc: Scan, pos: number): Hit<Alt<ClockValue>[]>[] {
  return memo(sc, "core", pos, () => {
    const out: Hit<Alt<ClockValue>[]>[] = [];
    const colon = scanColonClock(sc.text, pos);
    if (colon && !isDigit(sc.text, pos - 1)) out.push([colon.end, [{ v: colon.c }]]);
    for (const [end, x] of numberHits(sc, pos, 2, false)) {
      if (x.v > 24 || sc.text[end] === ":" || (x.v === 24 && x.word)) continue;
      const v: ClockValue = {
        h: x.v,
        mi: 0,
        s: 0,
        us: 0,
        word: x.word,
        bare: !x.word,
        hourOnly: true,
      };
      if (x.padded) v.padded = true;
      if (x.article) v.article = true;
      out.push([end, [{ v }]]);
    }
    return out;
  });
}

function affixedClockHits(sc: Scan, pos: number): Hit<Alt<ClockValue>[]>[] {
  const out: Hit<Alt<ClockValue>[]>[] = [];
  for (const elems of sc.env.pack.clockAffixes) {
    for (const [end, c] of matchAt(sc, elems, pos)) {
      if (c.clock) out.push([end, c.clock.map((a) => ({ ...a, v: { ...a.v, bare: false } }))]);
      else if (c.h !== undefined && c.h < 24) {
        const v: ClockValue = { h: c.h, mi: c.mi ?? 0, s: 0, us: 0, word: c.hWord === true };
        if (c.mi === undefined) v.hourOnly = true;
        if (c.hPadded) v.padded = true;
        out.push([end, [{ v }]]);
      }
    }
  }
  return out;
}

// A 12-hour value (1-12, 0-12 in h11 packs) takes the mark's half; a day part also takes a 24-hour
// value, unshifted and only inside its range, so hour 0 only in a part that starts at midnight.
function withMod(alts: Alt<ClockValue>[], mod: ClockMod): Alt<ClockValue>[] {
  const out: Alt<ClockValue>[] = [];
  for (const { v } of alts) {
    const h =
      v.h < (mod.ap ?? Math.sign(mod.from)) || (mod.ap !== undefined && v.h > 12)
        ? null
        : hourIn(v.h, mod.from, mod.to);
    if (h !== null) out.push({ v: { ...v, h, mod, bare: false } });
  }
  return out;
}

function clockHits(sc: Scan, pos: number): Hit<Alt<ClockValue>[]>[] {
  return memo(sc, "clock", pos, () => {
    const mods = sc.env.pack.mods;
    const core = (at: number) => coreClockHits(sc, at).filter(([, alts]) => !alts[0].v.article);
    const bases = (at: number) => [...core(at), ...affixedClockHits(sc, at)];
    const out: Hit<Alt<ClockValue>[]>[] = [];
    for (const [end, alts] of bases(pos)) {
      out.push([end, alts.flatMap((a) => wordHours(a.v))]);
      for (const at of spaced(sc, end)) {
        for (const [e2, mod] of words(sc, at, mods)) {
          const m = withMod(alts, mod);
          if (m.length > 0) out.push([e2, m]);
        }
      }
    }
    for (const [end, mod] of words(sc, pos, mods)) {
      for (const at of spaced(sc, end)) {
        const was = sc.partial;
        for (const [e2, alts] of bases(at)) {
          const m = withMod(alts, mod);
          if (m.length > 0) out.push([e2, m]);
          // A refused clock stays refused however it goes on (`PM 13:30 o'clock`), unless it is
          // one digit typed last, which a second digit can still make fit (`PM 0` before `PM 09`).
          else if (e2 - at > 1 || e2 < sc.len || !grows(alts, mod)) sc.partial = was;
        }
      }
    }
    return out;
  });
}

function grows(alts: Alt<ClockValue>[], mod: ClockMod): boolean {
  return alts.some(({ v }) =>
    [...Array(10).keys()].some((k) => withMod([{ v: { ...v, h: v.h * 10 + k } }], mod).length > 0),
  );
}

function zoned(sc: Scan, end: number, alts: Alt<ClockValue>[]): Hit<Alt<ClockValue>[]>[] {
  const out: Hit<Alt<ClockValue>[]>[] = [[end, alts]];
  const host = alts.some((a) => a.v.sec) ? 2 : 0;
  const at = zoneStart(sc.text, end, host, true);
  const dash = at !== null && zoneStart(sc.text, end, host) === null;
  // A bare digit hour takes no signed offset: `3+4` is not 03:00 at UTC+4.
  const signed = sc.text[at ?? end] === "+" || sc.text[at ?? end] === "-";
  if (at === null || (signed && alts.some((a) => a.v.bare))) return out;
  for (const z of scanZone(sc.text, at)) {
    const next: Alt<ClockValue>[] = [];
    for (const a of alts) {
      for (const zone of z.alts) {
        const v =
          "zone" in zone.v
            ? { ...a.v, zone: zone.v.zone }
            : { ...a.v, offsetSec: zone.v.offsetSec, dash };
        next.push({ v, why: a.why ?? zone.why, tag: joinTags(a.tag, zone.tag) });
      }
    }
    out.push([z.end, next]);
  }
  return out;
}

function spaced(sc: Scan, end: number): number[] {
  return sc.fold[end] === " " ? [end + 1, end] : [end];
}

function cross<A, B, T>(as: Alt<A>[], bs: Alt<B>[], make: (a: A, b: B) => T): Alt<T>[] {
  const out: Alt<T>[] = [];
  for (const a of as)
    for (const b of bs)
      out.push({ v: make(a.v, b.v), why: a.why ?? b.why, tag: joinTags(a.tag, b.tag) });
  return out;
}

/** Machine stamps at `pos`; a mark after a stamp clock binds to it before any zone. A phrase picks a
 * year-less date's year itself, so only a log line marks a year-less stamp. */
export function stampHits(sc: Scan, pos: number, log?: boolean): Scanned<Point>[] {
  // A dated stamp keeps its own day, so a mark that shifts the day (`昨晚`) never binds to it.
  const mark = (at: number, c: ClockValue): [number, ClockValue][] =>
    spaced(sc, at).flatMap((p) =>
      words(sc, p, sc.env.pack.mods).flatMap(([end, mod]): [number, ClockValue][] =>
        mod.shift || isDigit(sc.text, end) ? [] : withMod([{ v: c }], mod).map((m) => [end, m.v]),
      ),
    );
  return scanStamp(sc.text, pos, sc.env.nowUs, sc.env.zone, mark)
    .map((s) => ({
      end: s.end,
      alts: s.alts.filter(
        (a) => log || !(a.tag?.includes("yw") && "clock" in a.v && a.v.clock?.mod),
      ),
    }))
    .filter((s) => s.alts.length > 0);
}

/** `fold` with every clock mark blanked, so a tail of marks and stamp characters reads as a clock. */
export function unmarked(sc: Scan): string {
  const keep = { ...sc };
  let out = sc.fold;
  for (let i = 0; i < sc.len; i++)
    for (const [end] of words(sc, i, sc.env.pack.mods))
      out = out.slice(0, i).padEnd(end) + out.slice(end);
  Object.assign(sc, keep);
  return out;
}

/** Any one point or period: a stamp, an epoch, date math, now, a day with or without a clock, a clock. */
export function pointHits(sc: Scan, pos: number): Hit<Alt<Point>[]>[] {
  return memo(sc, "point", pos, () => {
    const env = sc.env;
    const out: Hit<Alt<Point>[]>[] = [];
    for (const s of stampHits(sc, pos)) out.push([s.end, s.alts]);
    for (const s of scanEpoch(sc.text, pos)) out.push([s.end, s.alts]);
    const math = scanDateMath(sc.text, pos, env.nowUs, env.zone);
    if (math && math.offsets.length + (math.snapped ? 1 : 0) > 0) {
      out.push([math.end, math.alts]);
    }
    for (const w of env.pack.nowWords) {
      const end = litAt(sc, pos, w);
      if (end >= 0) out.push([end, [{ v: { p: "now" } }]]);
    }
    for (const [end, span] of words(sc, pos, env.pack.spanWords)) {
      out.push([end, [{ v: { p: "span", drafts: spanDrafts(span.unit, span.offset, env) } }]]);
    }
    for (const [end, days] of dayHits(sc, pos)) {
      out.push([end, days.map((a) => ({ v: { p: "day", ...a.v }, why: a.why, tag: a.tag }))]);
      for (const at of spaced(sc, end)) {
        for (const [e2, clocks] of clockHits(sc, at)) {
          for (const [e3, zc] of zoned(sc, e2, clocks))
            out.push([e3, cross(days, zc, (d, c): Point => ({ p: "wall", ...d, clock: c }))]);
        }
      }
    }
    for (const [end, clocks] of clockHits(sc, pos)) {
      for (const [e2, zc] of zoned(sc, end, clocks)) {
        out.push([e2, zc.map((c) => ({ v: { p: "clock", clock: c.v }, why: c.why, tag: c.tag }))]);
        for (const at of spaced(sc, e2)) {
          // A bare digit glued to a word is a count with its unit (de `3mo`), never an hour on a day.
          if (at === e2 && wordy(sc.fold.charCodeAt(at)) && zc.every((c) => c.v.bare)) continue;
          for (const [e3, days] of dayHits(sc, at)) {
            out.push([e3, cross(days, zc, (d, c): Point => ({ p: "wall", ...d, clock: c }))]);
          }
        }
      }
    }
    return out;
  });
}

function wholePoint(sc: Scan, from: number, to: number): Alt<Point>[] {
  const out: Alt<Point>[] = [];
  for (const [end, alts] of pointHits(sc, from)) if (end === to) out.push(...alts);
  return out;
}

function onDay(alts: Alt<Point>[] | undefined, days: Alt<DateVal>[] | undefined): Alt<Point>[] {
  if (!alts || !days) return alts ?? [];
  const out: Alt<Point>[] = [];
  for (const a of alts) {
    if (a.v.p !== "clock") out.push(a);
    else {
      const clock = a.v.clock;
      out.push(
        ...days.map((d) => ({
          v: { p: "wall" as const, ...d.v, clock, shared: true },
          why: a.why ?? d.why,
          tag: joinTags(a.tag, d.tag),
        })),
      );
    }
  }
  return out;
}

function joinAt(sc: Scan, join: string, k: number): boolean {
  if (!sc.fold.startsWith(join, k)) return false;
  const end = k + join.length;
  if (
    !wordy(join.charCodeAt(0)) &&
    wordy(sc.fold.charCodeAt(k - 1)) &&
    wordy(sc.fold.charCodeAt(end))
  )
    return false;
  if (wordy(join.charCodeAt(0)) && k > 0 && wordy(sc.fold.charCodeAt(k - 1))) return false;
  return !(
    wordy(join.charCodeAt(join.length - 1)) &&
    end < sc.len &&
    wordy(sc.fold.charCodeAt(end))
  );
}

function isoOnly(sc: Scan, from: number, to: number): boolean {
  return scanIso(sc.text, from).some((s) => s.end === to);
}

// The dash is an offset after `UTC`/`GMT`, after a clock with seconds, or when the stamp scanner reads
// the whole text as the stamp at `k` plus a fixed offset.
function offsetLike(sc: Scan, k: number): boolean {
  const off = scanOffset(sc.text, k);
  if (!off || off.end !== sc.len) return false;
  if (["utc", "gmt"].includes(sc.fold.slice(k - 3, k))) return true;
  const left = sc.text[k - 1] === " " ? k - 1 : k;
  const stamps = scanStamp(sc.text, 0, sc.env.nowUs, sc.env.zone);
  const seconds = pointHits(sc, 0).some(
    ([end, alts]) =>
      end === sc.len &&
      alts.every((a) => a.v.p === "wall" && a.v.clock.sec && a.v.clock.offsetSec !== undefined),
  );
  return (
    seconds ||
    (stamps.some((s) => s.end === left && s.alts.every((a) => a.v.p === "wall")) &&
      stamps.some((s) => s.end === sc.len && s.alts.every((a) => a.v.p === "instant")))
  );
}

function joinSplits(
  sc: Scan,
  out: Draft[][],
  zero: { hit: boolean; incomplete: boolean; reversed: boolean },
): void {
  const joins = [...sc.env.pack.joins, ...UNIVERSAL_JOINS];
  for (const join of joins) {
    const at: number[] = [];
    for (
      let k = sc.fold.indexOf(join, 1);
      k > 0 && at.length <= JOIN_LIMIT;
      k = sc.fold.indexOf(join, k + 1)
    ) {
      if (joinAt(sc, join, k)) at.push(k);
    }
    if (at.length > JOIN_LIMIT) continue;
    for (const k of at) {
      const leftEnd = sc.fold[k - 1] === " " ? k - 1 : k;
      let rightStart = k + join.length;
      if (sc.fold[rightStart] === " ") rightStart++;
      if (join === "/" && !(isoOnly(sc, 0, leftEnd) && isoOnly(sc, rightStart, sc.len))) continue;
      if (join === "-" && offsetLike(sc, k)) continue;
      const left = wholePoint(sc, 0, leftEnd);
      if (left.length === 0 || (join === "-" && left.every((a) => a.v.p === "now"))) continue;
      if (rightStart >= sc.len) {
        zero.incomplete = true;
        continue;
      }
      const right = wholePoint(sc, rightStart, sc.len);
      const r = rangeDrafts(left, right, sc.env);
      zero.hit = zero.hit || r.zero;
      zero.reversed = zero.reversed || r.reversed;
      if (r.drafts.length > 0) out.push(r.drafts);
    }
  }
}

/** Step 3: a range template or a join whose two sides each read wholly as a point or period. */
export function rangeOutcome(sc: Scan): Outcome {
  const saved = sc.partial;
  const found: Draft[][] = [];
  const zero = { hit: false, incomplete: false, reversed: false };
  for (const elems of sc.env.pack.rangeTemplates) {
    for (const prefixed of [elems, [DAY_PREFIX, ...elems]]) {
      for (const c of whole(sc, prefixed)) {
        if (!c.start || !c.end) continue;
        // A day before a range lands on its clocks; with no clock to land on it would be dropped text.
        if (c.day && ![...c.start, ...c.end].some((a) => a.v.p === "clock")) continue;
        const r = rangeDrafts(onDay(c.start, c.day), onDay(c.end, c.day), sc.env);
        zero.hit = zero.hit || r.zero;
        zero.reversed = zero.reversed || r.reversed;
        if (r.drafts.length > 0) found.push(r.drafts);
      }
    }
  }
  sc.partial = false;
  joinSplits(sc, found, zero);
  const drafts = distinct(found.flat());
  if (drafts.length > 0) return { t: "drafts", drafts, form: "range" };
  if (zero.hit) return { t: "invalid", reason: "zero-length" };
  // Both sides read wholly but run backwards: never swapped, and no later step may claim the text.
  if (zero.reversed) return { t: "invalid", reason: "reversed" };
  const open = sc.env.pack.rangeTemplates.some((elems) => startsBeforeEnd(sc, elems));
  sc.partial = saved;
  sc.rangeOpen = zero.incomplete || open;
  return { t: "none" };
}

function startsBeforeEnd(sc: Scan, elems: Elem[]): boolean {
  const at = elems.findIndex((e) => e.k === "slot" && e.s === "end");
  if (at < 1) return false;
  return matchAt(sc, elems.slice(0, at), 0).some(
    ([end, c]) => c.start !== undefined && end === sc.len,
  );
}

export function distinct(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  return drafts.filter((d) => {
    const key = `${d.startUs}:${d.endUs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// `last hour` reads after the day and period words, so `last week` stays the calendar week.
function counted(elems: Elem[]): boolean {
  return elems.some((e) => e.k === "slot" && e.s === "n");
}

function countOf(c: Caps): number | null {
  if (!c.unit) return null;
  if (c.n !== undefined && c.unit.count !== undefined) return null;
  return c.n ?? c.unit.count ?? 1;
}

// Two unit words spelled alike (es narrow `m`: minute and month) ask, shortest span first.
function rollingFrom(sc: Scan, list: [Caps, UnitKey | null][]): Draft[] {
  const out: Draft[] = [];
  for (const [c, fixedUnit] of list) {
    const unit = fixedUnit ?? c.unit?.unit;
    const n = fixedUnit ? (c.n ?? 1) : countOf(c);
    if (unit && n !== null) out.push(...rollingDrafts(n, unit, sc.env));
  }
  const kept = distinct(out);
  if (kept.length < 2 || kept.some((d) => d.why)) return kept;
  return kept
    .sort((a, b) => b.startUs - a.startUs)
    .map((d) => ({ ...d, why: "unit-case" as const }));
}

function bareDrafts(sc: Scan, list: Caps[]): Draft[] {
  const out: Draft[] = [];
  for (const c of list) {
    const n = c.n;
    if (n === undefined || !c.unit || c.unit.count !== undefined) continue;
    out.push(
      ...rollingDrafts(n, c.unit.unit, sc.env).map((d) => ({
        ...d,
        why: "bare-duration" as const,
      })),
    );
    if (c.unit.unit === "m" && n < 60) {
      const now = today(sc.env);
      const at = wallUs({ ...now, mi: n, s: 0, us: 0 });
      const t = civilOfWall(at > wallUs(now) ? at - US_PER_H : at);
      const clock: ClockValue = { h: t.h, mi: t.mi, s: 0, us: 0, word: false };
      const minute = singleDrafts([{ v: { p: "wall", y: t.y, mo: t.mo, d: t.d, clock } }], sc.env);
      out.push(...minute.map((d) => ({ ...d, why: "bare-duration" as const })));
    }
  }
  return out;
}

// A since clock typed as a bare digit hour asks am or pm, like its word spelling.
function digitHours(a: Alt<Point>): Alt<Point>[] {
  if (a.v.p !== "clock" || !a.v.clock.bare || a.v.clock.padded) return [a];
  return wordHours({ ...a.v.clock, word: true }).map((c) => ({
    v: { p: "clock", clock: c.v },
    why: c.why ?? a.why,
    tag: c.tag ?? a.tag,
  }));
}

/** The whole input read as one point or period. */
export function pointDrafts(sc: Scan): Draft[] {
  return singleDrafts(wholePoint(sc, 0, sc.len), sc.env);
}

function completions(sc: Scan): Draft[] {
  const env = sc.env;
  const out: Draft[] = [];
  if (sc.wantUnit !== undefined) {
    for (const unit of env.units) out.push(...rollingDrafts(sc.wantUnit, unit, env));
  }
  const prefix = sc.fold;
  // Many spellings share one value, so values are deduplicated before any date work.
  const hits = <T>(list: Words<T>): T[] => [
    ...new Map(
      [...list.values()]
        .flat()
        .filter((w) => w.s.length > prefix.length && w.s.startsWith(prefix))
        .map((w) => [JSON.stringify(w.value), w.value]),
    ).values(),
  ];
  const day = (c: { y: number; mo: number; d: number }, rel?: boolean): Draft[] =>
    singleDrafts([{ v: { p: "day", y: c.y, mo: c.mo, d: c.d, rel } }], env);
  for (const n of hits(env.pack.dayWords)) out.push(...day(addDays(today(env), n), true));
  for (const w of hits(env.pack.spanWords)) out.push(...spanDrafts(w.unit, w.offset, env));
  for (const n of hits(env.pack.weekdays)) out.push(...day(weekdayDate(n, env)));
  return distinct(out);
}

/** Step 8: the pack's phrase patterns over `fold`; the first family that reads the whole input wins. */
export function phraseOutcome(sc: Scan): Outcome {
  const pack = sc.env.pack;
  const families: (() => Draft[])[] = [
    () =>
      rollingFrom(
        sc,
        pack.lastN.filter(counted).flatMap((p) => whole(sc, p).map((c): [Caps, null] => [c, null])),
      ),
    () =>
      rollingFrom(
        sc,
        pack.ago.flatMap((p) =>
          whole(sc, p.elems).map((c): [Caps, UnitKey | null] => [c, p.value]),
        ),
      ),
    () =>
      pack.agoFixed.flatMap((p) =>
        whole(sc, p.elems).length > 0 ? rollingDrafts(p.value.count, p.value.unit, sc.env) : [],
      ),
    () =>
      pack.since.flatMap((p) =>
        whole(sc, p).flatMap((c) =>
          c.start ? sinceDrafts(c.start.flatMap(digitHours), sc.env) : [],
        ),
      ),
    () => {
      const point = pointDrafts(sc);
      const orClock = pack.hooks.orClock;
      const bare = orClock && point.length > 0 ? bareDrafts(sc, whole(sc, BARE)) : [];
      return orClock && bare.length > 0 ? orClock(bare, () => point) : point;
    },
    () =>
      rollingFrom(
        sc,
        pack.lastN
          .filter((p) => !counted(p))
          .flatMap((p) => whole(sc, p).map((c): [Caps, null] => [c, null])),
      ),
    () => bareDrafts(sc, whole(sc, BARE)),
  ];
  for (const family of families) {
    const drafts = distinct(family());
    if (drafts.length > 0) return { t: "drafts", drafts, form: "phrase" };
  }
  const ime = pack.hooks.ime?.(sc.fold) === true;
  if (sc.partial || ime || sc.rangeOpen)
    return { t: "incomplete", drafts: completions(sc).slice(0, 6) };
  return { t: "none" };
}
