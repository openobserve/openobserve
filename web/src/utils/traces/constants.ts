// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Maps OTEL numeric span kind IDs to human-readable display names.
 * Reference: https://opentelemetry.io/docs/specs/otel/trace/api/#spankind
 */
export const SPAN_KIND_MAP: Record<string, string> = {
  "0": "Unspecified",
  "1": "Internal",
  "2": "Server",
  "3": "Client",
  "4": "Producer",
  "5": "Consumer",
};

/**
 * Reverse of SPAN_KIND_MAP — maps lowercase display labels back to numeric keys.
 * Keys are stored lowercased so lookups can be done case-insensitively.
 */
export const SPAN_KIND_LABEL_TO_KEY: Record<string, string> =
  Object.fromEntries(
    Object.entries(SPAN_KIND_MAP).map(([key, label]) => [
      label.toLowerCase(),
      key,
    ]),
  );

/**
 * Replaces human-readable span_kind labels (e.g. `'Server'`, `'Client'`) in a
 * WHERE clause with their numeric OTEL key equivalents (e.g. `'2'`, `'3'`).
 *
 * This mirrors the duration-suffix replacement done by `parseDurationWhereClause`
 * and must be called before sending a filter to the backend.
 *
 * Examples:
 *   `span_kind='Server'`              →  `span_kind='2'`
 *   `span_kind!='client'`             →  `span_kind!='3'`
 *   `(span_kind='SERVER' or span_kind='internal')`  →  `(span_kind='2' or span_kind='1')`
 */
export const parseSpanKindWhereClause = (whereClause: string): string => {
  return whereClause.replace(
    /\bspan_kind\s*(!?=)\s*'([^']*)'/gi,
    (match, op: string, label: string) => {
      const key = SPAN_KIND_LABEL_TO_KEY[label.toLowerCase()];
      return key !== undefined ? `span_kind${op}'${key}'` : match;
    },
  );
};

/** OTEL span kind ID for UNSPECIFIED (0) */
export const SPAN_KIND_UNSPECIFIED = "0";

/** OTEL span kind ID for CLIENT (3) */
export const SPAN_KIND_CLIENT = "3";
