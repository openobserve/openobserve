// Copyright 2026 OpenObserve Inc.

import { bestMatch } from "./classify";
import type { DetectionRow } from "@/composables/security/useSiemDetections";
import { isErrorOutcome } from "@/utils/alerts/runOutcome";
import { applicableRules, ruleAppliesTo, type CompiledSigma, type SigmaRule } from "./sigma";
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

/** A stream counts once, under its best match, so the generic catch-all does not also claim it. */
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
  return sources.filter((source) => ruleAppliesTo(rule, source));
}

export function rulesForSource(source: SourceType, rules: SigmaRule[]): SigmaRule[] {
  return rules.filter((rule) => ruleAppliesTo(rule, source));
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

/** Each (source, stream) compiles once for all its rules, keeping this one pass over the pack. */
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

export const DETECTED_RAIL = "var(--color-status-positive)";

export type DetectionState = "erroring" | "disabled" | "enabled";

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
  return "enabled";
}
