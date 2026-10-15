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

export type PixelPoint = [number, number];

export interface LineSeriesPixels {
  seriesIndex: number;
  /** Data index of `points[0]`. */
  offset?: number;
  /** One entry per data index from `offset`; null where the series draws nothing. */
  points: (PixelPoint | null)[];
}

export interface LineSeriesHit {
  seriesIndex: number;
  dataIndex: number;
}

/** Screen pixels a click may miss a drawn line by and still count as on it. */
export const LINE_HIT_TOLERANCE = 6;

const distanceToSegment = (p: PixelPoint, a: PixelPoint, b: PixelPoint): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** The placed index nearest `mid` within [low, high], skipping gaps; null when all are gaps. */
const placedNear = (
  mid: number,
  low: number,
  high: number,
  xAt: (index: number) => number | null,
): { index: number; x: number } | null => {
  for (let step = 0; mid - step >= low || mid + step <= high; step++) {
    for (const index of step === 0 ? [mid] : [mid - step, mid + step]) {
      if (index < low || index > high) continue;
      const x = xAt(index);
      if (x !== null && Number.isFinite(x)) return { index, x };
    }
  }
  return null;
};

/** Last placed index whose x is at or left of `x`, -1 when none, for points ascending in x. */
const lastIndexAtOrBefore = (
  count: number,
  x: number,
  xAt: (index: number) => number | null,
): number => {
  let low = 0;
  let high = count - 1;
  let last = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const placed = placedNear(mid, low, high, xAt);
    if (!placed) break;
    // Indexes between `mid` and the placed one are gaps, so the search may skip past both.
    if (placed.x <= x) {
      last = placed.index;
      low = Math.max(placed.index, mid) + 1;
    } else {
      high = Math.min(placed.index, mid) - 1;
    }
  }
  return last;
};

const nearAscendingX = (
  count: number,
  cursorX: number,
  xAt: (index: number) => number | null,
  tolerance: number,
): [number, number] => {
  const from = lastIndexAtOrBefore(count, cursorX - tolerance, xAt);
  const to = lastIndexAtOrBefore(count, cursorX + tolerance, xAt);
  return [Math.max(0, from), Math.min(count - 1, to + 1)];
};

/** The data indexes whose segments can pass within `tolerance` of `cursorX`; `xAt` is null for a gap. */
export const indexesNearX = (
  count: number,
  cursorX: number,
  xAt: (index: number) => number | null,
  tolerance: number = LINE_HIT_TOLERANCE,
): [number, number] | null => {
  const first = count > 0 ? placedNear(0, 0, count - 1, xAt) : null;
  const last = count > 0 ? placedNear(count - 1, 0, count - 1, xAt) : null;
  if (!first || !last) return null;
  if (first.x <= last.x) return nearAscendingX(count, cursorX, xAt, tolerance);
  // Rows sorted newest first run right to left, so search them mirrored.
  const [from, to] = nearAscendingX(count, cursorX, (index) => xAt(count - 1 - index), tolerance);
  return [count - 1 - to, count - 1 - from];
};

const gap = (a: PixelPoint, b: PixelPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

const nearestOnSeries = (
  cursor: PixelPoint,
  points: (PixelPoint | null)[],
): { distance: number; dataIndex: number } | null => {
  let best: { distance: number; dataIndex: number } | null = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) continue;
    const next = points[index + 1] ?? null;
    const distance = distanceToSegment(cursor, point, next ?? point);
    if (best && distance >= best.distance) continue;
    const nearerNext = !!next && gap(cursor, next) < gap(cursor, point);
    best = { distance, dataIndex: nearerNext ? index + 1 : index };
  }
  return best;
};

/** The line series drawn under a cursor that hit no symbol, with the data point nearest it. */
export const lineSeriesAtPoint = (
  cursor: PixelPoint,
  series: LineSeriesPixels[],
  tolerance: number = LINE_HIT_TOLERANCE,
): LineSeriesHit | null => {
  let best: (LineSeriesHit & { distance: number }) | null = null;
  for (const { seriesIndex, offset = 0, points } of series) {
    const hit = nearestOnSeries(cursor, points);
    if (hit && hit.distance <= tolerance && (!best || hit.distance < best.distance)) {
      best = { seriesIndex, distance: hit.distance, dataIndex: offset + hit.dataIndex };
    }
  }
  return best && { seriesIndex: best.seriesIndex, dataIndex: best.dataIndex };
};
