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

import { foldText, type FoldScript } from "../normalize";
import type { ClockMod, Draft, SpanUnit, TimeRangePack, TimeRangeLocale, UnitKey } from "../types";

export type WordKey = "today" | "yesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

/** Code only some locales need; it ships in their lazy chunk, never in the core. */
export interface PackHooks {
  /** A numeral the digit and word scanners miss (`二十三`), as `[end, value]` at `pos` of the fold. */
  numeral?: (fold: string, pos: number) => [number, number] | null;
  /** Folds one lowercased character of a non-Latin script. */
  fold?: (ch: string) => string;
  /** Rewrites the NFKC text before digits and spaces are mapped. */
  clean?: (nfkc: string) => string;
  /** Adds a second reading of the same text (`15h`: a clock too) so the two ask. */
  orClock?: (first: Draft[], other: () => Draft[]) => Draft[];
  /** A typed year in the pack's era to Gregorian: four digits (`y`), two (`yy`, near `nowY`), ROC (`ry`). */
  year?: (y: number, slot: "y" | "yy" | "ry", nowY: number) => number | undefined;
  /** Whether an article's typed spelling is a numeral instead (nl `één`, which folds to `een`). */
  marked?: (typed: string, folded: string) => boolean;
  /** Whether the fold is the start of a romanised IME word, so typing goes on. */
  ime?: (fold: string) => boolean;
}

/** The hand-written half of a locale pack; every pattern is slots and literal words, never a regex. */
export interface LocalePack {
  key: TimeRangeLocale;
  bcp47: string;
  script: FoldScript;
  spaceless?: boolean;
  dateOrder?: "dmy" | "mdy";
  slashAmbiguous?: boolean;
  units: Partial<Record<UnitKey, string[]>>;
  countedUnits?: Record<string, [UnitKey, number]>;
  patterns: {
    lastN: string[];
    ago: string[];
    since: string[];
    weekdayOfWeek?: Record<string, number>;
  };
  rangeJoin: string[];
  rangeTemplates: string[];
  pointAffixes: string[];
  clockAffixes: string[];
  datePatterns?: string[];
  words: Record<WordKey, string[]> & {
    dayBeforeYesterday?: string[];
    tomorrow?: string[];
    now?: string[];
    thisYear?: string[];
    lastYear?: string[];
  };
  weekdays?: string[][];
  dayParts?: Record<string, [number, number] | [number, number, number]>;
  meridiem?: { am: string[]; pm: string[] };
  numberWords?: Record<string, number>;
  /** Number words that only count (`a`, `an`) and never name a clock hour. */
  articles?: string[];
  hooks?: PackHooks;
  nameTemplates: { lastN: string };
  examples: string[];
}

/** The Intl-derived half, written by web/scripts/gen-time-range-intl.mjs. */
export interface GeneratedTables {
  icu: string;
  bcp47: string;
  firstDay: number;
  dateOrder: string;
  numeric: string[];
  dates: string[];
  months: string[][];
  weekdays: string[][];
  meridiem: string[][];
  h11: boolean;
  ago: Partial<Record<UnitKey, string[]>>;
  fixed: [string, number, string][];
  auto: [string, number, string][];
}

export type Slot =
  | "n"
  | "unit"
  | "start"
  | "end"
  | "date"
  | "day"
  | "clock"
  | "weekday"
  | "h"
  | "mi"
  | "d"
  | "m"
  | "y"
  | "ry"
  | "month";

export type Elem = { k: "lit"; alts: string[] } | { k: "slot"; s: Slot };

export interface Fixed<T> {
  elems: Elem[];
  value: T;
}

export interface Word<T> {
  s: string;
  value: T;
}

/** Words bucketed by first character, longest first, so a scan compares only candidates that can match. */
export type Words<T> = Map<string, Word<T>[]>;

export interface CompiledPack {
  key: TimeRangeLocale;
  bcp47: string;
  script: FoldScript;
  firstDay: number;
  slashOrder: "dmy" | "mdy";
  slashAmbiguous: boolean;
  units: Words<{ unit: UnitKey; count?: number }>;
  numberWords: Words<number>;
  articles: Set<string>;
  hooks: PackHooks;
  lastN: Elem[][];
  ago: Fixed<UnitKey | null>[];
  agoFixed: Fixed<{ unit: UnitKey; count: number }>[];
  since: Elem[][];
  weekdayOfWeek: Fixed<number>[];
  rangeTemplates: Elem[][];
  joins: string[];
  pointAffixes: Elem[][];
  clockAffixes: Elem[][];
  datePatterns: Elem[][];
  dayWords: Words<number>;
  spanWords: Words<{ unit: SpanUnit; offset: number }>;
  nowWords: string[];
  months: Words<number>;
  weekdays: Words<number>;
  mods: Words<ClockMod>;
  autoNames: Record<string, string>;
  nameLastN: string;
  examples: string[];
}

const SLOTS = new Set<string>([
  "n",
  "unit",
  "start",
  "end",
  "date",
  "day",
  "clock",
  "weekday",
  "h",
  "mi",
  "d",
  "m",
  "y",
  "ry",
  "month",
]);
const UNIT_KEYS = new Set<string>(["s", "m", "h", "d", "w", "M", "y"]);
const compiled = new WeakMap<TimeRangePack, CompiledPack>();

function isSlot(name: string): name is Slot {
  return SLOTS.has(name);
}

function isUnitKey(name: string): name is UnitKey {
  return UNIT_KEYS.has(name);
}

function byLength<T>(words: Word<T>[]): Words<T> {
  const seen = new Set<string>();
  const out: Words<T> = new Map();
  for (const w of [...words].sort((x, y) => y.s.length - x.s.length)) {
    const key = `${w.s}\u0000${JSON.stringify(w.value)}`;
    if (w.s.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.set(w.s[0], [...(out.get(w.s[0]) ?? []), w]);
  }
  return out;
}

/** Splits a pattern into literal words, `(a|b)` alternatives and `{slot}`s. */
export function compilePattern(source: string, fold: (s: string) => string): Elem[] {
  const elems: Elem[] = [];
  let lit = "";
  const flush = (): void => {
    if (lit.length > 0) elems.push({ k: "lit", alts: [fold(lit)] });
    lit = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === " ") {
      flush();
    } else if (ch === "{") {
      const close = source.indexOf("}", i);
      const name = close > i ? source.slice(i + 1, close) : "";
      if (!isSlot(name)) throw new Error(`time range pack: unknown slot in "${source}"`);
      flush();
      elems.push({ k: "slot", s: name });
      i = close;
    } else if (ch === "(") {
      const close = source.indexOf(")", i);
      if (close < i) throw new Error(`time range pack: open group in "${source}"`);
      flush();
      const alts = source
        .slice(i + 1, close)
        .split("|")
        .map(fold)
        .sort((a, b) => b.length - a.length);
      elems.push({ k: "lit", alts });
      i = close;
    } else {
      lit += ch;
    }
  }
  flush();
  return elems;
}

/** A pattern of two or more elements must hold a slot, so no pack can spell out a whole phrase. */
export function hasSlotRule(elems: Elem[]): boolean {
  return elems.length < 2 || elems.some((e) => e.k === "slot");
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

interface Split {
  unit: UnitKey;
  pre: string;
  post: string;
}

// The ago affix is what a template shares with every other unit's template; the rest is the unit word.
function deriveUnits(splits: Split[]): {
  words: Word<{ unit: UnitKey }>[];
  pre: string[];
  post: string[];
} {
  const words: Word<{ unit: UnitKey }>[] = [];
  const pre = new Set<string>();
  const post = new Set<string>();
  for (const a of splits) {
    let p = Infinity;
    let q = Infinity;
    for (const b of splits) {
      if (b.unit === a.unit) continue;
      p = Math.min(p, commonPrefix(a.pre, b.pre));
      q = Math.min(q, commonSuffix(a.post, b.post));
    }
    if (!Number.isFinite(p)) continue;
    const head = a.pre.slice(p).trim();
    const tail = a.post.slice(0, a.post.length - q).trim();
    if (head.length > 0 && tail.length > 0) continue;
    words.push({ s: head || tail, value: { unit: a.unit } });
    pre.add(a.pre.slice(0, p));
    post.add(a.post.slice(a.post.length - q));
  }
  return { words, pre: [...pre], post: [...post] };
}

function stripAffix(text: string, pre: string[], post: string[]): string | null {
  for (const p of pre) {
    for (const q of post) {
      if (text.startsWith(p) && text.endsWith(q) && text.length > p.length + q.length) {
        return text.slice(p.length, text.length - q.length).trim();
      }
    }
  }
  return null;
}

function mergeEnglish(hand: LocalePack, en: LocalePack | undefined): LocalePack {
  if (!en) return hand;
  const units: Partial<Record<UnitKey, string[]>> = { ...hand.units };
  for (const [key, words] of Object.entries(en.units)) {
    if (isUnitKey(key)) units[key] = [...(units[key] ?? []), ...(words ?? [])];
  }
  const words = { ...hand.words };
  for (const key of Object.keys(en.words) as (keyof LocalePack["words"])[]) {
    words[key] = [...(hand.words[key] ?? []), ...(en.words[key] ?? [])];
  }
  return {
    ...hand,
    units,
    words,
    patterns: {
      lastN: [...hand.patterns.lastN, ...en.patterns.lastN],
      ago: [...hand.patterns.ago, ...en.patterns.ago],
      since: [...hand.patterns.since, ...en.patterns.since],
      weekdayOfWeek: hand.patterns.weekdayOfWeek,
    },
    rangeJoin: [...hand.rangeJoin, ...en.rangeJoin],
    rangeTemplates: [...hand.rangeTemplates, ...en.rangeTemplates],
    numberWords: { ...en.numberWords, ...hand.numberWords },
    dayParts: { ...en.dayParts, ...hand.dayParts },
    articles: [...(en.articles ?? []), ...(hand.articles ?? [])],
  };
}

function autoWords(gen: GeneratedTables, fold: (s: string) => string) {
  const dayWords: Word<number>[] = [];
  const spanWords: Word<{ unit: SpanUnit; offset: number }>[] = [];
  const autoNames: Record<string, string> = {};
  for (const [unit, offset, word] of gen.auto) {
    autoNames[`${unit}${offset}`] = word;
    if (unit === "d") dayWords.push({ s: fold(word), value: offset });
    else if (unit === "w" || unit === "M" || unit === "q" || unit === "y") {
      spanWords.push({ s: fold(word), value: { unit, offset } });
    }
  }
  return { dayWords, spanWords, autoNames };
}

function handWords(hand: LocalePack, fold: (s: string) => string) {
  const w = hand.words;
  const day = (list: string[] | undefined, value: number): Word<number>[] =>
    (list ?? []).map((s) => ({ s: fold(s), value }));
  const span = (list: string[] | undefined, unit: SpanUnit, offset: number) =>
    (list ?? []).map((s) => ({ s: fold(s), value: { unit, offset } }));
  return {
    dayWords: [
      ...day(w.today, 0),
      ...day(w.yesterday, -1),
      ...day(w.dayBeforeYesterday, -2),
      ...day(w.tomorrow, 1),
    ],
    spanWords: [
      ...span(w.thisWeek, "w", 0),
      ...span(w.lastWeek, "w", -1),
      ...span(w.thisMonth, "M", 0),
      ...span(w.lastMonth, "M", -1),
      ...span(w.thisYear, "y", 0),
      ...span(w.lastYear, "y", -1),
    ],
  };
}

function generatedAgo(gen: GeneratedTables, pat: (s: string) => Elem[]) {
  const ago: Fixed<UnitKey | null>[] = [];
  const splits: Split[] = [];
  for (const [key, templates] of Object.entries(gen.ago)) {
    if (!isUnitKey(key)) continue;
    for (const t of templates ?? []) {
      ago.push({ elems: pat(t), value: key });
      const at = t.indexOf("{n}");
      splits.push({ unit: key, pre: t.slice(0, at), post: t.slice(at + 3) });
    }
  }
  return { ago, splits };
}

/** Builds the matcher tables of one locale from its hand pack, its Intl tables and English. */
export function compilePack(hand: LocalePack, gen: GeneratedTables, en?: LocalePack): CompiledPack {
  const pack = mergeEnglish(hand, en);
  const fold = (s: string): string =>
    foldText(s.normalize("NFKC"), pack.bcp47, pack.script, pack.hooks?.fold);
  const pat = (s: string): Elem[] => compilePattern(s.normalize("NFKC"), fold);
  const { ago, splits } = generatedAgo(gen, pat);
  const derived = deriveUnits(splits);
  const units: Word<{ unit: UnitKey; count?: number }>[] = derived.words.map((w) => ({
    s: fold(w.s),
    value: w.value,
  }));
  for (const [key, words] of Object.entries(pack.units)) {
    if (isUnitKey(key))
      for (const s of words ?? []) units.push({ s: fold(s), value: { unit: key } });
  }
  const agoFixed: Fixed<{ unit: UnitKey; count: number }>[] = [];
  for (const [unit, count, text] of gen.fixed) {
    if (!isUnitKey(unit)) continue;
    agoFixed.push({ elems: pat(text), value: { unit, count } });
    const core = stripAffix(text, derived.pre, derived.post);
    if (core) units.push({ s: fold(core), value: { unit, count } });
  }
  for (const [s, [unit, count]] of Object.entries(pack.countedUnits ?? {})) {
    units.push({ s: fold(s), value: { unit, count } });
  }
  for (const p of pack.patterns.ago) ago.push({ elems: pat(p), value: null });
  const auto = autoWords(gen, fold);
  const manual = handWords(pack, fold);
  const months: Word<number>[] = [];
  gen.months.forEach((names, i) => names.forEach((s) => months.push({ s: fold(s), value: i + 1 })));
  const weekdays: Word<number>[] = [];
  [
    ...gen.weekdays.map((n, i) => [n, i] as const),
    ...(pack.weekdays ?? []).map((n, i) => [n, i] as const),
  ].forEach(([names, i]) => names.forEach((s) => weekdays.push({ s: fold(s), value: i })));
  const mods: Word<ClockMod>[] = [];
  const ap = gen.h11 ? 0 : 1;
  // Pasted English stamps carry Latin AM/PM, so every pack also reads the English marks.
  (["am", "pm"] as const).forEach((k, i) =>
    [...gen.meridiem[i], ...(pack.meridiem?.[k] ?? []), ...(en?.meridiem?.[k] ?? [])].forEach((s) =>
      mods.push({ s: fold(s), value: { from: 12 * i, to: 12 * i + 12, shift: 0, ap } }),
    ),
  );
  for (const [s, [from, to, shift]] of Object.entries(pack.dayParts ?? {})) {
    mods.push({ s: fold(s), value: { from, to, shift: shift ?? 0 } });
  }
  return {
    key: pack.key,
    bcp47: pack.bcp47,
    script: pack.script,
    firstDay: gen.firstDay,
    slashOrder: pack.dateOrder ?? (gen.dateOrder.startsWith("m") ? "mdy" : "dmy"),
    slashAmbiguous: pack.slashAmbiguous === true,
    units: byLength(units),
    numberWords: byLength(
      Object.entries(pack.numberWords ?? {}).map(([s, value]) => ({ s: fold(s), value })),
    ),
    articles: new Set((pack.articles ?? []).map(fold)),
    hooks: pack.hooks ?? {},
    lastN: pack.patterns.lastN.map(pat),
    ago,
    agoFixed,
    since: pack.patterns.since.map(pat),
    weekdayOfWeek: Object.entries(pack.patterns.weekdayOfWeek ?? {}).map(([p, value]) => ({
      elems: pat(p),
      value,
    })),
    rangeTemplates: pack.rangeTemplates.map(pat),
    joins: [...new Set(pack.rangeJoin.map(fold))].sort((a, b) => b.length - a.length),
    pointAffixes: pack.pointAffixes.map(pat),
    clockAffixes: pack.clockAffixes.map(pat),
    datePatterns: [...gen.dates, ...(pack.datePatterns ?? [])].map(pat),
    dayWords: byLength([...auto.dayWords, ...manual.dayWords]),
    spanWords: byLength([...auto.spanWords, ...manual.spanWords]),
    nowWords: [...new Set(["now", ...(pack.words.now ?? [])].map(fold))].sort(
      (a, b) => b.length - a.length,
    ),
    months: byLength(months),
    weekdays: byLength(weekdays),
    mods: byLength(mods),
    autoNames: auto.autoNames,
    nameLastN: pack.nameTemplates.lastN,
    examples: pack.examples,
  };
}

export function brandPack(pack: CompiledPack): TimeRangePack {
  const branded: TimeRangePack = Object.freeze({ locale: pack.key, __brand: "TimeRangePack" });
  compiled.set(branded, pack);
  return branded;
}

export function compiledOf(pack: TimeRangePack): CompiledPack | undefined {
  return compiled.get(pack);
}
