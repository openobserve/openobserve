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

export interface TimeRange {
  start: number;
  end: number;
}

export type SeekPlan =
  | { status: "ready" }
  | { status: "needs-fetch"; from: number; to: number }
  | { status: "unplayable" };

// Merge overlapping or touching ranges so coverage can be tested with a single forward scan.
function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end >= r.start)
    .sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

function isCovered(from: number, to: number, merged: TimeRange[]): boolean {
  return merged.some((r) => r.start <= from && r.end >= to);
}

// A replay can only start at a full snapshot, so the answer depends on the nearest snapshot at or before the target.
export function planSeek(
  target: number,
  loadedRanges: TimeRange[],
  snapshotStarts: number[],
): SeekPlan {
  const anchor = snapshotStarts
    .filter((start) => start <= target)
    .reduce((best, start) => (best === null || start > best ? start : best), null as number | null);

  if (anchor === null) return { status: "unplayable" };

  const merged = mergeRanges(loadedRanges);
  if (isCovered(anchor, target, merged)) return { status: "ready" };

  return { status: "needs-fetch", from: anchor, to: target };
}
