// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { StreamInfo } from "@/services/service_streams";

export type Overlap = "yes" | "no";

export interface StreamWithOverlap extends StreamInfo {
  overlap: Overlap;
  doc_time_min?: number;
  doc_time_max?: number;
}

export interface TimeRange {
  startTime: number;
  endTime: number;
}

interface StreamStats {
  doc_time_min?: number;
  doc_time_max?: number;
}

// Streams without confirmed overlap (missing stats OR no intersection) are
// demoted to the bottom — they still render and stay clickable.
export function classifyOverlap(
  stats: StreamStats | null | undefined,
  range: TimeRange,
): Overlap {
  if (!stats) return "no";
  const { doc_time_min, doc_time_max } = stats;
  if (typeof doc_time_min !== "number" || typeof doc_time_max !== "number") {
    return "no";
  }
  if (doc_time_min === 0 && doc_time_max === 0) return "no";
  // Intersection: [min, max] ∩ [start, end] is non-empty iff max >= start && min <= end
  if (doc_time_max < range.startTime) return "no";
  if (doc_time_min > range.endTime) return "no";
  return "yes";
}

// `streamsState` is `store.state.streams` — see web/src/stores/streams.ts.
// Per-type lists live at `streamsState[type].list`, with name→index in
// `streamsState.streamsIndexMapping[type]`.
function lookupStats(
  streamsState: any,
  streamType: string,
  streamName: string,
): StreamStats | null {
  const indexMapping = streamsState?.streamsIndexMapping?.[streamType];
  const list = streamsState?.[streamType]?.list;
  if (!indexMapping || !list) return null;
  const idx = indexMapping[streamName];
  if (idx == null) return null;
  return list[idx]?.stats ?? null;
}

export function enrichStreamsWithOverlap(
  streams: StreamInfo[],
  streamType: "logs" | "traces" | "metrics",
  range: TimeRange,
  streamsState: any,
): StreamWithOverlap[] {
  return streams.map((s) => {
    const stats = lookupStats(streamsState, streamType, s.stream_name);
    return {
      ...s,
      overlap: classifyOverlap(stats, range),
      doc_time_min: stats?.doc_time_min,
      doc_time_max: stats?.doc_time_max,
    };
  });
}

// Stable sort: has-data first, no-data last; preserves input order within each bucket.
export function sortStreamsByOverlap(
  streams: StreamWithOverlap[],
): StreamWithOverlap[] {
  const yes: StreamWithOverlap[] = [];
  const no: StreamWithOverlap[] = [];
  for (const s of streams) (s.overlap === "yes" ? yes : no).push(s);
  return [...yes, ...no];
}
