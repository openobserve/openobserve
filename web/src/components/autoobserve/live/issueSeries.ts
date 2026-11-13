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

import { bucketMs, quoteIdent, type BucketHit } from "./serviceChartSql";

export interface IssueStream {
  type: string;
  name: string;
}

export interface IssueWindow {
  startMs: number;
  endMs: number;
  detectedMs: number;
  /** True once the window ends before the newest bucket, so its counts never change again. */
  fixed: boolean;
}

export interface IssueSeries {
  points: number[];
  startMs: number;
  stepMs: number;
  detectedIndex: number;
  peak: number;
  /** First bucket holding rows; null when the window holds none. */
  firstRowIndex: number | null;
  /** Mean rows per bucket from the first stored row to detection; null when none was stored before it. */
  usual: number | null;
  /** Mean rows per bucket from detection on. */
  since: number;
  /** The window's last bucket is the newest one, so a live mark belongs there. */
  endsNow: boolean;
}

// 15 minutes is the engine's own bucket, so the chart shows what it compared.
export const ISSUE_STEP_MS = 15 * 60_000;
export const ISSUE_LEAD_MS = 6 * 3_600_000;
export const ISSUE_TAIL_MS = 3_600_000;
// The volume series route answers at most seven days, so one request covers any incident's chart.
export const ISSUE_MAX_SPAN_MS = 7 * 86_400_000;

const floorTo = (ms: number) => Math.floor(ms / ISSUE_STEP_MS) * ISSUE_STEP_MS;
const ceilTo = (ms: number) => Math.ceil(ms / ISSUE_STEP_MS) * ISSUE_STEP_MS;

// Six hours before detection to an hour after the incident ended, or to now while it is open.
// A span over seven days keeps its end, so the recovery or now stays on the chart.
export const issueWindow = (
  firstSeenUs: number,
  nowMs: number,
  endUs: number | null = null,
  open = true,
): IssueWindow => {
  const detectedMs = Math.floor(firstSeenUs / 1000);
  const leadStart = floorTo(detectedMs - ISSUE_LEAD_MS);
  const lastFull = floorTo(nowMs);
  // A resolved incident with no recorded end is drawn up to the longest span.
  const target =
    endUs !== null
      ? ceilTo(Math.floor(endUs / 1000) + ISSUE_TAIL_MS)
      : open
        ? null
        : leadStart + ISSUE_MAX_SPAN_MS;
  // The detection bucket stays on the chart even while it is still filling.
  const endMs = Math.max(
    target === null ? lastFull : Math.min(target, lastFull),
    floorTo(detectedMs) + ISSUE_STEP_MS,
  );
  return {
    startMs: Math.max(leadStart, endMs - ISSUE_MAX_SPAN_MS),
    endMs,
    detectedMs,
    fixed: target !== null && target <= lastFull,
  };
};

export const issueSeriesSql = (stream: string) =>
  `SELECT histogram(_timestamp, '15 minute') AS t, count(*) AS n FROM ${quoteIdent(stream)} GROUP BY t ORDER BY t`;

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

// A bucket the search leaves out had no rows, so it is a measured zero, never a gap.
export const toIssueSeries = (hits: BucketHit[], w: IssueWindow): IssueSeries => {
  const count = Math.max(1, Math.round((w.endMs - w.startMs) / ISSUE_STEP_MS));
  const points = Array.from({ length: count }, () => 0);
  for (const hit of hits) {
    const ms = bucketMs(hit.t);
    const n = Number(hit.n);
    if (ms == null || !Number.isFinite(n)) continue;
    const i = Math.floor((ms - w.startMs) / ISSUE_STEP_MS);
    if (i >= 0 && i < count) points[i] += n;
  }
  const detectedIndex = Math.min(
    count - 1,
    Math.max(0, Math.floor((w.detectedMs - w.startMs) / ISSUE_STEP_MS)),
  );
  const first = points.findIndex((p) => p > 0);
  const firstRowIndex = first < 0 ? null : first;
  // Buckets before the stream's first stored row are unknown, not quiet, so they never count as usual.
  const before =
    firstRowIndex !== null && firstRowIndex < detectedIndex
      ? points.slice(firstRowIndex, detectedIndex)
      : [];
  return {
    points,
    startMs: w.startMs,
    stepMs: ISSUE_STEP_MS,
    detectedIndex,
    peak: Math.max(...points),
    firstRowIndex,
    usual: before.length ? mean(before) : null,
    since: mean(points.slice(detectedIndex)),
    endsNow: !w.fixed,
  };
};

export const hasRows = (s: IssueSeries) => s.points.some((p) => p > 0);
