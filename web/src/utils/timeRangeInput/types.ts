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

export type RelativeUnit = "s" | "m" | "h" | "d" | "w" | "M";

export type TimeRangeLocale =
  | "en-us"
  | "ar"
  | "zh-cn"
  | "tr-turk"
  | "de"
  | "es"
  | "fr"
  | "it"
  | "ja"
  | "ko"
  | "nl"
  | "pt"
  | "zh-tw"
  | "ru"
  | "pl"
  | "vi"
  | "th";

export interface RangeLimits {
  allowFuture: boolean;
  maxEndUs?: number;
  minStartUs?: number;
  maxSpanUs?: number;
  retentionStartUs?: number;
  skewUs?: number;
}

/** A compiled, immutable locale pack; only this module can create one. */
export interface TimeRangePack {
  readonly locale: TimeRangeLocale;
  readonly __brand: "TimeRangePack";
}

export type InputSource = "typed" | "paste";

export type InputForm =
  "copy-payload" | "url" | "range" | "epoch" | "iso" | "shorthand" | "date-math" | "phrase";

export interface ParseContext {
  text: string;
  nowUs: number;
  zone: string;
  pack: TimeRangePack;
  source?: InputSource;
  units: RelativeUnit[];
  kinds: { relative: boolean; calendar: boolean; absolute: boolean };
  limits: RangeLimits;
}

export type ZoneNote =
  | { kind: "dst-gap"; typedLocal: string; readAsLocal: string }
  | { kind: "converted"; fromOffset: string }
  | { kind: "instant-window"; instantUs: number; halfWidthUs: number }
  | { kind: "partial-retention"; keptFromUs: number }
  | { kind: "elapsed-chain"; totalUs: number };

export type BlockReason = "future" | "after-max" | "before-min" | "retention" | "max-span";

/** `reversed`: both ends read but the end is before the start; they are never swapped. */
export type InvalidReason = "unreadable" | "too-long" | "out-of-range" | "zero-length" | "reversed";

export interface TimeRangeReading {
  kind: "rolling" | "calendar" | "absolute";
  startUs: number;
  endUs: number;
  startOffset: string;
  endOffset: string;
  rolling?: { value: number; unit: RelativeUnit };
  calendarToken?: string;
  fixedToNow?: boolean;
  name?: string;
  notes: ZoneNote[];
  blocked?: BlockReason;
  origin: { source: InputSource; form: InputForm };
}

export type AmbiguityReason =
  | "day-month-order"
  | "unit-case"
  | "repeated-hour"
  | "am-pm"
  | "zone-abbreviation"
  | "bare-duration";

export type TimeRangeParseResult =
  | { state: "empty" }
  | { state: "incomplete"; completions: TimeRangeReading[] }
  | {
      state: "invalid";
      reason: InvalidReason;
      examples: string[];
      at?: [number, number];
    }
  | { state: "ambiguous"; reason: AmbiguityReason; readings: TimeRangeReading[] }
  | { state: "valid"; reading: TimeRangeReading }
  | {
      state: "blocked";
      reason: BlockReason;
      reading: TimeRangeReading;
      others?: TimeRangeReading[];
      fix?: TimeRangeReading;
    };

// Internal shapes shared by the layers; index.ts does not export them.

export type UnitKey = RelativeUnit | "y";

/** A calendar period a span word names: week, month, quarter or year. */
export type SpanUnit = "w" | "M" | "q" | "y";

/** An hour window a day part or meridiem allows, with a day shift ("last night" is -1). */
export interface ClockMod {
  from: number;
  to: number;
  shift: number;
  /** A meridiem's lowest hour (0 in h11 locales); it takes no hour above 12, unlike a day part. */
  ap?: number;
}

export interface ClockValue {
  h: number;
  mi: number;
  s: number;
  us: number;
  word: boolean;
  bare?: boolean;
  padded?: boolean;
  /** An hour typed without minutes or a colon (`5`, `5点`, `4시`); only these may take a day part. */
  hourOnly?: boolean;
  /** The clock has seconds, so a short `-hh` after it is an offset like after an ISO `T`. */
  sec?: boolean;
  article?: boolean;
  mod?: ClockMod;
  zone?: string;
  offsetSec?: number;
  /** An attached `-hh:mm` only a phrase clock admits; it holds only opposite a zoned range side. */
  dash?: boolean;
}

export type Point =
  | { p: "instant"; us: number; notes: ZoneNote[]; clock?: ClockValue }
  | { p: "wall"; y: number; mo: number; d: number; clock: ClockValue; shared?: boolean }
  | { p: "day"; y: number; mo: number; d: number; days?: number; rel?: boolean }
  | { p: "clock"; clock: ClockValue }
  | { p: "now" }
  | { p: "span"; drafts: Draft[] };

export interface Alt<T> {
  v: T;
  why?: AmbiguityReason;
  tag?: string;
}

export interface Draft {
  startUs: number;
  endUs: number;
  softEnd: boolean;
  kind: "rolling" | "calendar" | "absolute";
  rolling?: { value: number; unit: RelativeUnit };
  calendarToken?: string;
  fixedToNow?: boolean;
  name?: string;
  notes: ZoneNote[];
  why?: AmbiguityReason;
  sinceClock?: { clock: ClockValue; y: number; mo: number; d: number; zone: string };
}

export type Outcome =
  | { t: "none" }
  | { t: "incomplete"; drafts: Draft[] }
  | { t: "invalid"; reason: Exclude<InvalidReason, "too-long"> }
  | { t: "drafts"; drafts: Draft[]; form: InputForm; why?: AmbiguityReason };
