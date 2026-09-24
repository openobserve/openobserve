// Copyright 2026 OpenObserve Inc.
//
// outcome.ts — "did this event fail?", as SQL and as a check on real values.
//
// The word lists mirror `toOcsfStatus` in ocsf.ts (a spec keeps them in step),
// so a row counted as failed here is the row the Events table shows as
// "Failure". Numeric HTTP-style codes follow the same rule: 4xx/5xx failed.
//
// A column is only trusted as an outcome once its actual values have been
// looked at: a gRPC code, a k8s status object or a free-text phrase would
// otherwise produce "0 failures" that is not a fact but a failure to read.

import { toOcsfStatus } from "./ocsf";

export const OUTCOME_FAILURE_WORDS = [
  "failure",
  "failed",
  "fail",
  "deny",
  "denied",
  "denied_by_policy",
  "block",
  "blocked",
  "drop",
  "dropped",
  "error",
  "reject",
  "rejected",
  "false",
  "invalid",
];

/** Windows Security logs spell the keyword as a phrase. */
const EXTRA_FAILURE_PHRASES = ["audit failure"];
const EXTRA_SUCCESS_PHRASES = ["audit success"];

/** 1 = success, 2 = failure, 99 = a value this cannot interpret, 0 = empty. */
export function classifyOutcome(value: unknown): number {
  const word = String(value ?? "")
    .trim()
    .toLowerCase();
  if (EXTRA_FAILURE_PHRASES.includes(word)) return 2;
  if (EXTRA_SUCCESS_PHRASES.includes(word)) return 1;
  return toOcsfStatus(value);
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** SQL predicate: the outcome column says this event failed. */
export function failurePredicate(column: string): string {
  const text = `LOWER(TRIM(CAST(${quoteIdent(column)} AS VARCHAR)))`;
  const words = [...OUTCOME_FAILURE_WORDS, ...EXTRA_FAILURE_PHRASES].map(quoteString).join(", ");
  return (
    `(${text} IN (${words}) OR ` +
    `TRY_CAST(CAST(${quoteIdent(column)} AS VARCHAR) AS BIGINT) BETWEEN 400 AND 599)`
  );
}

/** Values → counts for the top values of a candidate outcome column. */
export function outcomeSampleSql(stream: string, column: string, limit = 50): string {
  return (
    `SELECT CAST(${quoteIdent(column)} AS VARCHAR) AS zo_value, COUNT(*) AS zo_n ` +
    `FROM ${quoteIdent(stream)} WHERE ${quoteIdent(column)} IS NOT NULL ` +
    `GROUP BY zo_value ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

/** Share of sampled rows that must read as success or failure to trust the column. */
export const OUTCOME_MIN_INTERPRETED = 0.98;

// Whether a column's values read as success/failure words or HTTP codes; anything
// mostly else (gRPC codes, phrases) leaves failures "unknown".
export function outcomeInterpretable(sample: { value: unknown; n: number }[]): boolean {
  let total = 0;
  let read = 0;
  for (const { value, n } of sample) {
    if (value === null || value === undefined || value === "") continue;
    total += n;
    const status = classifyOutcome(value);
    if (status === 1 || status === 2) read += n;
  }
  return total > 0 && read / total >= OUTCOME_MIN_INTERPRETED;
}
