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

import {
  compareManifestOrder,
  segmentId,
  type ManifestEntry,
} from "@/utils/rum/sessionReplayManifest";

export interface ManifestTailMerge {
  appended: ManifestEntry[];
  late: boolean;
}

/** A session whose last replay row is this recent is still being recorded; the Sessions list uses the same rule. */
export const ACTIVE_WINDOW_MS = 5 * 60_000;
export const LIVE_POLL_MS = 30_000;
// The SDK expires a session after 15 minutes without activity and ends every session at 4 hours.
export const LIVE_IDLE_STOP_MS = 15 * 60_000;
export const LIVE_MAX_SESSION_MS = 4 * 3_600_000;
export const LIVE_OVERLAP_US = 60_000_000;

export function isSessionLive(endTimeMs: number | null | undefined, nowMs: number): boolean {
  const end = Number(endTimeMs);
  return end > 0 && nowMs - end <= ACTIVE_WINDOW_MS;
}

// The bound only moves forward, so a poll that returns nothing never narrows the body window.
export function raiseUpperTs(current: number, rows: any[], field: string): number {
  let upper = current;
  for (const row of rows) {
    const value = Number(row?.[field]);
    if (value > upper) upper = value;
  }
  return upper;
}

// The manifest only grows at its end, because the converter cannot take a segment before one the player already holds.
export function mergeManifestTail(
  manifest: ManifestEntry[],
  rows: ManifestEntry[],
  known: { has: (id: string) => boolean },
): ManifestTailMerge {
  const appended: ManifestEntry[] = [];
  const seen = new Set<string>();
  let tail = manifest[manifest.length - 1];
  let late = false;
  for (const row of [...rows].sort(compareManifestOrder)) {
    const id = segmentId(row);
    if (known.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (tail && compareManifestOrder(row, tail) < 0) {
      late = true;
      continue;
    }
    appended.push(row);
    tail = row;
  }
  return { appended, late };
}

export function shouldStopLive(
  lastNewIdAtMs: number,
  sessionStartMs: number,
  nowMs: number,
): boolean {
  if (nowMs - lastNewIdAtMs >= LIVE_IDLE_STOP_MS) return true;
  return sessionStartMs > 0 && nowMs - sessionStartMs >= LIVE_MAX_SESSION_MS;
}

/** A RUM event's own id; view rows are re-sent under the same view_id as the view updates. */
export function eventKey(hit: any): string | null {
  const id = hit?.[`${hit?.type}_id`];
  return id === undefined || id === null || id === "" ? null : `${hit.type}|${id}`;
}

// Error log rows carry no stable id, so the arrival time, device time and message stand in for one.
export function errorLogKey(hit: any, timestampField: string): string {
  return `${hit?.[timestampField]}|${hit?.date}|${hit?.message}`;
}
