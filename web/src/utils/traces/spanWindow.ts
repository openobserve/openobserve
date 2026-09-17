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

type SpanTimes = { start_time?: unknown; end_time?: unknown };

// Number("") is 0, so a blank string must not be read as a valid timestamp.
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** The trace window of a span list: earliest start to latest end, ns in, integer µs out. */
export function spanWindowUs(
  spans: ReadonlyArray<SpanTimes | null | undefined> | null | undefined,
): { start: number; end: number } | null {
  if (!spans) return null;
  let startNs = Infinity;
  let endNs = -Infinity;
  for (const span of spans) {
    const start = toFiniteNumber(span?.start_time);
    const end = toFiniteNumber(span?.end_time);
    if (start === null || end === null) continue;
    if (start < startNs) startNs = start;
    if (end > endNs) endNs = end;
  }
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs)) return null;
  return { start: Math.floor(startNs / 1000), end: Math.ceil(endNs / 1000) };
}
