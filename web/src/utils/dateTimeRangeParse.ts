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

// Parses pasted date-range / single date-time text into a shape the DateTime
// picker can apply. `parseDateRangeString` handles a full range (replacing
// both the start and end); `parseSingleDateTime` handles a single value
// (replacing just the side the caller targets, e.g. via cursor position).
//
// Accepted range inputs: the `{"start_date","end_date"}` JSON object Copy
// emits (epoch microseconds, timezone-independent), ISO 8601, the app's own
// "MMM DD, YYYY HH:mm:ss.SSS Z" display format (JsonPreview, DetailTable,
// TraceDetailsSidebar, etc. all render this — a user copying a timestamp out
// of the app's own log/trace views produces exactly this string), the plain
// absolute range, and a raw epoch timestamp pair. Accepted single-value
// inputs: the single-value form of any of the above.
//
// Timezone handling: this module has no store/timezone dependency by design.
// Anything that already resolves to an unambiguous instant — the copy-emitted
// JSON, a raw epoch timestamp, or ISO 8601 WITH an explicit offset/`Z` —
// is returned as `"timestamp"` (epoch µs), untouched by whatever timezone the
// picker has selected. Anything with no timezone information of its own — the
// app's own `YYYY/MM/DD HH:MM:SS` format, or offset-less ISO — is returned as
// `"absolute"` (date/time strings); the caller (DateTime.vue) resolves those
// using the picker's *currently selected* timezone, same as manual entry.

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

const ABSOLUTE_RANGE_RE =
  /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?\s*-\s*(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_RANGE_RE = /^(\d{10,16})\s*-\s*(\d{10,16})$/;
const ABSOLUTE_SINGLE_RE = /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_SINGLE_RE = /^(\d{10,16})$/;
// ISO 8601: YYYY-MM-DD, optionally with a T- or space-separated time
// (seconds optional), optionally with a `Z` or ±HH:MM/±HHMM offset.
const ISO_SINGLE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/;
// The app's own "MMM DD, YYYY HH:mm:ss.SSS Z" display format (see
// src/utils/date.ts's formatTimestamp / the HUMAN_TZ_FORMAT constants used
// across the log/trace views): month name, day, year, time, optional
// milliseconds, optional `Z`/±offset.
const HUMAN_LOG_SINGLE_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s+(Z|[+-]\d{2}:?\d{2}))?$/i;
const MONTH_INDEX: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDateRangeString(raw: string): ParsedDateRange | null {
  const s = raw.trim();

  const json = parseJsonRange(s);
  if (json) return json;

  const iso = parseRangeVia(s, parseIsoSingle);
  if (iso) return iso;

  const humanLog = parseRangeVia(s, parseHumanLogSingle);
  if (humanLog) return humanLog;

  // Timestamps before the human-readable absolute regex.
  const tsMatch = s.match(TIMESTAMP_RANGE_RE);
  if (tsMatch) {
    return {
      type: "timestamp",
      startMicros: toMicros(tsMatch[1]),
      endMicros: toMicros(tsMatch[2]),
    };
  }

  const absMatch = s.match(ABSOLUTE_RANGE_RE);
  if (absMatch) {
    return {
      type: "absolute",
      startDate: absMatch[1],
      startTime: absMatch[2] ?? "00:00:00",
      endDate: absMatch[3],
      endTime: absMatch[4] ?? "23:59:59",
    };
  }

  return null;
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
    return { type: "absolute", date: absMatch[1], time: absMatch[2] };
  }

  return null;
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

  if (offset) {
    // Fully qualified instant — parse natively. Deliberately ignores the
    // picker's selected timezone: an explicit offset already IS the instant.
    const normalizedOffset =
      offset === "Z" ? "Z" : offset.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
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

// The app's own "MMM DD, YYYY HH:mm:ss.SSS Z" display format. Milliseconds
// (when present) are kept in the time string / fed straight to Date.parse —
// the picker's own display is second-granularity, so they're honored for the
// resulting instant but won't visibly round-trip in the field afterward,
// exactly like pasting a µs timestamp already behaves.
function parseHumanLogSingle(raw: string): IsoSingleParsed | null {
  const m = raw.match(HUMAN_LOG_SINGLE_RE);
  if (!m) return null;
  const [, monthAbbr, day, year, hour, minute, second, ms, offset] = m;
  const month = MONTH_INDEX[monthAbbr.toLowerCase()];
  const dd = day.padStart(2, "0");
  const secWithMs = ms ? `${second}.${ms}` : second;

  if (offset) {
    const normalizedOffset =
      offset.toUpperCase() === "Z" ? "Z" : offset.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
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

// Splits on a whitespace-padded ` - ` and parses both sides with the given
// single-value parser. Safe for formats whose date component can itself
// contain a bare `-` (ISO, the human-log format) where the naive
// TIMESTAMP/ABSOLUTE regexes' looser `\s*-\s*` would be ambiguous — neither
// format ever has whitespace around its own internal dashes.
function parseRangeVia(
  s: string,
  parseSingle: (part: string) => IsoSingleParsed | null,
): ParsedDateRange | null {
  const parts = s.split(/\s+-\s+/);
  if (parts.length !== 2) return null;

  const start = parseSingle(parts[0]);
  const end = parseSingle(parts[1]);
  // Both sides must agree on having/not having an offset — mixing would
  // silently interpret one side in a different frame of reference than the
  // other, which is exactly the ambiguity this feature exists to avoid.
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

// The object Copy puts on the clipboard: `{"start_date":<µs>,"end_date":<µs>}`.
// Epoch microseconds side-step timezone ambiguity entirely, so this is trusted
// as-is (no digit-length unit guessing, unlike the raw-timestamp paste path).
function parseJsonRange(s: string): TimestampRangeResult | null {
  if (!s.startsWith("{")) return null;
  try {
    const obj = JSON.parse(s);
    if (typeof obj?.start_date === "number" && typeof obj?.end_date === "number") {
      return { type: "timestamp", startMicros: obj.start_date, endMicros: obj.end_date };
    }
  } catch {
    // Not JSON — fall through to the other formats.
  }
  return null;
}

// Auto-detect epoch unit by digit length and normalize to microseconds.
// Mirrors the defaultAbsoluteTime handling in DateTime.vue.
function toMicros(digits: string): number {
  const n = Number(digits);
  if (digits.length <= 10) return n * 1_000_000; // seconds
  if (digits.length <= 13) return n * 1_000; // milliseconds
  return n; // microseconds
}
