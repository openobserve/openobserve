// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { resolveSeverityFieldValue, type KnownLogSeverityLevel } from "@/utils/logs/statusParser";

// [row key, field whose tier rules apply]; camel-case aliases come from SQL projections and dashboards.
const SOURCE_EVENT_SEVERITY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["severity_text", "severity_text"],
  ["severityText", "severity_text"],
  ["severity", "severity"],
  ["level", "level"],
  ["loglevel", "loglevel"],
  ["log_level", "log_level"],
  ["severity_number", "severity_number"],
  ["severityNumber", "severity_number"],
];

const SOURCE_EVENT_VOCABULARY: Readonly<Record<KnownLogSeverityLevel, string>> = {
  emergency: "FATAL",
  alert: "FATAL",
  critical: "FATAL",
  error: "ERROR",
  warning: "WARN",
  notice: "WARN",
  info: "INFO",
  ok: "INFO",
  debug: "DEBUG",
  trace: "TRACE",
};

/**
 * Normalize a log row's severity into a human-readable label for the source
 * event banner.
 *
 * Accepts either a text label (`severity_text`, `level`, etc.) or an OTel
 * numeric severity_number (1-24). Returns `null` for unspecified (0) or
 * unrecognized values so the badge can be hidden rather than rendering a
 * raw number.
 *
 * OTel severity_number ranges (per the spec):
 *   1-4   → TRACE
 *   5-8   → DEBUG
 *   9-12  → INFO
 *   13-16 → WARN
 *   17-20 → ERROR
 *   21-24 → FATAL
 *   0     → unspecified
 */
export function normalizeSeverity(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === "") return null;

  // Numeric path — OTel severity_number.
  if (typeof raw === "number") {
    if (raw === 0) return null;
    if (raw >= 1 && raw <= 4) return "TRACE";
    if (raw >= 5 && raw <= 8) return "DEBUG";
    if (raw >= 9 && raw <= 12) return "INFO";
    if (raw >= 13 && raw <= 16) return "WARN";
    if (raw >= 17 && raw <= 20) return "ERROR";
    if (raw >= 21 && raw <= 24) return "FATAL";
    return null;
  }

  // String path — could be a label ("INFO") or a stringified number ("9").
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Stringified numbers — coerce and recurse.
  if (/^\d+$/.test(trimmed)) {
    return normalizeSeverity(parseInt(trimmed, 10));
  }

  const upper = trimmed.toUpperCase();
  // Accept any string containing a recognized severity keyword.
  for (const label of ["FATAL", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"]) {
    if (upper.includes(label)) return label;
  }
  return null;
}

/** Pull the best-available tier 1-2 severity field from a log row, in the correlation vocabulary. */
export function extractSeverity(row: Record<string, any> | null | undefined): string | null {
  if (!row) return null;
  for (const [alias, field] of SOURCE_EVENT_SEVERITY_FIELDS) {
    const resolved = resolveSeverityFieldValue(field, row[alias]);
    if (resolved) return SOURCE_EVENT_VOCABULARY[resolved.level];
  }
  return null;
}
