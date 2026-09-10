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
  dbmHostScopeState,
  dbmHostSelector,
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

describe("section order", () => {
  it("leads with the host section — CPU/memory answer the first question load raises", () => {
    expect(DBM_METRIC_SECTIONS[0].key).toBe("host");
  });
});

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

describe("host panel defaults", () => {
  it("slices by HOST first — which machine is loaded is the section's first question", () => {
    for (const key of ["memoryUsage", "diskIo", "networkIo"]) {
      expect(panelDef("host", key).byDims[0]).toBe("host");
    }
  });
});

describe("dbmHostScopeState", () => {
  it("names a managed-database endpoint — there is no host to scrape, and a matcher would lie", () => {
    expect(dbmHostScopeState({ instance: "o2dev.cf0ost4wkmaj.us-east-2.rds.amazonaws.com" })).toBe(
      "managed",
    );
    expect(dbmHostScopeState({ instance: "mydb.database.azure.com:5432" })).toBe("managed");
    // A managed endpoint also yields no selector — never a doomed matcher.
    expect(dbmHostSelector({ instance: "x.rds.amazonaws.com" })).toBe("");
  });

  it("classifies the other scopes", () => {
    expect(dbmHostScopeState({})).toBe("unscoped");
    expect(dbmHostScopeState({ instance: "localhost:5432" })).toBe("loopback");
    expect(dbmHostScopeState({ instance: "db-1:5432" })).toBe("scoped");
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

describe("buildDbmSectionPanel — counter-rate panels (sql-rate)", () => {
  it("charts per-bucket call rates LAG-diffed from the cumulative counter", () => {
    const entry = buildDbmSectionPanel(panelDef("activity", "calls"), "query", {}, t);
    const q = entry.schema.queries[0].query;
    expect(entry.schema.queryType).toBe("sql");
    // Poll resolution: the 15-minute rollup charted 4 dots an hour.
    expect(entry.schema.queries[0].fields.stream).toBe("_o2_dbm_server");
    expect(q).toContain("o2_event_name = 'db.server.top_query'");
    expect(q).toContain("substr(o2_dbm_activity_query, 1, 60)");
    expect(q).toContain("MAX(o2_dbm_calls) AS cum");
    expect(q).toContain("LAG(cum) OVER (PARTITION BY segment ORDER BY ts)");
    // The receiver stamps metrics_are_delta on lifetime totals, so the flag
    // cannot gate this panel — the diff shape charts the feed either way.
    expect(q).not.toContain("metrics_are_delta");
    // A negative delta is a counter reset, not a measurement — dropped.
    expect(q).toContain("d >= 0");
    // Top-N discipline for the unbounded query dim: a WINDOW predicate, never
    // a LIMIT 10 subquery — the server lifts the result cap from ANY LIMIT in
    // the SQL text and would truncate the whole panel to 10 rows.
    expect(q).toContain("DENSE_RANK() OVER (ORDER BY span DESC, segment)");
    expect(q).toContain("rnk <= 10");
    expect(q).not.toContain("LIMIT 10)");
    expect(q).not.toContain("JOIN");
    expect(q).toMatch(/LIMIT 30000$/);
  });

  it("computes average duration as Δseconds × 1000 over Δcalls, zero-safe", () => {
    const q = buildDbmSectionPanel(panelDef("activity", "avgDuration"), "query", {}, t).schema
      .queries[0].query;
    expect(q).toContain("MAX(o2_dbm_exec_time_s) AS cum");
    expect(q).toContain("MAX(o2_dbm_calls) AS den");
    expect(q).toContain("d * 1000.0 / dd");
    // dd > 0 both drops call-counter resets and keeps the division zero-safe.
    expect(q).toContain("dd > 0");
  });

  it("the bounded database dim skips the top-N guard — a legend holds every segment", () => {
    const q = buildDbmSectionPanel(panelDef("activity", "calls"), "database", {}, t).schema
      .queries[0].query;
    expect(q).not.toContain("rnk <= 10");
    // Still needs the outer LIMIT: segments x buckets exceeds the search
    // API's 1000-row default cap on routine windows.
    expect(q).toMatch(/ORDER BY ts ASC LIMIT 30000$/);
  });

  it("splices the scope as server-vantage columns, quotes escaped", () => {
    const q = buildDbmSectionPanel(
      panelDef("activity", "calls"),
      "database",
      { system: "postgresql", instance: "db-1", namespace: "o'brien" },
      t,
    ).schema.queries[0].query;
    expect(q).toContain("o2_dbm_engine = 'postgresql'");
    expect(q).toContain("o2_dbm_instance = 'db-1'");
    expect(q).toContain("o2_dbm_database = 'o''brien'");
  });

  it("has no explorer handoff — the DBM stream is not a metrics stream", () => {
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
    expect(q).toContain("WHERE rnk <= 10");
    // Server samples land every poll (~1 min) — auto bucket width fits them.
    expect(q).not.toContain("'15 minute'");
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

const HOST_STREAMS = new Set([
  "system_cpu_time",
  "system_memory_usage",
  "system_disk_io",
  "system_network_io",
]);

describe("dbmHostSelector", () => {
  it("is empty when the scope names no instance", () => {
    expect(dbmHostSelector({})).toBe("");
    expect(dbmHostSelector({ system: "postgresql", namespace: "orders" })).toBe("");
  });

  it("is empty for a loopback instance — the collector swaps loopback for its own hostname", () => {
    for (const addr of [
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]:5432",
      "0.0.0.0",
      "localhost:3306",
    ]) {
      expect(dbmHostSelector({ instance: addr })).toBe("");
    }
  });

  it("matches the bare host and any FQDN suffix, with the port stripped", () => {
    expect(dbmHostSelector({ instance: "db-1:5432" })).toBe('host_name=~"db-1(\\\\..*)?"');
    expect(dbmHostSelector({ instance: "db-1" })).toBe('host_name=~"db-1(\\\\..*)?"');
  });

  it("escapes regex metacharacters in the host before building the pattern", () => {
    expect(dbmHostSelector({ instance: "db.internal" })).toBe(
      'host_name=~"db\\\\.internal(\\\\..*)?"',
    );
  });

  it("normalizes case the way the health column does", () => {
    expect(dbmHostSelector({ instance: "DB-1" })).toBe('host_name=~"db-1(\\\\..*)?"');
  });
});

describe("availableDbmSections — host section", () => {
  it("appears when a hostmetrics stream exists in the ALL-streams set", () => {
    const keys = availableDbmSections(PG_STREAMS, HOST_STREAMS).map((s) => s.key);
    expect(keys).toContain("host");
    // Host leads: CPU/memory answer the first question the load chart raises.
    expect(keys[0]).toBe("host");
  });

  it("is unaffected by the engine-scoped DB set — an empty DB scope still shows hosts", () => {
    const keys = availableDbmSections(new Set(), HOST_STREAMS).map((s) => s.key);
    expect(keys).toContain("host");
  });

  it("stays hidden when no hostmetrics streams exist anywhere", () => {
    expect(availableDbmSections(PG_STREAMS, PG_STREAMS).map((s) => s.key)).not.toContain("host");
    expect(availableDbmSections(PG_STREAMS).map((s) => s.key)).not.toContain("host");
  });

  it("falls back to the DB set when no ALL-streams set is given", () => {
    const keys = availableDbmSections(new Set(["system_cpu_time"])).map((s) => s.key);
    expect(keys).toContain("host");
  });

  it("keeps only the host panels whose stream exists", () => {
    const host = availableDbmSections(
      new Set(),
      new Set(["system_cpu_time", "system_disk_io"]),
    ).find((s) => s.key === "host")!;
    expect(host.panels.map((p) => p.key)).toEqual(["cpuUtilization", "diskIo"]);
  });

  it("other sections still check the engine-scoped DB set, never the ALL set", () => {
    const keys = availableDbmSections(new Set(), new Set([...PG_STREAMS])).map((s) => s.key);
    expect(keys).not.toContain("locks");
  });
});

describe("buildDbmSectionPanel — host panels", () => {
  it("composes CPU utilization as the idle-time complement, in percent", () => {
    const entry = buildDbmSectionPanel(panelDef("host", "cpuUtilization"), "host", {}, t);
    const q = entry.schema.queries[0].query;
    expect(q).toBe(
      "100 * (1 - " +
        'sum(rate(system_cpu_time{state="idle"}[$__rate_interval])) / ' +
        "sum(rate(system_cpu_time{}[$__rate_interval])))",
    );
    expect(entry.schema.config.unit).toBe("percent");
  });

  it("splices the host selector into BOTH cpu operands", () => {
    const q = buildDbmSectionPanel(
      panelDef("host", "cpuUtilization"),
      "host",
      {
        instance: "db-1",
      },
      t,
    ).schema.queries[0].query;
    expect(q).toContain('system_cpu_time{state="idle",host_name=~"db-1(\\\\..*)?"}');
    expect(q).toContain('/ sum(rate(system_cpu_time{host_name=~"db-1(\\\\..*)?"}');
  });

  it("leaves the cpu query unscoped for a loopback instance", () => {
    const q = buildDbmSectionPanel(
      panelDef("host", "cpuUtilization"),
      "host",
      {
        instance: "localhost:5432",
      },
      t,
    ).schema.queries[0].query;
    expect(q).not.toContain("host_name");
  });

  it("system/namespace scope never leaks into host streams", () => {
    const q = buildDbmSectionPanel(
      panelDef("host", "memoryUsage"),
      "state",
      {
        system: "postgresql",
        namespace: "orders",
      },
      t,
    ).schema.queries[0].query;
    expect(q).not.toContain("postgresql_database_name");
    expect(q).not.toContain("service_instance_id");
  });

  it("charts memory by state, adding host_name when unscoped so hosts stay distinguishable", () => {
    const entry = buildDbmSectionPanel(panelDef("host", "memoryUsage"), "state", {}, t);
    const q = entry.schema.queries[0].query;
    expect(q).toBe("sum by (state, host_name) (system_memory_usage{})");
    expect(entry.schema.queries[0].config.promql_legend).toBe("{host_name} {state}");
    expect(entry.schema.config.unit).toBe("bytes");
  });

  it("groups memory by state alone once a host selector applies", () => {
    const entry = buildDbmSectionPanel(
      panelDef("host", "memoryUsage"),
      "state",
      {
        instance: "db-1",
      },
      t,
    );
    const q = entry.schema.queries[0].query;
    expect(q).toContain("sum by (state) (system_memory_usage{host_name=~");
    expect(entry.schema.queries[0].config.promql_legend).toBe("{state}");
  });

  it("rates disk io by direction and re-slices by device", () => {
    const scoped = { instance: "db-1" };
    const byDir = buildDbmSectionPanel(panelDef("host", "diskIo"), "direction", scoped, t);
    expect(byDir.schema.queries[0].query).toContain(
      "sum by (direction) (rate(system_disk_io{host_name=~",
    );
    expect(byDir.schema.queries[0].query).toContain("[$__rate_interval])");
    expect(byDir.schema.config.unit).toBe("bps");
    const byDevice = buildDbmSectionPanel(panelDef("host", "diskIo"), "device", scoped, t);
    expect(byDevice.schema.queries[0].query).toContain("sum by (device) (rate(system_disk_io{");
  });

  it("network io mirrors disk io over system_network_io", () => {
    const q = buildDbmSectionPanel(
      panelDef("host", "networkIo"),
      "direction",
      {
        instance: "db-1",
      },
      t,
    ).schema.queries[0].query;
    expect(q).toContain("rate(system_network_io{host_name=~");
  });

  it("host panels carry the explorer handoff like every promql panel", () => {
    const entry = buildDbmSectionPanel(panelDef("host", "cpuUtilization"), "host", {}, t);
    expect(entry.explore).toEqual({
      stream: "system_cpu_time",
      query: entry.schema.queries[0].query,
    });
  });
});
