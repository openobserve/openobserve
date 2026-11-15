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

import { isOwnedStream } from "@/composables/sampleData/useSampleDataPresence";
import {
  PLATFORM_STREAM_NAMES,
  USER_DATA_STREAM_TYPES,
  USER_SOURCED_STREAM_NAMES,
  type UserDataStreamType,
} from "@/utils/internalStreams";

/** fresh: data in the range; quiet: data stopped before it; empty: streams with no record yet; none: no stream. */
export type FreshnessTone = "fresh" | "quiet" | "empty" | "none";

export interface FreshnessRow {
  type: UserDataStreamType;
  tone: FreshnessTone;
  /** Newest record across the type's streams, in microseconds; null when none has one. */
  lastSeenUs: number | null;
  /** The stream that holds that record, so a link opens on it. */
  stream: string | null;
}

export interface FreshnessStream {
  name?: string;
  stream_type?: string;
  is_internal?: boolean;
  stats?: { doc_time_max?: number };
}

const USER_SOURCED: ReadonlySet<string> = new Set(USER_SOURCED_STREAM_NAMES);

const isOrgData = (s: FreshnessStream, type: string) => {
  const name = s.name ?? "";
  if (PLATFORM_STREAM_NAMES.has(name) || (name.startsWith("_") && !USER_SOURCED.has(name)))
    return false;
  return isOwnedStream(s, type);
};

const toneOf = (lastSeenUs: number | null, rangeStartUs: number): FreshnessTone => {
  if (lastSeenUs === null) return "empty";
  return lastSeenUs >= rangeStartUs ? "fresh" : "quiet";
};

/** One row per signal type, in the shared type order; profiles only when the org has a profiles stream. */
export function freshnessRows(
  lists: readonly (readonly FreshnessStream[] | undefined)[],
  rangeStartUs: number,
  failed: readonly boolean[] = [],
): FreshnessRow[] {
  return USER_DATA_STREAM_TYPES.flatMap((type, i): FreshnessRow[] => {
    // a type whose list did not load is left out, never shown as "not set up"
    if (failed[i]) return [];
    const owned = (lists[i] ?? []).filter((s) => isOrgData(s, type));
    if (owned.length === 0) {
      return type === "profiles" ? [] : [{ type, tone: "none", lastSeenUs: null, stream: null }];
    }
    const newest = owned.reduce((best, s) =>
      Number(s.stats?.doc_time_max ?? 0) > Number(best.stats?.doc_time_max ?? 0) ? s : best,
    );
    const at = Number(newest.stats?.doc_time_max ?? 0);
    const lastSeenUs = at > 0 ? at : null;
    return [
      {
        type,
        tone: toneOf(lastSeenUs, rangeStartUs),
        lastSeenUs,
        stream: lastSeenUs === null ? (owned[0].name ?? null) : (newest.name ?? null),
      },
    ];
  });
}

/** The org has streams of its own, yet none of them received a record in the range. */
export function noDataInRange(rows: readonly FreshnessRow[]): boolean {
  return rows.some((r) => r.tone !== "none") && rows.every((r) => r.tone !== "fresh");
}
