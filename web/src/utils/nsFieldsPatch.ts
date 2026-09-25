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

// Matches 19+ digit integers in start_time/end_time fields — nanosecond epoch
// values that exceed JS Number precision (safe up to ~15-16 digits).
// (?<!\\) skips escaped-quote sequences (\"start_time\") inside JSON string values.
const NS_FIELDS_RE = /(?<!\\)"(start_time|end_time)"\s*:\s*(\d{19,})/g;

// Injects string shadow fields (_start_time_ns / _end_time_ns) into raw JSON
// before JSON.parse so the exact nanosecond values are preserved as strings.
// streamWorker.js keeps an inline copy of this logic since it cannot import TS.
export function patchNsFieldsInJson(text: string): string {
  NS_FIELDS_RE.lastIndex = 0;
  return text.replace(NS_FIELDS_RE, '"$1":$2,"_$1_ns":"$2"');
}

// Matches any bare JSON integer value — any field name, any nesting depth —
// with 16+ digits, the digit count of Number.MAX_SAFE_INTEGER (9007199254740991).
// That's the minimum length where precision loss becomes possible;
// exceedsMaxSafeInteger() below narrows it down to values that actually overflow.
// (?<!\\) skips escaped-quote sequences inside JSON string values.
const UNSAFE_INT_RE = /(?<!\\)"((?:[^"\\]|\\.)*)"\s*:\s*(-?\d{16,})(?=\s*[,}\]])/g;

const MAX_SAFE_INTEGER_DIGITS = "9007199254740991"; // Number.MAX_SAFE_INTEGER

function exceedsMaxSafeInteger(digits: string): boolean {
  const unsigned = digits[0] === "-" ? digits.slice(1) : digits;
  return unsigned.length !== MAX_SAFE_INTEGER_DIGITS.length
    ? unsigned.length > MAX_SAFE_INTEGER_DIGITS.length
    : unsigned > MAX_SAFE_INTEGER_DIGITS;
}

// Quotes any integer field value outside JS's safe integer range (±(2^53-1)) so
// JSON.parse can't silently round it — e.g. a user-defined `userid` field logged
// as a bare 18-digit number (see #14376). Skips start_time/end_time: those are
// handled by patchNsFieldsInJson instead, which keeps them numeric and adds an
// exact-value shadow field, since other code still expects them to be numbers.
// streamWorker.js keeps an inline copy of this logic since it cannot import TS.
export function patchUnsafeIntegersInJson(text: string): string {
  UNSAFE_INT_RE.lastIndex = 0;
  return text.replace(UNSAFE_INT_RE, (match, key, digits) => {
    if (key === "start_time" || key === "end_time") return match;
    return exceedsMaxSafeInteger(digits) ? `"${key}":"${digits}"` : match;
  });
}

// Runs both patches: ns shadow fields first, then generic unsafe-integer
// quoting for every other field. Order matters — the ns patch only ever adds
// quoted shadow fields, so it never creates new unsafe bare integers for the
// second pass to trip over.
export function patchLargeNumbersInJson(text: string): string {
  return patchUnsafeIntegersInJson(patchNsFieldsInJson(text));
}
