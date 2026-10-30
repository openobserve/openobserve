// Copyright 2026 OpenObserve Inc.

import { bestMatch, readPath, type Classification } from "./classify";
import { SECURITY_STREAM_RE, loadTaggedStreams } from "./streams";

export type SourceDecision = "auto" | "suggested" | "ignored";

/** Confident enough to include without asking. */
const AUTO_CONFIDENCE = 0.7;
/** Worth showing as a suggestion. */
const SUGGEST_CONFIDENCE = 0.5;

export interface StreamVerdict {
  decision: SourceDecision;
  /** Source type id, e.g. `aws_cloudtrail`. */
  sourceId: string;
  label: string;
  confidence: number;
}

export interface CachedVerdict extends StreamVerdict {
  /** Changes when the stream is recreated, which forces a reclassification. */
  key: string;
}

export interface SourcePrefs {
  include: string[];
  exclude: string[];
  dismissed: string[];
  classified: Record<string, CachedVerdict>;
}

export type SourceReason = "name" | "auto" | "manual";

export interface SourceEntry {
  name: string;
  reason: SourceReason;
  verdict: StreamVerdict | null;
}

const prefsKey = (orgId: string) => `oo_sec_sources_${orgId}`;

const emptyPrefs = (): SourcePrefs => ({ include: [], exclude: [], dismissed: [], classified: {} });

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export function loadSourcePrefs(orgId: string): SourcePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey(orgId)) ?? "null");
    if (!raw || typeof raw !== "object") return emptyPrefs();
    return {
      include: strings(raw.include),
      exclude: strings(raw.exclude),
      dismissed: strings(raw.dismissed),
      classified: raw.classified && typeof raw.classified === "object" ? raw.classified : {},
    };
  } catch {
    return emptyPrefs();
  }
}

export function saveSourcePrefs(orgId: string, prefs: SourcePrefs) {
  try {
    localStorage.setItem(prefsKey(orgId), JSON.stringify(prefs));
  } catch {
    /* private mode / quota — preferences are a convenience, not state */
  }
}

/** Bumped when the decision rules change, so verdicts cached under older rules are redone. */
const RULES_VERSION = "v2";

type StreamStats = { created_at?: number } | null | undefined;

/** Identity of a stream instance, so a dropped-and-recreated stream is classified again. */
export const streamKey = (stats: StreamStats) =>
  `${RULES_VERSION}:${Number(stats?.created_at ?? 0)}`;

/** Key for a verdict made without sample rows; it expires daily so a quiet stream is retried. */
export const unsampledKey = (stats: StreamStats, nowMs: number = Date.now()) =>
  `${streamKey(stats)}:${Math.floor(nowMs / 86_400_000)}`;

/** Classifies a stream by schema; sample rows can only raise confidence, never drop a type. */
export function judgeStream(
  fields: string[],
  samples: Record<string, unknown>[],
): StreamVerdict | null {
  const schemaOnly = bestMatch(fields);
  let best: Classification | null = schemaOnly;
  let fromSample = false;
  for (const row of samples) {
    const withRow = bestMatch(fields, { sample: row });
    if (withRow && (!best || withRow.confidence > best.confidence)) {
      best = withRow;
      fromSample = true;
    }
  }
  if (!best) return null;

  const source = best.source;
  const security = !source.telemetryOnly;
  const filled =
    samples.length > 0 &&
    best.matchedRequired.every((field) =>
      samples.some((row) => {
        const value = readPath(row, field);
        return value !== undefined && value !== null && value !== "";
      }),
    );
  const valuesHeld = !source.valueSignals?.length || fromSample;
  // Rows that were read and lacked the identifying values are evidence against the type.
  const valuesRefuted = !valuesHeld && samples.length > 0;

  let decision: SourceDecision = "ignored";
  if (security && best.confidence >= AUTO_CONFIDENCE && filled && valuesHeld) decision = "auto";
  else if (security && !valuesRefuted && best.confidence >= SUGGEST_CONFIDENCE)
    decision = "suggested";

  return {
    decision,
    sourceId: source.id,
    label: source.label,
    confidence: best.confidence,
  };
}

/** Sources in display order (name match, auto, manual); an exclusion beats every inclusion. */
export function resolveSources(all: string[], prefs: SourcePrefs): SourceEntry[] {
  const excluded = new Set(prefs.exclude);
  const seen = new Set<string>();
  const out: SourceEntry[] = [];
  const add = (name: string, reason: SourceReason) => {
    if (seen.has(name) || excluded.has(name) || !all.includes(name)) return;
    seen.add(name);
    out.push({ name, reason, verdict: prefs.classified[name] ?? null });
  };
  for (const name of all) if (SECURITY_STREAM_RE.test(name)) add(name, "name");
  for (const name of all) if (prefs.classified[name]?.decision === "auto") add(name, "auto");
  for (const name of prefs.include) add(name, "manual");
  return out;
}

/** The org's source names as every SIEM page reads them, hand-added legacy streams included. */
export function securitySourceNames(orgId: string, all: string[]): string[] {
  const prefs = loadSourcePrefs(orgId);
  const legacy = loadTaggedStreams(orgId).filter((n) => !prefs.include.includes(n));
  return resolveSources(all, { ...prefs, include: [...prefs.include, ...legacy] }).map(
    (entry) => entry.name,
  );
}

/** Suggested streams that are not already sources and were not dismissed. */
export function suggestedSources(all: string[], prefs: SourcePrefs): SourceEntry[] {
  const included = new Set(resolveSources(all, prefs).map((entry) => entry.name));
  const dismissed = new Set(prefs.dismissed);
  return all
    .filter((name) => !name.startsWith("_"))
    .filter((name) => !included.has(name) && !dismissed.has(name) && !prefs.exclude.includes(name))
    .filter((name) => prefs.classified[name]?.decision === "suggested")
    .map((name) => ({ name, reason: "auto" as const, verdict: prefs.classified[name] }))
    .sort((a, b) => (b.verdict?.confidence ?? 0) - (a.verdict?.confidence ?? 0));
}

/** Streams needing (re)classification, busiest first: new, recreated, or unsampled before today. */
export function staleStreams(
  streams: { name: string; stats?: { created_at?: number; doc_num?: number } }[],
  prefs: SourcePrefs,
  nowMs: number = Date.now(),
): string[] {
  return streams
    .filter((s) => !s.name.startsWith("_"))
    .filter((s) => {
      const key = prefs.classified[s.name]?.key;
      return key !== streamKey(s.stats) && key !== unsampledKey(s.stats, nowMs);
    })
    .sort((a, b) => Number(b.stats?.doc_num ?? 0) - Number(a.stats?.doc_num ?? 0))
    .map((s) => s.name);
}
