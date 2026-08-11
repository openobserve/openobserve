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

import type { DbTotalsRow } from "@/services/db_monitoring";

import {
  DBM_INSTANCE_METRICS,
  buildInstanceMetricsSql,
  cacheHitRatio,
  connectionSaturation,
  foldMetricRows,
  instanceIdentityKey,
  mergeInstanceMetrics,
  normalizeInstanceHost,
  receiverHostOf,
  unmatchedReason,
  type DbmMetricRole,
  type DbmMetricRow,
} from "./instanceMetrics";

const WINDOW = { startTime: 1_000_000, endTime: 2_000_000 };

const totalsRow = (overrides: Partial<DbTotalsRow> = {}): DbTotalsRow =>
  ({
    db_system: "postgresql",
    db_instance: "pgprod-1",
    calls: 10,
    ...overrides,
  }) as DbTotalsRow;

const metricRow = (overrides: Partial<DbmMetricRow> = {}): DbmMetricRow => ({
  _timestamp: WINDOW.startTime,
  value: 1,
  ...overrides,
});

const specFor = (role: DbmMetricRole, system: string) => {
  const spec = DBM_INSTANCE_METRICS.find((s) => s.role === role && s.system === system);
  if (!spec) throw new Error(`no spec for ${system}/${role}`);
  return spec;
};

// ── the metric catalog ───────────────────────────────────────────────────────
//
// The stream names are the sanitised metric names (`format_stream_name` maps
// every non `[A-Za-z0-9_:]` run to `_`), so a typo here reads an empty stream
// forever and renders as "the receiver is not running".

describe("DBM_INSTANCE_METRICS", () => {
  it("names each Postgres stream as the receiver's sanitised metric name", () => {
    const byRole = Object.fromEntries(
      DBM_INSTANCE_METRICS.filter((s) => s.system === "postgresql").map((s) => [s.role, s.stream]),
    );
    expect(byRole).toMatchObject({
      connections: "postgresql_backends",
      connectionLimit: "postgresql_connection_max",
      replicationLag: "postgresql_replication_data_delay",
      cacheHit: "postgresql_blks_hit",
      cacheRead: "postgresql_blks_read",
      deadlocks: "postgresql_deadlocks",
    });
  });

  it("names each MySQL stream as the receiver's sanitised metric name", () => {
    const byRole = Object.fromEntries(
      DBM_INSTANCE_METRICS.filter((s) => s.system === "mysql").map((s) => [s.role, s.stream]),
    );
    expect(byRole).toMatchObject({
      connections: "mysql_threads",
      replicationLag: "mysql_replica_time_behind_source",
    });
  });

  // MySQL publishes no max_connections: `mysql.connection.count` counts
  // ATTEMPTS and `mysql.max_used_connections` is a high-water mark. Carrying a
  // MySQL connectionLimit spec would put a fabricated denominator under a
  // saturation percentage.
  it("declares no MySQL connection limit, because the receiver publishes none", () => {
    const limits = DBM_INSTANCE_METRICS.filter(
      (s) => s.system === "mysql" && s.role === "connectionLimit",
    );
    expect(limits).toEqual([]);
  });

  // Four of these are `enabled: false` upstream, so they arrive only if the
  // user turned them on. The flag is what lets the UI distinguish "you did not
  // enable this" from "your database is unreachable".
  it("records which metrics the receiver enables by default", () => {
    const enabledByDefault = DBM_INSTANCE_METRICS.filter((s) => s.defaultEnabled).map(
      (s) => s.stream,
    );
    expect(enabledByDefault.sort()).toEqual(
      [
        "mysql_threads",
        "postgresql_backends",
        "postgresql_connection_max",
        "postgresql_replication_data_delay",
      ].sort(),
    );
  });

  // A monotonic counter's window figure is last-minus-first. Reading its raw
  // value would report every block hit since the server started.
  it("marks the monotonic counters as cumulative", () => {
    const cumulative = DBM_INSTANCE_METRICS.filter((s) => s.cumulative).map((s) => s.stream);
    expect(cumulative.sort()).toEqual(
      ["postgresql_blks_hit", "postgresql_blks_read", "postgresql_deadlocks"].sort(),
    );
  });

  it("carries no duplicate (system, role) pair", () => {
    const keys = DBM_INSTANCE_METRICS.map((s) => `${s.system}/${s.role}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Whether same-timestamp rows may be summed has to be catalog DATA, not a
  // rule hardcoded against today's role names — otherwise the next
  // instance-level gauge added is silently summed, and per the fold's own
  // comment that halves every saturation figure on the page.
  // How same-timestamp rows combine is catalog DATA, not a rule hardcoded
  // against today's role names. Three answers, because there are three real
  // shapes: a per-database counter sums, a per-instance gauge is one reading
  // repeated, and a per-replica lag takes the WORST — summing replicas reports
  // a lag no replica has.
  it("records how each metric's same-timestamp rows combine", () => {
    const byStream = Object.fromEntries(DBM_INSTANCE_METRICS.map((s) => [s.stream, s.aggregate]));
    expect(byStream).toEqual({
      postgresql_backends: "sum",
      postgresql_connection_max: "single",
      postgresql_replication_data_delay: "max",
      postgresql_blks_hit: "sum",
      postgresql_blks_read: "sum",
      postgresql_deadlocks: "sum",
      mysql_threads: "sum",
      mysql_replica_time_behind_source: "max",
    });
  });

  // Which column splits an instance's rows into series. Catalog data, so the
  // SQL projection is generated from the same source the fold groups on.
  it("records which column splits each metric into per-series rows", () => {
    const byStream = Object.fromEntries(
      DBM_INSTANCE_METRICS.map((s) => [s.stream, s.seriesColumns ?? []]),
    );
    expect(byStream).toEqual({
      postgresql_backends: ["db_namespace"],
      postgresql_connection_max: [],
      postgresql_replication_data_delay: ["replication_client"],
      postgresql_blks_hit: ["db_namespace"],
      postgresql_blks_read: ["db_namespace"],
      postgresql_deadlocks: ["db_namespace"],
      mysql_threads: [],
      mysql_replica_time_behind_source: [],
    });
  });

  // Both sides of the join are microsecond timestamps: `_timestamp` on a
  // metric row, and the DBM scope's own window. A builder that assumed
  // milliseconds would query 1970 and return nothing for every stream, which
  // renders as "the receiver is not running" — the silently-empty outcome.
  it("declares the identity column each engine actually publishes", () => {
    const byEngine = Object.fromEntries(
      DBM_INSTANCE_METRICS.map((s) => [s.system, s.identityColumn]),
    );
    expect(byEngine).toEqual({
      postgresql: "service_instance_id",
      mysql: "mysql_instance_endpoint",
    });
  });
});

// ── host normalisation ───────────────────────────────────────────────────────
//
// The client vantage records `server.address` with the port STRIPPED, while the
// receiver records the endpoint verbatim as `host:port`. Normalising both sides
// to a bare lowercase host is the only way the two can meet.

describe("normalizeInstanceHost", () => {
  it("strips the port the receiver carries and the client side does not", () => {
    expect(normalizeInstanceHost("postgres:5432")).toBe("postgres");
  });

  it("leaves a host that never had a port", () => {
    expect(normalizeInstanceHost("pgprod-1")).toBe("pgprod-1");
  });

  it("lowercases, so a DNS name cased differently on the two sides still joins", () => {
    expect(normalizeInstanceHost("PgProd-1.EXAMPLE.com:5432")).toBe("pgprod-1.example.com");
  });

  it("drops a fully-qualified name's trailing dot", () => {
    expect(normalizeInstanceHost("pgprod-1.example.com.")).toBe("pgprod-1.example.com");
  });

  it("unwraps a bracketed IPv6 host rather than reading its colons as a port", () => {
    expect(normalizeInstanceHost("[2001:db8::1]:5432")).toBe("2001:db8::1");
  });

  it("keeps a bare IPv6 host whole — its colons are address, not a port", () => {
    expect(normalizeInstanceHost("2001:db8::1")).toBe("2001:db8::1");
  });

  it("keeps a host whose last colon segment is not numeric", () => {
    expect(normalizeInstanceHost("pgprod:notaport")).toBe("pgprod:notaport");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeInstanceHost("  pgprod-1  ")).toBe("pgprod-1");
  });

  it("keeps the loopback literals verbatim, so the unmatched reason can recognise them", () => {
    expect(normalizeInstanceHost("LOCALHOST")).toBe("localhost");
    expect(normalizeInstanceHost("127.0.0.1:5432")).toBe("127.0.0.1");
  });

  it("returns null for an absent or blank host rather than an empty key", () => {
    expect(normalizeInstanceHost("")).toBeNull();
    expect(normalizeInstanceHost("   ")).toBeNull();
    expect(normalizeInstanceHost(null)).toBeNull();
    expect(normalizeInstanceHost(undefined)).toBeNull();
  });

  it("returns null for a bare port with no host", () => {
    expect(normalizeInstanceHost(":5432")).toBeNull();
  });
});

describe("instanceIdentityKey", () => {
  it("joins on system and host, so two engines on one host stay distinct", () => {
    const pg = instanceIdentityKey("postgresql", "db-1:5432");
    const my = instanceIdentityKey("mysql", "db-1:3306");
    expect(pg).not.toBe(my);
  });

  it("produces the same key from the client's port-less host and the receiver's endpoint", () => {
    expect(instanceIdentityKey("postgresql", "pgprod-1")).toBe(
      instanceIdentityKey("postgresql", "pgprod-1:5432"),
    );
  });

  it("normalises the system's case, since it comes from two different producers", () => {
    expect(instanceIdentityKey("PostgreSQL", "db-1")).toBe(
      instanceIdentityKey("postgresql", "db-1"),
    );
  });

  it("returns null when the host cannot be resolved, so nothing joins on emptiness", () => {
    expect(instanceIdentityKey("postgresql", "")).toBeNull();
    expect(instanceIdentityKey("postgresql", null)).toBeNull();
  });

  it("returns null when the system is missing", () => {
    expect(instanceIdentityKey("", "db-1")).toBeNull();
    expect(instanceIdentityKey(null, "db-1")).toBeNull();
  });
});

// ── receiver identity, which is engine-dependent ─────────────────────────────
//
// postgresqlreceiver writes the endpoint into `service.instance.id`; mysql
// writes a UUID v5 there and puts the endpoint in `mysql.instance.endpoint`.
// Reading one column for both engines silently joins nothing for MySQL.

describe("receiverHostOf", () => {
  it("reads the Postgres endpoint from service_instance_id", () => {
    expect(receiverHostOf(metricRow({ service_instance_id: "pgprod-1:5432" }), "postgresql")).toBe(
      "pgprod-1",
    );
  });

  it("reads the MySQL endpoint from mysql_instance_endpoint", () => {
    const row = metricRow({
      mysql_instance_endpoint: "myprod-1:3306",
      service_instance_id: "0b3e6f2a-8b5d-5f0e-9a1c-2d4e6f8a0b2c",
    });
    expect(receiverHostOf(row, "mysql")).toBe("myprod-1");
  });

  // The MySQL UUID is not an endpoint, and joining on it would match nothing
  // while looking like a populated key.
  it("never falls back to MySQL's service_instance_id UUID", () => {
    const row = metricRow({ service_instance_id: "0b3e6f2a-8b5d-5f0e-9a1c-2d4e6f8a0b2c" });
    expect(receiverHostOf(row, "mysql")).toBeNull();
  });

  it("returns null when the row carries no identity at all", () => {
    expect(receiverHostOf(metricRow(), "postgresql")).toBeNull();
  });

  it("returns null for an engine we do not read metrics for", () => {
    expect(receiverHostOf(metricRow({ service_instance_id: "x:1" }), "redis")).toBeNull();
  });
});

// ── SQL ──────────────────────────────────────────────────────────────────────

describe("buildInstanceMetricsSql", () => {
  // Asserted on the PROJECTION, not on the whole string: `_timestamp` and the
  // identity column also appear in the WHERE and ORDER BY, so a substring
  // check passes even when the SELECT list is missing the column the fold
  // reads — and the fold then sees `undefined` for every row.
  it("projects the timestamp, the value and the engine's identity column", () => {
    const sql = buildInstanceMetricsSql(specFor("connections", "postgresql"), WINDOW);
    const projection = sql.slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i));
    expect(projection).toContain("_timestamp");
    expect(projection).toContain("value");
    expect(projection).toContain("service_instance_id");
    expect(sql).toContain('FROM "postgresql_backends"');
  });

  it("selects MySQL's endpoint column, not the UUID one", () => {
    const sql = buildInstanceMetricsSql(specFor("connections", "mysql"), WINDOW);
    expect(sql).toContain("mysql_instance_endpoint");
    expect(sql).not.toContain("service_instance_id");
  });

  // `mysql.threads` reports four thread kinds on one stream; summing them
  // would count `created` (a lifetime total) alongside `connected`.
  it("filters mysql_threads to the connected kind, conjunctively", () => {
    const sql = buildInstanceMetricsSql(specFor("connections", "mysql"), WINDOW);
    expect(sql).toMatch(/AND\s+kind = 'connected'/i);
    expect(sql).not.toMatch(/\bOR\b/i);
    expect(sql).not.toMatch(/\bNOT\b/i);
  });

  // The fold splits an instance's rows by database or by replica, so those
  // columns have to survive the projection too. Without them every series
  // collapses into one, same-timestamp rows overwrite each other, and an
  // instance running 5 + 7 backends reports 7 — calm, at 70% of a limit it is
  // actually 20% over. Driven off the catalog so the two cannot drift.
  it("projects every column the fold groups series by", () => {
    for (const spec of DBM_INSTANCE_METRICS) {
      const sql = buildInstanceMetricsSql(spec, WINDOW);
      const projection = sql.slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i));
      for (const column of spec.seriesColumns ?? []) {
        expect(projection).toContain(column);
      }
    }
  });

  // The fold re-checks the filter on the row it is handed, so the column has
  // to survive the projection. Without it every MySQL row reads `undefined`,
  // fails its own filter, and MySQL instance health is blank forever — with
  // the SQL and the fold each correct in isolation.
  it("projects the column it filters on, so the fold can see it", () => {
    const spec = specFor("connections", "mysql");
    const sql = buildInstanceMetricsSql(spec, WINDOW);
    const projection = sql.slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i));
    expect(projection).toContain(spec.filter?.column);
  });

  // The search API caps the rows it returns. Ordered ASC that cap discards the
  // NEWEST readings, so "latest" silently becomes a value from early in the
  // window — a saturated instance reads as calm. Newest-first means the cap
  // costs the oldest history instead, which the strip can survive.
  it("orders newest first, so a row cap costs the oldest readings not the newest", () => {
    const sql = buildInstanceMetricsSql(specFor("connections", "postgresql"), WINDOW);
    expect(sql).toMatch(/ORDER BY\s+_timestamp\s+DESC/i);
  });

  // The window is passed to the search API as start_time/end_time; repeating it
  // inside the SQL is how the query stays correct if that ever changes. Both
  // bounds must constrain OPPOSITE sides — `>= start AND >= end` is a syntactically
  // fine query that silently returns only the window's last instant.
  it("bounds the query below by the window start and above by its end", () => {
    const sql = buildInstanceMetricsSql(specFor("connections", "postgresql"), WINDOW);
    expect(sql).toMatch(new RegExp(`_timestamp\\s*>=\\s*${WINDOW.startTime}\\b`));
    expect(sql).toMatch(new RegExp(`_timestamp\\s*<=\\s*${WINDOW.endTime}\\b`));
  });

  // Every spec must round-trip through one builder. A per-engine branch that
  // hardcoded two stream names would leave the other five reading nothing,
  // and the emptiness is indistinguishable from "the receiver is off".
  it("names each catalog entry's own stream and projects its identity column", () => {
    for (const spec of DBM_INSTANCE_METRICS) {
      const sql = buildInstanceMetricsSql(spec, WINDOW);
      const projection = sql.slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i));
      expect(sql).toContain(`FROM "${spec.stream}"`);
      expect(projection).toContain(spec.identityColumn);
      // Every stream is bounded and ordered, not just the two spot-checked above.
      expect(sql).toMatch(new RegExp(`_timestamp\\s*>=\\s*${WINDOW.startTime}\\b`));
      expect(sql).toMatch(new RegExp(`_timestamp\\s*<=\\s*${WINDOW.endTime}\\b`));
      expect(sql).toMatch(/ORDER BY\s+_timestamp\s+DESC/i);
    }
  });

  // The stream name is interpolated as a table name and can never be escaped
  // as a literal, so the builder must refuse anything that is not an
  // identifier rather than emit it — the rule QueryDetailPage already follows.
  it("refuses a stream name that is not a plain identifier", () => {
    const hostile = {
      ...specFor("connections", "postgresql"),
      stream: 'x" ; DROP TABLE users --',
    };
    expect(() => buildInstanceMetricsSql(hostile, WINDOW)).toThrow(/stream/i);
  });

  it("refuses a non-finite window bound rather than interpolating NaN", () => {
    expect(() =>
      buildInstanceMetricsSql(specFor("connections", "postgresql"), {
        startTime: Number.NaN,
        endTime: WINDOW.endTime,
      }),
    ).toThrow(/window/i);
  });
});

// ── folding rows into a per-instance series ──────────────────────────────────

describe("foldMetricRows", () => {
  const spec = () => specFor("connections", "postgresql");

  it("groups by instance identity, so two instances do not average together", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 10, _timestamp: 1 }),
        metricRow({ service_instance_id: "b:5432", value: 90, _timestamp: 1 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(10);
    expect(folded.get("postgresql|b")?.latest).toBe(90);
  });

  it("takes the LATEST value as current, not the first", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 10, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 42, _timestamp: 2 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(42);
  });

  it("reads the latest by timestamp even when rows arrive out of order", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 42, _timestamp: 2 }),
        metricRow({ service_instance_id: "a:5432", value: 10, _timestamp: 1 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(42);
  });

  it("keeps the series in time order for the sparkline", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 3, _timestamp: 3 }),
        metricRow({ service_instance_id: "a:5432", value: 1, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 2, _timestamp: 2 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.series).toEqual([1, 2, 3]);
  });

  // A bare value array cannot be overlaid on a latency chart: three points
  // spread over an hour and three points inside one minute draw the same
  // sparkline, so the strip would misplace exactly the spike it exists to
  // correlate. The timestamps ride along for that.
  it("carries each point's timestamp, so the strip can be aligned to a latency axis", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 3, _timestamp: 3_000 }),
        metricRow({ service_instance_id: "a:5432", value: 1, _timestamp: 1_000 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.points).toEqual([
      { timestamp: 1_000, value: 1 },
      { timestamp: 3_000, value: 3 },
    ]);
  });

  // A cumulative counter that reads 5,000,000 has not had five million hits in
  // this window — it has had them since the server started.
  it("reports a cumulative counter as its window delta, not its raw total", () => {
    const cum = specFor("cacheHit", "postgresql");
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 5_000_000, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 5_000_120, _timestamp: 2 }),
      ],
      cum,
    );
    expect(folded.get("postgresql|a")?.latest).toBe(120);
  });

  // A restart resets the counter, so last-minus-first goes negative and would
  // render a negative cache-hit count.
  it("treats a counter reset as the post-reset value rather than a negative delta", () => {
    const cum = specFor("cacheHit", "postgresql");
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 5_000_000, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 40, _timestamp: 2 }),
      ],
      cum,
    );
    expect(folded.get("postgresql|a")?.latest).toBe(40);
  });

  // One sample cannot be differenced, so the window's figure is UNKNOWN — not
  // zero. Zero is a positive claim: rendered on the deadlock counter it reads
  // as "no deadlocks", which is the opposite of "we could not tell", and a user
  // who just enabled the metric sees a green all-clear built on one scrape.
  it("reports a single cumulative sample as unknown, never as a zero delta", () => {
    const cum = specFor("cacheHit", "postgresql");
    const folded = foldMetricRows(
      [metricRow({ service_instance_id: "a:5432", value: 5_000_000, _timestamp: 1 })],
      cum,
    );
    expect(folded.get("postgresql|a")?.latest).toBeNull();
  });

  // Several Postgres metrics carry `db.namespace`, so one instance emits one
  // row per database each scrape. Ignoring that reads only one database's
  // backends and calls it the instance's.
  it("sums same-timestamp rows an instance emits per database", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 4, _timestamp: 1, db_namespace: "app" }),
        metricRow({ service_instance_id: "a:5432", value: 6, _timestamp: 1, db_namespace: "jobs" }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(10);
  });

  // A cumulative counter must be differenced PER SERIES and the deltas summed,
  // never summed and then differenced. A database that comes into view partway
  // through the window brings its whole since-boot total with it, and the
  // sum-then-difference order reads that arrival as activity: here, 900
  // deadlocks on an instance that had none, complete with a red chip.
  it("does not read a database appearing mid-window as a burst of activity", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 5, _timestamp: 1, db_namespace: "app" }),
        metricRow({ service_instance_id: "a:5432", value: 5, _timestamp: 2, db_namespace: "app" }),
        metricRow({
          service_instance_id: "a:5432",
          value: 900,
          _timestamp: 2,
          db_namespace: "newdb",
        }),
      ],
      specFor("deadlocks", "postgresql"),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(0);
  });

  // The mirror image: a database dropping out must not read as a counter reset
  // and report a number that is neither a delta nor a total.
  it("does not read a database dropping out mid-window as a counter reset", () => {
    const folded = foldMetricRows(
      [
        metricRow({
          service_instance_id: "a:5432",
          value: 1000,
          _timestamp: 1,
          db_namespace: "app",
        }),
        metricRow({
          service_instance_id: "a:5432",
          value: 5000,
          _timestamp: 1,
          db_namespace: "jobs",
        }),
        metricRow({
          service_instance_id: "a:5432",
          value: 1100,
          _timestamp: 2,
          db_namespace: "app",
        }),
      ],
      specFor("cacheHit", "postgresql"),
    );
    // Only `app` spans the window, and it gained 100.
    expect(folded.get("postgresql|a")?.latest).toBe(100);
  });

  it("sums the per-database deltas of a counter both databases reported", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 10, _timestamp: 1, db_namespace: "app" }),
        metricRow({ service_instance_id: "a:5432", value: 40, _timestamp: 2, db_namespace: "app" }),
        metricRow({
          service_instance_id: "a:5432",
          value: 100,
          _timestamp: 1,
          db_namespace: "jobs",
        }),
        metricRow({
          service_instance_id: "a:5432",
          value: 105,
          _timestamp: 2,
          db_namespace: "jobs",
        }),
      ],
      specFor("cacheHit", "postgresql"),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(35);
  });

  // `postgresql.replication.data_delay` is emitted once per REPLICA
  // (`replication_client` is the replica's address). Summing them reports a lag
  // no replica has — with five replicas the printed figure is roughly five
  // times the worst one. The instance's lag is its worst replica's.
  it("reports the worst replica's lag, not the sum of every replica's", () => {
    const folded = foldMetricRows(
      [
        metricRow({
          service_instance_id: "a:5432",
          value: 1000,
          _timestamp: 1,
          replication_client: "10.0.0.1",
        }),
        metricRow({
          service_instance_id: "a:5432",
          value: 2000,
          _timestamp: 1,
          replication_client: "10.0.0.2",
        }),
      ],
      specFor("replicationLag", "postgresql"),
    );
    expect(folded.get("postgresql|a")?.latest).toBe(2000);
  });

  // `postgresql.connection.max` is an INSTANCE-level gauge with no
  // `db.namespace`, so two rows at one timestamp are the same reading twice —
  // summing them doubles the denominator and halves every saturation figure on
  // the page, which is the headline number.
  it("does not sum a per-instance gauge across same-timestamp rows", () => {
    const limit = specFor("connectionLimit", "postgresql");
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 100, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 100, _timestamp: 1 }),
      ],
      limit,
    );
    expect(folded.get("postgresql|a")?.latest).toBe(100);
  });

  // MySQL's identity is in a different column, and the fold must read it —
  // reaching for `service_instance_id` finds the UUID and buckets every MySQL
  // instance under a key nothing can join to.
  it("folds MySQL rows on the endpoint column, not the UUID", () => {
    const folded = foldMetricRows(
      [
        {
          mysql_instance_endpoint: "myprod-1:3306",
          service_instance_id: "0b3e6f2a-8b5d-5f0e-9a1c-2d4e6f8a0b2c",
          value: 20,
          _timestamp: 1,
          kind: "connected",
        },
      ],
      specFor("connections", "mysql"),
    );
    expect(folded.get("mysql|myprod-1")?.latest).toBe(20);
  });

  // `mysql.threads` puts all four kinds on one stream. The SQL filters to
  // `connected`, but the fold sums same-timestamp rows — so if an unfiltered
  // batch ever reaches it, `created` (a lifetime total, routinely in the
  // thousands) lands in the connection count and the saturation reads far
  // over 100%.
  it("counts only connected threads when a MySQL batch carries every kind", () => {
    const rows = [
      { mysql_instance_endpoint: "myprod-1:3306", value: 20, _timestamp: 1, kind: "connected" },
      { mysql_instance_endpoint: "myprod-1:3306", value: 900, _timestamp: 1, kind: "created" },
      { mysql_instance_endpoint: "myprod-1:3306", value: 4, _timestamp: 1, kind: "running" },
    ];
    const folded = foldMetricRows(rows, specFor("connections", "mysql"));
    expect(folded.get("mysql|myprod-1")?.latest).toBe(20);
  });

  // A dropped sample must not become the new delta base: treating the gap as a
  // reset turns a 120-hit window into a 5-million-hit one.
  it("ignores a non-finite sample without resetting a cumulative counter's base", () => {
    const cum = specFor("cacheHit", "postgresql");
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: 5_000_000, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: Number.NaN, _timestamp: 2 }),
        metricRow({ service_instance_id: "a:5432", value: 5_000_120, _timestamp: 3 }),
      ],
      cum,
    );
    expect(folded.get("postgresql|a")?.latest).toBe(120);
  });

  it("drops a row with no resolvable identity rather than bucketing it under a blank key", () => {
    const folded = foldMetricRows([metricRow({ value: 7, _timestamp: 1 })], spec());
    expect(folded.size).toBe(0);
  });

  it("ignores a row whose value is not a finite number", () => {
    const folded = foldMetricRows(
      [
        metricRow({ service_instance_id: "a:5432", value: Number.NaN, _timestamp: 1 }),
        metricRow({ service_instance_id: "a:5432", value: 5, _timestamp: 2 }),
      ],
      spec(),
    );
    expect(folded.get("postgresql|a")?.series).toEqual([5]);
  });

  it("returns an empty map for no rows", () => {
    expect(foldMetricRows([], spec()).size).toBe(0);
  });
});

// ── saturation, which is a ratio or nothing ──────────────────────────────────

describe("connectionSaturation", () => {
  it("reports the ratio of used connections to the configured limit", () => {
    expect(connectionSaturation(20, 100)).toEqual({
      state: "measured",
      used: 20,
      limit: 100,
      ratio: 0.2,
    });
  });

  it("does not cap a ratio above 1 — being over the limit is the thing to see", () => {
    const result = connectionSaturation(120, 100);
    expect(result.state).toBe("measured");
    expect(result.ratio).toBeCloseTo(1.2, 10);
  });

  // MySQL publishes no limit. A count with no denominator is exactly the
  // "raw count means nothing" complaint, so it gets its own state rather than
  // an invented 100%.
  it("reports a count with no limit as its own state, never as a ratio", () => {
    expect(connectionSaturation(20, null)).toEqual({
      state: "no-limit",
      used: 20,
      limit: null,
      ratio: null,
    });
  });

  it("treats a zero limit as no limit rather than dividing by zero", () => {
    expect(connectionSaturation(20, 0).state).toBe("no-limit");
  });

  it("reports no measurement when the used count is absent", () => {
    expect(connectionSaturation(null, 100)).toEqual({
      state: "absent",
      used: null,
      limit: 100,
      ratio: null,
    });
  });

  // A negative connection count cannot happen and cannot be rendered: -5%
  // saturation is a number the page would have to explain.
  it("refuses a negative count rather than reporting a negative percentage", () => {
    expect(connectionSaturation(-5, 100).state).toBe("absent");
  });

  it("reports zero used against a real limit as a measured zero, not as absent", () => {
    expect(connectionSaturation(0, 100)).toEqual({
      state: "measured",
      used: 0,
      limit: 100,
      ratio: 0,
    });
  });
});

// ── cache hit ratio ──────────────────────────────────────────────────────────

describe("cacheHitRatio", () => {
  it("is hits over hits plus reads", () => {
    expect(cacheHitRatio(90, 10)).toBeCloseTo(0.9, 10);
  });

  // 0/0 is not a 100% cache hit rate — it is a window in which the database
  // touched no blocks, and printing "100%" there invents a measurement.
  it("is null when the window saw no block traffic at all", () => {
    expect(cacheHitRatio(0, 0)).toBeNull();
  });

  it("is null when either counter is missing", () => {
    expect(cacheHitRatio(null, 10)).toBeNull();
    expect(cacheHitRatio(90, null)).toBeNull();
  });

  it("is 1 when every block came from cache", () => {
    expect(cacheHitRatio(50, 0)).toBe(1);
  });

  it("is 0 when no block came from cache", () => {
    expect(cacheHitRatio(0, 50)).toBe(0);
  });

  it("is null for a negative counter, which cannot be a real delta", () => {
    expect(cacheHitRatio(-5, 10)).toBeNull();
  });
});

// ── the merge, and its explicit unmatched state ──────────────────────────────

describe("mergeInstanceMetrics", () => {
  const metricsFor = (key: string) =>
    new Map([
      [
        key,
        {
          connections: {
            latest: 20,
            series: [18, 20],
            points: [
              { timestamp: 1, value: 18 },
              { timestamp: 2, value: 20 },
            ],
          },
          connectionLimit: {
            latest: 100,
            series: [100, 100],
            points: [
              { timestamp: 1, value: 100 },
              { timestamp: 2, value: 100 },
            ],
          },
        },
      ],
    ]);

  it("attaches the receiver's metrics to the client-vantage row they describe", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.state).toBe("matched");
    expect(row.metrics?.saturation.ratio).toBeCloseTo(0.2, 10);
  });

  // The whole point of the identity work: the client sees the pooler's address
  // and the receiver sees the real host, so an equality join yields nothing.
  // Rendering that as blank is how a user concludes the feature is broken.
  it("marks a row the receiver never reported as unmatched, never as blank", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgbouncer.internal" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.state).toBe("unmatched");
    expect(row.metrics?.saturation.state).toBe("absent");
  });

  it("keeps every input row and its order — metrics are additive, never a filter", () => {
    const rows = mergeInstanceMetrics(
      [
        totalsRow({ db_instance: "a" }),
        totalsRow({ db_instance: "pgprod-1" }),
        totalsRow({ db_instance: "b" }),
      ],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(rows.map((r) => r.db_instance)).toEqual(["a", "pgprod-1", "b"]);
  });

  it("leaves the query-side figures of a matched row untouched", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1", calls: 1234 })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.calls).toBe(1234);
  });

  it("matches a client host against the receiver key built from a host:port endpoint", () => {
    // The receiver reported `pgprod-1:5432`; the client row records the same
    // host with the port stripped. This is the join the whole module exists for.
    const byEndpoint = new Map([
      [
        instanceIdentityKey("postgresql", "pgprod-1:5432") as string,
        { connections: { latest: 20, series: [20], points: [{ timestamp: 1, value: 20 }] } },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "PGPROD-1" })], byEndpoint);
    expect(row.metrics?.state).toBe("matched");
  });

  // "Silently empty is forbidden": the cell must be able to name the likely
  // cause, so the reason has to reach the row. A merge that sets `unmatched`
  // and never resolves a reason renders a bare em-dash with no tooltip.
  it("carries the likely cause onto an unmatched row, not just the state", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgbouncer.internal" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.unmatchedReason).toBe("pooler");
  });

  it("names the loopback substitution when the client row points at localhost", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "localhost" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.unmatchedReason).toBe("loopback");
  });

  it("names no cause on a matched row", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.unmatchedReason).toBeNull();
  });

  // Without this case a merge that hardcodes "pooler" for every unmatched row
  // passes: the other two causes are the only ones exercised here, and both
  // are reachable from one fixture. This is the branch that says "no receiver
  // is watching this engine at all", which is a different action entirely.
  it("blames the receiver, not a pooler, when only another engine reported", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      new Map([["mysql|myprod-1", { connections: { latest: 5, series: [5], points: [] } }]]),
    );
    expect(row.metrics?.state).toBe("unmatched");
    expect(row.metrics?.unmatchedReason).toBe("no-receiver");
  });

  // A stream we could not READ is not a receiver that is not running. The
  // first is a permission or retention problem the user can fix; the second
  // sends them to reconfigure a collector that was fine all along. The cell
  // names a cause, so the cause has to be the right one.
  it("blames the unreadable stream when the read failed, not the receiver", () => {
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], new Map(), {
      failedStreams: ["postgresql_backends"],
    });
    expect(row.metrics?.unmatchedReason).toBe("unreadable");
  });

  it("still blames the receiver when the failure was on another engine's stream", () => {
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], new Map(), {
      failedStreams: ["mysql_threads"],
    });
    expect(row.metrics?.unmatchedReason).toBe("no-receiver");
  });

  it("does not join a MySQL row onto a Postgres instance of the same host name", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_system: "mysql", db_instance: "pgprod-1" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.state).toBe("unmatched");
  });

  // No metrics read happened at all (knob off, or every stream failed): that is
  // not the same claim as "the receiver does not know this instance".
  it("reports no-data rather than unmatched when nothing was read", () => {
    const [row] = mergeInstanceMetrics([totalsRow()], new Map());
    expect(row.metrics?.state).toBe("no-data");
  });

  it("carries a partially-reporting instance's metrics and marks the rest absent", () => {
    const partial = new Map([
      [
        "postgresql|pgprod-1",
        { connections: { latest: 20, series: [20], points: [{ timestamp: 1, value: 20 }] } },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], partial);
    expect(row.metrics?.state).toBe("matched");
    expect(row.metrics?.saturation).toEqual({
      state: "no-limit",
      used: 20,
      limit: null,
      ratio: null,
    });
  });

  it("computes the cache hit ratio from the two block counters", () => {
    const withCache = new Map([
      [
        "postgresql|pgprod-1",
        {
          cacheHit: { latest: 90, series: [90], points: [{ timestamp: 1, value: 90 }] },
          cacheRead: { latest: 10, series: [10], points: [{ timestamp: 1, value: 10 }] },
        },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], withCache);
    expect(row.metrics?.cacheHitRatio).toBeCloseTo(0.9, 10);
  });

  it("exposes the connection series so the cell can draw a trend, not just a number", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.connectionSeries).toEqual([18, 20]);
  });

  it("gives an unresolvable client row an unmatched state and a stated cause", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.state).toBe("unmatched");
    // A cell that renders "—" with nothing behind it is the forbidden state,
    // whatever the reason it got there.
    expect(row.metrics?.unmatchedReason).not.toBeNull();
  });

  // The limit is looked up per instance. Reading it from whichever instance
  // happened to publish one would put A's max_connections under B's backend
  // count — a saturation percentage that is wrong rather than absent, which is
  // the worse of the two failures.
  it("does not borrow another instance's connection limit", () => {
    const split = new Map([
      [
        "postgresql|a",
        { connections: { latest: 20, series: [20], points: [{ timestamp: 1, value: 20 }] } },
      ],
      [
        "postgresql|b",
        { connectionLimit: { latest: 100, series: [100], points: [{ timestamp: 1, value: 100 }] } },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "a" })], split);
    expect(row.metrics?.saturation).toEqual({
      state: "no-limit",
      used: 20,
      limit: null,
      ratio: null,
    });
  });

  // The strip needs the timestamps, and this is the layer that feeds it. The
  // fold produces them; nothing proved they survive onto the row, so a merge
  // that kept only the bare values would silently defeat the correlation the
  // whole time-series correction exists for.
  it("carries the timestamped points onto the row, not only the bare values", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.connectionPoints).toEqual([
      { timestamp: 1, value: 18 },
      { timestamp: 2, value: 20 },
    ]);
  });

  // ── the seam ───────────────────────────────────────────────────────────────
  //
  // Every other merge test is fed a hand-built metric set, and every fold test
  // asserts the fold's own output. Both stay green if the two disagree about
  // the shape — the feature is then broken in exactly the place no unit test
  // looks. This one runs real rows through the fold and into the merge.
  it("consumes the fold's own output, so the two cannot drift apart", () => {
    const key = "postgresql|pgprod-1";
    const backends = foldMetricRows(
      [
        { service_instance_id: "pgprod-1:5432", value: 18, _timestamp: 1 },
        { service_instance_id: "pgprod-1:5432", value: 20, _timestamp: 2 },
      ],
      specFor("connections", "postgresql"),
    );
    const limits = foldMetricRows(
      [{ service_instance_id: "pgprod-1:5432", value: 100, _timestamp: 2 }],
      specFor("connectionLimit", "postgresql"),
    );
    const folded = new Map([
      [key, { connections: backends.get(key), connectionLimit: limits.get(key) }],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], folded);
    expect(row.metrics?.state).toBe("matched");
    expect(row.metrics?.saturation.ratio).toBeCloseTo(0.2, 10);
    expect(row.metrics?.connectionPoints).toEqual([
      { timestamp: 1, value: 18 },
      { timestamp: 2, value: 20 },
    ]);
  });

  // `postgresql.replication.data_delay` is a gauge in BYTES (unit `By`), not
  // seconds. Passing it through unconverted is what lets the cell label it
  // correctly; treating it as a duration would print "4 minutes behind" for
  // 240 bytes of WAL.
  it("passes the Postgres replication lag through carrying its BYTES unit", () => {
    const withLag = new Map([
      [
        "postgresql|pgprod-1",
        {
          replicationLag: {
            latest: 4096,
            series: [2048, 4096],
            points: [
              { timestamp: 1, value: 2048 },
              { timestamp: 2, value: 4096 },
            ],
          },
        },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], withLag);
    expect(row.metrics?.replicationLag).toEqual({ value: 4096, unit: "bytes" });
  });

  // The two engines report replication lag in DIFFERENT units under one role:
  // Postgres `data_delay` is bytes of WAL, MySQL `time_behind_source` is
  // seconds. A single unitless field renders "4 KB behind" for a replica that
  // is 4096 SECONDS behind, which is the same class of error the Postgres case
  // above exists to prevent.
  it("passes the MySQL replication lag through carrying its SECONDS unit", () => {
    const withLag = new Map([
      [
        "mysql|myprod-1",
        {
          replicationLag: { latest: 4096, series: [4096], points: [{ timestamp: 1, value: 4096 }] },
        },
      ],
    ]);
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_system: "mysql", db_instance: "myprod-1" })],
      withLag,
    );
    expect(row.metrics?.replicationLag).toEqual({ value: 4096, unit: "seconds" });
  });

  it("passes the window's deadlock count through", () => {
    const withDeadlocks = new Map([
      [
        "postgresql|pgprod-1",
        { deadlocks: { latest: 3, series: [3], points: [{ timestamp: 1, value: 3 }] } },
      ],
    ]);
    const [row] = mergeInstanceMetrics([totalsRow({ db_instance: "pgprod-1" })], withDeadlocks);
    expect(row.metrics?.deadlocks).toBe(3);
  });

  // A row can be matched — the receiver knows the instance — while every
  // individual metric is one the user never enabled. That must read as absent
  // metrics on a known instance, not as an unknown instance.
  it("stays matched when the receiver knows the instance but published no metric we read", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "pgprod-1" })],
      new Map([["postgresql|pgprod-1", {}]]),
    );
    expect(row.metrics?.state).toBe("matched");
    expect(row.metrics?.saturation.state).toBe("absent");
    expect(row.metrics?.cacheHitRatio).toBeNull();
    expect(row.metrics?.replicationLag).toBeNull();
    expect(row.metrics?.deadlocks).toBeNull();
  });

  it("gives an unmatched row an empty connection series rather than undefined", () => {
    const [row] = mergeInstanceMetrics(
      [totalsRow({ db_instance: "elsewhere" })],
      metricsFor("postgresql|pgprod-1"),
    );
    expect(row.metrics?.connectionSeries).toEqual([]);
  });
});

// ── why a row is unmatched ───────────────────────────────────────────────────
//
// "Silently empty is forbidden" means the cell must be able to say the LIKELY
// cause, and the three causes are genuinely different actions for the reader.

describe("unmatchedReason", () => {
  it("blames the receiver when it reported no instance of this engine at all", () => {
    expect(unmatchedReason("postgresql", "pgprod-1", [])).toBe("no-receiver");
  });

  it("blames pooler indirection when the receiver reported other hosts of this engine", () => {
    expect(unmatchedReason("postgresql", "pgbouncer.internal", ["postgresql|pgprod-1"])).toBe(
      "pooler",
    );
  });

  // Upstream substitutes os.Hostname() when the endpoint is a loopback, so a
  // client row pointing at localhost can never match by construction.
  it("blames the loopback substitution when the client row points at localhost", () => {
    expect(unmatchedReason("postgresql", "localhost", ["postgresql|pgprod-1"])).toBe("loopback");
    expect(unmatchedReason("postgresql", "127.0.0.1", ["postgresql|pgprod-1"])).toBe("loopback");
    expect(unmatchedReason("postgresql", "::1", ["postgresql|pgprod-1"])).toBe("loopback");
  });

  it("blames the receiver when only another engine reported", () => {
    expect(unmatchedReason("postgresql", "pgprod-1", ["mysql|myprod-1"])).toBe("no-receiver");
  });
});
