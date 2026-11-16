// Copyright 2026 OpenObserve Inc.

import type { DetectionRow } from "@/composables/security/useSiemDetections";
import { isErrorOutcome } from "@/utils/alerts/runOutcome";
import type { ApplicableRule, CatalogRule, CompiledSigma } from "@/services/securitySigma";
import type { SourceType } from "@/services/securitySources";

/** Sigma ids already running as a SIEM detection, with the detections using each. */
export function installedBySigmaId(rows: DetectionRow[]): Map<string, DetectionRow[]> {
  const map = new Map<string, DetectionRow[]>();
  for (const row of rows) {
    const id = row.meta.sigmaId;
    if (!row.meta.isSiem || !id) continue;
    map.set(id, [...(map.get(id) ?? []), row]);
  }
  return map;
}

export interface StreamSchema {
  name: string;
  fields: string[];
  /** The server's schema-only match, `null` when nothing fits. */
  sourceId: string | null;
}

/** A stream counts once, under its best match, so the generic catch-all does not also claim it. */
export function streamsBySource(streams: StreamSchema[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const stream of streams) {
    if (!stream.sourceId) continue;
    map.set(stream.sourceId, [...(map.get(stream.sourceId) ?? []), stream.name]);
  }
  return map;
}

/** Source types a rule was written for (the server lists them on each catalog rule). */
export function sourcesForRule(rule: CatalogRule, sources: SourceType[]): SourceType[] {
  return sources.filter((source) => rule.sources.includes(source.id));
}

export function rulesForSource(source: SourceType, rules: CatalogRule[]): CatalogRule[] {
  return rules.filter((rule) => rule.sources.includes(source.id));
}

/** The org's streams a rule could run on, via the source types it applies to. */
export function streamsForRule(rule: CatalogRule, bySource: Map<string, string[]>): string[] {
  return rule.sources.flatMap((id) => bySource.get(id) ?? []);
}

/** Streams a rule applies to: its log source's streams plus any stream the server compiled it for, so a rule ready to run is always counted as applying. */
export function ruleStreams(
  rule: CatalogRule,
  bySource: Map<string, string[]>,
  checks: StreamCheck[],
): string[] {
  return [...new Set([...streamsForRule(rule, bySource), ...checks.map((c) => c.stream)])];
}

/** One definition for the Content counters: "ready" is always a subset of "applies". */
export function ruleCounts(
  rows: { streams: string[]; runnable: string[]; matched?: string[]; installed: boolean }[],
) {
  return {
    ready: rows.filter((r) => (r.matched ?? r.runnable).length > 0 && !r.installed).length,
    installed: rows.filter((r) => r.installed).length,
    applies: rows.filter((r) => r.streams.length > 0).length,
  };
}

/** Runnable streams whose source the rule was written for; a rule only compiling on another source's shared names is not ready. */
export function matchedRunnable(rule: CatalogRule, checks: StreamCheck[]): string[] {
  return checks
    .filter((c) => c.compiled.runnable && rule.sources.includes(c.source.id))
    .map((c) => c.stream);
}

export interface StreamCheck {
  stream: string;
  source: SourceType;
  compiled: CompiledSigma;
}

/** One stream's compile of its source's whole pack, as the compile API returns it. */
export interface StreamCompile {
  stream: string;
  source: SourceType;
  applicable: ApplicableRule[];
}

/** For every rule key, how it compiles on each of the org's streams it applies to. */
export function checksByRule(compiles: StreamCompile[]): Map<string, StreamCheck[]> {
  const map = new Map<string, StreamCheck[]>();
  for (const { stream, source, applicable } of compiles) {
    for (const { key, compiled } of applicable) {
      map.set(key, [...(map.get(key) ?? []), { stream, source, compiled }]);
    }
  }
  return map;
}

export interface LogsourceGroup {
  key: string;
  label: string;
  count: number;
}

/** Rules grouped by their Sigma logsource, busiest first. */
export function groupByLogsource(rules: CatalogRule[]): LogsourceGroup[] {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = rule.logsourceLabel || "unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export const logsourceKey = (rule: CatalogRule) => rule.logsourceLabel || "unspecified";

export const DETECTED_RAIL = "var(--color-status-positive)";

export type DetectionState = "erroring" | "notifyFailing" | "disabled" | "enabled";

/** `*_at` fields are microseconds on the v2 list; older rows may carry ms. */
export function toMicros(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? n : n * 1000;
}

/** `last_outcome` is overwritten every run, so erroring clears on success, unlike a lingering `last_error`. */
export function detectionState(alert: Record<string, any>): DetectionState {
  if (!alert.enabled) return "disabled";
  if (isErrorOutcome(alert.last_outcome)) return "erroring";
  // The rule matched but its notification never landed, so nobody was told.
  if (alert.last_outcome === "notify_failed") return "notifyFailing";
  return "enabled";
}
