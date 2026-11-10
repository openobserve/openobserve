// Copyright 2026 OpenObserve Inc.

// Word lists mirror `toOcsfStatus` in ocsf.ts, so a row failed here shows as "Failure" in Events.

import { toOcsfStatus } from "./ocsf";
import { quoteIdent, quoteString } from "./sql";

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

/** A Windows NTSTATUS such as `0xC000006D`; `0x0` is success. */
const NTSTATUS = /^0x([0-9a-f]+)$/;

/** 1 = success, 2 = failure, 99 = a value this cannot interpret, 0 = empty. */
export function classifyOutcome(value: unknown): number {
  const word = String(value ?? "")
    .trim()
    .toLowerCase();
  if (EXTRA_FAILURE_PHRASES.includes(word)) return 2;
  if (EXTRA_SUCCESS_PHRASES.includes(word)) return 1;
  const ntstatus = NTSTATUS.exec(word);
  if (ntstatus) return /^0+$/.test(ntstatus[1]) ? 1 : 2;
  return toOcsfStatus(value);
}

export function failurePredicate(column: string): string {
  const text = `LOWER(TRIM(CAST(${quoteIdent(column)} AS VARCHAR)))`;
  const words = [...OUTCOME_FAILURE_WORDS, ...EXTRA_FAILURE_PHRASES].map(quoteString).join(", ");
  return (
    `(${text} IN (${words}) OR ` +
    `TRY_CAST(CAST(${quoteIdent(column)} AS VARCHAR) AS BIGINT) BETWEEN 400 AND 599)`
  );
}

export function outcomeSampleSql(stream: string, column: string, limit = 50): string {
  return (
    `SELECT CAST(${quoteIdent(column)} AS VARCHAR) AS zo_value, COUNT(*) AS zo_n ` +
    `FROM ${quoteIdent(stream)} WHERE ${quoteIdent(column)} IS NOT NULL ` +
    `GROUP BY zo_value ORDER BY zo_n DESC LIMIT ${limit}`
  );
}

/** The outcome sample reads only this recent slice, µs; its values, not its counts, matter. */
export const OUTCOME_SAMPLE_WINDOW_US = 3_600_000_000;

/** The [start, end] µs the outcome sample scans, never wider than the caller's window. */
export function outcomeSampleWindow(startUs: number, endUs: number): [number, number] {
  return [Math.max(startUs, endUs - OUTCOME_SAMPLE_WINDOW_US), endUs];
}

/** A stream quiet for the last hour is sampled over at most this much of the window, µs. */
export const OUTCOME_FALLBACK_WINDOW_US = 24 * 3_600_000_000;

/** The wider [start, end] µs tried when the last hour held no outcome values. */
export function outcomeFallbackWindow(startUs: number, endUs: number): [number, number] {
  return [Math.max(startUs, endUs - OUTCOME_FALLBACK_WINDOW_US), endUs];
}

/** Share of sampled rows that must read as success or failure to trust the column. */
export const OUTCOME_MIN_INTERPRETED = 0.98;

// Only success/failure words or HTTP codes count; mostly-other values (gRPC codes, phrases) stay "unknown".
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
