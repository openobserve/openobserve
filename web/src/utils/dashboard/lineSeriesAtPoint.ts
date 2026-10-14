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
  /** One entry per data index; null where the series draws nothing. */
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
  for (const { seriesIndex, points } of series) {
    const hit = nearestOnSeries(cursor, points);
    if (hit && hit.distance <= tolerance && (!best || hit.distance < best.distance)) {
      best = { seriesIndex, ...hit };
    }
  }
  return best && { seriesIndex: best.seriesIndex, dataIndex: best.dataIndex };
};
