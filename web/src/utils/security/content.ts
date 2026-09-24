// Copyright 2026 OpenObserve Inc.
//
// content.ts — what ships with the SIEM (the Sigma pack and the source types it
// understands) set against what this org actually has: which rules are
// installed as detections, and which of its streams each source type matches.

import { bestMatch } from "./classify";
import type { DetectionRow } from "@/composables/security/useSiemDetections";
import { isErrorOutcome } from "@/utils/alerts/runOutcome";
import { isFiring, type HistoryRow } from "./history";
import { applicableRules, matchesLogsource, type CompiledSigma, type SigmaRule } from "./sigma";
import {
  SOURCE_TYPES,
  SOURCE_TYPE_BY_ID,
  sigmaLogsourceLabel,
  type SourceType,
} from "./sourceTypes";

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
}

/**
 * Which of the org's streams each source type matches, identified from schema
 * alone. A stream counts once, under its best match, so a CloudTrail stream is
 * not also claimed by the generic catch-all.
 */
export function streamsBySource(streams: StreamSchema[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const stream of streams) {
    if (!stream.fields.length) continue;
    const match = bestMatch(stream.fields);
    if (!match) continue;
    map.set(match.source.id, [...(map.get(match.source.id) ?? []), stream.name]);
  }
  return map;
}

/** Source types a rule was written for (its logsource is satisfied by theirs). */
export function sourcesForRule(
  rule: SigmaRule,
  sources: SourceType[] = SOURCE_TYPES,
): SourceType[] {
  return sources.filter((source) => matchesLogsource(rule, source.sigma));
}

/** Rules written for a source type. */
export function rulesForSource(source: SourceType, rules: SigmaRule[]): SigmaRule[] {
  return rules.filter((rule) => matchesLogsource(rule, source.sigma));
}

/** The org's streams a rule could run on, via the source types it applies to. */
export function streamsForRule(rule: SigmaRule, bySource: Map<string, string[]>): string[] {
  return sourcesForRule(rule).flatMap((source) => bySource.get(source.id) ?? []);
}

export interface StreamCheck {
  stream: string;
  source: SourceType;
  compiled: CompiledSigma;
}

/**
 * For every rule, how it compiles on each of the org's streams it applies to.
 * Each (source, stream) is compiled once for all of its rules, so this stays
 * one pass over the pack rather than one per rule.
 */
export function checksByRule(
  bySource: Map<string, string[]>,
  fieldsByStream: Map<string, string[]>,
): Map<SigmaRule, StreamCheck[]> {
  const map = new Map<SigmaRule, StreamCheck[]>();
  for (const [sourceId, streams] of bySource) {
    const source = SOURCE_TYPE_BY_ID.get(sourceId);
    if (!source) continue;
    for (const stream of streams) {
      for (const { rule, compiled } of applicableRules(source, fieldsByStream.get(stream) ?? [])) {
        map.set(rule, [...(map.get(rule) ?? []), { stream, source, compiled }]);
      }
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
export function groupByLogsource(rules: SigmaRule[]): LogsourceGroup[] {
  const counts = new Map<string, number>();
  for (const rule of rules) {
    const key = sigmaLogsourceLabel(rule.logsource) || "unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export const logsourceKey = (rule: SigmaRule) =>
  sigmaLogsourceLabel(rule.logsource) || "unspecified";

/** Row rail for a log source the org actually ingests (OTable getRowStatusColor). */
export const DETECTED_RAIL = "var(--color-status-positive)";

/** Detection states, as the Detections list facets them. */
export type DetectionState = "erroring" | "disabled" | "enabled";

/** `*_at` fields are microseconds on the v2 list; older rows may carry ms. */
export function toMicros(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e14 ? n : n * 1000;
}

export interface FiringSummary {
  count: number;
  /** Newest firing, µs. */
  lastUs: number;
}

/**
 * Firings per alert name from alert history. `last_triggered_at` on the alert
 * is the last *evaluation*, not the last firing, so history is the only honest
 * source for "did this fire, and when".
 */
export function firingsByName(rows: HistoryRow[]): Map<string, FiringSummary> {
  const map = new Map<string, FiringSummary>();
  for (const row of rows) {
    if (!isFiring(row)) continue;
    const entry = map.get(row.alert_name) ?? { count: 0, lastUs: 0 };
    entry.count += 1;
    entry.lastUs = Math.max(entry.lastUs, Number(row.timestamp) || 0);
    map.set(row.alert_name, entry);
  }
  return map;
}

/**
 * The rule's current state. Erroring is read from `last_outcome`, which the
 * scheduler overwrites on every run — so it clears itself once a run succeeds,
 * unlike `last_error`, which may linger.
 */
export function detectionState(alert: Record<string, any>): DetectionState {
  if (!alert.enabled) return "disabled";
  if (isErrorOutcome(alert.last_outcome)) return "erroring";
  return "enabled";
}
