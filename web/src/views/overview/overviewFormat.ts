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
  OrgOverview,
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

export type AttentionKey = "firing" | "failing" | "incidents" | "pipelines" | "quiet";

// the headline tiles' order, so the status line reads in the same order as the strip below it
export const ATTENTION_ORDER: AttentionKey[] = [
  "firing",
  "failing",
  "incidents",
  "pipelines",
  "quiet",
];

// quiet streams are a warning, not an outage, so they alone never turn the line red
export const DANGER_KEYS: AttentionKey[] = ["firing", "failing", "incidents", "pipelines"];

export type CheckState = "ok" | "loading" | "unavailable";

export interface AttentionCheck {
  key: AttentionKey;
  state: CheckState;
  count: number;
  // true once the source has something configured to watch, so zero problems can mean healthy
  monitors: boolean;
}

export interface AttentionItem {
  key: AttentionKey;
  count: number;
}

export type OverviewStatusKind =
  "danger" | "warning" | "checking" | "partial" | "unmonitored" | "clear";

export interface OverviewStatus {
  kind: OverviewStatusKind;
  items: AttentionItem[];
}

export interface OverviewChecksInput {
  overview: OrgOverview | null;
  pending: boolean;
  failed: boolean;
  forbidden?: boolean;
  // left out when the edition or deployment has no incidents, so it can neither alarm nor block all clear
  incidents?: Omit<AttentionCheck, "key" | "monitors">;
}

export function checkState(view: OverviewView): CheckState {
  if (view === "ok" || view === "empty") return "ok";
  return view === "loading" ? "loading" : "unavailable";
}

// a source that is not set up reports zero problems and monitors nothing
export function overviewChecks(input: OverviewChecksInput): AttentionCheck[] {
  const opts = { pending: input.pending, failed: input.failed, forbidden: input.forbidden };
  const fromSection = <T>(
    key: AttentionKey,
    section: OverviewSection<T> | undefined,
    pick: (data: T) => number,
    monitors: (data: T) => boolean,
  ): AttentionCheck => {
    const view = sectionView(section, opts);
    const data = view === "ok" ? section?.data : undefined;
    return {
      key,
      state: checkState(view),
      count: data ? pick(data) : 0,
      monitors: data ? monitors(data) : false,
    };
  };
  const o = input.overview;
  const hasRules = (d: OverviewAlertsData) => d.total > 0;
  const checks = [
    fromSection("firing", o?.alerts, (d) => firingCount(d), hasRules),
    fromSection("failing", o?.alerts, (d) => d.failed_evaluation, hasRules),
    fromSection(
      "pipelines",
      o?.pipelines,
      (d) => d.errored,
      (d) => d.total > 0,
    ),
    fromSection(
      "quiet",
      o?.streams,
      (d) => d.quiet_count,
      (d) => d.total_streams > 0,
    ),
  ];
  if (input.incidents) {
    const monitors = input.incidents.state === "ok";
    checks.push({ key: "incidents", ...input.incidents, monitors });
  }
  return checks;
}

// a problem outranks a check still loading or one that failed, so a known outage is never held back
export function overviewStatus(checks: AttentionCheck[]): OverviewStatus {
  const items = ATTENTION_ORDER.flatMap((key) => {
    const count = checks
      .filter((c) => c.key === key && c.state === "ok")
      .reduce((sum, c) => sum + Math.max(0, c.count), 0);
    return count > 0 ? [{ key, count }] : [];
  });
  if (items.some((item) => DANGER_KEYS.includes(item.key))) return { kind: "danger", items };
  if (items.length > 0) return { kind: "warning", items };
  if (checks.some((c) => c.state === "loading")) return { kind: "checking", items: [] };
  if (checks.some((c) => c.state === "unavailable")) return { kind: "partial", items: [] };
  if (!checks.some((c) => c.monitors)) return { kind: "unmonitored", items: [] };
  return { kind: "clear", items: [] };
}
