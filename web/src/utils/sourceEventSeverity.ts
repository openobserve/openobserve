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
export function normalizeSeverity(
  raw: string | number | null | undefined,
): string | null {
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

/**
 * Pull the best-available severity field from a log row and normalize it.
 * Returns null when no field is set or all values are unrecognized.
 */
export function extractSeverity(
  row: Record<string, any> | null | undefined,
): string | null {
  if (!row) return null;
  const candidates = [
    row.severity_text,
    row.severityText,
    row.severity,
    row.level,
    row.loglevel,
    row.log_level,
    row.severity_number,
    row.severityNumber,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSeverity(candidate);
    if (normalized) return normalized;
  }
  return null;
}
