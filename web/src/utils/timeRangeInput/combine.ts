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
  civilOfWall,
  dayStart,
  daysFromCivil,
  isValidDate,
  wallUs,
  weekdayOf,
  weekStartOf,
  US_PER_S,
  type Civil,
} from "./civil";
import { firstInstant, UNIT_US, WINDOW_US, YEARS_BACK } from "./machine";
import type { CompiledPack } from "./packs/schema";
import type {
  Alt,
  AmbiguityReason,
  ClockValue,
  Draft,
  Point,
  RelativeUnit,
  SpanUnit,
  UnitKey,
  ZoneNote,
} from "./types";
import { offsetAtInstant, offsetLabel, pad, resolveCivil, wallAt } from "./zone";

export interface Env {
  nowUs: number;
  zone: string;
  pack: CompiledPack;
  units: RelativeUnit[];
  /** Set when a value fell outside the safe-integer µs range, so the result says out-of-range. */
  overflow?: boolean;
}

type Wall = Extract<Point, { p: "wall" }>;

interface Inst {
  us: number;
  notes: ZoneNote[];
  why?: AmbiguityReason;
  soft: boolean;
  clock?: ClockValue;
  date?: { y: number; mo: number; d: number };
}

const UNIT_NAMES: Record<UnitKey, string> = {
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
  M: "month",
  y: "year",
};
const numberFormats = new Map<string, Intl.NumberFormat>();

export function today(env: Env): Civil {
  return wallAt(env.zone, env.nowUs);
}

/** The year of the most recent `mo`/`d` not after the day of `now`. */
export function latestYear(mo: number, d: number, now: Civil): number | null {
  const last = wallUs(dayStart(now.y, now.mo, now.d));
  for (let y = now.y; y >= now.y - YEARS_BACK; y--)
    if (isValidDate(y, mo, d) && wallUs(dayStart(y, mo, d)) <= last) return y;
  return null;
}

/** A year-less date (a `y` tag) or a day word under a written zone counts from today in that zone. */
export function zonedDate(p: Wall, env: Env, tag: string | undefined): Wall | null {
  const c = p.clock;
  if (
    (!yearless(tag) && p.off === undefined) ||
    (c.zone === undefined && c.offsetSec === undefined)
  )
    return p;
  const now = wallFor(c, env.nowUs, env);
  if (p.off === undefined) {
    const y = latestYear(p.mo, p.d, now);
    return y === null ? null : { ...p, y };
  }
  const t = addDays(dayStart(now.y, now.mo, now.d), p.off);
  return { ...p, y: t.y, mo: t.mo, d: t.d };
}

function clockText(c: Civil): string {
  return `${pad(c.h)}:${pad(c.mi)}${c.s > 0 ? `:${pad(c.s)}` : ""}`;
}

/** Applies a day part or meridiem to a typed hour; null when the hour cannot sit in it. */
export function hourIn(h: number, from: number, to: number): number | null {
  for (const candidate of h === 12 ? [12, 0] : [h, h + 12]) {
    if (candidate >= from && candidate < to && candidate < 24) return candidate;
  }
  return null;
}

function wallInstants(y: number, mo: number, d: number, clock: ClockValue, env: Env): Inst[] {
  const date = addDays(dayStart(y, mo, d), clock.mod?.shift ?? 0);
  const c: Civil = { ...date, h: clock.h, mi: clock.mi, s: clock.s, us: clock.us };
  const base = { soft: false, clock, date: { y: date.y, mo: date.mo, d: date.d } };
  if (clock.offsetSec !== undefined) {
    const us = wallUs(c, clock.offsetSec * US_PER_S);
    const note: ZoneNote = { kind: "converted", fromOffset: offsetLabel(clock.offsetSec) };
    return [{ ...base, us, notes: [note] }];
  }
  const r = resolveCivil(c, clock.zone ?? env.zone);
  if (!r) return [{ ...base, us: NaN, notes: [] }];
  if (r.kind === "exact") return [{ ...base, us: r.us, notes: [] }];
  if (r.kind === "gap") {
    const note: ZoneNote = {
      kind: "dst-gap",
      typedLocal: clockText(c),
      readAsLocal: clockText(r.readAs),
    };
    return [{ ...base, us: r.us, notes: [note] }];
  }
  return [r.earlier, r.later].map((us) => ({
    ...base,
    us,
    notes: [],
    why: "repeated-hour" as const,
  }));
}

function dayInstant(y: number, mo: number, d: number, env: Env): number {
  return firstInstant(dayStart(y, mo, d), env.zone);
}

function dateOf(p: Point, env: Env): { y: number; mo: number; d: number } | undefined {
  if (p.p === "day" || p.p === "wall") return { y: p.y, mo: p.mo, d: p.d };
  if (p.p === "instant") return wallAt(env.zone, p.us);
  return undefined;
}

/** The wall clock at `us` where `c` is read: its fixed offset, its zone, or the context zone. */
function wallFor(c: ClockValue, us: number, env: Env): Civil {
  return c.offsetSec !== undefined
    ? civilOfWall(us, c.offsetSec * US_PER_S)
    : wallAt(c.zone ?? env.zone, us);
}

function clockOf(p: Point): ClockValue | undefined {
  return "clock" in p ? p.clock : undefined;
}

function rawStartInstants(
  p: Point,
  env: Env,
  inherit?: { y: number; mo: number; d: number },
): Inst[] {
  if (p.p === "instant") return [{ us: p.us, notes: p.notes, soft: false }];
  if (p.p === "now") return [{ us: env.nowUs, notes: [], soft: false }];
  if (p.p === "day") return [{ us: dayInstant(p.y, p.mo, p.d, env), notes: [], soft: false }];
  if (p.p === "wall") return wallInstants(p.y, p.mo, p.d, p.clock, env);
  if (p.p === "clock") {
    const t = inherit ?? wallFor(p.clock, env.nowUs, env);
    return wallInstants(t.y, t.mo, t.d, p.clock, env);
  }
  return p.drafts.map((d) => ({ us: d.startUs, notes: d.notes, why: d.why, soft: false }));
}

function kept(list: Inst[], env: Env): Inst[] {
  const out = list.filter((i) => Number.isSafeInteger(i.us));
  if (out.length < list.length) env.overflow = true;
  return out;
}

function startInstants(p: Point, env: Env, inherit?: { y: number; mo: number; d: number }): Inst[] {
  return kept(rawStartInstants(p, env, inherit), env);
}

function endInstants(p: Point, env: Env, inherit?: { y: number; mo: number; d: number }): Inst[] {
  return kept(rawEndInstants(p, env, inherit), env);
}

function rawEndInstants(
  p: Point,
  env: Env,
  inherit?: { y: number; mo: number; d: number },
): Inst[] {
  if (p.p === "day") {
    const next = addDays(dayStart(p.y, p.mo, p.d), p.days ?? 1);
    return [{ us: dayInstant(next.y, next.mo, next.d, env), notes: [], soft: true }];
  }
  if (p.p === "span")
    return p.drafts.map((d) => ({ us: d.endUs, notes: d.notes, why: d.why, soft: d.softEnd }));
  return startInstants(p, env, inherit);
}

function windowDraft(inst: Inst): Draft {
  const note: ZoneNote = { kind: "instant-window", instantUs: inst.us, halfWidthUs: WINDOW_US };
  return {
    startUs: inst.us - WINDOW_US,
    endUs: inst.us + WINDOW_US,
    softEnd: true,
    kind: "absolute",
    notes: [...inst.notes, note],
    why: inst.why,
  };
}

function dayDraft(p: Extract<Point, { p: "day" }>, env: Env): Draft {
  const end = rawEndInstants(p, env)[0];
  const now = today(env);
  const offset = daysFromCivil(p.y, p.mo, p.d) - daysFromCivil(now.y, now.mo, now.d);
  const calendar = p.rel === true && (p.days ?? 1) === 1 && offset <= 0;
  return {
    startUs: dayInstant(p.y, p.mo, p.d, env),
    endUs: end.us,
    softEnd: true,
    kind: calendar ? "calendar" : "absolute",
    calendarToken: calendar ? `calendar:day:${offset}` : undefined,
    name: p.rel ? env.pack.autoNames[`d${offset}`] : undefined,
    notes: [],
  };
}

/** Keeps the readings of a clock word that are already past, unless none is. */
function pastClockWords(
  alts: Alt<Point>[],
  env: Env,
  inherit?: { y: number; mo: number; d: number },
): Alt<Point>[] {
  if (!alts.some((a) => a.why === "am-pm")) return alts;
  const past = alts.filter((a) => startInstants(a.v, env, inherit).every((i) => i.us <= env.nowUs));
  const kept = past.length > 0 ? past : alts;
  // The survivor keeps its am/pm tag so `sameTag` still pairs it with the end of the same meridiem.
  return kept.length === 1 ? [{ v: kept[0].v, tag: kept[0].tag }] : kept;
}

/** A whole input that is one point: a day, a period, or an instant shown as a ±5 min window. */
export function singleDrafts(alts: Alt<Point>[], env: Env): Draft[] {
  const raw = singleRaw(
    alts.filter((a) => !dashed(a.v)),
    env,
  );
  if (raw.some((d) => !Number.isSafeInteger(d.startUs) || !Number.isSafeInteger(d.endUs)))
    env.overflow = true;
  return raw.filter((d) => d.startUs < d.endUs);
}

function singleRaw(alts: Alt<Point>[], env: Env): Draft[] {
  const out: Draft[] = [];
  for (const alt of pastClockWords(alts, env)) {
    const p = alt.v;
    if (p.p === "day") out.push({ ...dayDraft(p, env), why: alt.why });
    else if (p.p === "span") out.push(...p.drafts.map((d) => ({ ...d, why: d.why ?? alt.why })));
    else {
      for (const inst of startInstants(p, env))
        out.push(windowDraft({ ...inst, why: inst.why ?? alt.why }));
    }
  }
  return out;
}

// An unpadded hour-only 1-11 end with no meridiem or date of its own takes the start's day part,
// or, outside it, the typed hour if after the start, else the afternoon (`9am to 5`, `深夜1時から5時`).
function inheritMod(end: Point, start: Point, env: Env): Point {
  const sc = clockOf(start);
  const ec = clockOf(end);
  if (!shared(end) || !sc?.mod || !ec?.hourOnly || ec.padded || ec.mod || ec.h < 1 || ec.h > 11)
    return end;
  // Wall hours in two offsets do not compare, so an end in another zone keeps its typed hour.
  const offset = (c: ClockValue): number =>
    c.offsetSec ?? offsetAtInstant(c.zone ?? env.zone, env.nowUs);
  if (zonedSide(end) && offset(ec) !== offset(sc)) return end;
  const h = hourIn(ec.h, sc.mod.from, sc.mod.to);
  const begin = sc.h * 60 + sc.mi;
  if (h === null && ec.h * 60 > begin) return end;
  const clock =
    h !== null && h * 60 > begin
      ? { ...ec, h, mod: { ...sc.mod, shift: 0, dated: undefined } }
      : (ec.h + 12) * 60 > begin
        ? { ...ec, h: ec.h + 12 }
        : ec;
  return { ...end, clock };
}

// A bare end clock, one on the shared date, or a year-less or day-word end is read in the start's
// offset or zone, so the viewer's zone never decides it (`09:30Z - 11` ends at 11:00Z everywhere).
function inZone(end: Point, tag: string | undefined, start: Point, env: Env): Point | null {
  const c = clockOf(start);
  if (end.p !== "clock" && end.p !== "wall") return end;
  const dated = end.p === "wall" && (yearless(tag) || end.off !== undefined);
  if (!(shared(end) || dated) || zonedSide(end) || !c || !zonedSide(start)) return end;
  const clock = { ...end.clock, offsetSec: c.offsetSec, zone: c.zone };
  return end.p === "wall" ? zonedDate({ ...end, clock }, env, tag) : { ...end, clock };
}

function yearless(tag: string | undefined): boolean {
  return !!tag?.split(" ").some((t) => t[0] === "y");
}

function shared(p: Point): p is Extract<Point, { p: "clock" | "wall" }> {
  return p.p === "clock" || (p.p === "wall" && p.shared === true);
}

// After a start with a day part, a word hour 1-11 reads like its digit, so its pm twin is dropped.
function pmTwin(end: Alt<Point>, start: Point): boolean {
  const ec = clockOf(end.v);
  return (
    !!end.tag?.split(" ").includes("pm") &&
    shared(end.v) &&
    !!clockOf(start)?.mod &&
    !!ec?.word &&
    !!ec.hourOnly &&
    ec.h > 12
  );
}

// Tag families: am/pm, day-month order, `z<minutes>` abbreviation meaning and the year rule of a
// year-less date (`yw` stamp walk, `yd` phrase). A pair fails on two members of one family.
function sameTag(a: Alt<Point>, b: Alt<Point>, skip?: string): boolean {
  const family = (t: string): string =>
    t[0] === "z" || t[0] === "y" ? t[0] : t === "pm" ? "am" : t === "dmy" ? "mdy" : t;
  const bt = b.tag?.split(" ") ?? [];
  return !a.tag
    ?.split(" ")
    .some((t) => family(t) !== skip && bt.some((u) => u !== t && family(u) === family(t)));
}

// An attached `-hh:mm` after a phrase clock is an offset only opposite a side that is itself zoned
// (an instant, or a clock with an offset or zone); a since, a point or a plain side refuses it.
function dashed(p: Point): boolean {
  return clockOf(p)?.dash === true;
}

function zonedSide(p: Point): boolean {
  const c = clockOf(p);
  return p.p === "instant" || c?.offsetSec !== undefined || c?.zone !== undefined;
}

// Two dashed sides vouch for each other only with the same offset (`09:00-05:00 to 10:00-05:00`).
function dashMismatch(a: Point, b: Point): boolean {
  if (dashed(a) && dashed(b)) return clockOf(a)?.offsetSec !== clockOf(b)?.offsetSec;
  return (dashed(a) && !zonedSide(b)) || (dashed(b) && !zonedSide(a));
}

// A bare digit hour (`dalle 9`) is a clock only next to another clock, never beside a date (`del 13 al 15 nov`).
function bareMismatch(a: Point, b: Point): boolean {
  const bare = (p: Point): boolean => p.p === "clock" && p.clock.bare === true;
  const clocked = (p: Point): boolean => clockOf(p) !== undefined;
  return (bare(a) && !clocked(b)) || (bare(b) && !clocked(a));
}

// With no same-meridiem pair running forward, an undated word range crosses noon only from a morning
// hour 7-11 to an end 1-6 (`nine to five`); `nine to nine` and `five to three` (2:55) do not.
function workday(s: Point, e: Point): boolean {
  return (
    s.p === "clock" &&
    e.p === "clock" &&
    s.clock.h > 6 &&
    s.clock.h < 12 &&
    e.clock.h > 12 &&
    e.clock.h < 19
  );
}

/** Ordered start/end combinations; `zero` and `reversed` report pairs that met or ran backwards. */
export function rangeDrafts(
  starts: Alt<Point>[],
  ends: Alt<Point>[],
  env: Env,
): { drafts: Draft[]; zero: boolean; reversed: boolean } {
  if (ends.length === 0) return { drafts: [], zero: false, reversed: false };
  if (ends.every((e) => e.v.p === "now")) {
    // A dated start is ordered against the real now; a bare clock keeps its D3 previous-day fix.
    const since = sinceDrafts(starts, env);
    const late = (d: Draft): boolean => !d.sinceClock && d.startUs >= env.nowUs;
    return {
      drafts: since.filter((d) => !late(d)),
      zero: since.some((d) => late(d) && d.startUs === env.nowUs),
      reversed: since.some((d) => late(d) && d.startUs > env.nowUs),
    };
  }
  const drafts: Draft[] = [];
  const cross: Draft[] = [];
  let zero = false;
  let reversed = false;
  const pastFor = ends.map((e0) =>
    pastClockWords(starts, env, e0.v.p === "clock" ? undefined : dateOf(e0.v, env)),
  );
  for (const s0 of starts) {
    for (const [i, e0] of ends.entries()) {
      const s = pastFor[i].find((k) => k.v === s0.v);
      if (
        !s ||
        !(sameTag(s, e0) || (workday(s.v, e0.v) && sameTag(s, e0, "am"))) ||
        bareMismatch(s.v, e0.v) ||
        dashMismatch(s.v, e0.v) ||
        pmTwin(e0, s.v)
      )
        continue;
      const e = inZone(inheritMod(e0.v, s.v, env), e0.tag, s.v, env);
      if (!e) continue;
      const into = sameTag(s, e0) ? drafts : cross;
      for (const [a, b] of sidePairs(s.v, e, env)) {
        // An end day that closes where the start begins lies wholly before it.
        if (a.us === b.us) zero = zero || e.p !== "day";
        if (a.us > b.us || (a.us === b.us && e.p === "day")) reversed = true;
        if (a.us >= b.us) continue;
        into.push({
          startUs: a.us,
          endUs: b.us,
          softEnd: b.soft,
          kind: "absolute",
          fixedToNow: e.p === "now" ? true : undefined,
          notes: [...a.notes, ...b.notes],
          why: a.why ?? b.why ?? s.why ?? e0.why,
          sinceClock: e.p === "now" ? sinceOf(s.v, a, env) : undefined,
        });
      }
    }
  }
  return { drafts: drafts.length > 0 ? drafts : cross, zero, reversed };
}

// A bare clock on one side takes the other side's date, read in the clock's own zone when either
// side is zoned, so the inherited day is never the one the other side's zone shows.
function sidePairs(s: Point, e: Point, env: Env): [Inst, Inst][] {
  const out: [Inst, Inst][] = [];
  if (s.p === "clock" && (e.p === "instant" || e.p === "wall") && (zonedSide(s) || zonedSide(e))) {
    for (const b of endInstants(e, env))
      for (const a of startInstants(s, env, wallFor(s.clock, b.us, env))) out.push([a, b]);
    return out;
  }
  for (const a of startInstants(s, env, e.p === "clock" ? undefined : dateOf(e, env))) {
    const own = zonedSide(s) || (a.clock !== undefined && zonedSide(e));
    // A day part that names its own day (`今晚`) never takes the start's date.
    const day =
      e.p !== "clock" || e.clock.mod?.dated
        ? undefined
        : own
          ? wallFor(e.clock, a.us, env)
          : (a.date ?? dateOf(s, env));
    for (const b of endInstants(e, env, day)) out.push([a, b]);
  }
  return out;
}

function sinceOf(p: Point, inst: Inst, env: Env): Draft["sinceClock"] {
  if (p.p !== "clock" || !inst.clock || !inst.date) return undefined;
  return { clock: inst.clock, ...inst.date, zone: inst.clock.zone ?? env.zone };
}

/** `since X` is [X, now]; a start after now keeps the instant so policy can block it. */
export function sinceDrafts(starts: Alt<Point>[], env: Env): Draft[] {
  const out: Draft[] = [];
  for (const s of pastClockWords(
    starts.filter((a) => !dashed(a.v)),
    env,
  )) {
    for (const a of startInstants(s.v, env)) {
      out.push({
        startUs: a.us,
        endUs: Math.max(a.us, env.nowUs),
        softEnd: false,
        kind: "absolute",
        fixedToNow: true,
        notes: a.notes,
        why: a.why ?? s.why,
        sinceClock: sinceOf(s.v, a, env),
      });
    }
  }
  return out;
}

/** Previous-day start for a D3 since-clock fix. */
export function previousDayStart(since: NonNullable<Draft["sinceClock"]>, env: Env): number {
  const prev = addDays(dayStart(since.y, since.mo, since.d), -1);
  const insts = wallInstants(
    prev.y,
    prev.mo,
    prev.d,
    { ...since.clock, mod: undefined, zone: since.zone },
    env,
  );
  return insts.length > 0 ? insts[0].us : NaN;
}

function durationName(n: number, unit: UnitKey, env: Env): string | undefined {
  const key = `${env.pack.bcp47}:${unit}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(env.pack.bcp47, {
      style: "unit",
      unit: UNIT_NAMES[unit],
      unitDisplay: "long",
    });
    numberFormats.set(key, format);
  }
  return env.pack.nameLastN.replace("{duration}", format.format(n));
}

/** `last N unit` and `N unit ago`: µs for s/m/h, the context zone's civil calendar for d/w/M/y. */
export function rollingDrafts(n: number, unit: UnitKey, env: Env): Draft[] {
  const value = unit === "y" ? n * 12 : n;
  const ru: RelativeUnit = unit === "y" ? "M" : unit;
  const allowed = env.units.includes(ru);
  const base = {
    endUs: env.nowUs,
    softEnd: false,
    kind: allowed ? ("rolling" as const) : ("absolute" as const),
    rolling: allowed ? { value, unit: ru } : undefined,
    fixedToNow: allowed ? undefined : true,
    name: durationName(n, unit, env),
  };
  const fixed = UNIT_US[unit];
  if (fixed) {
    const startUs = env.nowUs - n * fixed;
    if (Number.isSafeInteger(startUs)) return [{ ...base, startUs, notes: [] }];
    env.overflow = true;
    return [];
  }
  const now = today(env);
  const back =
    unit === "d" ? addDays(now, -n) : unit === "w" ? addDays(now, -7 * n) : addMonths(now, -value);
  const clock: ClockValue = { h: back.h, mi: back.mi, s: back.s, us: back.us, word: false };
  return wallInstants(back.y, back.mo, back.d, clock, env).map((i) => ({
    ...base,
    startUs: i.us,
    notes: i.notes,
    why: i.why,
  }));
}

/** This/last week, month, quarter or year as calendar periods. */
export function spanDrafts(unit: SpanUnit, offset: number, env: Env): Draft[] {
  const now = today(env);
  const day = dayStart(now.y, now.mo, now.d);
  let start: Civil;
  let next: Civil;
  if (unit === "w") {
    // Typed week words read as the rail's `calendar:week` token, which starts on Monday.
    start = addDays(weekStartOf(day, 1), 7 * offset);
    next = addDays(start, 7);
  } else {
    const months = unit === "q" ? 3 : unit === "y" ? 12 : 1;
    start = addMonths(dayStart(now.y, now.mo - ((now.mo - 1) % months), 1), offset * months);
    next = addMonths(start, months);
  }
  const token = unit === "q" ? "quarter" : UNIT_NAMES[unit];
  const calendar = offset <= 0;
  return [
    {
      startUs: dayInstant(start.y, start.mo, start.d, env),
      endUs: dayInstant(next.y, next.mo, next.d, env),
      softEnd: true,
      kind: calendar ? "calendar" : "absolute",
      calendarToken: calendar ? `calendar:${token}:${offset}` : undefined,
      name: env.pack.autoNames[`${unit}${offset}`],
      notes: [],
    },
  ];
}

/** The most recent past weekday (never today), or the weekday inside a week `offset` from this one. */
export function weekdayDate(wd: number, env: Env, offset?: number): Civil {
  const now = today(env);
  const day = dayStart(now.y, now.mo, now.d);
  if (offset !== undefined) {
    const start = addDays(weekStartOf(day, env.pack.firstDay), 7 * offset);
    return addDays(start, (wd - env.pack.firstDay + 7) % 7);
  }
  return addDays(day, -((weekdayOf(day.y, day.mo, day.d) - wd + 7) % 7 || 7));
}
