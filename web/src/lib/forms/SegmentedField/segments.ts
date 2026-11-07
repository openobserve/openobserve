// Copyright 2026 OpenObserve Inc.

import type {
  SegmentKind,
  SegmentedFieldPattern,
  SegmentedFieldStatus,
} from "./OSegmentedField.types";

export type SegmentValues = (number | null)[];

export interface SegmentDef {
  kind: SegmentKind;
  min: number;
  max: number;
  digits: number;
  placeholder: string;
  /** Text placed before this segment. */
  before: string;
}

/** The rendered text and each segment's [start, end) range inside it. */
export interface SegmentLayout {
  text: string;
  ranges: [number, number][];
}

const DATE_DEFS: SegmentDef[] = [
  { kind: "year", min: 1, max: 9999, digits: 4, placeholder: "YYYY", before: "" },
  { kind: "month", min: 1, max: 12, digits: 2, placeholder: "MM", before: "-" },
  { kind: "day", min: 1, max: 31, digits: 2, placeholder: "DD", before: "-" },
];

const CLOCK_TAIL: SegmentDef[] = [
  { kind: "minute", min: 0, max: 59, digits: 2, placeholder: "mm", before: ":" },
  { kind: "second", min: 0, max: 59, digits: 2, placeholder: "ss", before: ":" },
];

const TIME_DEFS: SegmentDef[] = [
  { kind: "hour", min: 0, max: 23, digits: 2, placeholder: "HH", before: "" },
  ...CLOCK_TAIL,
];

const TIME12_DEFS: SegmentDef[] = [
  { kind: "hour", min: 1, max: 12, digits: 2, placeholder: "hh", before: "" },
  ...CLOCK_TAIL,
  { kind: "period", min: 0, max: 1, digits: 0, placeholder: "--", before: " " },
];

const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?$/i;

/** The segments of a pattern, plus an offset segment when there are offsets to choose from. */
export const segmentDefs = (pattern: SegmentedFieldPattern, offsetCount: number): SegmentDef[] => {
  const base = pattern === "date" ? DATE_DEFS : pattern === "time" ? TIME_DEFS : TIME12_DEFS;
  if (pattern === "date" || offsetCount < 2) return base;
  return [
    ...base,
    { kind: "offset", min: 0, max: offsetCount - 1, digits: 0, placeholder: "", before: " " },
  ];
};

export const daysIn = (year: number | null, month: number | null): number => {
  if (month === null) return 31;
  if (month === 2) {
    if (year === null) return 29;
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/** The highest value a segment takes now; a day's depends on the month and year already typed. */
export const segmentMax = (defs: SegmentDef[], values: SegmentValues, index: number): number => {
  const def = defs[index];
  if (def.kind !== "day") return def.max;
  return daysIn(values[0] ?? null, values[1] ?? null);
};

export const layoutSegments = (
  defs: SegmentDef[],
  values: SegmentValues,
  dayPeriods: [string, string],
  offsets: string[],
): SegmentLayout => {
  let text = "";
  const ranges: [number, number][] = [];
  defs.forEach((def, index) => {
    text += def.before;
    const start = text.length;
    text += segmentText(def, values[index] ?? null, dayPeriods, offsets);
    ranges.push([start, text.length]);
  });
  return { text, ranges };
};

export const segmentText = (
  def: SegmentDef,
  value: number | null,
  dayPeriods: [string, string],
  offsets: string[],
): string => {
  if (def.kind === "period") return value === null ? def.placeholder : dayPeriods[value];
  if (def.kind === "offset") return offsets[value ?? 0] ?? "";
  if (value === null) return def.placeholder;
  return String(value).padStart(def.digits, "0");
};

/** Segment values from a canonical value; all empty when it does not parse. */
export const parseCanonical = (pattern: SegmentedFieldPattern, value: string): SegmentValues => {
  const parsed = parseWholeValue(pattern, value);
  return parsed ?? emptyValues(pattern);
};

export const emptyValues = (pattern: SegmentedFieldPattern): SegmentValues =>
  segmentDefs(pattern, 0).map(() => null);

/** Reads a whole typed or filled value: `YYYY-MM-DD`, or `HH:mm[:ss]` / `h:mm[:ss] AM` in either time pattern. */
export const parseWholeValue = (
  pattern: SegmentedFieldPattern,
  text: string,
): SegmentValues | null => {
  const value = text.trim();
  if (pattern === "date") {
    const match = value.match(DATE_RE);
    if (!match) return null;
    const [year, month, day] = match.slice(1, 4).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return [year, month, day];
  }
  const match = value.match(TIME_RE);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (minute > 59 || second > 59) return null;
  if (match[4]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[4].toLowerCase() === "p" ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  return pattern === "time"
    ? [hour, minute, second]
    : [hour % 12 || 12, minute, second, hour >= 12 ? 1 : 0];
};

/** Carries the clock across a 24h / 12h switch, partial values included. */
export const convertValues = (
  from: SegmentedFieldPattern,
  to: SegmentedFieldPattern,
  values: SegmentValues,
): SegmentValues => {
  if (from === to || from === "date" || to === "date")
    return values.slice(0, segmentDefs(to, 0).length);
  const [hour, minute, second] = values;
  if (to === "time12") {
    if (hour === null) return [null, minute, second, null];
    return [hour % 12 || 12, minute, second, hour >= 12 ? 1 : 0];
  }
  if (hour === null) return [null, minute, second];
  return [(hour % 12) + (values[3] === 1 ? 12 : 0), minute, second];
};

export const statusOf = (
  pattern: SegmentedFieldPattern,
  values: SegmentValues,
  min?: string,
  max?: string,
): SegmentedFieldStatus => {
  const own = values.slice(0, segmentDefs(pattern, 0).length);
  if (own.every((value) => value === null)) return "empty";
  if (own.some((value) => value === null)) return "incomplete";
  if (pattern !== "date") return "valid";
  const [year, month, day] = own as number[];
  if (day > daysIn(year, month)) return "invalid";
  const canonical = toCanonical(pattern, own) ?? "";
  if ((min && canonical < min) || (max && canonical > max)) return "out-of-range";
  return "valid";
};

/** `YYYY-MM-DD` or 24h `HH:mm:ss`, or null while a segment is empty. */
export const toCanonical = (
  pattern: SegmentedFieldPattern,
  values: SegmentValues,
): string | null => {
  const own = values.slice(0, segmentDefs(pattern, 0).length);
  if (own.some((value) => value === null)) return null;
  const pad = (value: number, digits = 2) => String(value).padStart(digits, "0");
  const [a, b, c, period] = own as number[];
  if (pattern === "date") return `${pad(a, 4)}-${pad(b)}-${pad(c)}`;
  const hour = pattern === "time12" ? (a % 12) + (period === 1 ? 12 : 0) : a;
  return `${pad(hour)}:${pad(b)}:${pad(c)}`;
};
