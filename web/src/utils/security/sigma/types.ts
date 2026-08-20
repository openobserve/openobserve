// Copyright 2026 OpenObserve Inc.
//
// types.ts — the Sigma rule model, as this codebase understands it.
//
// Sigma (https://sigmahq.io) is the portable detection format: a rule states
// what to look for in vendor-neutral terms, and a backend compiles it to
// whatever query language the data actually lives in. That indirection is the
// whole point, and it is why a SIEM can ship thousands of detections without
// knowing anything about the customer's log pipeline.
//
// The model here is the v2 specification's structure, not a superset. Fields
// that exist in the spec but change nothing about how a rule runs (`author`,
// `references`, `date`) are carried through untouched so the UI can show them,
// while everything that affects matching is typed.

/**
 * The logsource triple. A rule declares which kind of log it was written
 * against, and it may set any subset: a rule with only `category:
 * process_creation` runs against process telemetry from any product.
 */
export interface SigmaLogsource {
  category?: string;
  product?: string;
  service?: string;
  definition?: string;
}

/** Sigma's five severity words, in the order they escalate. */
export const SIGMA_LEVELS = ["informational", "low", "medium", "high", "critical"] as const;
export type SigmaLevel = (typeof SIGMA_LEVELS)[number];

/**
 * Rule lifecycle. `stable` and `test` are safe to run; `experimental` is
 * expected to be noisy, and `deprecated`/`unsupported` should not run at all.
 */
export type SigmaStatus = "stable" | "test" | "experimental" | "deprecated" | "unsupported";

/**
 * One search identifier's body: a map of field-to-value, a list of such maps
 * (any of which may match), or a list of bare strings to look for anywhere in
 * the event.
 */
export type SigmaSearch = Record<string, unknown> | Record<string, unknown>[] | (string | number)[];

export interface SigmaRule {
  id?: string;
  title: string;
  description?: string;
  status?: SigmaStatus;
  author?: string;
  date?: string;
  modified?: string;
  references?: string[];
  logsource: SigmaLogsource;
  /** Search identifiers, keyed by the names the condition refers to. */
  searches: Record<string, SigmaSearch>;
  /**
   * The condition expression(s). Sigma allows a list here, which means "any of
   * these", so it is always stored as a list even when the YAML had one string.
   */
  condition: string[];
  /** Field names to group by when reporting, informational only. */
  fields?: string[];
  falsepositives?: string[];
  level?: SigmaLevel;
  tags?: string[];
  /** MITRE ATT&CK technique ids parsed out of `tags`, e.g. `T1078.004`. */
  techniques: string[];
  /** MITRE ATT&CK tactic names parsed out of `tags`, e.g. `credential_access`. */
  tactics: string[];
  /** The rule as written, kept verbatim so it can be shown and round-tripped. */
  yaml: string;
}

/** A rule that failed to parse, with the reason, so it can be surfaced not swallowed. */
export interface SigmaParseError {
  message: string;
  /** The text that was handed in, so a bad rule can still be shown and fixed. */
  yaml: string;
}

export type SigmaParseResult =
  { ok: true; rule: SigmaRule } | { ok: false; error: SigmaParseError };
