// Copyright 2026 OpenObserve Inc.
//
// classify.ts — decides what a log stream is, from its shape.
//
// The input is a stream's schema (and optionally one sample row); the output is
// a ranked list of candidate source types with a confidence and the evidence
// behind it. Evidence matters as much as the answer: an analyst who cannot see
// WHY a stream was called CloudTrail has no way to correct it, so every result
// carries the fields that matched.
//
// Scoring is deliberately simple and explainable rather than statistical. A
// source is a candidate only if every required field is present; confidence then
// rises with each optional signal it also carries. Nothing here learns or
// drifts: the same stream always classifies the same way.

import type { SourceType, ValueSignal } from "./sourceTypes";
import { SOURCE_TYPES } from "./sourceTypes";
import { FieldIndex, toColumnName } from "./fields";

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

/**
 * Reads a field out of a row by the path its producer uses.
 *
 * Three spellings are tried, in the order they are likely: the path exactly as
 * written, the column name ingest rewrote it into (`userIdentity.type` is stored
 * as `useridentity_type`), and finally a walk down the nested objects, which is
 * what a row that was never flattened still looks like.
 */
export function readPath(row: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, path)) return row[path];

  const column = toColumnName(path);
  if (column !== path && Object.prototype.hasOwnProperty.call(row, column)) return row[column];

  let node: unknown = row;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

const isPresent = (value: unknown) =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);

/**
 * Resolves one `a|b|c` alternation against what the stream actually has,
 * returning the spelling that matched so the evidence names a real field.
 */
function resolveField(
  spec: string,
  fields: FieldIndex,
  sample: Record<string, unknown> | null | undefined,
): string | null {
  for (const option of spec.split("|")) {
    // The evidence should name the column as the stream really spells it, so
    // the analyst can go and look at it.
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

/**
 * Scores one source type against a stream.
 *
 * Required fields are a gate, not a score: a source that is missing one is not a
 * weak match, it is the wrong source. Everything after that is confidence.
 */
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

  // A disqualifying field means we are looking at a neighbouring source that
  // happens to share the required ones, e.g. Sysmon vs the Windows Security log.
  for (const spec of source.absent ?? []) {
    if (resolveField(spec, fields, sample)) return null;
  }

  const matchedSignals: string[] = [];
  for (const spec of source.signals ?? []) {
    const hit = resolveField(spec, fields, sample);
    if (hit) matchedSignals.push(hit);
  }

  // Value fingerprints only apply when a sample was supplied. Without one they
  // are skipped rather than failed, so classification still works from a schema
  // alone, just with less confidence.
  const valueSignals = source.valueSignals ?? [];
  let valueScore = 0;
  if (sample && valueSignals.length) {
    const held = valueSignals.filter((signal) => valueSignalHolds(signal, sample));
    // A source whose identity IS its values (sshd in a syslog stream) is wrong
    // if none of them hold.
    if (!held.length) return null;
    valueScore = held.length / valueSignals.length;
  }

  const signalRatio = source.signals?.length ? matchedSignals.length / source.signals.length : 0;
  // Required fields carry the match; signals and values refine it. The weights
  // keep a source with every signal below 1.0, because certainty is not on offer
  // when the only evidence is a field list.
  const base = 0.45 + 0.4 * signalRatio + 0.15 * valueScore;
  const confidence = Math.min(0.99, base * (source.weight ?? 1));

  return { source, confidence, matchedRequired, matchedSignals };
}

/**
 * Ranks every source type against a stream, most confident first.
 *
 * Ties are broken by how much evidence backs the match, so a source recognised
 * by six fields outranks one recognised by two.
 */
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

/** The single best guess, or null when nothing fits. */
export function bestMatch(fields: string[], options: ClassifyOptions = {}): Classification | null {
  return classifyStream(fields, options)[0] ?? null;
}

/**
 * Whether a stream is worth putting in front of a security analyst.
 *
 * Telemetry-only sources (container stdout, application logs) still classify, so
 * their events can be read in the same columns, but they are not security
 * sources and should not be presented as though they were.
 */
export function isSecuritySource(classification: Classification | null): boolean {
  if (!classification) return false;
  return !classification.source.telemetryOnly && classification.confidence >= 0.35;
}
