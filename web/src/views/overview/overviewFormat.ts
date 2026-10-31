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

import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import type {
  SegmentedBarSegment,
  SegmentedBarVariant,
} from "@/lib/data/SegmentedBar/OSegmentedBar.types";
import type {
  OverviewAlertLevel,
  OverviewAlertsData,
  OverviewFiringAlert,
  OverviewSection,
  OverviewStreamTypeSummary,
  OverviewTopStream,
} from "@/ts/interfaces/overview";

export type OverviewView = "loading" | "error" | "forbidden" | "locked" | "empty" | "ok";

export type OverviewDestination = "alerts" | "pipelines" | "streams";

export const TOP_STREAMS_LIMIT = 5;

export function sectionView(
  section: OverviewSection<unknown> | null | undefined,
  opts: { pending: boolean; failed: boolean; forbidden?: boolean },
): OverviewView {
  if (opts.pending) return "loading";
  if (opts.forbidden) return "forbidden";
  if (opts.failed || !section) return "error";
  if (section.status === "ok") return section.data ? "ok" : "error";
  return section.status;
}

export type LimitLevel = "ok" | "warning" | "critical" | "over";

// 70 and 90 match the license limit card on the About page, so one number has one colour
export function limitLevel(percent: number): LimitLevel {
  if (percent >= 100) return "over";
  if (percent > 90) return "critical";
  if (percent > 70) return "warning";
  return "ok";
}

export function percentVariant(percent: number): ProgressBarVariant {
  const level = limitLevel(percent);
  if (level === "ok") return "default";
  return level === "warning" ? "warning" : "danger";
}

// a rule whose notification failed still fired
export function firingCount(alerts: OverviewAlertsData | undefined): number {
  return (alerts?.by_state.firing ?? 0) + (alerts?.by_state.notify_failed ?? 0);
}

export function percentToFraction(percent: number): number {
  return Math.min(1, Math.max(0, percent / 100));
}

export interface TopStreamRow extends OverviewTopStream {
  stream_type: string;
}

export function mergeTopStreams(
  byType: OverviewStreamTypeSummary[],
  limit = TOP_STREAMS_LIMIT,
): TopStreamRow[] {
  return byType
    .flatMap((type) => type.top.map((s) => ({ ...s, stream_type: type.stream_type })))
    .sort((a, b) => b.storage_size_mb - a.storage_size_mb)
    .slice(0, limit);
}

// the bar shows the same share of total storage as the "% of total" text beside it
export function sizeShare(sizeMb: number, totalMb: number): number {
  return totalMb > 0 ? sizeMb / totalMb : 0;
}

export type OverviewSignal = "logs" | "metrics" | "traces";

export const OVERVIEW_SIGNALS: OverviewSignal[] = ["logs", "metrics", "traces"];

// the split bar, its legend and the top-stream swatch share one colour per signal
export const SIGNAL_VARIANT: Record<OverviewSignal, SegmentedBarVariant> = {
  logs: "default",
  metrics: "info",
  traces: "neutral",
};

export function isSignal(streamType: string): streamType is OverviewSignal {
  return (OVERVIEW_SIGNALS as string[]).includes(streamType);
}

export function signalVariant(streamType: string): SegmentedBarVariant {
  return isSignal(streamType) ? SIGNAL_VARIANT[streamType] : "muted";
}

export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// a non-empty share that rounds to 0% would read as no storage at all
export function isUnderOnePercent(part: number, total: number): boolean {
  return total > 0 && part > 0 && (part / total) * 100 < 1;
}

export interface SignalSplitRow {
  signal: OverviewSignal;
  sizeMb: number;
  percent: number;
  segment: SegmentedBarSegment;
}

// enrichment, metadata and index streams stay out of the split: only the three signals are compared
export function signalSplit(byType: OverviewStreamTypeSummary[]): SignalSplitRow[] {
  const sizes = OVERVIEW_SIGNALS.map((signal) => ({
    signal,
    sizeMb: byType.find((x) => x.stream_type === signal)?.storage_size_mb ?? 0,
  }));
  const total = sizes.reduce((sum, x) => sum + x.sizeMb, 0);
  return sizes.map(({ signal, sizeMb }) => ({
    signal,
    sizeMb,
    percent: percentOf(sizeMb, total),
    segment: {
      id: signal,
      pct: total > 0 ? (sizeMb / total) * 100 : 0,
      variant: SIGNAL_VARIANT[signal],
    },
  }));
}

export interface Elapsed {
  days: number;
  hours: number;
  minutes: number;
}

export const MS_PER_MINUTE = 60_000;

// whole minutes, never negative: a clock slightly behind the server must not print "-1m"
export function elapsedParts(ms: number): Elapsed {
  const total = Math.max(0, Math.floor(ms / MS_PER_MINUTE));
  return {
    days: Math.floor(total / 1440),
    hours: Math.floor((total % 1440) / 60),
    minutes: total % 60,
  };
}

export function microsToMs(micros: number): number {
  return Math.floor(micros / 1000);
}

// the server sends 0 when it does not know when a rule started firing
export function hasKnownSince(since: number): boolean {
  return since > 0;
}

export const ALERT_LEVELS: OverviewAlertLevel[] = [
  "critical",
  "warning",
  "ok",
  "no_data",
  "unclassified",
];

export function levelCount(
  alerts: OverviewAlertsData | undefined,
  level: OverviewAlertLevel,
): number {
  return alerts?.firing_by_level?.[level] ?? 0;
}

export function firingRows(alerts: OverviewAlertsData | undefined): OverviewFiringAlert[] {
  return alerts?.firing ?? [];
}

export function oldestKnownFiring(
  alerts: OverviewAlertsData | undefined,
): OverviewFiringAlert | undefined {
  return firingRows(alerts).find((row) => hasKnownSince(row.since));
}

// firing_by_level counts every firing rule, so it is the total the capped list is cut from
export function firingTotal(alerts: OverviewAlertsData | undefined): number {
  if (!alerts?.firing_by_level) return firingCount(alerts);
  return ALERT_LEVELS.reduce((sum, level) => sum + levelCount(alerts, level), 0);
}

export function levelTone(level: OverviewAlertLevel): "error" | "warning" | "success" | "neutral" {
  if (level === "critical") return "error";
  if (level === "warning") return "warning";
  if (level === "ok") return "success";
  return "neutral";
}
