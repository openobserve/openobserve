//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export const MICROS_PER_MINUTE = 60 * 1_000_000;
export const MICROS_PER_HOUR = 60 * MICROS_PER_MINUTE;
export const MICROS_PER_DAY = 24 * MICROS_PER_HOUR;
export const MIN_KNOWN_SPAN_US = MICROS_PER_MINUTE;
export const FRESH_UNKNOWN_MAX_STREAMS = 10;
export const FRESH_UNKNOWN_MAX_WINDOW_US = MICROS_PER_HOUR;

const UNIT_MICROS: Record<string, number> = {
  s: 1_000_000,
  m: MICROS_PER_MINUTE,
  h: MICROS_PER_HOUR,
  d: MICROS_PER_DAY,
  w: 7 * MICROS_PER_DAY,
  M: 31 * MICROS_PER_DAY,
};

const PRESET_VALUES: Record<string, number[]> = {
  m: [1, 5, 10, 15, 30, 45],
  h: [1, 2, 3, 6, 8, 12],
  d: [1, 2, 3, 4, 5, 6],
  w: [1, 2, 3, 4, 5, 6],
  M: [1, 2, 3, 4, 5, 6],
};

export interface StreamStatsEntry {
  name: string;
  stats?: {
    doc_time_min?: number;
    doc_time_max?: number;
    storage_size?: number;
  } | null;
  settings?: { data_retention?: number } | null;
}

export interface EstimateContext {
  nowUs: number;
  defaultRetentionDays: number;
  superCluster: boolean;
}

export interface WindowUs {
  startUs: number;
  endUs: number;
}

export type UnknownCause = "no-stats" | "short-span" | "super-cluster";

export interface StreamScanEstimate {
  name: string;
  status: "known" | "unknown";
  estimateMb: number | null;
  cause: UnknownCause | null;
}

export interface ScanEstimate {
  status: "known" | "unknown" | "unresolved";
  knownMb: number;
  streams: StreamScanEstimate[];
  unknownStreams: string[];
  unresolvedSources: string[];
  superCluster: boolean;
  window: WindowUs;
}

export type ScanPolicyReason =
  | "within-threshold"
  | "over-threshold"
  | "unknown-allowed"
  | "unknown-window"
  | "unknown-unvalidated"
  | "unresolved";

export interface ScanPolicyDecision {
  allowed: boolean;
  reason: ScanPolicyReason;
  estimateMb: number;
}

export interface NarrowPreset {
  period: string;
  durationUs: number;
}

export interface NarrowCandidate extends NarrowPreset {
  estimate: ScanEstimate;
  decision: ScanPolicyDecision;
}

export const NARROW_PRESETS: NarrowPreset[] = Object.entries(PRESET_VALUES)
  .flatMap(([unit, values]) =>
    values.map((value) => ({
      period: `${value}${unit}`,
      durationUs: value * UNIT_MICROS[unit],
    })),
  )
  .sort((a, b) => a.durationUs - b.durationUs);

export function periodToMicros(period: string): number | null {
  const match = /^(\d+)([smhdwM])$/.exec(period ?? "");
  if (!match) return null;
  return Number(match[1]) * UNIT_MICROS[match[2]];
}

export function relativeWindow(period: string, nowUs: number): WindowUs | null {
  const duration = periodToMicros(period);
  if (duration === null) return null;
  return { startUs: nowUs - duration, endUs: nowUs };
}

export function estimateStreamMb(
  entry: StreamStatsEntry,
  window: WindowUs,
  ctx: EstimateContext,
): StreamScanEstimate {
  const unknown = (cause: UnknownCause): StreamScanEstimate => ({
    name: entry.name,
    status: "unknown",
    estimateMb: null,
    cause,
  });
  if (ctx.superCluster) return unknown("super-cluster");
  const docMin = Number(entry.stats?.doc_time_min ?? 0);
  const docMax = Number(entry.stats?.doc_time_max ?? 0);
  if (docMax <= 0) return unknown("no-stats");
  const observedSpan = Math.min(ctx.nowUs, docMax) - docMin;
  if (observedSpan < MIN_KNOWN_SPAN_US) return unknown("short-span");
  const retentionDays =
    Number(entry.settings?.data_retention ?? 0) > 0
      ? Number(entry.settings?.data_retention)
      : Number(ctx.defaultRetentionDays ?? 0);
  const spanUs = Math.max(1, observedSpan);
  const retentionUs = retentionDays * MICROS_PER_DAY;
  const denominator = retentionUs > 0 ? Math.min(retentionUs, spanUs) : spanUs;
  const rate = Number(entry.stats?.storage_size ?? 0) / denominator;
  const covered = Math.max(0, Math.min(window.endUs, ctx.nowUs) - Math.max(window.startUs, docMin));
  return { name: entry.name, status: "known", estimateMb: rate * covered, cause: null };
}

export function estimateScanMb(
  streamNames: string[],
  list: StreamStatsEntry[],
  window: WindowUs,
  ctx: EstimateContext,
): ScanEstimate {
  const byName = new Map(list.map((entry) => [entry.name, entry]));
  const unresolvedSources = streamNames.filter((name) => !byName.has(name));
  const streams = streamNames
    .filter((name) => byName.has(name))
    .map((name) => estimateStreamMb(byName.get(name) as StreamStatsEntry, window, ctx));
  const knownMb = streams.reduce((sum, s) => sum + (s.estimateMb ?? 0), 0);
  const unknownStreams = streams.filter((s) => s.status === "unknown").map((s) => s.name);
  let status: ScanEstimate["status"] = "known";
  if (unresolvedSources.length > 0 || streamNames.length === 0) status = "unresolved";
  else if (unknownStreams.length > 0) status = "unknown";
  return {
    status,
    knownMb,
    streams,
    unknownStreams,
    unresolvedSources,
    superCluster: ctx.superCluster,
    window,
  };
}

export function evaluateScanPolicy(
  estimate: ScanEstimate,
  thresholdMb: number,
): ScanPolicyDecision {
  const decide = (allowed: boolean, reason: ScanPolicyReason): ScanPolicyDecision => ({
    allowed,
    reason,
    estimateMb: estimate.knownMb,
  });
  if (estimate.status === "unresolved") return decide(false, "unresolved");
  if (estimate.knownMb > thresholdMb) return decide(false, "over-threshold");
  if (estimate.status === "known") return decide(true, "within-threshold");
  if (estimate.superCluster || estimate.unknownStreams.length > FRESH_UNKNOWN_MAX_STREAMS) {
    return decide(false, "unknown-unvalidated");
  }
  const windowUs = estimate.window.endUs - estimate.window.startUs;
  if (windowUs <= FRESH_UNKNOWN_MAX_WINDOW_US) return decide(true, "unknown-allowed");
  return decide(false, "unknown-window");
}

export function chooseNarrowPreset(
  streamNames: string[],
  list: StreamStatsEntry[],
  ctx: EstimateContext,
  thresholdMb: number,
  currentWindowUs: number,
): NarrowCandidate | null {
  const candidates = NARROW_PRESETS.filter((p) => p.durationUs < currentWindowUs).reverse();
  for (const preset of candidates) {
    const window = { startUs: ctx.nowUs - preset.durationUs, endUs: ctx.nowUs };
    const estimate = estimateScanMb(streamNames, list, window, ctx);
    const decision = evaluateScanPolicy(estimate, thresholdMb);
    if (decision.allowed) return { ...preset, estimate, decision };
  }
  return null;
}

export function compareStreamsByLatest(a: StreamStatsEntry, b: StreamStatsEntry): number {
  const diff = Number(b.stats?.doc_time_max ?? 0) - Number(a.stats?.doc_time_max ?? 0);
  if (diff !== 0) return diff;
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

export function pickLatestStream(list: StreamStatsEntry[]): string | null {
  const withData = list.filter((entry) => Number(entry.stats?.doc_time_max ?? 0) > 0);
  if (withData.length === 0) return null;
  return [...withData].sort(compareStreamsByLatest)[0].name;
}
