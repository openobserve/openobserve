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

const ABSOLUTE_RANGE_RE =
  /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?\s*-\s*(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_RANGE_RE = /^(\d{10,16})\s*-\s*(\d{10,16})$/;
const ABSOLUTE_SINGLE_RE = /^(\d{4}\/\d{2}\/\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?$/;
const TIMESTAMP_SINGLE_RE = /^(\d{10,16})$/;
const ISO_SINGLE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/;
// The app's own log/trace timestamp display format (src/utils/date.ts formatTimestamp).
const HUMAN_LOG_SINGLE_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:\s+(Z|[+-]\d{2}:?\d{2}))?$/i;
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

export function parseDateRangeString(raw: string): ParsedDateRange | null {
  const s = raw.trim();

  const json = parseJsonRange(s);
  if (json) return json;

  const iso = parseRangeVia(s, parseIsoSingle);
  if (iso) return iso;

  const humanLog = parseRangeVia(s, parseHumanLogSingle);
  if (humanLog) return humanLog;

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
    // Explicit offset already IS the instant — ignores the picker's timezone.
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
