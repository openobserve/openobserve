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

import type { Router } from "vue-router";
import type { AnomalyExploreResponse, AnomalyExploreSummary } from "@/types/anomalyExplore";
import { anomalyIntervalMs, formatReading } from "@/utils/alerts/anomalyBandChart";

/** A run or a cursor older than this many intervals reads as stale. */
const STALE_INTERVALS = 3;

export type AnomalyStripState =
  "ongoing" | "back_in_range" | "paused" | "no_recent_runs" | "no_new_data" | "learning" | "none";

export interface AnomalyStripView {
  state: AnomalyStripState;
  startedUs: number | null;
  /** The 7-day search reached the first bucket of the model, so the true start is earlier. */
  startedBefore: boolean;
  sinceUs: number | null;
  /** Null when the window is clipped, because the true start is not known. */
  lastedMs: number | null;
  /** Ongoing only: from the start to the window end, so it moves only when the strip reloads. */
  ongoingMs: number | null;
  lastRunUs: number | null;
  /** Set for the "No new data" state and for the gray second line under Ongoing. */
  noNewDataSinceUs: number | null;
  incomplete: boolean;
  summary: AnomalyExploreSummary | null;
}

/** The detector fields the strip reads from the config row of the page. */
export interface AnomalyStripConfig {
  enabled: boolean;
  isTrained: boolean;
  scheduleMs: number | null;
  bucketMs: number | null;
}

/** The model the page loaded: the endpoint sends the same value, 0 while untrained. */
export function pageModelVersion(config: Record<string, any> | null | undefined): number {
  if (!config?.is_trained) return 0;
  const v = Number(config.current_model_version);
  return Number.isFinite(v) ? v : 0;
}

export function stripConfigOf(config: Record<string, any> | null | undefined): AnomalyStripConfig {
  return {
    enabled: config?.enabled !== false,
    isTrained: !!config?.is_trained,
    scheduleMs: anomalyIntervalMs(config?.schedule_interval),
    bucketMs: anomalyIntervalMs(config?.histogram_interval),
  };
}

function olderThan(us: number | null, intervalMs: number | null, nowUs: number): boolean {
  if (us === null || intervalMs === null) return false;
  return nowUs - us > STALE_INTERVALS * intervalMs * 1000;
}

/** Null freshness fields (a peer cluster) never show a stale state. */
export function anomalyStripView(
  res: AnomalyExploreResponse,
  config: AnomalyStripConfig,
  nowUs: number,
): AnomalyStripView {
  const summary = res.summary ?? null;
  const win = res.window ?? null;
  const startedUs = summary?.started_us ?? win?.start_us ?? null;
  const sinceUs = summary?.since_us ?? null;
  const noRecentRuns = olderThan(res.last_detection_run, config.scheduleMs, nowUs);
  const noNewData = !noRecentRuns && olderThan(res.no_new_data_since_us, config.bucketMs, nowUs);
  // The cursor is the end of the newest judged bucket; Ongoing has its window end.
  const newestEndUs = res.state === "ongoing" && win !== null ? win.end_us : res.cursor_us;
  const incomplete =
    newestEndUs !== null &&
    config.scheduleMs !== null &&
    nowUs - newestEndUs < config.scheduleMs * 1000;
  const clipped = !!win?.clipped;
  const base: AnomalyStripView = {
    state: "none",
    startedUs,
    startedBefore: clipped,
    sinceUs,
    lastedMs:
      !clipped && sinceUs !== null && startedUs !== null ? (sinceUs - startedUs) / 1000 : null,
    ongoingMs: null,
    lastRunUs: res.last_detection_run,
    noNewDataSinceUs: noNewData ? res.no_new_data_since_us : null,
    incomplete,
    summary: null,
  };
  if (!config.enabled) return { ...base, state: "paused" };
  // Rule 10: while untrained the strip says Learning, whatever the run freshness.
  if (!config.isTrained) return { ...base, state: "learning" };
  if (res.state === "ongoing") {
    const ongoingMs =
      !clipped && win !== null && startedUs !== null ? (win.end_us - startedUs) / 1000 : null;
    return { ...base, state: "ongoing", summary, ongoingMs };
  }
  if (noRecentRuns) return { ...base, state: "no_recent_runs" };
  if (noNewData) return { ...base, state: "no_new_data" };
  // A peer cluster sends no run time, and there the strip shows no stale state.
  if (res.state === "no_runs" && res.last_detection_run !== null) {
    return { ...base, state: "no_recent_runs" };
  }
  if (res.state === "back_in_range") return { ...base, state: "back_in_range", summary };
  return base;
}

/** "18:00" for a microsecond timestamp; the copy appends "UTC". */
export function formatUtcHm(us: number): string {
  return new Date(us / 1000).toISOString().slice(11, 16);
}

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Strip and popover time in the zone of the chart axis: the chart sets no zone, so ECharts
 * draws the axis in the browser zone. A time on another day than `refUs` also shows the date.
 */
export function formatAnomalyTime(us: number, refUs: number): string {
  const d = new Date(us / 1000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (localDay(d) === localDay(new Date(refUs / 1000))) return hm;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hm}`;
}

/** "2026-11-16 18:00" in UTC, for the tooltip of a strip or popover time; the copy appends "UTC". */
export function formatAnomalyTimeUtc(us: number): string {
  return new Date(us / 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** Two decimals from 1 up, as the alert copy writes them; smaller values keep their digits. */
export function formatAnomalyNumber(value: number): string {
  return Math.abs(value) >= 1 ? formatReading(value, 2) : formatReading(value);
}

/** The arrow before a signed change; none for no change. */
export function changeArrow(percent: number): string {
  if (percent > 0) return "▲";
  return percent < 0 ? "▼" : "";
}

export function formatChangePercent(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${formatReading(rounded, 1)}%`;
}

/** Whole hours and minutes of a duration, or null under a minute. */
export function durationParts(ms: number): { h: number; m: number } | null {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return null;
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/** Opens an endpoint link in place when it points into this app, else as a full page load. */
export function openAppUrl(router: Router, url: string): void {
  let target: URL;
  try {
    target = new URL(url, window.location.origin);
  } catch {
    return;
  }
  const base = (router.options.history.base ?? "").replace(/\/$/, "");
  const inApp =
    target.origin === window.location.origin &&
    (base === "" || target.pathname === base || target.pathname.startsWith(`${base}/`));
  if (inApp) {
    void router.push(`${target.pathname.slice(base.length) || "/"}${target.search}${target.hash}`);
    return;
  }
  window.location.assign(target.href);
}
