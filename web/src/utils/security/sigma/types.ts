// Copyright 2026 OpenObserve Inc.

/** Any subset may be set: `category: process_creation` alone runs on process telemetry from any product. */
export interface SigmaLogsource {
  category?: string;
  product?: string;
  service?: string;
  definition?: string;
}

/** Sigma's five severity words, in the order they escalate. */
export const SIGMA_LEVELS = ["informational", "low", "medium", "high", "critical"] as const;
export type SigmaLevel = (typeof SIGMA_LEVELS)[number];

/** `stable`/`test` are safe to run; `experimental` is noisy; `deprecated`/`unsupported` should not run. */
export type SigmaStatus = "stable" | "test" | "experimental" | "deprecated" | "unsupported";

/** A field-to-value map, a list of such maps (any may match), or bare strings to find anywhere in the event. */
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
  /** Always a list: Sigma allows several conditions, meaning "any of these". */
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
