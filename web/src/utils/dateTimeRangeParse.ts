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

// Text with no zone of its own comes back `absolute`, for the caller to read in the picker's zone.

import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from "date-fns-tz";

import { parseCalendarToken } from "@/utils/dashboard/calendarPeriods";
import { CALENDAR_RAIL_ITEMS } from "@/utils/timeRangeRail";
import { weekStartsOn, type WeekDay } from "@/utils/weekStart";

export interface AbsoluteRangeResult {
  type: "absolute";
  startDate: string; // YYYY/MM/DD
  startTime: string; // HH:MM:SS
  endDate: string;
  endTime: string;
  /** A single typed time the range was widened around; a zoned reader widens it in real time, as a DST day's civil clock skips or repeats. */
  centre?: { date: string; time: string };
  /** The text gave a year, so its wall clock may be a pasted stamp from another zone. */
  hasYear?: boolean;
  /** Real instants for text counted back from now, as the civil fields repeat an hour on a DST fall-back. */
  exact?: { startMicros: number; endMicros: number };
  /** Name a typed business period keeps, as raw text: "Q3 2026", "H1 2026", "2025", "FY26". */
  name?: string;
  /** Start month (1 = January) of a fiscal-year reading. */
  fiscalStartMonth?: number;
}

export interface TimestampRangeResult {
  type: "timestamp";
  startMicros: number;
  endMicros: number;
  /** The zone the text wrote its times in (`UTC`, `UTC+05:30`, `Asia/Kolkata`); absent for epoch numbers. */
  sourceZone?: string;
  /** The instant a lone pasted or typed time was widened around. */
  centreMicros?: number;
  epochUnit?: EpochUnit;
  /** Which instant of a DST repeated hour this reading took. */
  fold?: "earlier" | "later";
  /** A zone-abbreviation reading that lies wholly in the future, kept so the preferred reading is never dropped. */
  future?: boolean;
}

export type ParsedDateRange = AbsoluteRangeResult | TimestampRangeResult;

export type EpochUnit = "s" | "ms" | "µs" | "ns";

export type ParseFailureReason = "unreadable" | "future" | "reversed";

/** A civil time in a zone: a skipped time moves forward by the gap; a repeated time has two instants, the earlier first. */
export type ZonedCivil =
  | { kind: "exact"; micros: number }
  | { kind: "gap"; micros: number; usedTime: string }
  | { kind: "fold"; micros: number; laterMicros: number };

export interface SingleAbsoluteResult {
  type: "absolute";
  date: string; // YYYY/MM/DD
  time?: string; // HH:MM:SS — omitted when not given; caller defaults per side
}

export interface SingleTimestampResult {
  type: "timestamp";
  micros: number;
}

export type ParsedSingleDateTime = SingleAbsoluteResult | SingleTimestampResult;

/** A rolling period such as `15m`, in the picker's `<n><s|m|h|d|w|M>` form, or a calendar rail token such as `calendar:day:0`. */
export interface RelativeInputResult {
  type: "relative";
  period: string;
}

/** What the picker's text input reads: a rolling period or a concrete range. */
export type ParsedTimeInput = RelativeInputResult | ParsedDateRange;

/** `timeZone` (IANA) is the picker's zone: every wall-clock reading against `now` uses its date and time, else the browser's. */
export interface TimeInputOptions {
  now?: Date;
  locale?: string;
  timeZone?: string;
  weekStart?: WeekDay;
}

// `implied` marks the UTC frame a pasted instant is read in, which the text never wrote as a zone.
type Zone = { kind: "offset"; minutes: number; implied?: boolean } | { kind: "iana"; name: string };

// Civil times below are wall-clock fields stored as UTC epoch ms, so arithmetic never meets a DST jump.
interface ParseContext {
  now: Date;
  nowCivil: number;
  timeZone?: string;
  dayFirst: boolean;
  flipDayMonth: boolean;
  flipMeridiem: boolean;
  zoneOverride?: Zone;
  weekStart: WeekDay;
  keepFuture: boolean;
  seen: {
    dayMonth: boolean;
    meridiem: boolean;
    year: boolean;
    abbreviation?: string;
    reversed?: boolean;
  };
}

interface Duration {
  amount: number;
  unit: "s" | "m" | "h" | "d" | "w" | "M" | "y";
  counted: boolean;
}

// Candidate 24-hour hours in preference order; `ambiguous` marks a 1–12 hour typed without am/pm.
interface Clock {
  hours: number[];
  offsetMs: number;
  ambiguous: boolean;
}

type DaySpec =
  | { kind: "date"; year?: number; month: number; day?: number }
  | { kind: "shift"; days: number }
  | { kind: "weekday"; weekday: number; strict: boolean };

interface PointSpec {
  day?: DaySpec;
  clock?: Clock;
  part?: [number, number];
  instant?: number;
  span?: [number, number];
  zone?: Zone;
  bareNumber?: number;
  undated?: boolean;
  isNow?: boolean;
  exact?: number;
}

interface ResolvedPoint {
  start: number;
  end: number;
  instant: boolean;
}

interface CivilRange {
  start: number;
  end: number;
  startZone?: Zone;
  endZone?: Zone;
  centre?: number;
  endIsNow?: boolean;
  startExact?: number;
  endExact?: number;
  centreExact?: number;
}

interface IsoSingleParsed {
  hasOffset: boolean;
  micros?: number; // set when hasOffset
  offset?: string; // set when hasOffset
  date?: string; // YYYY/MM/DD — set when !hasOffset
  time?: string; // HH:MM:SS — set when !hasOffset and a time was given
  subMicros?: number; // µs past the time's millisecond
}

// A stamp that wrote its own offset keeps it, so the reading can name the zone it came from.
type StampedSingle =
  SingleAbsoluteResult | (SingleTimestampResult & { offset?: string; epochUnit?: EpochUnit });

// One side of a range: an instant (offset, epoch, JSON), a zoneless date[+time], or a time of day that borrows the other side's date.
type RangePoint =
  | { kind: "instant"; micros: number; date?: string; offset?: string }
  | { kind: "civil"; date: string; time?: string; subMicros?: number }
  | { kind: "time"; time: string; offset?: string; subMicros?: number };

export const SINGLE_WINDOW_MICROS = 5 * 60 * 1_000_000;
const ABSOLUTE_SINGLE_RE = /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?$/;
// Only whole epoch units count; 11, 12, 14, 15, 17 and 18 digits are a typo, not a time.
const TIMESTAMP_SINGLE_RE = /^(\d{10}|\d{13}|\d{16}|\d{19})$/;
const ISO_SINGLE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,6})?))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;
const TIME_ONLY_RE = /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,6})?))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
// The app's own log/trace timestamp display format (src/utils/date.ts formatTimestamp).
const HUMAN_LOG_SINGLE_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:\s+(Z|[+-]\d{2}(?::?\d{2})?))?$/i;
const RELATIVE_RE = /^(?:(?:last|past)\s+)?(\d{1,6})?\s*([a-z]+)$/i;
// Tried in order; each must split the text into exactly two sides, so a date's own `-` or `/` never counts as one.
const BARE_DASH = /\s*-\s*/;
const SPACED_DASH = /\s+-\s+/;
const RANGE_SEPARATORS = [/\s+to\s+/i, /\s*[–—]\s*/, SPACED_DASH, /\s*\/\s*/, BARE_DASH];
// After a dash, a bare HH:MM reads as much as a negative UTC offset as an end time.
const OFFSET_LIKE_END_RE = /^\d{2}:\d{2}$/;
// "last day" names yesterday, as "last week" names the previous week.
const CALENDAR_WORD_ALIASES: Record<string, string> = { "last-day": "yesterday" };
const MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};
const RELATIVE_UNITS: Record<string, string> = {
  s: "s",
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  m: "m",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  h: "h",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  d: "d",
  day: "d",
  days: "d",
  w: "w",
  wk: "w",
  wks: "w",
  week: "w",
  weeks: "w",
  mo: "M",
  mon: "M",
  month: "M",
  months: "M",
};
const DURATION_UNITS: Record<string, Duration["unit"]> = {
  ...(RELATIVE_UNITS as Record<string, Duration["unit"]>),
  y: "y",
  yr: "y",
  yrs: "y",
  year: "y",
  years: "y",
};
const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
const UNITS_LARGEST_FIRST = ["w", "d", "h", "m", "s"] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MAX_COUNT = 999_999;
const DURATION_PART_RE = /(\d+(?:\.\d+)?|half\s+an?|an?)?\s*([A-Za-z]+)\s*/y;
const EXTRA_CALENDAR_WORDS: Record<string, string> = {
  "this year": "calendar:year:0",
  "last year": "calendar:year:-1",
  "previous year": "calendar:year:-1",
  "previous day": "calendar:day:-1",
  "previous week": "calendar:week:-1",
  "previous month": "calendar:month:-1",
  "previous quarter": "calendar:quarter:-1",
  wtd: "calendar:week:0",
  "week to date": "calendar:week:0",
  mtd: "calendar:month:0",
  "month to date": "calendar:month:0",
  qtd: "calendar:quarter:0",
  "quarter to date": "calendar:quarter:0",
  ytd: "calendar:year:0",
  "year to date": "calendar:year:0",
  "today so far": "calendar:day:0",
  "this week so far": "calendar:week:0",
  "this month so far": "calendar:month:0",
  "this quarter so far": "calendar:quarter:0",
  "this year so far": "calendar:year:0",
};
// Snap grammar: `now-1d/d` names a whole unit, `-1d@d+9h` a start that runs to now; `M` is months.
const SNAP_POINT_RE =
  /^(now)?((?:\s*[+-]\s*\d{1,6}\s*[smhdwMy])*)(?:\s*([/@])\s*([smhdwMy]))?((?:\s*[+-]\s*\d{1,6}\s*[smhdwMy])*)$/;
const SNAP_OFFSET_RE = /([+-])\s*(\d{1,6})\s*([smhdwMy])/g;
const SNAP_CALENDAR_UNITS: Record<string, string> = { d: "day", w: "week", M: "month", y: "year" };
const BARE_COUNT_UNITS = ["m", "h", "d", "w", "M"];
const DAY_CLOCK_TEXT = String.raw`\d{1,2}(?::\d{2})?(?:\s*[ap]m)?`;
const DAY_CLOCK_ZONE_TEXT = String.raw`(?:utc|gmt)(?:\s*[+-]\d{1,2}(?::?\d{2})?)?|z|[a-z]{2,5}|[a-z]+(?:/[\w+-]+)+`;
const DAY_CLOCK_RANGE_RE = new RegExp(
  String.raw`^(.+?)\s+(${DAY_CLOCK_TEXT})\s*(?:-|–|—|\bto\b|\buntil\b|\btill\b)\s*(${DAY_CLOCK_TEXT})(?:\s+(${DAY_CLOCK_ZONE_TEXT}))?$`,
  "i",
);
// A capital M is months by case only, so `15M` always asks with months first.
const CAPITAL_MONTHS_RE = /^(\d{1,6})\s*M$/;
const AGO_CALENDAR_UNITS: Partial<Record<Duration["unit"], string>> = {
  w: "week",
  M: "month",
  y: "year",
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTH_NAMES = [
  ...["january", "february", "march", "april", "may", "june", "july", "august"],
  ...["september", "october", "november", "december"],
];
// Largest rolling count per unit, about ten years, so a typo cannot ask for an absurd range.
export const MAX_ROLLING_VALUE: Readonly<Record<"s" | "m" | "h" | "d" | "w" | "M", number>> = {
  s: 315_360_000,
  m: 5_256_000,
  h: 87_600,
  d: 3_650,
  w: 520,
  M: 120,
};
const QUARTER_RE = /^q([1-4])(?:\s*(\d{4}))?$|^(\d{4})\s*q([1-4])$/i;
const HALF_RE = /^h([12])(?:\s*(\d{4}))?$|^(\d{4})\s*h([12])$/i;
const FISCAL_RE = /^fy\s*(\d{2}|\d{4})$/i;
const BARE_YEAR_RE = /^\d{4}$/;
const FIRST_BARE_YEAR = 1999;
// Until an org setting exists the fiscal year is the calendar year.
const FISCAL_START_MONTH = 1;
// Copied live text is `<name> (<dates zone>)`; the name is what moves with now.
const NAMED_COPY_RE = /^(.+?)\s*\((.+)\)$/;
// Zero code points of the decimal digit sets people type in; each set runs zero to nine.
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810, 0xff10,
];
const WRAPPER_PAIRS: Record<string, string> = { '"': '"', "'": "'", "`": "`", "[": "]", "(": ")" };
const UTC_ZONE: Zone = { kind: "offset", minutes: 0 };
const INSTANT_ZONE: Zone = { kind: "offset", minutes: 0, implied: true };
const APACHE_STAMP_RE = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/;
// Log text after a pasted stamp never starts with a word that would make the text a range.
const LOG_TEXT_STOP_RE = /^(?:to|and|until|till|through|thru|for)\b/i;
// A log line's stamp sits in its first few words, so a long paste never makes the reader scan it all.
const LOG_STAMP_MAX_WORDS = 10;
const LOG_STAMP_MAX_CHARS = 64;
// Longer text can only be a log line or a URL, which are read from their head and query.
const MAX_NATURAL_TEXT = 4096;
const TRAILING_PUNCTUATION = ".;!?";
// Hours from the start of the named day; night runs on to 06:00 the next morning.
const DAY_PARTS: Record<string, [number, number]> = {
  morning: [6, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [21, 30],
};
const CLOCK_TEXT = String.raw`(?:\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:\s*[ap]m)?|\d{1,2}\s*[ap]m|noon|midnight)`;
const CLOCK_TAIL_RE = new RegExp(String.raw`^(?:(.*?)\s+)?(?:at\s+)?(${CLOCK_TEXT})$`, "i");
const CLOCK_HEAD_RE = new RegExp(String.raw`^(${CLOCK_TEXT})\s+(?:on\s+)?(.+)$`, "i");
const CLOCK_RE = /^(\d{1,2})(?::(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*([ap]m)?$/i;
const NUMERIC_DATE_RE =
  /^(\d{1,2})([/.])(\d{1,2})(?:\2(\d{2}|\d{4}))?$|^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/;
const ENDS_WITH_CLOCK_RE = /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const NL_RANGE_SEPARATORS = [
  /\s+(?:to|until|till|through|thru)\s+/i,
  /\s*[–—]\s*/,
  SPACED_DASH,
  BARE_DASH,
];
// Letter abbreviations name several zones worldwide, so each lists every offset (minutes) it is used for.
const ZONE_ABBREVIATIONS: Record<string, number[]> = {
  IST: [330, 60, 120],
  CST: [-360, 480, -300],
  BST: [60, 360],
  AST: [-240, 180],
  CDT: [-300, -240],
  PST: [-480, 480],
  PDT: [-420],
  MST: [-420],
  MDT: [-360],
  EST: [-300],
  EDT: [-240],
  AKST: [-540],
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
};
// Only words of four letters or more are typo-corrected; each maps to the spelling the grammar reads.
const TYPO_VOCABULARY: Record<string, string> = Object.fromEntries(
  [
    ...["second", "seconds", "secs", "minute", "minutes", "mins", "hour", "hours", "days"],
    ...["week", "weeks", "month", "months", "year", "years", "fortnight", "half"],
    ...["today", "yesterday", "since", "between", "from", "last", "past", "previous", "this"],
    ...["noon", "midnight", "morning", "afternoon", "evening", "night", "tonight", "until"],
    ...["till", "through", "before", "date", "quarter", ...WEEKDAYS, "tues", "thur", "thurs"],
    ...["january", "february", "march", "april", "june", "july", "august", "september"],
    ...["sept", "october", "november", "december"],
  ].map((word) => [word, word]),
);

/** Splits a picker period such as `15m` into its count and unit; a count below 1 is not a period. */
export function parseRollingPeriod(period: string): { value: number; unit: string } | null {
  const match = String(period).match(/^(\d+)([smhdwM])$/);
  if (!match || Number(match[1]) < 1) return null;
  return { value: Number(match[1]), unit: match[2] };
}

/** Reads typed or pasted text as a rolling period, a range, or a single instant widened to ±5 minutes; ambiguous text gets its preferred reading. */
export function parseTimeInput(raw: string, opts?: TimeInputOptions): ParsedTimeInput | null {
  return readTimeInput(raw, createContext(opts));
}

/** The alternative readings of ambiguous text (bare number, day/month order, 12-hour time, letter zone), preferred first; [] when unambiguous. */
export function suggestTimeInput(raw: string, opts?: TimeInputOptions): ParsedTimeInput[] {
  const text = cleanInput(raw);
  if (/^\d{1,6}$/.test(text) && Number(text) >= 1) {
    const counts: ParsedTimeInput[] = BARE_COUNT_UNITS.map((unit) => ({
      type: "relative",
      period: `${Number(text)}${unit}`,
    }));
    const year = readBusinessPeriod(text, createContext(opts));
    return year ? [year, ...counts] : counts;
  }
  const months = text.match(CAPITAL_MONTHS_RE);
  if (months && Number(months[1]) >= 1) {
    const count = Number(months[1]);
    return [
      { type: "relative", period: `${count}M` },
      { type: "relative", period: `${count}m` },
    ];
  }
  const ctx = createContext(opts);
  const preferred = readTimeInput(raw, ctx);
  if (ctx.seen.abbreviation) return zoneReadings(raw, opts, ctx.seen.abbreviation);
  if (!preferred) return [];
  const asked = askedReadings(text, preferred, opts);
  if (asked.length) return asked;
  const { dayMonth, meridiem } = ctx.seen;
  const readings = [preferred];
  if (dayMonth) readings.push(...readFlipped(raw, opts, { flipDayMonth: true }));
  if (meridiem) readings.push(...readFlipped(raw, opts, { flipMeridiem: true }));
  const unique = uniqueReadings(readings);
  return unique.length > 1 ? unique.slice(0, 4) : [];
}

/** `today`, `yesterday`, `last day`, `this|last week|month|quarter` → the calendar token of the rail row with that name. */
export function parseCalendarWords(raw: string): string | null {
  const words = raw.trim().toLowerCase().replace(/\s+/g, "-");
  const id = CALENDAR_WORD_ALIASES[words] ?? words;
  return CALENDAR_RAIL_ITEMS.find((item) => item.id === id)?.token ?? null;
}

/** `15m`, `15 min`, `last 2 hours`, `past week` → a rolling `<n><unit>`; `last <unit>` with no count is calendar where parseCalendarWords has that unit. */
export function parseRelativeText(raw: string): string | null {
  const match = raw.trim().match(RELATIVE_RE);
  if (!match) return null;
  const [, count, unitText] = match;
  if (!count && !/^(last|past)\s/i.test(raw.trim())) return null;
  const unit = unitText === "M" ? "M" : RELATIVE_UNITS[unitText.toLowerCase()];
  const value = count ? Number(count) : 1;
  if (!unit || !(value >= 1)) return null;
  return `${value}${unit}`;
}

export function parseDateRangeString(raw: string): ParsedDateRange | null {
  const range = readRangeStamp(raw);
  if (range?.type !== "timestamp") return range;
  return { type: "timestamp", startMicros: range.startMicros, endMicros: range.endMicros };
}

export function parseSingleDateTime(raw: string): ParsedSingleDateTime | null {
  const single = readSingleStamp(raw);
  if (single?.type !== "timestamp") return single;
  return { type: "timestamp", micros: single.micros };
}

/** Why text did not read: only future readings, an end not after its start, or nothing at all. */
export function explainTimeInputFailure(raw: string, opts?: TimeInputOptions): ParseFailureReason {
  const ctx = createContext(opts, { keepFuture: true });
  const reading = readTimeInput(raw, ctx);
  if (reading && isWhollyFuture(reading, ctx)) return "future";
  return ctx.seen.reversed ? "reversed" : "unreadable";
}

/** The period with its count lowered to about ten years; `cut` says it was lowered. */
export function capRollingPeriod(period: string): { period: string; cut: boolean } | null {
  const rolling = parseRollingPeriod(period);
  if (!rolling) return null;
  const max = MAX_ROLLING_VALUE[rolling.unit as keyof typeof MAX_ROLLING_VALUE];
  if (max === undefined || rolling.value <= max) return { period, cut: false };
  return { period: `${max}${rolling.unit}`, cut: true };
}

/** A civil `yyyy/MM/dd` date and `HH:mm:ss[.SSS]` time in an IANA zone, with DST gaps and repeats made explicit. */
export function resolveZonedCivil(date: string, time: string, zone: string): ZonedCivil {
  const civil = civilOf(date, time);
  // Offsets a day either side cover both sides of any one DST change.
  const before = getTimezoneOffset(zone, civil - DAY_MS);
  const offsets = [before, getTimezoneOffset(zone, civil), getTimezoneOffset(zone, civil + DAY_MS)];
  if (!offsets.every(Number.isFinite)) return { kind: "exact", micros: civil * 1000 };
  const matches = [...new Set(offsets)]
    .map((offset) => civil - offset)
    .filter((at) => wallClockOf(new Date(at), zone) === civil)
    .sort((a, b) => a - b);
  if (matches.length > 1) {
    return {
      kind: "fold",
      micros: matches[0] * 1000,
      laterMicros: matches[matches.length - 1] * 1000,
    };
  }
  if (matches.length === 1) return { kind: "exact", micros: matches[0] * 1000 };
  // In a gap the offset before the jump carries the clock forward by the gap's length.
  const at = civil - before;
  return {
    kind: "gap",
    micros: at * 1000,
    usedTime: civilTime(new Date(wallClockOf(new Date(at), zone))),
  };
}

function readRangeStamp(raw: string, seen?: ParseContext["seen"]): ParsedDateRange | null {
  const s = raw.trim();

  const json = parseJsonRange(s);
  if (json) return json;

  for (const separator of RANGE_SEPARATORS) {
    // A lone instant with a negative offset ("… 10:00:00 -05:00") also splits on a bare dash.
    if (separator === BARE_DASH && readSingleStamp(s)) continue;
    const parts = s.split(separator);
    if (parts.length !== 2) continue;
    const dashed = separator === SPACED_DASH || separator === BARE_DASH;
    if (dashed && OFFSET_LIKE_END_RE.test(parts[1].trim())) continue;
    const range = combineRangePoints(parsePoint(parts[0]), parsePoint(parts[1]), seen);
    if (range) return range;
  }
  return null;
}

function readSingleStamp(raw: string): StampedSingle | null {
  const s = raw.trim();

  const iso = parseIsoSingle(s) ?? parseHumanLogSingle(s);
  if (iso) {
    return iso.hasOffset
      ? { type: "timestamp", micros: iso.micros as number, offset: iso.offset }
      : { type: "absolute", date: iso.date as string, time: iso.time };
  }

  const tsMatch = s.match(TIMESTAMP_SINGLE_RE);
  if (tsMatch) {
    return { type: "timestamp", micros: toMicros(tsMatch[1]), epochUnit: epochUnitOf(tsMatch[1]) };
  }

  const absolute = parseAbsoluteSlash(s);
  if (absolute) return { type: "absolute", date: absolute.date, time: absolute.time };

  return null;
}

// date-fns `X` (the app's `Z` token) renders whole-hour zones as `+HH`, with no minutes.
function normalizeOffset(offset: string): string {
  if (offset.toUpperCase() === "Z") return "Z";
  const [, hours, minutes = "00"] = offset.match(/^([+-]\d{2}):?(\d{2})?$/) ?? [];
  return `${hours}:${minutes}`;
}

function isValidDateTimeParts(
  year: string,
  month: string,
  day: string,
  hour = "00",
  minute = "00",
  second = "00",
): boolean {
  const yearValue = Number(year);
  const monthValue = Number(month);
  const dayValue = Number(day);
  const hourValue = Number(hour);
  const minuteValue = Number(minute);
  const secondValue = Number(second);

  if (
    ![yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue].every(
      Number.isFinite,
    ) ||
    ![yearValue, monthValue, dayValue, hourValue, minuteValue].every(Number.isInteger) ||
    monthValue < 1 ||
    monthValue > 12 ||
    dayValue < 1 ||
    hourValue < 0 ||
    hourValue > 23 ||
    minuteValue < 0 ||
    minuteValue > 59 ||
    secondValue < 0 ||
    secondValue >= 60
  ) {
    return false;
  }

  const isLeapYear = yearValue % 4 === 0 && (yearValue % 100 !== 0 || yearValue % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    monthValue - 1
  ];

  return dayValue <= (daysInMonth ?? 0);
}

function isValidAbsoluteValue(date: string, time?: string): boolean {
  const dateParts = date.split(/[/-]/);
  const timeParts = (time ?? "00:00:00").split(":");
  if (dateParts.length !== 3 || timeParts.length !== 3) return false;

  return isValidDateTimeParts(
    dateParts[0],
    dateParts[1],
    dateParts[2],
    timeParts[0],
    timeParts[1],
    timeParts[2],
  );
}

function parseAbsoluteSlash(s: string): { date: string; time?: string } | null {
  const match = s.match(ABSOLUTE_SINGLE_RE);
  if (!match) return null;
  const time = match[2] && match[2].length === 5 ? `${match[2]}:00` : match[2];
  if (!isValidAbsoluteValue(match[1], time)) return null;
  return { date: match[1], time };
}

function parseIsoSingle(raw: string): IsoSingleParsed | null {
  const m = raw.match(ISO_SINGLE_RE);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, offset] = m;

  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return null;
  const msSecond = second && millisSecond(second);

  if (offset) {
    // Explicit offset already IS the instant — ignores the picker's timezone.
    const normalizedOffset = normalizeOffset(offset);
    const iso = `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${msSecond ?? "00"}${normalizedOffset}`;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return {
      hasOffset: true,
      micros: ms * 1000 + subMillisMicros(second),
      offset: normalizedOffset,
      date: `${year}/${month}/${day}`,
    };
  }

  return {
    hasOffset: false,
    date: `${year}/${month}/${day}`,
    time: hour ? `${hour}:${minute}:${msSecond ?? "00"}` : undefined,
    subMicros: subMillisMicros(second),
  };
}

// Date.parse and civil times hold milliseconds, so a µs fraction's rest is added to the instant separately.
function millisSecond(second: string): string {
  return second.replace(/(\.\d{3})\d+$/, "$1");
}

function subMillisMicros(second?: string): number {
  const fraction = second?.split(".")[1] ?? "";
  return Number(fraction.slice(3, 6).padEnd(3, "0"));
}

function parseHumanLogSingle(raw: string): IsoSingleParsed | null {
  const m = raw.match(HUMAN_LOG_SINGLE_RE);
  if (!m) return null;
  const [, monthAbbr, day, year, hour, minute, second, ms, offset] = m;
  const month = MONTH_INDEX[monthAbbr.toLowerCase()];
  const dd = day.padStart(2, "0");
  const fraction = ms ? `${second}.${ms}` : second;
  const secWithMs = millisSecond(fraction);

  if (!isValidDateTimeParts(year, month, dd, hour, minute, secWithMs)) return null;

  if (offset) {
    const normalizedOffset = normalizeOffset(offset);
    const iso = `${year}-${month}-${dd}T${hour}:${minute}:${secWithMs}${normalizedOffset}`;
    const parsedMs = Date.parse(iso);
    if (Number.isNaN(parsedMs)) return null;
    return {
      hasOffset: true,
      micros: parsedMs * 1000 + subMillisMicros(fraction),
      offset: normalizedOffset,
      date: `${year}/${month}/${dd}`,
    };
  }

  return {
    hasOffset: false,
    date: `${year}/${month}/${dd}`,
    time: `${hour}:${minute}:${secWithMs}`,
    subMicros: subMillisMicros(fraction),
  };
}

function parseTimeOnly(s: string): RangePoint | null {
  const m = s.match(TIME_ONLY_RE);
  if (!m) return null;
  const [, hour, minute, second = "00", offset] = m;
  if (!isValidDateTimeParts("2000", "01", "01", hour, minute, second)) return null;
  return {
    kind: "time",
    time: `${hour}:${minute}:${millisSecond(second)}`,
    offset: offset ? normalizeOffset(offset) : undefined,
    subMicros: subMillisMicros(second),
  };
}

function offsetOf(s: string): string | undefined {
  const m = s.match(/(Z|[+-]\d{2}(?::?\d{2})?)$/i);
  return m ? normalizeOffset(m[1]) : undefined;
}

function parsePoint(raw: string): RangePoint | null {
  const s = raw.trim();
  const iso = parseIsoSingle(s) ?? parseHumanLogSingle(s);
  if (iso?.hasOffset) {
    return { kind: "instant", micros: iso.micros as number, date: iso.date, offset: offsetOf(s) };
  }
  if (iso)
    return { kind: "civil", date: iso.date as string, time: iso.time, subMicros: iso.subMicros };
  if (TIMESTAMP_SINGLE_RE.test(s)) return { kind: "instant", micros: toMicros(s) };
  const absolute = parseAbsoluteSlash(s);
  if (absolute) return { kind: "civil", ...absolute };
  return parseTimeOnly(s);
}

// An end earlier in the day than its start crosses midnight, so it lands on the next day.
function endDateFor(
  start: RangePoint & { kind: "civil" },
  end: RangePoint & { kind: "time" },
): string {
  const startKey = timeKey(start.time ?? "00:00:00", start.subMicros);
  return timeKey(end.time, end.subMicros) >= startKey ? start.date : nextCivilDate(start.date);
}

// Civil times hold milliseconds, so an end with leftover µs rounds up to keep its last µs inside the range.
function roundedUpEnd(
  date: string,
  time: string,
  subMicros = 0,
): { endDate: string; endTime: string } {
  if (!subMicros) return { endDate: date, endTime: time };
  const at = new Date(civilOf(date, time) + 1);
  return { endDate: civilDate(at), endTime: civilTime(at) };
}

function nextCivilDate(date: string): string {
  const [year, month, day] = date.split("/").map(Number);
  return civilDate(new Date(Date.UTC(year, month - 1, day + 1)));
}

function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
}

function civilTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ms = date.getUTCMilliseconds();
  const base = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  return ms ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

function instantFromOffsetParts(date: string, time: string, offset: string): number | null {
  const ms = Date.parse(`${date.replace(/\//g, "-")}T${time}${offset}`);
  return Number.isNaN(ms) ? null : ms * 1000;
}

// Both sides must agree on having or lacking a zone, else they would be read in different frames.
function combineRangePoints(
  start: RangePoint | null,
  end: RangePoint | null,
  seen?: ParseContext["seen"],
): ParsedDateRange | null {
  if (!start || !end) return null;
  if (start.kind === "instant" && end.kind === "instant") {
    if (end.micros <= start.micros) return markReversed(seen);
    return withSourceZone(
      { type: "timestamp", startMicros: start.micros, endMicros: end.micros },
      start.offset ?? end.offset,
    );
  }
  if (start.kind === "civil" && end.kind === "civil") {
    // A timeless end covers its whole day, so it ends at the next midnight, as the search end is exclusive.
    const endKey = end.time
      ? civilKey(end.date, end.time, end.subMicros)
      : civilKey(nextCivilDate(end.date));
    if (endKey <= civilKey(start.date, start.time, start.subMicros)) return markReversed(seen);
    return {
      type: "absolute",
      startDate: start.date,
      startTime: start.time ?? "00:00:00",
      ...(end.time
        ? roundedUpEnd(end.date, end.time, end.subMicros)
        : { endDate: nextCivilDate(end.date), endTime: "00:00:00" }),
    };
  }
  if (end.kind !== "time") return null;
  if (start.kind === "civil" && !end.offset) {
    return {
      type: "absolute",
      startDate: start.date,
      startTime: start.time ?? "00:00:00",
      ...roundedUpEnd(endDateFor(start, end), end.time, end.subMicros),
    };
  }
  if (start.kind !== "instant" || !start.date || !start.offset) return null;
  const offset = end.offset ?? start.offset;
  // The end is the first time of day after the start, counted on the start's calendar day as seen in the end's offset.
  const dayInEndOffset = civilDate(new Date(start.micros / 1000 + offsetMillis(offset)));
  const sub = end.subMicros ?? 0;
  const sameDay = instantFromOffsetParts(dayInEndOffset, end.time, offset);
  const nextDay = () => instantFromOffsetParts(nextCivilDate(dayInEndOffset), end.time, offset);
  const base = sameDay !== null && sameDay + sub <= start.micros ? nextDay() : sameDay;
  if (base === null) return null;
  return withSourceZone(
    { type: "timestamp", startMicros: start.micros, endMicros: base + sub },
    start.offset,
  );
}

function markReversed(seen?: ParseContext["seen"]): null {
  if (seen) seen.reversed = true;
  return null;
}

function civilKey(date: string, time = "00:00:00", subMicros = 0): string {
  return `${date.replace(/-/g, "/")} ${timeKey(time, subMicros)}`;
}

// Fixed-width `HH:MM:SS.ffffff`, so times with and without a fraction compare as strings.
function timeKey(time: string, subMicros = 0): string {
  const [clock, fraction = ""] = time.split(".");
  return `${clock}.${fraction.padEnd(3, "0")}${String(subMicros).padStart(3, "0")}`;
}

function withSourceZone(range: TimestampRangeResult, offset?: string): TimestampRangeResult {
  return offset ? { ...range, sourceZone: offsetLabel(offsetMillis(offset) / MINUTE_MS) } : range;
}

function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const pad = (n: number) => String(n).padStart(2, "0");
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function offsetMillis(offset: string): number {
  if (offset === "Z") return 0;
  const [, sign, hours, minutes] = offset.match(/^([+-])(\d{2}):(\d{2})$/) ?? [];
  if (!sign) return 0;
  const total = (Number(hours) * 60 + Number(minutes)) * 60_000;
  return sign === "-" ? -total : total;
}

// A lone instant is widened to ±5 minutes; a lone date covers that whole day.
function singleToWindow(single: StampedSingle): ParsedDateRange {
  if (single.type === "timestamp") {
    const window: TimestampRangeResult = {
      type: "timestamp",
      startMicros: single.micros - SINGLE_WINDOW_MICROS,
      endMicros: single.micros + SINGLE_WINDOW_MICROS,
      centreMicros: single.micros,
      ...(single.epochUnit ? { epochUnit: single.epochUnit } : {}),
    };
    return withSourceZone(window, single.offset);
  }
  if (!single.time) {
    return {
      type: "absolute",
      startDate: single.date,
      startTime: "00:00:00",
      endDate: nextCivilDate(single.date),
      endTime: "00:00:00",
    };
  }
  const [year, month, day] = single.date.split("/").map(Number);
  const [hour, minute, second] = single.time.split(":");
  const centre =
    Date.UTC(year, month - 1, day, Number(hour), Number(minute), 0) +
    Math.round(Number(second) * 1000);
  const from = new Date(centre - SINGLE_WINDOW_MICROS / 1000);
  const to = new Date(centre + SINGLE_WINDOW_MICROS / 1000);
  return {
    type: "absolute",
    startDate: civilDate(from),
    startTime: civilTime(from),
    endDate: civilDate(to),
    endTime: civilTime(to),
    centre: { date: single.date, time: single.time },
  };
}

// The `{"start_date":<µs>,"end_date":<µs>}` payload Copy puts on the clipboard.
function parseJsonRange(s: string): TimestampRangeResult | null {
  if (!s.startsWith("{")) return null;
  try {
    const obj = JSON.parse(s);
    if (typeof obj?.start_date === "number" && typeof obj?.end_date === "number") {
      return { type: "timestamp", startMicros: obj.start_date, endMicros: obj.end_date };
    }
  } catch {
    // not JSON
  }
  return null;
}

function epochUnitOf(digits: string): EpochUnit {
  if (digits.length <= 10) return "s";
  if (digits.length <= 13) return "ms";
  return digits.length <= 16 ? "µs" : "ns";
}

// Auto-detect epoch unit by digit length; mirrors DateTime.vue's defaultAbsoluteTime.
function toMicros(digits: string): number {
  const n = Number(digits);
  if (digits.length <= 10) return n * 1_000_000; // seconds
  if (digits.length <= 13) return n * 1_000; // milliseconds
  if (digits.length <= 16) return n; // microseconds
  return Number(digits.slice(0, -3)); // nanoseconds, cut as text since 19 digits exceed a double's precision
}

function createContext(opts?: TimeInputOptions, flips: Partial<ParseContext> = {}): ParseContext {
  const now = opts?.now ?? new Date();
  const locale =
    opts?.locale ?? (typeof navigator === "undefined" ? undefined : navigator.language);
  return {
    now,
    nowCivil: wallClockOf(now, opts?.timeZone),
    timeZone: opts?.timeZone,
    dayFirst: isDayFirstLocale(locale),
    flipDayMonth: false,
    flipMeridiem: false,
    weekStart: opts?.weekStart ?? weekStartsOn(),
    keepFuture: false,
    ...flips,
    seen: { dayMonth: false, meridiem: false, year: false },
  };
}

function wallClockOf(now: Date, timeZone?: string): number {
  const zone = timeZone ? canonicalZone(timeZone) : null;
  if (zone) return Date.parse(`${formatInTimeZone(now, zone, "yyyy-MM-dd'T'HH:mm:ss.SSS")}Z`);
  return Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds(),
  );
}

function isDayFirstLocale(locale?: string): boolean {
  try {
    const types = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" })
      .formatToParts(new Date(Date.UTC(2026, 10, 4, 12)))
      .map((part) => part.type);
    return types.indexOf("day") < types.indexOf("month");
  } catch {
    return false;
  }
}

function readFlipped(
  raw: string,
  opts: TimeInputOptions | undefined,
  flips: Partial<ParseContext>,
): ParsedTimeInput[] {
  const reading = readTimeInput(raw, createContext(opts, flips));
  return reading ? [reading] : [];
}

function zoneReadings(
  raw: string,
  opts: TimeInputOptions | undefined,
  abbreviation: string,
): ParsedTimeInput[] {
  const offsets = ZONE_ABBREVIATIONS[abbreviation] ?? [];
  const readings = offsets.flatMap((minutes) =>
    readFlipped(raw, opts, { zoneOverride: { kind: "offset", minutes }, keepFuture: true }),
  );
  return uniqueReadings(readings).slice(0, 4);
}

function uniqueReadings(readings: ParsedTimeInput[]): ParsedTimeInput[] {
  const keys = new Set<string>();
  return readings.filter((reading) => {
    const key = JSON.stringify(reading);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

// Text that gives a year or an instant is read as written even when it is in the future, so the caller can say so.
function readTimeInput(raw: string, ctx: ParseContext): ParsedTimeInput | null {
  const text = cleanInput(raw);
  if (!text) return null;
  const pasted = normalizePasted(text);
  if (pasted.length > MAX_NATURAL_TEXT) {
    const long = readQueryString(pasted) ?? readLogPrefix(pasted);
    return long && markYear(long);
  }
  const named = readNamedCopy(pasted, ctx);
  if (named) return named;
  const snapped = readSnap(pasted, ctx);
  if (snapped) return snapped;
  const business = readBusinessPeriod(pasted, ctx);
  if (business) return isWhollyFuture(business, ctx) && !ctx.keepFuture ? null : business;
  const stamped = readQueryString(pasted, ctx.seen) ?? readLegacy(pasted, ctx.seen);
  if (stamped) return markYear(stamped);
  const natural = readNatural(pasted, ctx);
  if (natural) {
    if (ctx.seen.year) return markYear(natural);
    if (!isWhollyFuture(natural, ctx)) return natural;
    return ctx.keepFuture ? markFuture(natural) : null;
  }
  const logLine = readLogPrefix(pasted);
  return logLine && markYear(logLine);
}

interface SnapPoint {
  civil: number;
  snap: { kind: "/" | "@"; unit: string } | null;
  offsets: { sign: 1 | -1; amount: number; unit: string }[];
}

// Snap text is read only when it snaps (`/` or `@`); `now-1d` alone stays the rolling period.
function readSnap(text: string, ctx: ParseContext): ParsedTimeInput | null {
  if (!/[/@]/.test(text) || /\d[/@]\d|\d\/\d/.test(text)) return null;
  const sides = text.split(/\s+to\s+/i);
  if (sides.length > 2) return null;
  const start = parseSnapPoint(sides[0], ctx);
  if (!start) return null;
  if (sides.length === 2) {
    const endIsNow = /^now$/i.test(sides[1].trim());
    const end = endIsNow ? null : parseSnapPoint(sides[1], ctx);
    if (!endIsNow && !end) return null;
    return snapRange(start, end, ctx);
  }
  if (start.snap?.kind === "/" && start.offsets.length === 0) return snapRange(start, start, ctx);
  return snapRange(start, null, ctx);
}

function parseSnapPoint(raw: string, ctx: ParseContext): SnapPoint | null {
  const text = raw.trim();
  const match = text.match(SNAP_POINT_RE);
  if (!match) return null;
  const [, now, before, kind, unit, after] = match;
  if (!now && !before && !kind) return null;
  if (!kind && after) return null;
  const offsets = (source: string) =>
    [...source.matchAll(SNAP_OFFSET_RE)].map((part) => ({
      sign: (part[1] === "-" ? -1 : 1) as 1 | -1,
      amount: Number(part[2]),
      unit: part[3],
    }));
  let civil = ctx.nowCivil;
  for (const offset of offsets(before)) civil = shiftSnap(civil, offset);
  const snap = kind ? { kind: kind as "/" | "@", unit } : null;
  if (snap) civil = floorCivil(civil, snap.unit, ctx.weekStart);
  const tail = offsets(after);
  for (const offset of tail) civil = shiftSnap(civil, offset);
  return Number.isFinite(civil) ? { civil, snap, offsets: tail } : null;
}

function shiftSnap(civil: number, offset: SnapPoint["offsets"][number]): number {
  const unit = offset.unit as Duration["unit"];
  return shiftCivil(civil, { amount: offset.amount, unit, counted: true }, offset.sign);
}

function floorCivil(civil: number, unit: string, weekStart: WeekDay = 1): number {
  const date = new Date(civil);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (unit === "y") return Date.UTC(y, 0, 1);
  if (unit === "M") return Date.UTC(y, m, 1);
  if (unit === "w") return Date.UTC(y, m, d - ((date.getUTCDay() - weekStart + 7) % 7));
  if (unit === "d") return Date.UTC(y, m, d);
  const size = UNIT_SECONDS[unit] * 1000;
  return Math.floor(civil / size) * size;
}

function nextCivilUnit(civil: number, unit: string): number {
  if (unit === "M" || unit === "y") return shiftSnap(civil, { sign: 1, amount: 1, unit });
  return civil + UNIT_SECONDS[unit] * 1000;
}

// A whole calendar period becomes its token; any other snapped range is fixed when read.
function snapRange(start: SnapPoint, end: SnapPoint | null, ctx: ParseContext): ParsedTimeInput {
  const endCivil =
    end === null
      ? ctx.nowCivil
      : end.snap?.kind === "/" && end.offsets.length === 0
        ? nextCivilUnit(end.civil, end.snap.unit)
        : end.civil;
  const token = snapToken(start, endCivil, ctx);
  if (token) return { type: "relative", period: token };
  const to = Math.min(endCivil, ctx.nowCivil);
  return absoluteFromCivil({ start: start.civil, end: Math.max(to, start.civil) });
}

function snapToken(start: SnapPoint, endCivil: number, ctx: ParseContext): string | null {
  const unit = start.snap && start.offsets.length === 0 ? start.snap.unit : null;
  const calendar = unit ? SNAP_CALENDAR_UNITS[unit] : undefined;
  if (!unit || !calendar || !Number.isFinite(start.civil)) return null;
  const current = floorCivil(ctx.nowCivil, unit, ctx.weekStart);
  const back = periodsBetween(start.civil, current, unit);
  if (back < 0 || back > MAX_COUNT) return null;
  const periodStart =
    back === 0
      ? current
      : floorCivil(shiftSnap(current, { sign: -1, amount: back, unit }), unit, ctx.weekStart);
  if (periodStart !== start.civil) return null;
  const whole =
    endCivil === nextCivilUnit(periodStart, unit) || (back === 0 && endCivil >= ctx.nowCivil);
  return whole ? `calendar:${calendar}:${back === 0 ? 0 : -back}` : null;
}

// Whole periods from `from` back to `to`, worked out directly so a far-back snap costs no loop.
function periodsBetween(from: number, to: number, unit: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (unit === "y") return b.getUTCFullYear() - a.getUTCFullYear();
  if (unit === "M") {
    return b.getUTCFullYear() * 12 + b.getUTCMonth() - (a.getUTCFullYear() * 12 + a.getUTCMonth());
  }
  const size = (unit === "w" ? 7 : 1) * DAY_MS;
  return Math.round((to - from) / size);
}

function markYear(reading: ParsedTimeInput): ParsedTimeInput {
  return reading.type === "absolute" ? { ...reading, hasYear: true } : reading;
}

function markFuture(reading: ParsedTimeInput): ParsedTimeInput {
  return reading.type === "timestamp" ? { ...reading, future: true } : reading;
}

// Copied live text names its range first; any other `text (…)` is read by what is inside.
// A `name · dates` label reads by its name when that reads, else by its dates.
function readNamedCopy(text: string, ctx: ParseContext): ParsedTimeInput | null {
  const label = text.split(" · ");
  if (label.length === 2) return readTimeInput(label[0], ctx) ?? readTimeInput(label[1], ctx);
  const match = text.match(NAMED_COPY_RE);
  if (!match) return null;
  const head = readTimeInput(match[1], ctx);
  if (head?.type === "relative") return head;
  return readTimeInput(match[2], ctx);
}

// `Q3`, `H1 2025`, `2025`, `FY26`: whole periods, fixed, ending at the next period's start; `back` steps a yearless one back a year.
function readBusinessPeriod(text: string, ctx: ParseContext, back = 0): AbsoluteRangeResult | null {
  const thisYear = new Date(ctx.nowCivil).getUTCFullYear();
  const quarter = text.match(QUARTER_RE);
  const half = quarter ? null : text.match(HALF_RE);
  if (quarter || half) {
    const months = quarter ? 3 : 6;
    const match = (quarter ?? half) as RegExpMatchArray;
    const index = Number(match[1] ?? match[4]);
    const yearText = match[2] ?? match[3];
    const firstMonth = (index - 1) * months;
    const started = Date.UTC(thisYear, firstMonth, 1) <= ctx.nowCivil ? thisYear : thisYear - 1;
    const year = yearText ? Number(yearText) : started - back;
    const name = `${quarter ? "Q" : "H"}${index} ${year}`;
    return wholeMonths(year, firstMonth, months, name);
  }
  const fiscal = text.match(FISCAL_RE);
  if (fiscal) {
    // A two-digit fiscal year is the nearest one, as the next is often named ahead (FY27 in 2026).
    const past = fullYear(fiscal[1], ctx);
    const year =
      fiscal[1].length === 2 && past + 100 - thisYear < thisYear - past ? past + 100 : past;
    const period = wholeMonths(
      year,
      FISCAL_START_MONTH - 1,
      12,
      fiscal[0].toUpperCase().replace(/\s+/g, ""),
    );
    return { ...period, fiscalStartMonth: FISCAL_START_MONTH };
  }
  const year = BARE_YEAR_RE.test(text) ? Number(text) : NaN;
  if (year >= FIRST_BARE_YEAR && year <= thisYear) return wholeMonths(year, 0, 12, String(year));
  return null;
}

function wholeMonths(
  year: number,
  firstMonth: number,
  months: number,
  name: string,
): AbsoluteRangeResult {
  return {
    type: "absolute",
    startDate: civilDate(new Date(Date.UTC(year, firstMonth, 1))),
    startTime: "00:00:00",
    endDate: civilDate(new Date(Date.UTC(year, firstMonth + months, 1))),
    endTime: "00:00:00",
    name,
  };
}

// Readings that must ask rather than guess: a yearless period, `N weeks ago`, a DST repeated hour.
function askedReadings(
  text: string,
  preferred: ParsedTimeInput,
  opts?: TimeInputOptions,
): ParsedTimeInput[] {
  const previous = readBusinessPeriod(text, createContext(opts), 1);
  if (
    preferred.type === "absolute" &&
    preferred.name &&
    previous &&
    previous.name !== preferred.name
  ) {
    return [preferred, previous];
  }
  return agoReadings(text, preferred, opts) ?? foldReadings(preferred, opts);
}

// `2w ago` is the calendar week or the moment two weeks back; both are offered.
function agoReadings(
  text: string,
  preferred: ParsedTimeInput,
  opts?: TimeInputOptions,
): ParsedTimeInput[] | null {
  if (preferred.type !== "relative" || !parseCalendarToken(preferred.period)) return null;
  const natural = normalizeNatural(text);
  if (!/\sago$/i.test(natural)) return null;
  const ctx = createContext(opts);
  const moment = readSinglePoint(natural, ctx);
  return moment ? [preferred, civilRangeToResult(moment, ctx)] : null;
}

function foldReadings(preferred: ParsedTimeInput, opts?: TimeInputOptions): ParsedTimeInput[] {
  const zone = opts?.timeZone ? canonicalZone(opts.timeZone) : null;
  if (!zone || preferred.type !== "absolute" || preferred.exact) return [];
  const centre = preferred.centre
    ? resolveZonedCivil(preferred.centre.date, preferred.centre.time, zone)
    : null;
  if (centre) {
    if (centre.kind !== "fold") return [];
    return [centre.micros, centre.laterMicros].map((micros, index) => ({
      type: "timestamp",
      startMicros: micros - SINGLE_WINDOW_MICROS,
      endMicros: micros + SINGLE_WINDOW_MICROS,
      centreMicros: micros,
      fold: index === 0 ? "earlier" : "later",
    }));
  }
  const start = resolveZonedCivil(preferred.startDate, preferred.startTime, zone);
  const end = resolveZonedCivil(preferred.endDate, preferred.endTime, zone);
  if (start.kind !== "fold" && end.kind !== "fold") return [];
  const later = (point: ZonedCivil) => (point.kind === "fold" ? point.laterMicros : point.micros);
  return [
    { type: "timestamp", startMicros: start.micros, endMicros: end.micros, fold: "earlier" },
    { type: "timestamp", startMicros: later(start), endMicros: later(end), fold: "later" },
  ];
}

function cleanInput(raw: string): string {
  const text = asciiDigits(raw)
    .trim()
    .replace(/\b([ap])\.m\b\.?/gi, "$1m");
  let end = text.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(text[end - 1])) end--;
  return unwrap(text.slice(0, end).trim());
}

function asciiDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) as number;
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9);
    return zero === undefined ? digit : String(code - zero);
  });
}

function unwrap(text: string): string {
  const wrapped = text.match(/^(["'`[(])(.*)(["'`\])])$/);
  return wrapped && WRAPPER_PAIRS[wrapped[1]] === wrapped[3] ? wrapped[2].trim() : text;
}

// Log lines carry comma fractions and nanoseconds; a search keeps microseconds, so the rest is cut.
function normalizePasted(text: string): string {
  const apache = text.match(APACHE_STAMP_RE);
  const stamp = apache
    ? `${apache[3]}-${MONTH_INDEX[apache[2].toLowerCase()] ?? "00"}-${apache[1]}T${apache[4]}${apache[5]}`
    : text;
  return stamp
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{1,9})\b/g, "$1.$2")
    .replace(/(\d{2}:\d{2}:\d{2}\.\d{6})\d{1,3}/g, "$1");
}

function readLegacy(text: string, seen?: ParseContext["seen"]): ParsedTimeInput | null {
  const calendar = parseCalendarWords(text);
  if (calendar) return { type: "relative", period: calendar };
  const relative = parseRelativeText(text);
  if (relative) return { type: "relative", period: relative };
  const range = readRangeStamp(text, seen);
  if (range) return range;
  const single = readSingleStamp(text) ?? parseEpochFraction(text);
  return single ? singleToWindow(single) : null;
}

function parseEpochFraction(text: string): StampedSingle | null {
  const match = text.match(/^(\d{10})\.(\d{1,9})$/);
  if (!match) return null;
  const fraction = Number(match[2].slice(0, 6).padEnd(6, "0"));
  return { type: "timestamp", micros: Number(match[1]) * 1_000_000 + fraction, epochUnit: "s" };
}

// The app's own URLs carry `period=` for a rolling range and `from=&to=` (epoch µs) for a fixed one.
function readQueryString(text: string, seen?: ParseContext["seen"]): ParsedTimeInput | null {
  if (!/(?:^|[?&])(?:period|from|to)=/.test(text)) return null;
  const params = new URLSearchParams(text.slice(text.indexOf("?") + 1).split("#")[0]);
  const period = params.get("period");
  if (period) {
    const known = parseRollingPeriod(period) || parseCalendarToken(period);
    return known ? { type: "relative", period } : null;
  }
  const from = params.get("from");
  const to = params.get("to");
  return from && to ? combineRangePoints(parsePoint(from), parsePoint(to), seen) : null;
}

// A pasted log line: the longest leading stamp with seconds, when the rest reads as log text.
function readLogPrefix(text: string): ParsedTimeInput | null {
  const words = text.split(/\s+/, LOG_STAMP_MAX_WORDS + 1);
  for (let count = words.length - 1; count > 0; count--) {
    const next = words[count];
    if (!/^[A-Za-z[]/.test(next) || LOG_TEXT_STOP_RE.test(next)) continue;
    const head = words.slice(0, count).join(" ");
    if (head.length > LOG_STAMP_MAX_CHARS) continue;
    const stamp = normalizePasted(head);
    const single = /\d{2}:\d{2}:\d{2}/.test(stamp) ? readSingleStamp(stamp) : null;
    if (single) return singleToWindow(single);
  }
  return null;
}

function isWhollyFuture(reading: ParsedTimeInput, ctx: ParseContext): boolean {
  if (reading.type === "relative") return false;
  if (reading.type === "timestamp") return reading.startMicros > ctx.now.getTime() * 1000;
  return civilOf(reading.startDate, reading.startTime) > ctx.nowCivil;
}

function civilOf(date: string, time: string): number {
  const [year, month, day] = date.split("/").map(Number);
  const [hour, minute, second] = time.split(":");
  return (
    Date.UTC(year, month - 1, day, Number(hour), Number(minute)) + Math.round(Number(second) * 1000)
  );
}

// Text the grammar cannot read gets one more try as a day with a clock range (`yesterday 9-17`).
function readNatural(raw: string, ctx: ParseContext): ParsedTimeInput | null {
  const reading = readNaturalText(raw, ctx);
  if (reading) return reading;
  const dayHours = spellDayClockRange(normalizeNatural(raw));
  return dayHours ? readNaturalText(dayHours, ctx) : null;
}

function readNaturalText(raw: string, ctx: ParseContext): ParsedTimeInput | null {
  const text = normalizeNatural(raw);
  const calendar = readCalendarNatural(text);
  if (calendar) return { type: "relative", period: calendar };
  const period = readRelativeNatural(text);
  if (period) return { type: "relative", period };
  const range =
    readSince(text, ctx) ??
    readBetween(text, ctx) ??
    readDurationAround(text, ctx) ??
    readSinglePoint(text, ctx) ??
    readSplitRange(text, ctx);
  return range ? civilRangeToResult(range, ctx) : null;
}

function normalizeNatural(text: string): string {
  return correctTypos(text)
    .replace(/,/g, " ")
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function correctTypos(text: string): string {
  return text.replace(/(?<![\w/])[A-Za-z]{4,}(?![\w/])/g, correctWord);
}

// Corrects a word only when every one-edit match means the same thing, so a guess is never a coin toss.
function correctWord(word: string): string {
  const lower = word.toLowerCase();
  if (TYPO_VOCABULARY[lower] || DURATION_UNITS[lower]) return word;
  const candidates = Object.keys(TYPO_VOCABULARY).filter((entry) => isOneEdit(lower, entry));
  const meanings = new Set(candidates.map((entry) => DURATION_UNITS[entry] ?? entry));
  return meanings.size === 1 ? candidates[0] : word;
}

function isOneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  if (a.slice(i + 1) === b.slice(i + 1)) return true;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

// `yesterday 9-17` or `nov 4 09:00-17:00` reads as that day's two clock times; bare hours become HH:00.
function spellDayClockRange(text: string): string | null {
  const match = text.match(DAY_CLOCK_RANGE_RE);
  if (!match || /^\d+$/.test(match[1])) return null;
  const zone = match[4] ? ` ${match[4]}` : "";
  const clock = (value: string) =>
    `${/^\d{1,2}$/.test(value) ? `${value.padStart(2, "0")}:00` : value}${zone}`;
  return `${match[1]} ${clock(match[2])} to ${match[1]} ${clock(match[3])}`;
}

// `N weeks|months|quarters|years ago` names that calendar period, as the rail's Last row does.
function readCalendarNatural(text: string): string | null {
  const lower = text.toLowerCase();
  const word = EXTRA_CALENDAR_WORDS[lower] ?? parseCalendarWords(lower);
  if (word) return word;
  const quarters = lower.match(/^([1-9]\d{0,5})\s*quarters?\s+ago$/);
  if (quarters) return `calendar:quarter:-${quarters[1]}`;
  const ago = text.match(/^(.+?)\s*ago$/i);
  const duration = ago ? parseDuration(ago[1]) : null;
  const unit = duration?.counted ? AGO_CALENDAR_UNITS[duration.unit] : undefined;
  return duration && unit ? `calendar:${unit}:-${duration.amount}` : null;
}

function readRelativeNatural(text: string): string | null {
  const body = text.replace(/^the\s+/i, "");
  const toNow = body.match(/^(?:from\s+)?(.+?)\s+(?:to|until|till)\s+now$/i);
  if (toNow) {
    const start = toNow[1].match(/^now\s*-\s*(.+)$|^(.+?)\s*ago$/i);
    return start ? durationPeriod(parseDuration(start[1] ?? start[2])) : null;
  }
  const nowMinus = body.match(/^now\s*-\s*(.+)$/i);
  if (nowMinus) return durationPeriod(parseDuration(nowMinus[1]));
  const prefixed = body.match(/^(?:last|past|previous)\s+(.+)$/i);
  const duration = parseDuration(prefixed ? prefixed[1] : body);
  return duration && (prefixed || duration.counted) ? durationPeriod(duration) : null;
}

// Years are stored as months, since the picker's rolling units stop at `M`.
function durationPeriod(duration: Duration | null): string | null {
  if (!duration?.counted && duration?.unit !== undefined && duration.amount < 1) return null;
  if (!duration) return null;
  return duration.unit === "y" ? `${duration.amount * 12}M` : `${duration.amount}${duration.unit}`;
}

function parseDuration(text: string): Duration | null {
  const source = text.trim();
  const parts: Duration[] = [];
  DURATION_PART_RE.lastIndex = 0;
  while (DURATION_PART_RE.lastIndex < source.length) {
    const from = DURATION_PART_RE.lastIndex;
    const match = DURATION_PART_RE.exec(source);
    if (!match || DURATION_PART_RE.lastIndex === from) return null;
    const part = durationPart(match[1], match[2]);
    if (!part) return null;
    parts.push(part);
  }
  return combineDurations(parts);
}

function durationPart(count: string | undefined, unitText: string): Duration | null {
  const fortnight = /^fortnights?$/i.test(unitText);
  const unit = unitText === "M" ? "M" : fortnight ? "w" : DURATION_UNITS[unitText.toLowerCase()];
  if (!unit) return null;
  const amount = !count ? 1 : /^half/i.test(count) ? 0.5 : /^an?$/i.test(count) ? 1 : Number(count);
  return { amount: fortnight ? amount * 2 : amount, unit, counted: count !== undefined };
}

// Mixed or fractional parts collapse into the largest unit that keeps a whole count.
function combineDurations(parts: Duration[]): Duration | null {
  if (!parts.length || (parts.length > 1 && parts.some((part) => !part.counted))) return null;
  const { counted } = parts[0];
  if (parts.length === 1 && Number.isInteger(parts[0].amount)) {
    return wholeDuration(parts[0].amount, parts[0].unit, counted);
  }
  const monthly = parts.filter((part) => part.unit === "M" || part.unit === "y");
  if (monthly.length) {
    if (monthly.length !== parts.length) return null;
    const months = parts.reduce((sum, part) => sum + part.amount * (part.unit === "y" ? 12 : 1), 0);
    return wholeDuration(months, "M", counted);
  }
  const total = parts.reduce((sum, part) => sum + part.amount * UNIT_SECONDS[part.unit], 0);
  const seconds = Math.round(total * 1000) / 1000;
  const unit = UNITS_LARGEST_FIRST.find((candidate) => seconds % UNIT_SECONDS[candidate] === 0);
  return unit ? wholeDuration(seconds / UNIT_SECONDS[unit], unit, counted) : null;
}

function wholeDuration(amount: number, unit: Duration["unit"], counted: boolean): Duration | null {
  return Number.isInteger(amount) && amount >= 1 && amount <= MAX_COUNT
    ? { amount, unit, counted }
    : null;
}

function shiftCivil(civil: number, duration: Duration, sign: 1 | -1): number {
  if (duration.unit === "M" || duration.unit === "y") {
    const date = new Date(civil);
    const months = duration.amount * (duration.unit === "y" ? 12 : 1);
    const day = date.getUTCDate();
    // A month shift keeps the day only where it exists, so Mar 31 less a month is Feb 28, not Mar 3.
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + sign * months);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.getTime();
  }
  return civil + sign * duration.amount * UNIT_SECONDS[duration.unit] * 1000;
}

// `since X` and `now-a to now-b` are fixed when read; there is no rolling kind for them.
function readSince(text: string, ctx: ParseContext): CivilRange | null {
  const match = text.match(/^since\s+(.+)$/i);
  const parsed = match ? parsePointSpec(match[1], ctx) : null;
  const spec = parsed?.bareNumber !== undefined ? bareClockSpec(parsed) : parsed;
  const point = spec ? resolvePoint(spec, ctx) : null;
  if (!spec || !point) return null;
  return {
    start: point.start,
    end: ctx.nowCivil,
    startZone: spec.zone,
    endIsNow: true,
    startExact: spec.exact,
  };
}

function readBetween(text: string, ctx: ParseContext): CivilRange | null {
  const match =
    text.match(/^between\s+(.+?)\s+and\s+(.+)$/i) ??
    text.match(/^from\s+(.+?)\s+(?:to|until|till|through|thru|-|–|—)\s+(.+)$/i);
  return match ? resolveRange(match[1], match[2], ctx) : null;
}

function readDurationAround(text: string, ctx: ParseContext): CivilRange | null {
  const span = text.match(/^(.+?)\s+for\s+(.+)$/i);
  const around = span ? null : text.match(/^(.+?)\s*(?:\+\/-|\+-|±)\s*(.+)$/);
  const match = span ?? around;
  const spec = match ? parsePointSpec(match[1], ctx) : null;
  const duration = match ? parseDuration(match[2]) : null;
  const point = spec && duration?.counted ? resolvePoint(spec, ctx) : null;
  if (!spec || !duration || !point) return null;
  const zones = { startZone: spec.zone, endZone: spec.zone };
  return span
    ? { start: point.start, end: shiftCivil(point.start, duration, 1), ...zones }
    : {
        start: shiftCivil(point.start, duration, -1),
        end: shiftCivil(point.start, duration, 1),
        ...zones,
      };
}

function readSinglePoint(text: string, ctx: ParseContext): CivilRange | null {
  const spec = parsePointSpec(text, ctx);
  if (!spec || spec.bareNumber !== undefined) return null;
  const point = resolvePoint(spec, ctx);
  if (!point) return null;
  const zones = { startZone: spec.zone, endZone: spec.zone };
  if (!point.instant) return { start: point.start, end: point.end, ...zones };
  const window = SINGLE_WINDOW_MICROS / 1000;
  return {
    start: point.start - window,
    end: point.start + window,
    centre: point.start,
    centreExact: spec.exact,
    ...zones,
  };
}

function readSplitRange(text: string, ctx: ParseContext): CivilRange | null {
  for (const separator of NL_RANGE_SEPARATORS) {
    const parts = text.split(separator);
    if (parts.length !== 2) continue;
    const dashed = separator === SPACED_DASH || separator === BARE_DASH;
    const [left, right] = parts.map((part) => part.trim());
    if (dashed && ENDS_WITH_CLOCK_RE.test(left) && OFFSET_LIKE_END_RE.test(right)) continue;
    const range = resolveRange(left, right, ctx);
    if (range) return range;
  }
  return null;
}

function resolveRange(leftText: string, rightText: string, ctx: ParseContext): CivilRange | null {
  const left = parsePointSpec(leftText, ctx);
  const right = parsePointSpec(rightText, ctx);
  const pair = left && right ? coerceBareNumbers(left, right) : null;
  if (!pair) return null;
  const [startSpec, endSpec] = pair;
  const startZone = startSpec.zone ?? endSpec.zone;
  const endZone = endSpec.zone ?? startSpec.zone;
  const start = resolvePoint(startSpec, ctx, startZone);
  if (!start) return null;
  // Across a DST change the sides name different offsets, so the end is compared on its own zone's clock.
  const from =
    startZone && endZone && startZone !== endZone
      ? civilIn(endZone, zonedMicros(start.start, startZone) / 1000)
      : start.start;
  const end = resolveRangeEnd(endSpec, startSpec, from, ctx, endZone);
  if (end !== null && end <= from) ctx.seen.reversed = true;
  if (end === null || end <= from) return null;
  return {
    start: start.start,
    end,
    startZone,
    endZone,
    endIsNow: endSpec.isNow,
    startExact: startSpec.exact,
    endExact: endSpec.exact,
  };
}

// A lone number beside a date is a day of that month (`Nov 4 - 6`); beside a time it is an hour (`3 to 5`).
function coerceBareNumbers(left: PointSpec, right: PointSpec): [PointSpec, PointSpec] | null {
  const leftBare = left.bareNumber !== undefined;
  const rightBare = right.bareNumber !== undefined;
  if (leftBare && rightBare)
    return businessHours(left, right) ?? pairOrNull(bareClockSpec(left), bareClockSpec(right));
  if (leftBare) {
    const day = dayOfSameMonth(right, left.bareNumber as number);
    return day
      ? [day, right]
      : right.clock && !right.day
        ? pairOrNull(bareClockSpec(left), right)
        : null;
  }
  if (rightBare) {
    const day = dayOfSameMonth(left, right.bareNumber as number);
    return day ? [left, day] : left.clock ? pairOrNull(left, bareClockSpec(right)) : null;
  }
  return [left, right];
}

// `9 to 5` is a working day: a smaller second hour reads as the afternoon, so neither side is a night.
function businessHours(left: PointSpec, right: PointSpec): [PointSpec, PointSpec] | null {
  const from = left.bareNumber as number;
  const to = right.bareNumber as number;
  if (!(from >= 1 && from <= 12 && to >= 1 && to < from)) return null;
  return [
    { clock: { hours: [from], offsetMs: 0, ambiguous: false } },
    { clock: { hours: [to + 12], offsetMs: 0, ambiguous: false } },
  ];
}

function pairOrNull(
  left: PointSpec | null,
  right: PointSpec | null,
): [PointSpec, PointSpec] | null {
  return left && right ? [left, right] : null;
}

function dayOfSameMonth(other: PointSpec, day: number): PointSpec | null {
  if (other.day?.kind !== "date" || other.day.day === undefined || other.clock || other.part) {
    return null;
  }
  return { day: { ...other.day, day }, zone: other.zone };
}

function bareClockSpec(spec: PointSpec): PointSpec | null {
  const clock = clockFromHour(spec.bareNumber as number, false, undefined, 0);
  return clock ? { clock } : null;
}

// A time-only end is the first such time after the start; a yearless end date is the first one on or after it.
function resolveRangeEnd(
  spec: PointSpec,
  startSpec: PointSpec,
  start: number,
  ctx: ParseContext,
  zone?: Zone,
): number | null {
  if (spec.clock && !spec.day) return startSpec.undated ? null : clockAfter(spec.clock, start);
  if (spec.day?.kind === "date" && spec.day.year === undefined && !spec.clock && !spec.part) {
    return resolveDate(spec.day, ctx, start)?.end ?? null;
  }
  const point = resolvePoint(spec, ctx, zone);
  if (!point) return null;
  return point.instant ? point.start : point.end;
}

function resolvePoint(spec: PointSpec, ctx: ParseContext, zone = spec.zone): ResolvedPoint | null {
  if (spec.instant !== undefined) return { start: spec.instant, end: spec.instant, instant: true };
  if (spec.span) return { start: spec.span[0], end: spec.span[1], instant: false };
  if (spec.clock) {
    const clockCtx = zone ? { ...ctx, nowCivil: civilIn(zone, ctx.now.getTime()) } : ctx;
    const at = spec.day
      ? clockOnDay(spec.clock, resolveDay(spec.day, clockCtx)?.start, clockCtx)
      : clockMostRecent(spec.clock, clockCtx);
    return at === null ? null : { start: at, end: at, instant: true };
  }
  const day = spec.day ? resolveDay(spec.day, ctx) : null;
  if (!day) return null;
  if (!spec.part) return { start: day.start, end: day.end, instant: false };
  const [from, to] = spec.part;
  return { start: day.start + from * HOUR_MS, end: day.start + to * HOUR_MS, instant: false };
}

// A clock that names its zone is past or future on that zone's wall clock, not the picker's.
function civilIn(zone: Zone, instantMs: number): number {
  if (zone.kind === "offset") return instantMs + zone.minutes * MINUTE_MS;
  return wallClockOf(new Date(instantMs), zone.name);
}

function startOfDay(civil: number): number {
  return Math.floor(civil / DAY_MS) * DAY_MS;
}

function resolveDay(day: DaySpec, ctx: ParseContext): { start: number; end: number } | null {
  const today = startOfDay(ctx.nowCivil);
  if (day.kind === "date") return resolveDate(day, ctx);
  if (day.kind === "shift") return daySpanAt(today + day.days * DAY_MS);
  const weekday = new Date(today).getUTCDay();
  const back = (weekday - day.weekday + 7) % 7 || (day.strict ? 7 : 0);
  return daySpanAt(today - back * DAY_MS);
}

// The end is the next midnight, exclusive, so the day's last second is searched.
function daySpanAt(start: number): { start: number; end: number } {
  return { start, end: start + DAY_MS };
}

// A missing year is the most recent past one; a range's end only rolls into the next year from an earlier month.
function resolveDate(
  day: Extract<DaySpec, { kind: "date" }>,
  ctx: ParseContext,
  notBefore?: number,
): { start: number; end: number } | null {
  const spanIn = (year: number) => dateSpan(year, day.month, day.day);
  if (day.year !== undefined) return spanIn(day.year);
  if (notBefore !== undefined) {
    const from = new Date(notBefore);
    const span = spanIn(from.getUTCFullYear());
    if (!span || span.end > notBefore) return span;
    if (day.month - 1 < from.getUTCMonth()) return spanIn(from.getUTCFullYear() + 1);
    ctx.seen.reversed = true;
    return null;
  }
  const year = new Date(ctx.nowCivil).getUTCFullYear();
  // A yearless Feb 29 falls back to the latest leap year; leap years are at most eight apart.
  for (let candidate = year; candidate > year - 9; candidate--) {
    const span = spanIn(candidate);
    if (span && span.start <= ctx.nowCivil) return span;
  }
  return null;
}

function dateSpan(
  year: number,
  month: number,
  day?: number,
): { start: number; end: number } | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!isValidDateTimeParts(String(year), pad(month), pad(day ?? 1))) return null;
  if (day !== undefined) return daySpanAt(Date.UTC(year, month - 1, day));
  return { start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 1) };
}

// On a named day the hour is read as typed, unless only the other half of the day has passed.
function clockOnDay(clock: Clock, dayStart: number | undefined, ctx: ParseContext): number | null {
  if (dayStart === undefined) return null;
  if (clock.ambiguous) ctx.seen.meridiem = true;
  const candidates = clock.hours.map((hour) => dayStart + hour * HOUR_MS + clock.offsetMs);
  const preferred = candidates.find((at) => at <= ctx.nowCivil) ?? candidates[0];
  if (!(ctx.flipMeridiem && clock.ambiguous)) return preferred;
  return candidates.find((at) => at !== preferred) ?? preferred;
}

// Logs are in the past, so a bare time is its most recent occurrence that is not in the future.
function clockMostRecent(clock: Clock, ctx: ParseContext): number | null {
  if (clock.ambiguous) ctx.seen.meridiem = true;
  const today = startOfDay(ctx.nowCivil);
  const latest = (hours: number[]) => {
    let found: { hour: number; at: number } | null = null;
    for (const hour of hours) {
      for (const day of [today, today - DAY_MS]) {
        const at = day + hour * HOUR_MS + clock.offsetMs;
        if (at <= ctx.nowCivil && (!found || at > found.at)) found = { hour, at };
      }
    }
    return found;
  };
  const preferred = latest(clock.hours);
  if (!preferred || !(ctx.flipMeridiem && clock.ambiguous)) return preferred?.at ?? null;
  return latest(clock.hours.filter((hour) => hour !== preferred.hour))?.at ?? preferred.at;
}

function clockAfter(clock: Clock, start: number): number {
  const dayStart = startOfDay(start);
  const hours = [...clock.hours].sort((a, b) => a - b);
  const sameDay = hours
    .map((hour) => dayStart + hour * HOUR_MS + clock.offsetMs)
    .find((at) => at > start);
  return sameDay ?? dayStart + DAY_MS + hours[0] * HOUR_MS + clock.offsetMs;
}

function parsePointSpec(raw: string, ctx: ParseContext): PointSpec | null {
  const text = raw.trim().replace(/^at\s+/i, "");
  if (!text) return null;
  if (/^now$/i.test(text)) return { instant: ctx.nowCivil, isNow: true, exact: ctx.now.getTime() };
  if (/^\d{1,2}$/.test(text)) return { bareNumber: Number(text) };
  const shifted = parseShiftedPoint(text, ctx);
  if (shifted) return shifted;
  const zoned = extractZone(text, ctx);
  if (!zoned) return null;
  const legacy = parseLegacyPoint(zoned.rest);
  if (legacy) ctx.seen.year = true;
  const point = legacy ?? parseCivilPoint(zoned.rest, ctx);
  return point && { ...point, zone: point.zone ?? zoned.zone };
}

// `5 minutes ago` is that instant; `2 days ago` is that whole day.
function parseShiftedPoint(text: string, ctx: ParseContext): PointSpec | null {
  const match = text.match(/^now\s*-\s*(.+)$|^(.+?)\s*ago$/i);
  const duration = match ? parseDuration(match[1] ?? match[2]) : null;
  if (!match || !duration?.counted) return null;
  const seconds = UNIT_SECONDS[duration.unit];
  if (seconds !== undefined && duration.unit !== "d" && duration.unit !== "w") {
    const exact = ctx.now.getTime() - duration.amount * seconds * 1000;
    return { instant: wallClockOf(new Date(exact), ctx.timeZone), exact };
  }
  const at = shiftCivil(ctx.nowCivil, duration, -1);
  if (match[2] === undefined || duration.unit !== "d") return { instant: at };
  const day = daySpanAt(startOfDay(at));
  return { span: [day.start, day.end] };
}

function extractZone(text: string, ctx: ParseContext): { rest: string; zone?: Zone } | null {
  const iana = text.match(/^(.*(?:\d|[ap]m))\s+([A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/i);
  if (iana) {
    // The typed name is kept, as the reading names it back and ICU may alias it (Kolkata to Calcutta).
    const zone: Zone = { kind: "iana", name: iana[2] };
    return canonicalZone(iana[2]) ? { rest: iana[1], zone } : null;
  }
  const named = text.match(/^(.*\S)\s*(?:utc|gmt)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (named) return withOffset(named[1], named[2], named[3], named[4]);
  const utc =
    text.match(/^(.*\S)\s+(?:utc|gmt|z)$/i) ??
    text.match(/^(.*\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)z$/i);
  if (utc) return { rest: utc[1], zone: UTC_ZONE };
  const numeric = text.match(
    /^(.*\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(\s*)([+-])(\d{2}):?(\d{2})?$/,
  );
  // A glued offset on a bare time (`10:00-11:00`) reads as a range, not a zone.
  if (numeric && (numeric[2] || !/^\d{1,2}:\d{2}/.test(numeric[1]))) {
    return withOffset(numeric[1], numeric[3], numeric[4], numeric[5]);
  }
  const abbreviation = text.match(/^(.*(?:\d|[ap]m))\s+([A-Za-z]{2,5})$/i);
  const upper = abbreviation?.[2].toUpperCase();
  if (abbreviation && upper && ZONE_ABBREVIATIONS[upper]) {
    ctx.seen.abbreviation = upper;
    const preferred: Zone = { kind: "offset", minutes: ZONE_ABBREVIATIONS[upper][0] };
    return { rest: abbreviation[1], zone: ctx.zoneOverride ?? preferred };
  }
  return { rest: text };
}

function withOffset(
  rest: string,
  sign: string,
  hours: string,
  minutes = "00",
): { rest: string; zone: Zone } | null {
  const total = Number(hours) * 60 + Number(minutes);
  if (Number(minutes) > 59 || total > 14 * 60) return null;
  return { rest: rest.trim(), zone: { kind: "offset", minutes: sign === "-" ? -total : total } };
}

function canonicalZone(name: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function parseLegacyPoint(text: string): PointSpec | null {
  const single = parseSingleDateTime(text);
  if (!single) return null;
  if (single.type === "timestamp") {
    return {
      instant: single.micros / 1000,
      zone: INSTANT_ZONE,
      undated: TIMESTAMP_SINGLE_RE.test(text.trim()),
    };
  }
  if (single.time) return { instant: civilOf(single.date, single.time) };
  const [year, month, day] = single.date.split("/").map(Number);
  return { day: { kind: "date", year, month, day } };
}

function parseCivilPoint(text: string, ctx: ParseContext): PointSpec | null {
  const part = parseDayPart(text, ctx);
  if (part) return part;
  const tail = text.match(CLOCK_TAIL_RE);
  const head = tail ? null : text.match(CLOCK_HEAD_RE);
  const clockText = tail ? tail[2] : head?.[1];
  const dayText = (tail ? tail[1] : head?.[2]) ?? (clockText ? "" : text);
  const clock = clockText ? parseClock(clockText) : undefined;
  if (clock === null) return null;
  if (!dayText) return clock ? { clock } : null;
  const day = parseDaySpec(dayText, ctx);
  return day ? { day, clock } : null;
}

function parseDayPart(text: string, ctx: ParseContext): PointSpec | null {
  const lower = text.toLowerCase();
  const match = lower.match(/^(?:(.+?)\s+)?(morning|afternoon|evening|night)$|^tonight$/);
  if (!match) return null;
  const part = match[2] ?? "night";
  const lead = match[1] ?? "this";
  const latestNight = part === "night" && (lead === "this" || lead === "last");
  const day: DaySpec | null = latestNight
    ? { kind: "shift", days: latestNightShift(ctx) }
    : lead === "this"
      ? { kind: "shift", days: 0 }
      : parseDaySpec(lead, ctx);
  return day ? { day, part: DAY_PARTS[part] } : null;
}

// `last night` and `tonight` are the latest night that has begun, so before 21:00 it is the one from yesterday.
function latestNightShift(ctx: ParseContext): number {
  return ctx.nowCivil - startOfDay(ctx.nowCivil) >= DAY_PARTS.night[0] * HOUR_MS ? 0 : -1;
}

function parseDaySpec(text: string, ctx: ParseContext): DaySpec | null {
  const lower = text
    .toLowerCase()
    .replace(/^on\s+/, "")
    .trim();
  const shifts: Record<string, number> = {
    today: 0,
    yesterday: -1,
    "day before yesterday": -2,
    tomorrow: 1,
  };
  if (shifts[lower] !== undefined) return { kind: "shift", days: shifts[lower] };
  const named = lower.match(/^(?:(last|previous|this)\s+)?([a-z]+)$/);
  const weekday = named ? weekdayIndex(named[2]) : -1;
  if (named && weekday >= 0) {
    return { kind: "weekday", weekday, strict: named[1] === "last" || named[1] === "previous" };
  }
  const legacy = parseLegacyPoint(text);
  // RFC 2822 stamps lead with the weekday name, which the date itself already fixes.
  const dated = lower.replace(/^([a-z]+)\.?\s+(?=\d)/, (all, word) =>
    weekdayIndex(word) >= 0 ? "" : all,
  );
  const day = legacy?.day ?? parseMonthNameDate(dated) ?? parseNumericDate(dated, ctx);
  if (day?.kind === "date" && day.year !== undefined) ctx.seen.year = true;
  return day;
}

function weekdayIndex(word: string): number {
  return word.length >= 3 ? WEEKDAYS.findIndex((name) => name.startsWith(word)) : -1;
}

function monthIndex(word: string): number {
  const name = word.replace(/\.$/, "");
  return name.length >= 3 ? MONTH_NAMES.findIndex((month) => month.startsWith(name)) + 1 : 0;
}

function parseMonthNameDate(text: string): DaySpec | null {
  const monthFirst = text.match(/^([a-z]+\.?)\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  const dayFirst = text.match(/^(\d{1,2})\s+([a-z]+\.?)(?:\s+(\d{4}))?$/);
  const monthOnly = text.match(/^([a-z]+\.?)(?:\s+(\d{4}))?$/);
  const year = (value?: string) => (value ? Number(value) : undefined);
  if (monthFirst && monthIndex(monthFirst[1])) {
    const month = monthIndex(monthFirst[1]);
    return { kind: "date", month, day: Number(monthFirst[2]), year: year(monthFirst[3]) };
  }
  if (dayFirst && monthIndex(dayFirst[2])) {
    const month = monthIndex(dayFirst[2]);
    return { kind: "date", month, day: Number(dayFirst[1]), year: year(dayFirst[3]) };
  }
  if (monthOnly && monthIndex(monthOnly[1])) {
    return { kind: "date", month: monthIndex(monthOnly[1]), year: year(monthOnly[2]) };
  }
  return null;
}

// Year-first dates never reach here; otherwise the locale decides, unless one part cannot be a month.
function parseNumericDate(text: string, ctx: ParseContext): DaySpec | null {
  const match = text.match(NUMERIC_DATE_RE);
  if (!match) return null;
  const [first, second, yearText] = match[1]
    ? [Number(match[1]), Number(match[3]), match[4]]
    : [Number(match[5]), Number(match[6]), match[7]];
  if (first > 12 && second > 12) return null;
  let dayFirst = first > 12;
  if (first <= 12 && second <= 12) {
    if (first !== second) ctx.seen.dayMonth = true;
    dayFirst = ctx.dayFirst !== ctx.flipDayMonth;
  }
  const year = yearText === undefined ? undefined : fullYear(yearText, ctx);
  return dayFirst
    ? { kind: "date", year, month: second, day: first }
    : { kind: "date", year, month: first, day: second };
}

// A two-digit year is the latest such year that is not in the future: `26` is 2026, `99` is 1999.
function fullYear(text: string, ctx: ParseContext): number {
  if (text.length !== 2) return Number(text);
  const thisYear = new Date(ctx.nowCivil).getUTCFullYear();
  const year = Math.floor(thisYear / 100) * 100 + Number(text);
  return year > thisYear ? year - 100 : year;
}

function parseClock(text: string): Clock | null {
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (lower === "noon") return { hours: [12], offsetMs: 0, ambiguous: false };
  if (lower === "midnight") return { hours: [0], offsetMs: 0, ambiguous: false };
  const match = lower.match(CLOCK_RE);
  if (!match) return null;
  const [, hour, minute = "00", second = "00", fraction = "", meridiem] = match;
  if (Number(minute) > 59 || Number(second) > 59) return null;
  const offsetMs =
    Number(minute) * MINUTE_MS +
    Number(second) * 1000 +
    Number(fraction.slice(0, 3).padEnd(3, "0"));
  return clockFromHour(Number(hour), /^0\d$/.test(hour), meridiem, offsetMs);
}

// 13–23, 0 and a leading-zero hour are 24-hour; 1–12 without am/pm could be either half of the day.
function clockFromHour(
  hour: number,
  leadingZero: boolean,
  meridiem: string | undefined,
  offsetMs: number,
): Clock | null {
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return { hours: [(hour % 12) + (meridiem === "pm" ? 12 : 0)], offsetMs, ambiguous: false };
  }
  if (hour > 23) return null;
  if (hour === 0 || hour > 12 || leadingZero) return { hours: [hour], offsetMs, ambiguous: false };
  return { hours: hour === 12 ? [12, 0] : [hour, hour + 12], offsetMs, ambiguous: true };
}

function civilRangeToResult(range: CivilRange, ctx: ParseContext): ParsedDateRange {
  const startZone = range.startZone ?? range.endZone;
  if (!startZone) return withExact(absoluteFromCivil(range), range, ctx);
  const sourceZone = zoneLabel(startZone);
  const labelled = sourceZone ? { sourceZone } : {};
  if (range.centre !== undefined) {
    const centre = zonedMicros(range.centre, startZone);
    return {
      type: "timestamp",
      startMicros: centre - SINGLE_WINDOW_MICROS,
      endMicros: centre + SINGLE_WINDOW_MICROS,
      centreMicros: centre,
      ...labelled,
    };
  }
  const endMicros = range.endIsNow
    ? ctx.now.getTime() * 1000
    : zonedMicros(range.end, range.endZone ?? startZone);
  return {
    type: "timestamp",
    startMicros: zonedMicros(range.start, startZone),
    endMicros,
    ...labelled,
  };
}

function withExact(
  result: AbsoluteRangeResult,
  range: CivilRange,
  ctx: ParseContext,
): AbsoluteRangeResult {
  if (range.centreExact !== undefined) {
    const centre = range.centreExact * 1000;
    const exact = {
      startMicros: centre - SINGLE_WINDOW_MICROS,
      endMicros: centre + SINGLE_WINDOW_MICROS,
    };
    return { ...result, exact };
  }
  const end = range.endIsNow ? ctx.now.getTime() : range.endExact;
  if (range.startExact === undefined || end === undefined) return result;
  return { ...result, exact: { startMicros: range.startExact * 1000, endMicros: end * 1000 } };
}

function zoneLabel(zone: Zone): string | undefined {
  if (zone.kind === "iana") return zone.name;
  return zone.implied ? undefined : offsetLabel(zone.minutes);
}

function absoluteFromCivil(range: CivilRange): AbsoluteRangeResult {
  const from = new Date(range.start);
  const to = new Date(range.end);
  const result: AbsoluteRangeResult = {
    type: "absolute",
    startDate: civilDate(from),
    startTime: civilTime(from),
    endDate: civilDate(to),
    endTime: civilTime(to),
  };
  if (range.centre === undefined) return result;
  const centre = new Date(range.centre);
  return { ...result, centre: { date: civilDate(centre), time: civilTime(centre) } };
}

function zonedMicros(civil: number, zone: Zone): number {
  if (zone.kind === "offset") return (civil - zone.minutes * MINUTE_MS) * 1000;
  const wallClock = new Date(civil).toISOString().slice(0, 23);
  return fromZonedTime(wallClock, zone.name).getTime() * 1000;
}
