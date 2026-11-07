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

import { fromZonedTime, toZonedTime } from "date-fns-tz";

import type { I18nKey } from "@/types/i18n";
import { formatUtcOffsetAt, wallInstants, zoneOffsetMs } from "@/utils/rangeText";
import { clampRelativeWindow, type RelativeUnit, type RelativeWindow } from "@/utils/timeRangeRail";

// Parses pasted date-range / single date-time text for the DateTime picker.
// No store/timezone dependency by design: inputs that already resolve to an
// unambiguous instant (JSON copy payload, epoch timestamp, offset/`Z` ISO)
// return `"timestamp"` (epoch µs); inputs with no timezone of their own
// return `"absolute"` (date/time strings), resolved by the caller using the
// picker's currently selected timezone.

export interface AbsoluteRangeResult {
  type: "absolute";
  startDate: string; // YYYY/MM/DD
  startTime: string; // HH:MM:SS
  endDate: string;
  endTime: string;
}

export interface TimestampRangeResult {
  type: "timestamp";
  startMicros: number;
  endMicros: number;
}

export type ParsedDateRange = AbsoluteRangeResult | TimestampRangeResult;

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

/** Which grammar read a pasted text, so the panel can say how it was read. */
export type PasteFormat = "copied" | "iso" | "log" | "epoch" | "slashed" | "label";

export type EpochUnit = "s" | "ms" | "us";

export type PasteFailReason = "empty" | "no-date" | "invalid-part" | "mixed-offset";

/** A pasted range (or single value, `endUs` null) as whole-second instants. */
export interface PasteParsed {
  ok: true;
  startUs: number;
  endUs: number | null;
  format: PasteFormat;
  epochUnit?: EpochUnit;
  /** True when the text had no zone and was read in the picker's zone. */
  zoneAssumed: boolean;
  /** True when a sub-second end was ceiled to the next whole second. */
  endRoundedUp: boolean;
}

export interface PasteFailed {
  ok: false;
  reason: PasteFailReason;
  /** The pasted text, cut to 40 characters, for the error note. */
  fragment: string;
}

export type PasteResult = PasteParsed | PasteFailed;

/** Why the range field could not read its text; `not-allowed` is relative text on a dates-only picker. */
export type RangeInputFailReason = PasteFailReason | "unknown" | "not-allowed" | "no-seconds";

/** What the range field's grammar may accept, and the picker it reads for. */
export interface RangeInputContext {
  zone: string;
  nowMs: number;
  /** BCP 47 locale for month and weekday names. */
  locale?: string;
  /** Localized labels and words; English is always accepted without it. */
  t?: (key: I18nKey, named?: Record<string, unknown>) => string;
  calendarPresets?: boolean;
  disableRelative?: boolean;
  hideRelativeTime?: boolean;
  hideSeconds?: boolean;
  queryRangeRestrictionInHour?: number;
}

/** A rolling window; `typed` is set when the page's limit replaced what was typed. */
export interface RelativeInput extends RelativeWindow {
  ok: true;
  kind: "relative";
  typed?: RelativeWindow;
}

export interface CalendarInput {
  ok: true;
  kind: "calendar";
  token: string;
}

/** Text the zone came from, when it named one: an IANA name, or an abbreviation and the zone it was read as. */
export interface NamedZone {
  zone: string;
  abbr?: string;
}

export interface AbsoluteInput extends Omit<PasteParsed, "endUs"> {
  kind: "absolute";
  endUs: number;
  namedZone?: NamedZone;
}

export interface InstantInput extends Omit<PasteParsed, "endUs" | "endRoundedUp"> {
  kind: "instant";
  namedZone?: NamedZone;
}

export interface RangeInputFailed {
  ok: false;
  reason: RangeInputFailReason;
  fragment: string;
  /** A rewrite of the text that reads, for a keyword within two edits of a known one. */
  suggestion?: string;
}

export type RangeInputResult =
  RelativeInput | CalendarInput | AbsoluteInput | InstantInput | RangeInputFailed;

interface DetailedRange {
  parsed: ParsedDateRange;
  format: PasteFormat;
  epochUnit?: EpochUnit;
}

interface LabelSide {
  month?: number;
  day?: number;
  year?: number;
  hour?: number;
  minute?: number;
  second?: number;
  period?: "a" | "p";
  offset?: string;
}

interface WallTime {
  date: string;
  time: string;
  offset?: string;
}

// Matchers built once per locale from the picker's own labels.
interface LocalizedWords {
  relative: { re: RegExp; unit: RelativeUnit }[];
  prefixes: string[];
  calendar: [string, string][];
  weekdays: string[][];
  months: [string, string][];
  to: string;
}

const ABSOLUTE_RANGE_RE =
  /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?\s*-\s*(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_RANGE_RE = /^(\d{10,16})\s*-\s*(\d{10,16})$/;
const ABSOLUTE_SINGLE_RE = /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_SINGLE_RE = /^(\d{10,16})$/;
const ISO_SINGLE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}(?:\.\d{1,3})?))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
// The app's own log/trace timestamp display format (src/utils/date.ts formatTimestamp).
const HUMAN_LOG_SINGLE_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s+(Z|[+-]\d{2}(?::?\d{2})?))?$/i;
const RANGE_SEPARATOR_RE = /\s+(?:[-\u2013\u2014]|to)\s+/i;
const DIGIT_DASH_RE = /(\d)\s*[\u2013\u2014]\s*(\d)/;
const TRAILING_ZONE_RE = /^(.*\S)\s+((?:UTC|GMT)(?:[+-]\d{2}:?\d{2})?)$/i;
const LABEL_MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const LABEL_TIME = "(\\d{1,2}):(\\d{2})(?::(\\d{2}))?(?:\\s*([ap])\\.?m\\.?)?";
const LABEL_OFFSET = "(?:\\s+((?:UTC|GMT)(?:[+-]\\d{2}:?\\d{2})?))?";
const LABEL_MONTH_FIRST_RE = new RegExp(
  `^${LABEL_MONTH}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?(?:,?\\s+${LABEL_TIME})?${LABEL_OFFSET}$`,
  "i",
);
const LABEL_DAY_FIRST_RE = new RegExp(
  `^(\\d{1,2})\\s+${LABEL_MONTH}(?:,?\\s+(\\d{4}))?(?:,?\\s+${LABEL_TIME})?${LABEL_OFFSET}$`,
  "i",
);
const LABEL_TIME_ONLY_RE = new RegExp(`^${LABEL_TIME}${LABEL_OFFSET}$`, "i");
const LABEL_DAY_ONLY_RE = new RegExp(`^(\\d{1,2})(?:,?\\s+(\\d{4}))?${LABEL_OFFSET}$`, "i");
const DATE_LIKE_RE =
  /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{10,}/i;
const FRAGMENT_MAX = 40;
const MICROS_PER_SECOND = 1_000_000;
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
const RELATIVE_UNIT_WORDS: Record<string, RelativeUnit> = {
  sec: "s",
  secs: "s",
  second: "s",
  seconds: "s",
  min: "m",
  mins: "m",
  minute: "m",
  minutes: "m",
  hr: "h",
  hrs: "h",
  hour: "h",
  hours: "h",
  day: "d",
  days: "d",
  wk: "w",
  wks: "w",
  week: "w",
  weeks: "w",
  mo: "M",
  mos: "M",
  mon: "M",
  month: "M",
  months: "M",
};
const RELATIVE_TEXT_RE = /^(?:([\p{L}]+)\s+|now\s*-\s*|-\s*)?(\d+)\s*([\p{L}]+)$/iu;
const RELATIVE_PREFIXES = ["last", "past"];
// Largest relative amount per unit (~10 years), so a typo cannot produce an absurd or overflowing range.
const MAX_RELATIVE_VALUE: Record<RelativeUnit, number> = {
  s: 315_360_000,
  m: 5_256_000,
  h: 87_600,
  d: 3_650,
  w: 520,
  M: 120,
};
const PAST_KEYS: Record<RelativeUnit, I18nKey> = {
  s: "common.pastSecond",
  m: "common.pastMinute",
  h: "common.pastHour",
  d: "common.pastDay",
  w: "common.pastWeek",
  M: "common.pastMonth",
};
// One count per plural category in every shipped locale, so each localized form becomes a matcher.
const PLURAL_PROBES = [1, 2, 3, 5, 11, 21, 22, 25, 101, 111];
const CALENDAR_WORDS: [string, string][] = [
  ["today", "calendar:day:0"],
  ["yesterday", "calendar:day:-1"],
  ["this week", "calendar:week:0"],
  ["last week", "calendar:week:-1"],
  ["this month", "calendar:month:0"],
  ["last month", "calendar:month:-1"],
  ["this quarter", "calendar:quarter:0"],
  ["last quarter", "calendar:quarter:-1"],
  ["this year", "calendar:year:0"],
  ["last year", "calendar:year:-1"],
];
const CALENDAR_KEYS: Record<string, I18nKey> = {
  "calendar:day:0": "common.today",
  "calendar:day:-1": "common.yesterday",
  "calendar:week:0": "common.thisWeek",
  "calendar:week:-1": "common.lastWeek",
  "calendar:month:0": "common.thisMonth",
  "calendar:month:-1": "common.lastMonth",
  "calendar:quarter:0": "common.thisQuarter",
  "calendar:quarter:-1": "common.lastQuarter",
  "calendar:year:0": "common.thisYear",
  "calendar:year:-1": "common.lastYear",
};
const ENGLISH_WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
// Abbreviations read as a fixed zone: IST is India, CST is US Central.
const ZONE_ABBREVIATIONS: Record<string, string> = {
  IST: "Asia/Kolkata",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  MST: "America/Denver",
  MDT: "America/Denver",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  EST: "America/New_York",
  EDT: "America/New_York",
  AKST: "America/Anchorage",
  AKDT: "America/Anchorage",
  HST: "Pacific/Honolulu",
  BST: "Europe/London",
  WET: "Europe/Lisbon",
  WEST: "Europe/Lisbon",
  CET: "Europe/Paris",
  CEST: "Europe/Paris",
  EET: "Europe/Athens",
  EEST: "Europe/Athens",
  MSK: "Europe/Moscow",
  GST: "Asia/Dubai",
  PKT: "Asia/Karachi",
  SGT: "Asia/Singapore",
  HKT: "Asia/Hong_Kong",
  JST: "Asia/Tokyo",
  KST: "Asia/Seoul",
  AWST: "Australia/Perth",
  ACST: "Australia/Adelaide",
  ACDT: "Australia/Adelaide",
  AEST: "Australia/Sydney",
  AEDT: "Australia/Sydney",
  NZST: "Pacific/Auckland",
  NZDT: "Pacific/Auckland",
};
const TRAILING_WORD_RE = /^(.*\S)\s+([A-Za-z]{2,5}|[A-Za-z]+\/[A-Za-z0-9_+\-/]+)$/;
const ISO_INTERVAL_RE = /^(\d{4}-\d{2}-\d{2}[T ]?[^/\s]*)\s*\/\s*(\d{4}-\d{2}-\d{2}[T ]?[^/\s]*)$/;
const HOUR_PERIOD_RE = /(^|[^\d:])(\d{1,2})\s*([ap])\.?m\.?(?![\p{L}])/giu;
const SUGGESTION_DISTANCE = 2;
const matcherCache = new Map<string, LocalizedWords>();

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

export function parseDateRangeString(raw: string): ParsedDateRange | null {
  return parseRangeDetailed(raw.trim())?.parsed ?? null;
}

export function parseSingleDateTime(raw: string): ParsedSingleDateTime | null {
  const s = raw.trim();

  const iso = parseIsoSingle(s) ?? parseHumanLogSingle(s);
  if (iso) {
    return iso.hasOffset
      ? { type: "timestamp", micros: iso.micros as number }
      : { type: "absolute", date: iso.date as string, time: iso.time };
  }

  const tsMatch = s.match(TIMESTAMP_SINGLE_RE);
  if (tsMatch) {
    return { type: "timestamp", micros: toMicros(tsMatch[1]) };
  }

  const absMatch = s.match(ABSOLUTE_SINGLE_RE);
  if (absMatch) {
    const [date, time] = [absMatch[1], absMatch[2]];
    if (!isValidAbsoluteValue(date, time)) return null;
    return { type: "absolute", date: absMatch[1], time: absMatch[2] };
  }

  return null;
}

/**
 * Reads a pasted range or single value into whole-second instants, or says why it could not.
 * Zone-less text is read in `zone`; a start is floored and an end ceiled to whole seconds.
 */
export function parseRangeWithReason(
  text: string,
  zone: string,
  nowMs: number = Date.now(),
): PasteResult {
  const s = text.trim();
  if (!s) return { ok: false, reason: "empty", fragment: "" };
  const range = readRange(s, zone, nowMs);
  if (range) return range;
  const single = readSingle(s, zone);
  if (single) return single;
  return { ok: false, reason: failReason(s), fragment: cutFragment(s) };
}

/** The zone's short name at that instant (EST, IST), from Intl or else the abbreviation table; an offset when it has none. */
export function zoneAbbreviation(zone: string, atMs: number): string {
  let short = "";
  try {
    short =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
        .formatToParts(atMs)
        .find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return zone;
  }
  if (short && !/^(GMT|UTC)[+-]/.test(short)) return short;
  const canonical = zone === "Asia/Calcutta" ? "Asia/Kolkata" : zone;
  const named = Object.entries(ZONE_ABBREVIATIONS)
    .filter(([, value]) => value === canonical)
    .map(([abbr]) => abbr);
  if (named.length === 0) return short || formatUtcOffsetAt(atMs, zone);
  // The table lists a zone's standard name before its daylight one, so daylight time takes the second.
  return isDaylightTime(zone, atMs) && named.length > 1 ? named[1] : named[0];
}

/** Reads the range field: a relative period, a calendar word, an absolute range or one instant, in that order. */
export function parseRangeInput(text: string, ctx: RangeInputContext): RangeInputResult {
  const words = localizedWords(ctx);
  const s = normalizeInput(text, words.to);
  if (!s) return { ok: false, reason: "empty", fragment: "" };
  const read = readInput(s, ctx, words);
  if (read.ok || read.reason === "not-allowed" || read.reason === "no-seconds") return read;
  const suggestion = suggestFor(s, ctx, words);
  return suggestion ? { ...read, reason: "unknown", suggestion } : read;
}

interface IsoSingleParsed {
  hasOffset: boolean;
  micros?: number; // set when hasOffset
  date?: string; // YYYY/MM/DD — set when !hasOffset
  time?: string; // HH:MM:SS — set when !hasOffset and a time was given
}

function parseIsoSingle(raw: string): IsoSingleParsed | null {
  const m = raw.match(ISO_SINGLE_RE);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, offset] = m;

  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return null;

  if (offset) {
    // Explicit offset already IS the instant — ignores the picker's timezone.
    const normalizedOffset = normalizeOffset(offset);
    const iso = `${year}-${month}-${day}T${hour ?? "00"}:${minute ?? "00"}:${second ?? "00"}${normalizedOffset}`;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return { hasOffset: true, micros: ms * 1000 };
  }

  return {
    hasOffset: false,
    date: `${year}/${month}/${day}`,
    time: hour ? `${hour}:${minute}:${second ?? "00"}` : undefined,
  };
}

function parseHumanLogSingle(raw: string): IsoSingleParsed | null {
  const m = raw.match(HUMAN_LOG_SINGLE_RE);
  if (!m) return null;
  const [, monthAbbr, day, year, hour, minute, second, ms, offset] = m;
  const month = MONTH_INDEX[monthAbbr.toLowerCase()];
  const dd = day.padStart(2, "0");
  const secWithMs = ms ? `${second}.${ms}` : second;

  if (!isValidDateTimeParts(year, month, dd, hour, minute, secWithMs)) return null;

  if (offset) {
    const normalizedOffset = normalizeOffset(offset);
    const iso = `${year}-${month}-${dd}T${hour}:${minute}:${secWithMs}${normalizedOffset}`;
    const parsedMs = Date.parse(iso);
    if (Number.isNaN(parsedMs)) return null;
    return { hasOffset: true, micros: parsedMs * 1000 };
  }

  return {
    hasOffset: false,
    date: `${year}/${month}/${dd}`,
    time: `${hour}:${minute}:${secWithMs}`,
  };
}

// Splits on a whitespace-padded ` - ` — safe for ISO/human-log dates, which
// contain a bare `-` but never whitespace around it.
function parseRangeVia(
  s: string,
  parseSingle: (part: string) => IsoSingleParsed | null,
): ParsedDateRange | null {
  const parts = s.split(/\s+-\s+/);
  if (parts.length !== 2) return null;

  const start = parseSingle(parts[0]);
  const end = parseSingle(parts[1]);
  // Both sides must agree on having/not having an offset, else they'd be
  // interpreted in different frames of reference.
  if (!start || !end || start.hasOffset !== end.hasOffset) return null;

  if (start.hasOffset) {
    return {
      type: "timestamp",
      startMicros: start.micros as number,
      endMicros: end.micros as number,
    };
  }
  return {
    type: "absolute",
    startDate: start.date as string,
    startTime: start.time ?? "00:00:00",
    endDate: end.date as string,
    endTime: end.time ?? "23:59:59",
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

// Auto-detect epoch unit by digit length; mirrors DateTime.vue's defaultAbsoluteTime.
function toMicros(digits: string): number {
  const n = Number(digits);
  if (digits.length <= 10) return n * 1_000_000; // seconds
  if (digits.length <= 13) return n * 1_000; // milliseconds
  return n; // microseconds
}

function parseRangeDetailed(s: string): DetailedRange | null {
  const json = parseJsonRange(s);
  if (json) return { parsed: json, format: "copied" };

  const iso = parseRangeVia(s, parseIsoSingle);
  if (iso) return { parsed: iso, format: "iso" };

  const humanLog = parseRangeVia(s, parseHumanLogSingle);
  if (humanLog) return { parsed: humanLog, format: "log" };

  const tsMatch = s.match(TIMESTAMP_RANGE_RE);
  if (tsMatch) {
    return {
      parsed: {
        type: "timestamp",
        startMicros: toMicros(tsMatch[1]),
        endMicros: toMicros(tsMatch[2]),
      },
      format: "epoch",
      epochUnit: epochUnitOf(tsMatch[1]),
    };
  }

  const absMatch = s.match(ABSOLUTE_RANGE_RE);
  if (absMatch) {
    if (!isValidAbsoluteValue(absMatch[1], absMatch[2])) return null;
    if (!isValidAbsoluteValue(absMatch[3], absMatch[4])) return null;
    return {
      parsed: {
        type: "absolute",
        startDate: absMatch[1],
        startTime: absMatch[2] ?? "00:00:00",
        endDate: absMatch[3],
        endTime: absMatch[4] ?? "23:59:59",
      },
      format: "slashed",
    };
  }

  return null;
}

function epochUnitOf(digits: string): EpochUnit {
  if (digits.length <= 10) return "s";
  return digits.length <= 13 ? "ms" : "us";
}

// The app's other range forms use ` - `; an en dash or ` to ` is the same separator.
function normalizeSeparators(s: string): string {
  return s.replace(RANGE_SEPARATOR_RE, " - ");
}

function readRange(s: string, zone: string, nowMs: number): PasteParsed | null {
  const detailed = parseRangeDetailed(normalizeSeparators(s));
  if (detailed) return rangeResult(detailed, zone);
  const suffixed = s.match(TRAILING_ZONE_RE);
  if (suffixed) {
    const inner = parseRangeDetailed(normalizeSeparators(suffixed[1]));
    if (inner?.parsed.type === "absolute") return rangeResult(inner, zone, offsetOf(suffixed[2]));
  }
  return parseLabelRange(s, zone, nowMs);
}

function readSingle(s: string, zone: string): PasteParsed | null {
  const suffixed = s.match(TRAILING_ZONE_RE);
  const offset = suffixed ? offsetOf(suffixed[2]) : undefined;
  const single = parseSingleDateTime(s) ?? (suffixed ? parseSingleDateTime(suffixed[1]) : null);
  if (!single) return null;
  if (single.type === "timestamp") {
    return {
      ok: true,
      startUs: floorSecond(single.micros),
      endUs: null,
      format: TIMESTAMP_SINGLE_RE.test(s) ? "epoch" : "iso",
      epochUnit: TIMESTAMP_SINGLE_RE.test(s) ? epochUnitOf(s) : undefined,
      zoneAssumed: false,
      endRoundedUp: false,
    };
  }
  const wall = { date: single.date, time: single.time ?? "00:00:00", offset };
  return {
    ok: true,
    startUs: floorSecond(wallToMicros(wall, zone)),
    endUs: null,
    format: ABSOLUTE_SINGLE_RE.test(s) ? "slashed" : "iso",
    zoneAssumed: offset === undefined,
    endRoundedUp: false,
  };
}

function rangeResult(detailed: DetailedRange, zone: string, offset?: string): PasteParsed {
  const { parsed } = detailed;
  const timestamp = parsed.type === "timestamp";
  const startUs = timestamp
    ? parsed.startMicros
    : wallToMicros({ date: parsed.startDate, time: parsed.startTime, offset }, zone);
  const endUs = timestamp
    ? parsed.endMicros
    : wallToMicros({ date: parsed.endDate, time: parsed.endTime, offset }, zone);
  const endCeiled = ceilSecond(endUs);
  return {
    ok: true,
    startUs: floorSecond(startUs),
    endUs: endCeiled,
    format: detailed.format,
    epochUnit: detailed.epochUnit,
    zoneAssumed: !timestamp && offset === undefined,
    endRoundedUp: endCeiled !== endUs,
  };
}

// A repeated wall time reads as its first occurrence, as a typed time does.
function wallToMicros(wall: WallTime, zone: string): number {
  const date = wall.date.replace(/\//g, "-");
  if (wall.offset !== undefined) return Date.parse(`${date}T${wall.time}${wall.offset}`) * 1000;
  const [clock, fraction = ""] = wall.time.split(".");
  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0;
  const first = wallInstants(date, clock, zone)[0];
  const ms = first ?? fromZonedTime(`${date}T${clock}`, zone).getTime();
  return Math.round((ms + fractionMs) * 1000);
}

function floorSecond(us: number): number {
  return Math.floor(us / MICROS_PER_SECOND) * MICROS_PER_SECOND;
}

function ceilSecond(us: number): number {
  return Math.ceil(us / MICROS_PER_SECOND) * MICROS_PER_SECOND;
}

// `UTC` is Z; `UTC+05:30` and `GMT+0530` become `+05:30`.
function offsetOf(token: string): string {
  const rest = token.replace(/^(?:UTC|GMT)/i, "");
  return rest ? normalizeOffset(rest) : "Z";
}

function failReason(s: string): PasteFailReason {
  const parts = normalizeSeparators(s).split(/\s+-\s+/);
  if (parts.length === 2) {
    const [start, end] = parts.map((part) => parseSingleDateTime(part));
    if (start && end && start.type !== end.type) return "mixed-offset";
  }
  return DATE_LIKE_RE.test(s) ? "invalid-part" : "no-date";
}

function cutFragment(s: string): string {
  return s.length > FRAGMENT_MAX ? `${s.slice(0, FRAGMENT_MAX - 1)}\u2026` : s;
}

// Splits on the first range separator, or on an en dash between digits (`4–6 Nov`).
function splitLabel(s: string): [string, string] | [string] {
  const separator = s.match(RANGE_SEPARATOR_RE);
  if (separator?.index !== undefined) {
    return [s.slice(0, separator.index), s.slice(separator.index + separator[0].length)];
  }
  const digits = s.match(DIGIT_DASH_RE);
  if (digits?.index !== undefined) {
    const cut = digits.index + 1;
    return [s.slice(0, cut), s.slice(cut + digits[0].length - 2)];
  }
  return [s];
}

function parseLabelSide(raw: string): LabelSide | null {
  const s = raw.trim().replace(/,$/, "");
  const monthFirst = s.match(LABEL_MONTH_FIRST_RE);
  if (monthFirst) return labelSide(monthFirst[1], monthFirst[2], monthFirst[3], monthFirst, 4);
  const dayFirst = s.match(LABEL_DAY_FIRST_RE);
  if (dayFirst) return labelSide(dayFirst[2], dayFirst[1], dayFirst[3], dayFirst, 4);
  const timeOnly = s.match(LABEL_TIME_ONLY_RE);
  if (timeOnly) return labelSide(undefined, undefined, undefined, timeOnly, 1);
  const dayOnly = s.match(LABEL_DAY_ONLY_RE);
  if (dayOnly) {
    return {
      day: Number(dayOnly[1]),
      year: dayOnly[2] ? Number(dayOnly[2]) : undefined,
      offset: dayOnly[3] ? offsetOf(dayOnly[3]) : undefined,
    };
  }
  return null;
}

function labelSide(
  month: string | undefined,
  day: string | undefined,
  year: string | undefined,
  match: RegExpMatchArray,
  timeAt: number,
): LabelSide {
  const [hour, minute, second, period, offset] = match.slice(timeAt, timeAt + 5);
  return {
    month: month ? Number(MONTH_INDEX[month.toLowerCase()]) : undefined,
    day: day ? Number(day) : undefined,
    year: year ? Number(year) : undefined,
    hour: hour ? Number(hour) : undefined,
    minute: minute ? Number(minute) : undefined,
    second: second ? Number(second) : hour ? 0 : undefined,
    period: period ? (period.toLowerCase() as "a" | "p") : undefined,
    offset: offset ? offsetOf(offset) : undefined,
  };
}

// The trigger's own English label forms: `Nov 4, 13:47 – 15:52`, `Nov 4 – 6`, `4 Nov, 1:47 – 3:52 PM UTC`; with `baseDate`, bare times too.
function parseLabelRange(
  s: string,
  zone: string,
  nowMs: number,
  baseDate?: string,
): PasteParsed | null {
  const pieces = splitLabel(s);
  const start = parseLabelSide(pieces[0]);
  const end = pieces.length === 2 ? parseLabelSide(pieces[1]) : { ...start };
  if (!start || !end) return null;
  if (baseDate && isTimeOnly(start) && isTimeOnly(end)) {
    return timesOnDate(start, end, pieces.length === 1, baseDate, zone);
  }
  if (pieces.length === 1 && start.month === undefined) return null;
  if (!shareLabelParts(start, end)) return null;
  defaultLabelYears(start, end, zone, nowMs);
  if (pieces.length === 1 && start.hour !== undefined) {
    const wall = labelWall(start);
    if (!wall) return null;
    const startUs = wallToMicros(wall, zone);
    return labelResult(startUs, null, wall);
  }
  const wholeDay = start.hour === undefined && end.hour === undefined;
  const startWall = labelWall(start, wholeDay ? "00:00:00" : undefined);
  const endWall = labelWall(end, wholeDay || end.hour === undefined ? "23:59:59" : undefined);
  if (!startWall || !endWall) return null;
  return labelResult(wallToMicros(startWall, zone), wallToMicros(endWall, zone), startWall);
}

function labelResult(startUs: number, endUs: number | null, wall: WallTime): PasteParsed {
  return {
    ok: true,
    startUs,
    endUs,
    format: "label",
    zoneAssumed: wall.offset === undefined,
    endRoundedUp: false,
  };
}

// An end with only a day or a time takes the rest from the other end, as Intl's formatRange leaves it out.
function shareLabelParts(start: LabelSide, end: LabelSide): boolean {
  if (end.month === undefined && end.day !== undefined) end.month = start.month;
  if (start.month === undefined && start.day !== undefined) start.month = end.month;
  if (end.day === undefined) {
    end.month = start.month;
    end.day = start.day;
  }
  if (end.year === undefined && start.year !== undefined) {
    end.year = endsInEarlierDay(start, end) ? start.year + 1 : start.year;
  }
  if (start.year === undefined && end.year !== undefined) {
    start.year = endsInEarlierDay(start, end) ? end.year - 1 : end.year;
  }
  if (start.period === undefined && start.hour !== undefined) start.period = end.period;
  if (end.period === undefined && end.hour !== undefined) end.period = start.period;
  if (start.offset === undefined) start.offset = end.offset;
  if (end.offset === undefined) end.offset = start.offset;
  return start.month !== undefined && start.day !== undefined && end.month !== undefined;
}

// With one year given, only December to January crosses into the other year; any other reversed pair stays end-before-start.
function endsInEarlierDay(start: LabelSide, end: LabelSide): boolean {
  return start.month === 12 && end.month === 1;
}

// A yearless label starts this year, or last year if that is in the future; an End earlier than Start is the next year.
function defaultLabelYears(start: LabelSide, end: LabelSide, zone: string, nowMs: number) {
  if (start.year !== undefined) return;
  const now = toZonedTime(nowMs, zone);
  const thisYear = now.getFullYear();
  const startsLater =
    (start.month ?? 1) > now.getMonth() + 1 ||
    ((start.month ?? 1) === now.getMonth() + 1 && (start.day ?? 1) > now.getDate());
  start.year = startsLater ? thisYear - 1 : thisYear;
  end.year = endsBeforeStartDay(start, end) ? start.year + 1 : start.year;
}

function endsBeforeStartDay(start: LabelSide, end: LabelSide): boolean {
  const startKey = (start.month ?? 1) * 100 + (start.day ?? 1);
  return (end.month ?? 1) * 100 + (end.day ?? 1) < startKey;
}

function labelWall(side: LabelSide, fixedTime?: string): WallTime | null {
  const year = String(side.year ?? "").padStart(4, "0");
  const month = String(side.month ?? "").padStart(2, "0");
  const day = String(side.day ?? "").padStart(2, "0");
  const time = fixedTime ?? labelClock(side);
  if (!time) return null;
  const [hour, minute, second] = time.split(":");
  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return null;
  return { date: `${year}-${month}-${day}`, time, offset: side.offset };
}

function labelClock(side: LabelSide): string | null {
  if (side.hour === undefined || side.minute === undefined) return null;
  let hour = side.hour;
  if (side.period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (side.period === "p" ? 12 : 0);
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(hour)}:${pad(side.minute)}:${pad(side.second ?? 0)}`;
}

function readInput(s: string, ctx: RangeInputContext, words: LocalizedWords): RangeInputResult {
  const relative = readRelative(s, ctx, words);
  if (relative) return relative;
  if (ctx.calendarPresets) {
    const calendar = readCalendar(s, ctx, words) ?? readZonedCalendar(s, ctx, words);
    if (calendar) return calendar;
  }
  return readAbsolute(s, ctx, words);
}

// A day word with times and a trailing zone name (`yesterday 09:00 - 17:00 IST`) reads in that zone.
function readZonedCalendar(
  s: string,
  ctx: RangeInputContext,
  words: LocalizedWords,
): AbsoluteInput | null {
  const named = trailingZone(s);
  if (!named) return null;
  const read = readCalendar(named.rest, { ...ctx, zone: named.zone.zone }, words);
  if (read?.kind !== "absolute") return null;
  return { ...read, zoneAssumed: false, namedZone: named.zone };
}

// Daylight time is whichever offset is the larger of the year's two.
function isDaylightTime(zone: string, atMs: number): boolean {
  const year = new Date(atMs).getUTCFullYear();
  const january = zoneOffsetMs(Date.UTC(year, 0, 1), zone);
  const july = zoneOffsetMs(Date.UTC(year, 6, 1), zone);
  if (!Number.isFinite(january) || january === july) return false;
  return zoneOffsetMs(atMs, zone) === Math.max(january, july);
}

function readRelative(
  s: string,
  ctx: RangeInputContext,
  words: LocalizedWords,
): RelativeInput | RangeInputFailed | null {
  const window = relativeWindowOf(s, words);
  if (!window) return null;
  if (ctx.disableRelative || ctx.hideRelativeTime) {
    return { ok: false, reason: "not-allowed", fragment: cutFragment(s) };
  }
  if (window.unit === "s" && ctx.hideSeconds) {
    return { ok: false, reason: "no-seconds", fragment: cutFragment(s) };
  }
  if (!(window.value >= 1)) return { ok: false, reason: "invalid-part", fragment: cutFragment(s) };
  const capped = { ...window, value: Math.min(window.value, MAX_RELATIVE_VALUE[window.unit]) };
  const clamped = clampRelativeWindow(capped, ctx.queryRangeRestrictionInHour ?? 0);
  const changed = clamped.value !== capped.value || clamped.unit !== capped.unit;
  return { ok: true, kind: "relative", ...clamped, ...(changed ? { typed: capped } : {}) };
}

function relativeWindowOf(s: string, words: LocalizedWords): RelativeWindow | null {
  const match = s.match(RELATIVE_TEXT_RE);
  if (match) {
    const [, prefix, amount, unitWord] = match;
    const unit = relativeUnitOf(unitWord);
    const knownPrefix = !prefix || words.prefixes.includes(prefix.toLowerCase());
    if (unit && knownPrefix) return { value: Number(amount), unit };
  }
  for (const { re, unit } of words.relative) {
    const label = s.match(re);
    if (label) return { value: Number(label[1]), unit };
  }
  return null;
}

// A one-letter unit keeps its case, so `m` is minutes and `M` months; words match in any case.
function relativeUnitOf(word: string): RelativeUnit | null {
  if (word === "m" || word === "M") return word;
  if (word.length === 1) {
    const unit = word.toLowerCase();
    return ["s", "h", "d", "w"].includes(unit) ? (unit as RelativeUnit) : null;
  }
  return RELATIVE_UNIT_WORDS[word.toLowerCase()] ?? null;
}

function readCalendar(
  s: string,
  ctx: RangeInputContext,
  words: LocalizedWords,
): CalendarInput | AbsoluteInput | null {
  const lower = s.toLowerCase();
  const token = words.calendar.find(([word]) => word === lower)?.[1];
  if (token) return { ok: true, kind: "calendar", token };
  const day = dayWordAt(lower, ctx, words);
  if (!day) return null;
  const rest = s.slice(day.length).trim();
  if (!rest) return wholeDay(day.date, ctx.zone);
  const times = parseLabelRange(
    normalizeSeparators(prepareAbsolute(rest, words)),
    ctx.zone,
    ctx.nowMs,
    day.date,
  );
  if (!times?.ok || times.endUs === null) return null;
  return { ...times, kind: "absolute", endUs: times.endUs };
}

// A day word at the start of the text (today, yesterday or a weekday), and the civil date it names.
function dayWordAt(
  lower: string,
  ctx: RangeInputContext,
  words: LocalizedWords,
): { length: number; date: string } | null {
  const today = toZonedTime(ctx.nowMs, ctx.zone);
  const startsWith = (word: string) => lower === word || lower.startsWith(`${word} `);
  for (const [word, token] of words.calendar) {
    if (token !== "calendar:day:0" && token !== "calendar:day:-1") continue;
    if (startsWith(word)) {
      return { length: word.length, date: civilDate(today, token.endsWith("-1") ? -1 : 0) };
    }
  }
  for (let weekday = 0; weekday < 7; weekday++) {
    const word = words.weekdays[weekday].find(startsWith);
    if (word) {
      const back = (today.getDay() - weekday + 7) % 7;
      return { length: word.length, date: civilDate(today, -back) };
    }
  }
  return null;
}

function civilDate(today: Date, days: number): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function wholeDay(date: string, zone: string): AbsoluteInput {
  const startUs = wallToMicros({ date, time: "00:00:00" }, zone);
  const endUs = wallToMicros({ date, time: "23:59:59" }, zone) + MICROS_PER_SECOND;
  return {
    ok: true,
    kind: "absolute",
    startUs,
    endUs,
    format: "label",
    zoneAssumed: true,
    endRoundedUp: false,
  };
}

function readAbsolute(
  s: string,
  ctx: RangeInputContext,
  words: LocalizedWords,
): AbsoluteInput | InstantInput | RangeInputFailed {
  const prepared = prepareAbsolute(s, words);
  const named = trailingZone(prepared);
  const text = named ? named.rest : prepared;
  const zone = named ? named.zone.zone : ctx.zone;
  const result = parseRangeWithReason(text, zone, ctx.nowMs);
  const read = result.ok ? result : (timeOnly(text, zone, ctx.nowMs) ?? result);
  if (!read.ok) return read;
  const zoneFields = named ? { zoneAssumed: false, namedZone: named.zone } : {};
  if (read.endUs === null) {
    const { endRoundedUp: _rounded, endUs: _end, ...single } = read;
    return { ...single, ...zoneFields, kind: "instant" };
  }
  return { ...read, ...zoneFields, kind: "absolute", endUs: read.endUs };
}

// A time or a pair of times with no date reads on today in the zone.
function timeOnly(s: string, zone: string, nowMs: number): PasteParsed | null {
  const today = civilDate(toZonedTime(nowMs, zone), 0);
  return parseLabelRange(s, zone, nowMs, today);
}

// Localized month names become English ones, `2 PM` gains its minutes, and an ISO interval's `/` becomes ` - `.
function prepareAbsolute(s: string, words: LocalizedWords): string {
  let text = s;
  for (const [local, english] of words.months) {
    if (local === english) continue;
    text = text.replace(
      new RegExp(`(^|[\\s,.])${escapeRe(local)}(?=$|[\\s,.])`, "giu"),
      `$1${english}`,
    );
  }
  text = text.replace(/(\d{1,2})\.(?=\s+[A-Za-z])/g, "$1");
  text = text.replace(HOUR_PERIOD_RE, (_all, lead, hour, period) => `${lead}${hour}:00 ${period}m`);
  const interval = text.match(ISO_INTERVAL_RE);
  return interval ? `${interval[1]} - ${interval[2]}` : text;
}

// A trailing IANA name or zone abbreviation, which then reads the rest of the text.
function trailingZone(s: string): { rest: string; zone: NamedZone } | null {
  const match = s.match(TRAILING_WORD_RE);
  if (!match) return null;
  const [, rest, word] = match;
  const abbr = word.toUpperCase();
  const fromAbbr = ZONE_ABBREVIATIONS[abbr];
  if (fromAbbr) return { rest, zone: { zone: fromAbbr, abbr } };
  if (!word.includes("/") || !isKnownZone(word)) return null;
  return { rest, zone: { zone: word } };
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Digits pasted from Arabic or Persian text, bidi marks, the Arabic comma, thin spaces and the localized "to".
function normalizeInput(text: string, to: string): string {
  let s = text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200e\u200f\u061c]/g, "")
    .replace(/\u060c/g, ",")
    .replace(/[\u2009\u202f\u00a0]/g, " ");
  if (to && to.toLowerCase() !== "to") {
    s = s.replace(new RegExp(`\\s${escapeRe(to)}\\s`, "giu"), " to ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function localizedWords(ctx: RangeInputContext): LocalizedWords {
  const locale = ctx.locale ?? "en-US";
  const key = `${locale}|${ctx.t ? ctx.t("common.pastMinute", { count: 2 }) : ""}`;
  const cached = matcherCache.get(key);
  if (cached) return cached;
  const words = buildLocalizedWords(locale, ctx.t);
  matcherCache.set(key, words);
  return words;
}

function buildLocalizedWords(locale: string, t: RangeInputContext["t"]): LocalizedWords {
  const word = (key: I18nKey) => (t ? t(key).trim().toLowerCase() : "");
  const relative: LocalizedWords["relative"] = [];
  if (t) {
    for (const unit of Object.keys(PAST_KEYS) as RelativeUnit[]) {
      const forms = new Set(
        PLURAL_PROBES.map((count) => {
          const label = t(PAST_KEYS[unit], { count }).trim();
          return escapeRe(label).replace(String(count), "(\\d+)");
        }),
      );
      for (const form of forms) {
        if (form.includes("(\\d+)")) relative.push({ re: new RegExp(`^${form}$`, "iu"), unit });
      }
    }
  }
  const calendar: [string, string][] = [...CALENDAR_WORDS];
  if (t) {
    for (const [token, key] of Object.entries(CALENDAR_KEYS)) calendar.push([word(key), token]);
  }
  return {
    relative,
    prefixes: [
      ...RELATIVE_PREFIXES,
      word("common.rangeParseLast"),
      word("common.rangeParsePast"),
    ].filter(Boolean),
    calendar: calendar.filter(([text]) => text),
    weekdays: weekdayNames(locale),
    months: monthNames(locale),
    to: t ? t("common.rangeParseTo").trim() : "to",
  };
}

// English and localized weekday names, long and short, indexed Sunday first.
function weekdayNames(locale: string): string[][] {
  const names = ENGLISH_WEEKDAYS.map((day) => [day, day.slice(0, 3)]);
  for (const style of ["long", "short"] as const) {
    const format = intlFormat(locale, { weekday: style, timeZone: "UTC" });
    for (let day = 0; day < 7; day++) {
      // 2023-01-01 was a Sunday.
      const text = format?.format(new Date(Date.UTC(2023, 0, 1 + day))).toLowerCase();
      if (text && !names[day].includes(text)) names[day].push(text.replace(/\.$/, ""));
    }
  }
  return names.map((list) => [...list].sort((a, b) => b.length - a.length));
}

// Localized month names, long then short, mapped to the English abbreviations the label grammar reads.
function monthNames(locale: string): [string, string][] {
  const english = Object.keys(MONTH_INDEX);
  const pairs: [string, string][] = [];
  for (const style of ["long", "short"] as const) {
    const format = intlFormat(locale, { month: style, timeZone: "UTC" });
    if (!format) continue;
    english.forEach((abbr, index) => {
      const part = format
        .formatToParts(new Date(Date.UTC(2023, index, 15)))
        .find((piece) => piece.type === "month")
        ?.value.replace(/\.$/, "");
      if (part && /\p{L}/u.test(part)) pairs.push([part, abbr]);
    });
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

function intlFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      calendar: "gregory",
      numberingSystem: "latn",
    });
  } catch {
    return null;
  }
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rewrites the first unknown word that is within two edits of a known keyword, if the result then reads.
function suggestFor(s: string, ctx: RangeInputContext, words: LocalizedWords): string | undefined {
  const known = suggestionWords(ctx, words);
  const tokens = s.split(" ");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.length < 3 || !/^\p{L}+$/u.test(token) || known.includes(token.toLowerCase())) {
      continue;
    }
    const near = nearestWord(token.toLowerCase(), known);
    if (!near) continue;
    const candidate = [...tokens.slice(0, index), near, ...tokens.slice(index + 1)].join(" ");
    if (readInput(candidate, ctx, words).ok) return candidate;
  }
  return undefined;
}

function suggestionWords(ctx: RangeInputContext, words: LocalizedWords): string[] {
  const list = [...Object.keys(RELATIVE_UNIT_WORDS), ...words.prefixes, "now"];
  list.push(...words.months.map(([local]) => local.toLowerCase()), ...Object.keys(MONTH_INDEX));
  if (ctx.calendarPresets) {
    list.push(...words.calendar.flatMap(([text]) => text.split(" ")), ...words.weekdays.flat());
  }
  return [...new Set(list)];
}

function nearestWord(token: string, known: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = SUGGESTION_DISTANCE + 1;
  for (const word of known) {
    if (Math.abs(word.length - token.length) > SUGGESTION_DISTANCE) continue;
    const distance = editDistance(token, word);
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function isTimeOnly(side: LabelSide): boolean {
  return side.month === undefined && side.day === undefined && side.hour !== undefined;
}

// Bare times sit on one day; an end earlier than its start runs past midnight into the next day.
function timesOnDate(
  start: LabelSide,
  end: LabelSide,
  single: boolean,
  date: string,
  zone: string,
): PasteParsed | null {
  if (start.period === undefined) start.period = end.period;
  if (end.period === undefined) end.period = start.period;
  if (start.offset === undefined) start.offset = end.offset;
  if (end.offset === undefined) end.offset = start.offset;
  const startClock = labelClock(start);
  const endClock = labelClock(end);
  if (!startClock || !endClock) return null;
  const startWall = { date, time: startClock, offset: start.offset };
  const startUs = wallToMicros(startWall, zone);
  if (single) return labelResult(startUs, null, startWall);
  let endUs = wallToMicros({ date, time: endClock, offset: end.offset }, zone);
  if (endUs <= startUs) {
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
    endUs = wallToMicros({ date: next, time: endClock, offset: end.offset }, zone);
  }
  return labelResult(startUs, endUs, startWall);
}
