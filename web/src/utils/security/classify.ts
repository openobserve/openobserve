// Copyright 2026 OpenObserve Inc.

// Scoring is simple and explainable on purpose: the same stream always classifies the same way.

import type { SourceType, ValueSignal } from "./sourceTypes";
import { SOURCE_TYPES } from "./sourceTypes";
import { FieldIndex, INGEST_FLATTEN_LEVEL, toColumnName } from "./fields";

export interface Classification {
  source: SourceType;
  /** 0..1. Above 0.6 is a confident match, below 0.35 is a guess. */
  confidence: number;
  /** Required fields that matched, in the spelling the stream actually uses. */
  matchedRequired: string[];
  /** Optional signals that matched, which is what separates near-ties. */
  matchedSignals: string[];
}

export interface ClassifyOptions {
  /** One event from the stream, used for the value-based fingerprints. */
  sample?: Record<string, unknown> | null;
  /** Candidates below this confidence are dropped. Default 0.25. */
  minConfidence?: number;
}

/** Tries the exact path, the ingest-rewritten column, then a nested walk for unflattened rows. */
export function readPath(row: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, path)) return row[path];

  const column = toColumnName(path);
  if (column !== path && Object.prototype.hasOwnProperty.call(row, column)) return row[column];

  let node: unknown = row;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return readFlattenedJson(row, path);
    node = (node as Record<string, unknown>)[part];
  }
  return node === undefined ? readFlattenedJson(row, path) : node;
}

/** Past the flatten depth, the remainder sits as JSON text in the deepest column it reached. */
function readFlattenedJson(row: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  if (parts.length <= INGEST_FLATTEN_LEVEL) return undefined;
  const text = row[toColumnName(parts.slice(0, INGEST_FLATTEN_LEVEL).join("."))];
  if (typeof text !== "string" || !text.startsWith("{")) return undefined;
  try {
    let node: unknown = JSON.parse(text);
    for (const key of parts.slice(INGEST_FLATTEN_LEVEL)) {
      if (node == null || typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[key];
    }
    return node;
  } catch {
    return undefined;
  }
}

const isPresent = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

/** Returns the spelling that matched so the evidence names a real field. */
function resolveField(
  spec: string,
  fields: FieldIndex,
  sample: Record<string, unknown> | null | undefined,
): string | null {
  for (const option of spec.split("|")) {
    const column = fields.resolve(option);
    if (column) return column;
    if (sample && isPresent(readPath(sample, option))) return option;
  }
  return null;
}

function valueSignalHolds(
  signal: ValueSignal,
  sample: Record<string, unknown> | null | undefined,
): boolean {
  if (!sample) return false;
  for (const option of signal.field.split("|")) {
    const value = readPath(sample, option);
    if (!isPresent(value)) continue;
    const text = String(value).toLowerCase();
    if (signal.any.some((want) => text.includes(want.toLowerCase()))) return true;
  }
  return false;
}

/** Required fields are a gate, not a score: missing one means the wrong source, not a weak match. */
function scoreSource(
  source: SourceType,
  fields: FieldIndex,
  sample: Record<string, unknown> | null | undefined,
): Classification | null {
  const matchedRequired: string[] = [];
  for (const spec of source.required) {
    const hit = resolveField(spec, fields, sample);
    if (!hit) return null;
    matchedRequired.push(hit);
  }

  // A disqualifying field marks a neighbouring source sharing the required ones (Sysmon vs Security log).
  for (const spec of source.absent ?? []) {
    if (resolveField(spec, fields, sample)) return null;
  }

  const matchedSignals: string[] = [];
  for (const spec of source.signals ?? []) {
    const hit = resolveField(spec, fields, sample);
    if (hit) matchedSignals.push(hit);
  }

  // Without a sample, value fingerprints are skipped, not failed, so schema-only classification still works.
  const valueSignals = source.valueSignals ?? [];
  let valueScore = 0;
  if (sample && valueSignals.length) {
    const held = valueSignals.filter((signal) => valueSignalHolds(signal, sample));
    // A source whose identity IS its values (sshd in a syslog stream) is wrong if none of them hold.
    if (!held.length) return null;
    valueScore = held.length / valueSignals.length;
  }

  const signalRatio = source.signals?.length ? matchedSignals.length / source.signals.length : 0;
  // The weights keep even a full-signal match below 1.0: a field list alone cannot give certainty.
  const base = 0.45 + 0.4 * signalRatio + 0.15 * valueScore;
  const confidence = Math.min(0.99, base * (source.weight ?? 1));

  return { source, confidence, matchedRequired, matchedSignals };
}

/** Ties break on evidence count, so a source recognised by six fields outranks one recognised by two. */
export function classifyStream(fields: string[], options: ClassifyOptions = {}): Classification[] {
  const index = new FieldIndex(fields);
  const { sample = null, minConfidence = 0.25 } = options;

  return SOURCE_TYPES.map((source) => scoreSource(source, index, sample))
    .filter((c): c is Classification => c !== null && c.confidence >= minConfidence)
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const evidence = (c: Classification) => c.matchedRequired.length + c.matchedSignals.length;
      return evidence(b) - evidence(a);
    });
}

export function bestMatch(fields: string[], options: ClassifyOptions = {}): Classification | null {
  return classifyStream(fields, options)[0] ?? null;
}

/** Telemetry-only sources still classify so their events read in the same columns, but are not security. */
export function isSecuritySource(classification: Classification | null): boolean {
  if (!classification) return false;
  return !classification.source.telemetryOnly && classification.confidence >= 0.35;
}
