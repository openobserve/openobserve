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

import type { Freshness, QueryStatsRow } from "@/services/db_monitoring";
import { buildIncidentSummary, type IncidentSummaryInput } from "./incidentSummary";

const MS = 1_000_000;

const row = (over: Partial<QueryStatsRow> = {}): QueryStatsRow => ({
  fingerprint: "abc123",
  db_system: "postgresql",
  db_instance: "orders-db",
  query_norm: "SELECT * FROM orders WHERE id = ?",
  calls: 1200,
  errors: 4,
  p95_ns: 250 * MS,
  total_time_ns: 90_000 * MS,
  ...over,
});

const freshness = (over: Partial<Freshness> = {}): Freshness => ({
  data_through: 1_700_000_000_000_000,
  live_tail: true,
  tail_covers_from: null,
  tail_through: null,
  tail_truncated: false,
  percentiles_estimated: false,
  traces_upper_bound: true,
  ...over,
});

const input = (over: Partial<IncidentSummaryInput> = {}): IncidentSummaryInput => ({
  row: row(),
  window: { startTime: 1_700_000_000_000_000, endTime: 1_700_003_600_000_000 },
  ...over,
});

describe("buildIncidentSummary", () => {
  it("leads with the engine, instance and the statement", () => {
    const summary = buildIncidentSummary(input());
    expect(summary).toContain("**Database query — postgresql on orders-db**");
    expect(summary).toContain("SELECT * FROM orders WHERE id = ?");
    expect(summary).toContain("```sql");
  });

  /** "Last hour" pasted into a channel is unreadable an hour later. */
  it("states the window absolutely, not relatively", () => {
    const summary = buildIncidentSummary(input());
    expect(summary).toContain("2023-11-14T22:13:20.000Z");
    expect(summary).not.toMatch(/last \d+ ?m/i);
  });

  it("includes the metrics that exist", () => {
    const summary = buildIncidentSummary(input());
    expect(summary).toContain("**p95:**");
    expect(summary).toContain("**Calls:** 1,200");
    expect(summary).toContain("**Errors:** 4");
  });

  /**
   * A summary is quoted in an incident review weeks later. A metric the rollup
   * never emitted must be absent, because an invented 0 becomes evidence.
   */
  it("omits a metric that was never emitted rather than printing zero", () => {
    const summary = buildIncidentSummary(
      input({ row: row({ p95_ns: undefined, errors: undefined }) }),
    );
    expect(summary).not.toContain("**p95:**");
    expect(summary).not.toContain("**Errors:**");
    expect(summary).toContain("**Calls:**");
  });

  it("renders a delta against the previous window", () => {
    const summary = buildIncidentSummary(
      input({ p95Delta: { state: "changed", current: 250 * MS, previous: 100 * MS, ratio: 1.5 } }),
    );
    expect(summary).toContain("+150% vs previous window");
  });

  /**
   * "First seen" and "rose by 100%" are different claims and only one is true.
   * This is the same trap the Δ column guards against, in prose form.
   */
  it("renders an arrival as first-seen, never as +100%", () => {
    const summary = buildIncidentSummary(input({ p95Delta: { state: "new", current: 250 * MS } }));
    expect(summary).toContain("first seen in this window");
    expect(summary).not.toContain("100%");
  });

  it("lists top calling endpoints and names an unattributed caller", () => {
    const summary = buildIncidentSummary(
      input({
        endpoints: [
          {
            service_name: "checkout",
            endpoint: "POST /cart",
            calls: 900,
            errors: 0,
            total_time_ns: 1,
            p95_ns: 1,
            traces: 5,
          },
          {
            service_name: null,
            endpoint: null,
            calls: 20,
            errors: 0,
            total_time_ns: 1,
            p95_ns: 1,
            traces: 1,
          },
        ],
      }),
    );
    expect(summary).toContain("checkout POST /cart — 900 calls");
    expect(summary).toContain("unattributed — 20 calls");
  });

  it("lists error codes when there are any", () => {
    const summary = buildIncidentSummary(
      input({ errorClasses: [{ status_code: "57014", errors: 12 }] }),
    );
    expect(summary).toContain("`57014` — 12");
  });

  it("drops error classes with no errors", () => {
    const summary = buildIncidentSummary(
      input({ errorClasses: [{ status_code: "unknown", errors: 0 }] }),
    );
    expect(summary).not.toContain("unknown");
  });

  /**
   * The message outlives the page it came from, so a caveat that is not in the
   * text is a caveat the reader will never recover.
   */
  it("always carries the completion-bias caveat", () => {
    const summary = buildIncidentSummary(input());
    expect(summary).toContain("**What this does not show**");
    expect(summary).toContain("blocked on a lock");
  });

  it("discloses estimated percentiles when the response said so", () => {
    const summary = buildIncidentSummary(
      input({ freshness: freshness({ percentiles_estimated: true }) }),
    );
    expect(summary).toContain("estimates, not true quantiles");
  });

  it("discloses a genuine coverage gap", () => {
    const summary = buildIncidentSummary(
      input({
        freshness: freshness({
          data_through: 1_700_000_000_000_000,
          tail_covers_from: 1_700_000_900_000_000,
        }),
      }),
    );
    expect(summary).toContain("Coverage gap");
  });

  it("prefers the subset caveat over an _other share when the scope is a subset", () => {
    const summary = buildIncidentSummary(input({ topNSubset: true, otherShare: 0.2 }));
    expect(summary).toContain("do not reconcile");
    expect(summary).not.toContain("below the top-N cut");
  });

  it("quantifies the _other share when the scope reconciles", () => {
    const summary = buildIncidentSummary(input({ otherShare: 0.19 }));
    expect(summary).toContain("19.0% of database time");
  });

  it("shortens an oversized statement and says it did", () => {
    const summary = buildIncidentSummary(
      input({ row: row({ query_norm: `SELECT ${"a".repeat(500)}` }) }),
    );
    expect(summary).toContain("…");
    expect(summary).toContain("Statement shortened");
  });

  it("falls back to the fingerprint when the text was never stored", () => {
    const summary = buildIncidentSummary(input({ row: row({ query_norm: undefined }) }));
    expect(summary).toContain("abc123");
  });

  it("appends a permalink when one is supplied", () => {
    const summary = buildIncidentSummary(input({ permalink: "https://o2.example/dbm?fp=abc123" }));
    expect(summary).toContain("[Open in Database Monitoring](https://o2.example/dbm?fp=abc123)");
  });
});
