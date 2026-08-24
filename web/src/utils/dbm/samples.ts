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
 * samples.ts — pure logic behind the global Samples tab (FR-6).
 *
 * Kept out of the view so the row shaping and the two pivot refusals are unit
 * tested: a row without a trace id must not offer a trace to open, and a row
 * without a fingerprint must not open a detail page keyed on nothing — the
 * same refusal ActivityPage makes on its query hop.
 */

import type { SampleSpanRow } from "@/services/db_monitoring";

/** One row of the samples table, shaped for rendering and the two pivots. */
export interface DbmSampleRow {
  rowKey: string;
  /** Microseconds — when the call was recorded. */
  timestamp: number;
  /** Nanoseconds. `null` when the span carried no usable duration. */
  durationNs: number | null;
  /** The normalized statement, or the operation when no text survived. */
  queryText: string;
  fingerprint: string;
  traceId: string;
  dbSystem: string;
  dbInstance: string;
  dbNamespace: string;
  env: string;
  serviceName: string;
  isError: boolean;
  statusCode: string;
  /** The trace stream this span was read from — both pivots need it. */
  traceStreamName: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * API rows → table rows. Order is preserved — the server already returns
 * slowest-first, and re-sorting client-side would silently disagree with the
 * server's `truncated` claim about what the cut kept.
 */
export const buildSampleRows = (hits: SampleSpanRow[]): DbmSampleRow[] =>
  hits.map((hit, index) => {
    const duration = Number(hit.duration_ns);
    return {
      // Index-qualified: one trace can hold several DB spans, so the trace id
      // alone is not unique.
      rowKey: `${str(hit.trace_id) || "row"}-${index}`,
      timestamp: Number(hit._timestamp ?? 0),
      durationNs: Number.isFinite(duration) && duration >= 0 ? duration : null,
      queryText: str(hit.query_norm) || str(hit.operation),
      fingerprint: str(hit.fingerprint),
      traceId: str(hit.trace_id),
      dbSystem: str(hit.db_system),
      dbInstance: str(hit.db_instance),
      dbNamespace: str(hit.db_namespace),
      env: str(hit.env),
      serviceName: str(hit.service_name),
      isError: str(hit.span_status) === "ERROR",
      statusCode: str(hit.status_code),
      traceStreamName: str(hit.trace_stream_name),
    };
  });

/**
 * The query-detail pivot for one sample, or `null` when the row cannot support
 * it: no fingerprint means no detail page to key, and no stream means the
 * detail page's raw-span panels would 400 — refusing is better than opening a
 * page that half-loads.
 */
export const sampleQueryDetailTarget = (
  row: DbmSampleRow,
): { fingerprint: string; stream: string; system?: string; instance?: string } | null => {
  if (!row.fingerprint || !row.traceStreamName) return null;
  return {
    fingerprint: row.fingerprint,
    stream: row.traceStreamName,
    ...(row.dbSystem ? { system: row.dbSystem } : {}),
    ...(row.dbInstance ? { instance: row.dbInstance } : {}),
  };
};

/**
 * The traces-page filter expression for one sample, or `null` without a trace
 * id. Quote-escaped here so no caller can forget to.
 */
export const sampleTraceFilter = (row: DbmSampleRow): string | null => {
  if (!row.traceId || !row.traceStreamName) return null;
  return `trace_id = '${row.traceId.replace(/'/g, "''")}'`;
};
