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

export interface ManifestEntry {
  start: number;
  end: number;
  has_full_snapshot?: boolean | string;
  records_count?: number;
  view_id?: string | null;
  index_in_view?: number | null;
}

export interface SegmentWindow {
  anchorIndex: number;
  targetIndex: number;
  from: number;
  to: number;
  movedForViews: boolean;
}

export interface ManifestSummary {
  segmentCount: number;
  recordCount: number;
  truncated: boolean;
}

// has_full_snapshot arrives as a boolean from the schema but as a string from older ingest paths.
export function hasFullSnapshot(entry: ManifestEntry): boolean {
  return entry.has_full_snapshot === true || entry.has_full_snapshot === "true";
}

/** Identity of one stored segment; rows from a schema without the view columns fall back to span and record count. */
export function segmentId(entry: ManifestEntry): string {
  const base = `${entry.start}|${entry.end}|${Number(entry.records_count) || 0}`;
  if (entry.view_id === undefined) return base;
  return `${entry.view_id ?? ""}|${Number(entry.index_in_view) || 0}|${base}`;
}

// A retried upload or a tie at a page edge returns the same segment twice, and decoding it twice corrupts the converter.
export function dedupManifest(rows: ManifestEntry[]): ManifestEntry[] {
  const seen = new Set<string>();
  const out: ManifestEntry[] = [];
  for (const row of rows) {
    const id = segmentId(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** The manifest query's sort (start, end, index_in_view, view_id) as a comparator. */
export function compareManifestOrder(a: ManifestEntry, b: ManifestEntry): number {
  const byStart = Number(a.start) - Number(b.start);
  if (byStart) return byStart;
  const byEnd = Number(a.end) - Number(b.end);
  if (byEnd) return byEnd;
  const byIndex = (Number(a.index_in_view) || 0) - (Number(b.index_in_view) || 0);
  if (byIndex) return byIndex;
  const viewA = a.view_id ?? "";
  const viewB = b.view_id ?? "";
  return viewA < viewB ? -1 : viewA > viewB ? 1 : 0;
}

// Rows before the first full snapshot are orphan mutations that decode against an empty id space, so playback starts at replayStart.
export function trimBeforeReplayStart(
  rows: ManifestEntry[],
  replayStart: number | null | undefined,
): ManifestEntry[] {
  const floor = Number(replayStart);
  if (!(floor > 0)) return rows;
  return rows.filter((row) => Number(row.start) >= floor);
}

/** Index of the segment holding `target`, or the last one starting at or before it. */
export function findTargetIndex(manifest: ManifestEntry[], target: number): number {
  let index = -1;
  for (let i = 0; i < manifest.length; i++) {
    if (manifest[i].start <= target) index = i;
    else break;
  }
  return index;
}

// A replay can only start cold at a full snapshot, so a target with none before it falls back to the first segment.
export function selectInitialWindow(
  manifest: ManifestEntry[],
  target: number,
): SegmentWindow | null {
  if (!manifest.length) return null;

  const targetIndex = Math.max(findTargetIndex(manifest, target), 0);

  let anchorIndex = -1;
  for (let i = targetIndex; i >= 0; i--) {
    if (hasFullSnapshot(manifest[i])) {
      anchorIndex = i;
      break;
    }
  }
  if (anchorIndex === -1) anchorIndex = 0;

  const viewAnchor = earliestAliveViewSnapshot(manifest, target, targetIndex);
  const chosen = viewAnchor !== null && viewAnchor < anchorIndex ? viewAnchor : anchorIndex;

  return {
    anchorIndex: chosen,
    targetIndex,
    from: manifest[chosen].start,
    to: manifest[targetIndex].start,
    movedForViews: chosen !== anchorIndex,
  };
}

// A view open at the target can become the shown tab, and it decodes only from its own full snapshot.
function earliestAliveViewSnapshot(
  manifest: ManifestEntry[],
  target: number,
  targetIndex: number,
): number | null {
  const lastEnd = new Map<string, number>();
  const firstSnapshot = new Map<string, number>();
  manifest.forEach((row, i) => {
    if (typeof row.view_id !== "string") return;
    lastEnd.set(row.view_id, Math.max(lastEnd.get(row.view_id) ?? -Infinity, Number(row.end)));
    if (i <= targetIndex && hasFullSnapshot(row) && !firstSnapshot.has(row.view_id)) {
      firstSnapshot.set(row.view_id, i);
    }
  });
  let earliest: number | null = null;
  firstSnapshot.forEach((index, viewId) => {
    if ((lastEnd.get(viewId) ?? -Infinity) < target) return;
    if (earliest === null || index < earliest) earliest = index;
  });
  return earliest;
}

/** Every row after the run starts at or after this, so the replay decoder never sees an earlier record later. */
export function replayWatermark(
  rows: ManifestEntry[],
  appendedThroughIndex: number,
  live: boolean,
): number {
  const next = appendedThroughIndex + 1;
  if (next < rows.length) return Number(rows[next].start);
  if (live && rows.length) return Number(rows[rows.length - 1].start);
  return Number.POSITIVE_INFINITY;
}

/** Starts of the segments that can anchor a cold player, used by the seek planner. */
export function snapshotStarts(manifest: ManifestEntry[]): number[] {
  return manifest.filter(hasFullSnapshot).map((entry) => entry.start);
}

/** What was actually listed, so a manifest cut short by the page cap can be reported. */
export function summarizeManifest(manifest: ManifestEntry[], complete: boolean): ManifestSummary {
  return {
    segmentCount: manifest.length,
    recordCount: manifest.reduce((total, entry) => total + (Number(entry.records_count) || 0), 0),
    truncated: !complete,
  };
}
