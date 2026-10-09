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

export interface ReplayView {
  id: string;
  start: number;
  end: number;
}

/** Views that never overlap in time, so one player run can hold them all. */
export interface ReplayTrack {
  views: ReplayView[];
  rows: ManifestEntry[];
}

// has_full_snapshot arrives as a boolean from the schema but as a string from older ingest paths.
export function hasFullSnapshot(entry: ManifestEntry): boolean {
  return entry.has_full_snapshot === true || entry.has_full_snapshot === "true";
}

/** The view a row belongs to; rows from a schema without the view columns all share one. */
export function viewKey(entry: ManifestEntry): string {
  return entry.view_id ?? "";
}

/** Identity of one stored segment; rows from a schema without the view columns fall back to span and record count. */
export function segmentId(entry: ManifestEntry): string {
  const base = `${entry.start}|${entry.end}|${Number(entry.records_count) || 0}`;
  if (entry.view_id === undefined) return base;
  return `${viewKey(entry)}|${Number(entry.index_in_view) || 0}|${base}`;
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
  const viewA = viewKey(a);
  const viewB = viewKey(b);
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

// Each browser tab numbers its nodes from 0, so views that overlap in time can never share one player run.
export function splitIntoTracks(rows: ManifestEntry[]): ReplayTrack[] {
  const tracks: ReplayTrack[] = [];
  for (const { rows: viewRows, ...view } of groupByView(rows)) {
    // Of the tracks already free, the one that ended last is the likeliest to be the same tab.
    let free: ReplayTrack | undefined;
    for (const track of tracks) {
      const end = track.views[track.views.length - 1].end;
      if (end <= view.start && (!free || end > free.views[free.views.length - 1].end)) {
        free = track;
      }
    }
    if (free) {
      free.views.push(view);
      free.rows.push(...viewRows);
    } else {
      tracks.push({ views: [view], rows: [...viewRows] });
    }
  }
  return tracks;
}

// With no tab id to go on, the tab recording at the target, else the one recording just before it, is the likeliest to hold it.
export function pickTrack(tracks: ReplayTrack[], target: number | null): ReplayTrack | undefined {
  // A track with no full snapshot cannot start playing, so it is picked only when no track has one.
  const playable = tracks.filter((track) => track.rows.some(hasFullSnapshot));
  const pool = playable.length ? playable : tracks;
  if (target === null) return busiest(pool);
  const covering = pool.filter((track) =>
    track.views.some((view) => view.start <= target && target <= view.end),
  );
  return busiest(covering) ?? endedLastBefore(pool, target) ?? busiest(pool);
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

function groupByView(rows: ManifestEntry[]): (ReplayView & { rows: ManifestEntry[] })[] {
  const views = new Map<string, ReplayView & { rows: ManifestEntry[] }>();
  for (const row of rows) {
    const id = viewKey(row);
    const view = views.get(id);
    if (!view) {
      views.set(id, { id, start: Number(row.start), end: Number(row.end), rows: [row] });
      continue;
    }
    view.start = Math.min(view.start, Number(row.start));
    view.end = Math.max(view.end, Number(row.end));
    view.rows.push(row);
  }
  return [...views.values()].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

function busiest(tracks: ReplayTrack[]): ReplayTrack | undefined {
  let best: ReplayTrack | undefined;
  let bestRecords = -1;
  for (const track of tracks) {
    const records = summarizeManifest(track.rows, true).recordCount;
    if (records > bestRecords) {
      best = track;
      bestRecords = records;
    }
  }
  return best;
}

function endedLastBefore(tracks: ReplayTrack[], target: number): ReplayTrack | undefined {
  let best: ReplayTrack | undefined;
  let bestEnd = -Infinity;
  for (const track of tracks) {
    for (const view of track.views) {
      if (view.end < target && view.end > bestEnd) {
        best = track;
        bestEnd = view.end;
      }
    }
  }
  return best;
}
