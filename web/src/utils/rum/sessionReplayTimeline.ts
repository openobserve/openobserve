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

export type LoadState = "loading" | "complete" | "failed" | "live" | "empty" | "error";

export type RangeState = "inPlayer" | "fetched" | "skipped" | "unavailable";

/** A span of the session in session ms, and what the viewer holds for it. */
export interface LoadedRange {
  start: number;
  end: number;
  state: RangeState;
}

export type PlaybackState =
  | "loading"
  | "empty"
  | "error"
  | "paused"
  | "playing"
  | "buffering"
  | "waiting"
  | "failed"
  | "ended";

/** Stands in the segment list where a segment could not be loaded, so the player can step past it. */
export interface SkipMarker {
  skipped: true;
  segmentId: string;
  start: number;
  end: number;
  viewId?: string;
}

export type ReplayIntent = "play" | "pause";

/** Loading and live both mean more data can still reach the player. */
export function expectsMoreData(state: LoadState): boolean {
  return state === "loading" || state === "live";
}

export function isSkipMarker(segment: any): segment is SkipMarker {
  return !!segment && segment.skipped === true;
}

// Skip-inactivity raises the timer speed far above this, but a skip stops at the next loaded interaction, so the user speed is the right scale.
export function playbackMargin(speed: number): number {
  return 1000 * (speed > 0 ? speed : 1);
}

/** Pause before the player runs out of loaded events; both values are in player time, so the origin cancels out. */
export function shouldBuffer(currentTime: number, loadedTotal: number, speed: number): boolean {
  return currentTime >= loadedTotal - playbackMargin(speed);
}

// Twice the pause threshold, so playback does not stutter between pausing and resuming.
export function canResume(currentTime: number, loadedTotal: number, speed: number): boolean {
  return loadedTotal - currentTime >= 2 * playbackMargin(speed);
}

/** Bar length in session ms: the metadata span, widened only if loaded records run past it. */
export function timelineLength(
  sessionStartMs: number,
  sessionEndMs: number,
  loadedEndMs: number,
): number {
  return Math.max(0, sessionEndMs - sessionStartMs, loadedEndMs - sessionStartMs);
}

export function toPercent(ms: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, (ms / total) * 100));
}

export function isLoadedAt(ms: number, ranges: LoadedRange[]): boolean {
  return ranges.some(
    (r) => (r.state === "inPlayer" || r.state === "fetched") && r.start <= ms && ms <= r.end,
  );
}

export function skippedCount(ranges: LoadedRange[]): number {
  return ranges.filter((r) => r.state === "skipped").length;
}

export function formatReplayTime(milliSeconds: number): string {
  const ms = Math.max(0, milliSeconds);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const seconds = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  if (hours === 0) return `${minutes}:${seconds}`;
  return `${String(hours).padStart(2, "0")}:${minutes}:${seconds}`;
}
