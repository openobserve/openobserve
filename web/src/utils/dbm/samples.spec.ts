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

import { describe, expect, it } from "vitest";

import type { SampleSpanRow } from "@/services/db_monitoring";

import {
  buildSampleRows,
  sampleQueryDetailTarget,
  sampleTraceFilter,
  type DbmSampleRow,
} from "./samples";

const hit = (overrides: Partial<SampleSpanRow> = {}): SampleSpanRow => ({
  _timestamp: 1_700_000_000_000_000,
  trace_id: "abc123",
  duration_ns: 2_000_000_000,
  fingerprint: "deadbeef",
  query_norm: "SELECT * FROM orders WHERE id = ?",
  db_system: "postgresql",
  db_instance: "db-1",
  db_namespace: "shop",
  service_name: "cart",
  span_status: "OK",
  status_code: "",
  trace_stream_name: "otel_demo",
  ...overrides,
});

const row = (overrides: Partial<SampleSpanRow> = {}): DbmSampleRow =>
  buildSampleRows([hit(overrides)])[0];

describe("buildSampleRows", () => {
  it("preserves the server's slowest-first order rather than re-sorting", () => {
    // The server's `truncated` claim is about ITS cut; a client re-sort could
    // silently disagree with what the cut kept.
    const rows = buildSampleRows([
      hit({ trace_id: "slow", duration_ns: 900 }),
      hit({ trace_id: "fast", duration_ns: 100 }),
    ]);
    expect(rows.map((r) => r.traceId)).toEqual(["slow", "fast"]);
  });

  it("index-qualifies the row key — one trace can hold several DB spans", () => {
    const rows = buildSampleRows([hit({ trace_id: "t1" }), hit({ trace_id: "t1" })]);
    expect(rows[0].rowKey).not.toBe(rows[1].rowKey);
  });

  it("flags errors from span_status alone", () => {
    expect(row({ span_status: "ERROR" }).isError).toBe(true);
    expect(row({ span_status: "OK" }).isError).toBe(false);
    expect(row({ span_status: undefined }).isError).toBe(false);
  });

  it("falls back to the operation when no normalized text survived", () => {
    // A degraded span (unknown dialect) carries no query_norm; the operation
    // is what remains. Never the raw statement — the server never sends one.
    expect(row({ query_norm: undefined, operation: "SELECT orders" }).queryText).toBe(
      "SELECT orders",
    );
    expect(row({ query_norm: "SELECT ?" }).queryText).toBe("SELECT ?");
  });

  it("keeps a missing duration null rather than inventing 0ns", () => {
    // A 0ns duration would render as the FASTEST call on a page about the
    // slowest ones; null renders as "not measured".
    expect(row({ duration_ns: undefined }).durationNs).toBeNull();
    expect(row({ duration_ns: -5 }).durationNs).toBeNull();
    expect(row({ duration_ns: 42 }).durationNs).toBe(42);
  });
});

describe("sampleQueryDetailTarget", () => {
  it("routes to the detail page keyed on fingerprint + stream", () => {
    expect(sampleQueryDetailTarget(row())).toEqual({
      fingerprint: "deadbeef",
      stream: "otel_demo",
      system: "postgresql",
      instance: "db-1",
    });
  });

  it("refuses without a fingerprint — no detail page to key", () => {
    expect(sampleQueryDetailTarget(row({ fingerprint: undefined }))).toBeNull();
  });

  it("refuses without a stream — the detail page's raw-span panels would 400", () => {
    expect(sampleQueryDetailTarget(row({ trace_stream_name: undefined }))).toBeNull();
  });

  it("omits empty dimensions rather than sending empty strings", () => {
    const target = sampleQueryDetailTarget(row({ db_system: undefined, db_instance: undefined }));
    expect(target).toEqual({ fingerprint: "deadbeef", stream: "otel_demo" });
  });
});

describe("sampleTraceFilter", () => {
  it("builds the traces-page filter with the id quote-escaped", () => {
    expect(sampleTraceFilter(row({ trace_id: "a'b" }))).toBe("trace_id = 'a''b'");
  });

  it("refuses without a trace id or a stream to open it in", () => {
    expect(sampleTraceFilter(row({ trace_id: undefined }))).toBeNull();
    expect(sampleTraceFilter(row({ trace_stream_name: undefined }))).toBeNull();
  });
});
