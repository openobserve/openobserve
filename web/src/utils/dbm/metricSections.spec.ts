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

import { raw, type TranslateFn } from "@/types/i18n";

import {
  availableDbmSections,
  buildDbmSectionPanel,
  catalogConsumedStreams,
  DBM_METRIC_SECTIONS,
} from "./metricSections";

/** Key-echoing stub — the assertions read the KEY, not real copy. */
const t = ((key: string, params?: Record<string, unknown>) =>
  raw(params ? `${key}|${JSON.stringify(params)}` : key)) as unknown as TranslateFn;

const PG_STREAMS = new Set([
  "postgresql_commits",
  "postgresql_rollbacks",
  "postgresql_operations",
  "postgresql_database_locks",
  "postgresql_wal_lag",
  "postgresql_rows",
]);

const panelDef = (sectionKey: string, panelKey: string) => {
  const section = DBM_METRIC_SECTIONS.find((s) => s.key === sectionKey)!;
  return section.panels.find((p) => p.key === panelKey)!;
};

describe("availableDbmSections", () => {
  it("shows a section only when at least one of its panels has data to read", () => {
    const sections = availableDbmSections(PG_STREAMS);
    const keys = sections.map((s) => s.key);
    expect(keys).toContain("activity");
    expect(keys).toContain("locks");
    expect(keys).toContain("replication");
    expect(keys).toContain("vacuum");
    // No index streams in this org — the whole section stays hidden.
    expect(keys).not.toContain("indexes");
  });

  it("keeps activity and blocks even with NO metric streams — their panels read DBM streams", () => {
    const keys = availableDbmSections(new Set()).map((s) => s.key);
    expect(keys).toContain("activity");
    expect(keys).toContain("blocks");
    expect(keys).not.toContain("locks");
  });

  it("drops promql panels whose stream is absent while keeping the section's others", () => {
    const activity = availableDbmSections(new Set()).find((s) => s.key === "activity")!;
    const panelKeys = activity.panels.map((p) => p.key);
    expect(panelKeys).toContain("calls");
    expect(panelKeys).not.toContain("commits");
  });
});

describe("catalogConsumedStreams", () => {
  it("names the metric streams the catalog charts, so the remainder grid can skip them", () => {
    const consumed = catalogConsumedStreams(PG_STREAMS);
    expect(consumed.has("postgresql_commits")).toBe(true);
    expect(consumed.has("postgresql_database_locks")).toBe(true);
    // Absent stream → its panel is absent → nothing consumed.
    expect(consumed.has("postgresql_index_scans")).toBe(false);
  });
});

describe("buildDbmSectionPanel — promql panels", () => {
  it("rates a counter and groups by the default dimension", () => {
    const entry = buildDbmSectionPanel(panelDef("activity", "commits"), "database", {}, t);
    const q = entry.schema.queries[0].query;
    expect(q).toContain("rate(postgresql_commits{");
    expect(q).toContain("sum by (postgresql_database_name)");
    expect(entry.schema.queryType).toBe("promql");
  });

  it("charts a gauge without rating and re-slices when the dimension changes", () => {
    const byMode = buildDbmSectionPanel(panelDef("locks", "locks"), "mode", {}, t);
    expect(byMode.schema.queries[0].query).toContain("sum by (mode) (postgresql_database_locks{");
    expect(byMode.schema.queries[0].query).not.toContain("rate(");
    const byTable = buildDbmSectionPanel(panelDef("locks", "locks"), "table", {}, t);
    expect(byTable.schema.queries[0].query).toContain("sum by (postgresql_table_name)");
  });

  it("splices the scope selector into the promql", () => {
    const entry = buildDbmSectionPanel(
      panelDef("activity", "commits"),
      "database",
      { instance: "db-1", namespace: "orders" },
      t,
    );
    const q = entry.schema.queries[0].query;
    expect(q).toContain("service_instance_id=~");
    expect(q).toContain('postgresql_database_name="orders"');
  });

  it("carries an explorer handoff — stream plus raw query", () => {
    const entry = buildDbmSectionPanel(panelDef("activity", "commits"), "database", {}, t);
    expect(entry.explore).toEqual({
      stream: "postgresql_commits",
      query: entry.schema.queries[0].query,
    });
  });
});

describe("buildDbmSectionPanel — query-rollup panels (sql-stats)", () => {
  it("charts calls from the rollup, sliced by normalized query text", () => {
    const entry = buildDbmSectionPanel(panelDef("activity", "calls"), "query", {}, t);
    const q = entry.schema.queries[0].query;
    expect(entry.schema.queryType).toBe("sql");
    expect(entry.schema.queries[0].fields.stream).toBe("_o2_db_stats");
    expect(q).toContain("record_type = 'query_stats'");
    expect(q).toContain("substr(query_norm, 1, 60)");
    expect(q).toContain("SUM(calls)");
    // GROUP BY repeats the expression — alias grouping fails planning.
    expect(q).toMatch(/GROUP BY ts, COALESCE\(substr\(query_norm, 1, 60\)/);
  });

  it("computes average duration in milliseconds with a zero-safe denominator", () => {
    const q = buildDbmSectionPanel(panelDef("activity", "avgDuration"), "query", {}, t).schema
      .queries[0].query;
    expect(q).toContain("SUM(total_time_ns)");
    expect(q).toContain("NULLIF(SUM(calls), 0)");
    expect(q).toContain("1000000");
  });

  it("splices the scope as rollup columns, quotes escaped", () => {
    const q = buildDbmSectionPanel(
      panelDef("activity", "calls"),
      "database",
      { system: "postgresql", instance: "db-1", namespace: "o'brien" },
      t,
    ).schema.queries[0].query;
    expect(q).toContain("db_system = 'postgresql'");
    expect(q).toContain("db_instance = 'db-1'");
    expect(q).toContain("db_namespace = 'o''brien'");
  });

  it("has no explorer handoff — the rollup is not a metrics stream", () => {
    const entry = buildDbmSectionPanel(panelDef("activity", "calls"), "query", {}, t);
    expect(entry.explore).toBeUndefined();
  });
});

describe("buildDbmSectionPanel — server-counter panels (sql-server)", () => {
  it("charts shared block hits from top_query samples, delta rows only", () => {
    const entry = buildDbmSectionPanel(panelDef("blocks", "blksHit"), "query", {}, t);
    const q = entry.schema.queries[0].query;
    expect(entry.schema.queries[0].fields.stream).toBe("_o2_dbm_server");
    expect(q).toContain("o2_event_name = 'db.server.top_query'");
    // Cumulative counters summed per bucket double-count; only deltas chart.
    expect(q).toContain("COALESCE(o2_dbm_metrics_are_delta, true) = true");
    expect(q).toContain("SUM(o2_dbm_shared_blks_hit)");
    // The text column top_query rows populate — query_shape is never ingested
    // and a missing column is a hard DataFusion schema error.
    expect(q).toContain("substr(o2_dbm_activity_query, 1, 60)");
    expect(q).not.toContain("o2_dbm_query_shape");
  });

  it("splices the scope as server-vantage columns", () => {
    const q = buildDbmSectionPanel(
      panelDef("blocks", "blksRead"),
      "database",
      { system: "postgresql", namespace: "orders" },
      t,
    ).schema.queries[0].query;
    expect(q).toContain("o2_dbm_engine = 'postgresql'");
    expect(q).toContain("o2_dbm_database = 'orders'");
    expect(q).toContain("SUM(o2_dbm_shared_blks_read)");
  });
});
