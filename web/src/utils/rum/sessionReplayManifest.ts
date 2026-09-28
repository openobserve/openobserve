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

  return {
    anchorIndex,
    targetIndex,
    from: manifest[anchorIndex].start,
    to: manifest[targetIndex].start,
  };
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
