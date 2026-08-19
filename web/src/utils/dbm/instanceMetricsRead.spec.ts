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

import { describe, expect, it, vi } from "vitest";

import {
  DBM_METRIC_STREAM_NAMES,
  collectInstanceMetrics,
  type DbmMetricStreamReader,
} from "./instanceMetricsRead";
import { DBM_INSTANCE_METRICS } from "./instanceMetrics";

const WINDOW = { startTime: 1_000_000, endTime: 2_000_000 };

/**
 * A reader that answers per stream. Anything not named returns no rows, which
 * is what a stream the user never enabled actually looks like.
 */
const readerFor = (byStream: Record<string, unknown[]>): DbmMetricStreamReader =>
  vi.fn(async (stream: string) => byStream[stream] ?? []);

const pgBackends = (host: string, value: number, ts = 1) => ({
  service_instance_id: `${host}:5432`,
  value,
  _timestamp: ts,
});

// ── the failure posture, which is the whole contract ─────────────────────────
//
// "Absent stream, missing metric or unreadable stream ⇒ the column renders
// empty and the page behaves exactly as today. Metrics must never block or
// degrade the query view." Four of the six Postgres metrics are disabled
// upstream by default, so a missing stream is the COMMON case, not the edge.

describe("DBM_METRIC_STREAM_NAMES", () => {
  // Callers prefetch schemas by this list, and the existing-streams filter
  // skips anything not in it — a stream missing here is never read at all,
  // however correct its catalog spec is.
  it("includes the MySQL connection-limit stream the limits recipe fills", () => {
    expect(DBM_METRIC_STREAM_NAMES).toContain("mysql_connection_max");
  });

  it("names every stream in the catalog exactly once", () => {
    const streams = DBM_INSTANCE_METRICS.map((spec) => spec.stream);
    expect([...DBM_METRIC_STREAM_NAMES].sort()).toEqual([...new Set(streams)].sort());
  });
});

describe("collectInstanceMetrics", () => {
  it("returns the instances a readable stream reported", async () => {
    const read = readerFor({ postgresql_backends: [pgBackends("pgprod-1", 20)] });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.connections?.latest).toBe(20);
  });

  it("never rejects when a stream read fails", async () => {
    const read: DbmMetricStreamReader = vi.fn(async () => {
      throw new Error("stream not found");
    });
    await expect(collectInstanceMetrics(read, WINDOW)).resolves.toBeDefined();
  });

  // The one that matters: a 404 on `postgresql_deadlocks` (disabled upstream by
  // default) must not take the connections column down with it.
  it("keeps the streams that read when one of them fails", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream: string) => {
      if (stream === "postgresql_deadlocks") throw new Error("stream not found");
      if (stream === "postgresql_backends") return [pgBackends("pgprod-1", 20)];
      return [];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.connections?.latest).toBe(20);
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.deadlocks).toBeUndefined();
  });

  it("reports an empty result rather than throwing when every stream fails", async () => {
    const read: DbmMetricStreamReader = vi.fn(async () => {
      throw new Error("no permission");
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.size).toBe(0);
  });

  // A stream that ERRORED and a stream that returned no rows must not land in
  // the same bucket: the first is "we could not look", the second is "we
  // looked and there was nothing". The row's tooltip names a different cause
  // for each, so collapsing them sends the user to fix the wrong thing.
  //
  // Asserted as the EXACT set, not with `toContain`: a collector that marks
  // every stream failed also "contains" the one that did.
  it("separates the streams that failed from the ones that were simply empty", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream: string) => {
      if (stream === "postgresql_backends") throw new Error("boom");
      return [];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.failedStreams).toEqual(["postgresql_backends"]);
  });

  it("reports no failed streams when every read succeeded, however empty", async () => {
    const result = await collectInstanceMetrics(readerFor({}), WINDOW);
    expect(result.failedStreams).toEqual([]);
  });

  it("merges the roles of one instance read from several streams", async () => {
    const read = readerFor({
      postgresql_backends: [pgBackends("pgprod-1", 20)],
      postgresql_connection_max: [
        { service_instance_id: "pgprod-1:5432", value: 100, _timestamp: 1 },
      ],
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    const set = result.metricsByKey.get("postgresql|pgprod-1");
    expect(set?.connections?.latest).toBe(20);
    expect(set?.connectionLimit?.latest).toBe(100);
  });

  // The seam the SQL and the fold each pass in isolation and fail together.
  // The reader is handed rows shaped by the builder's OWN projection, so a
  // column the fold needs but the SELECT list omits is caught here and only
  // here — and its absence made every MySQL instance permanently blank.
  it("folds MySQL rows shaped exactly as its own SQL would return them", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream: string, sql: string) => {
      if (stream !== "mysql_threads") return [];
      // Only the columns this query actually selects — nothing else exists.
      const projection = sql
        .slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i))
        .split(",")
        .map((column) => column.trim());
      const full: Record<string, unknown> = {
        _timestamp: 1,
        value: 20,
        mysql_instance_endpoint: "myprod-1:3306",
        kind: "connected",
      };
      return [Object.fromEntries(projection.map((column) => [column, full[column]]))];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("mysql|myprod-1")?.connections?.latest).toBe(20);
  });

  // The same seam, for the columns the fold GROUPS on rather than filters on.
  // Postgres emits one row per database per scrape; if `postgresql_database_name` is not
  // projected, every database collapses into one series, same-timestamp rows
  // overwrite each other, and an instance running 5 + 7 backends reports 7 —
  // which against a limit of 10 renders a calm 70% for a database 20% OVER its
  // connection limit.
  it("sums an instance's databases from rows shaped as its own SQL returns them", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream: string, sql: string) => {
      if (stream !== "postgresql_backends") return [];
      const projection = sql
        .slice(sql.search(/SELECT/i) + "SELECT".length, sql.search(/FROM/i))
        .split(",")
        .map((column) => column.trim());
      const shape = (full: Record<string, unknown>) =>
        Object.fromEntries(projection.map((column) => [column, full[column]]));
      return [
        shape({
          _timestamp: 2,
          value: 5,
          service_instance_id: "a:5432",
          postgresql_database_name: "app",
        }),
        shape({
          _timestamp: 2,
          value: 7,
          service_instance_id: "a:5432",
          postgresql_database_name: "jobs",
        }),
      ];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("postgresql|a")?.connections?.latest).toBe(12);
  });

  // The SQL asks for newest first so a server row cap costs the oldest
  // readings. The fold has to put them back in time order, or the "latest"
  // figure is the window's first reading and the strip runs backwards.
  it("reads the newest value as current from a newest-first response", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream: string) =>
      stream === "postgresql_backends"
        ? [
            pgBackends("pgprod-1", 42, 3),
            pgBackends("pgprod-1", 20, 2),
            pgBackends("pgprod-1", 5, 1),
          ]
        : [],
    );
    const result = await collectInstanceMetrics(read, WINDOW);
    const connections = result.metricsByKey.get("postgresql|pgprod-1")?.connections;
    expect(connections?.latest).toBe(42);
    expect(connections?.series).toEqual([5, 20, 42]);
  });

  it("keeps two instances of one engine apart", async () => {
    const read = readerFor({
      postgresql_backends: [pgBackends("a", 10), pgBackends("b", 90)],
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("postgresql|a")?.connections?.latest).toBe(10);
    expect(result.metricsByKey.get("postgresql|b")?.connections?.latest).toBe(90);
  });

  // Eight simultaneous searches saturate the browser's per-origin connection
  // pool, so anything the user does next — expanding a row, changing the range
  // — queues behind them. That is the query view degraded by the metrics read,
  // which the requirement forbids even though nothing is technically blocked.
  it("keeps only a few reads in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const read: DbmMetricStreamReader = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return [];
    });
    await collectInstanceMetrics(read, WINDOW);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("still reads every stream despite the limit", async () => {
    const read = readerFor({});
    await collectInstanceMetrics(read, WINDOW);
    expect((read as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(DBM_INSTANCE_METRICS.length);
  });

  /**
   * Once per SPEC, not once per stream. MySQL's two cache roles share
   * `mysql_buffer_pool_operations` and are separated by a `filter` on the
   * `operation` dimension, so each needs its own query — deduplicating by
   * stream here would read one operation and hand the same rows to both roles,
   * making the hit ratio `1 - x/x = 0` on every MySQL instance.
   */
  it("reads once per catalog spec, including specs that share a stream", async () => {
    const read = readerFor({});
    await collectInstanceMetrics(read, WINDOW);
    const streamsRead = (read as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const expected = DBM_INSTANCE_METRICS.map((s) => s.stream);
    expect(streamsRead.slice().sort()).toEqual(expected.slice().sort());

    const shared = streamsRead.filter((s) => s === "mysql_buffer_pool_operations");
    expect(shared).toHaveLength(2);
  });

  // Every call, not one spot-check: a collector that builds the SQL once and
  // reuses it for all eight streams reads the same stream eight times, and the
  // seven metrics that never arrive are indistinguishable from seven the user
  // did not enable.
  it("hands each stream its OWN SQL and the selected window", async () => {
    const read = readerFor({});
    await collectInstanceMetrics(read, WINDOW);
    const calls = (read as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    for (const [stream, sql, window] of calls) {
      expect(sql).toContain(`FROM "${stream}"`);
      expect(window).toEqual(WINDOW);
    }
  });

  // A stream that resolves to something other than an array (a shape change, a
  // proxy returning an error object with a 200) must be treated as no rows
  // rather than crashing the fold.
  it("treats a non-array response as no rows", async () => {
    const read: DbmMetricStreamReader = vi.fn(
      async () => undefined as unknown as Record<string, unknown>[],
    );
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.size).toBe(0);
  });

  // ── the catalog filter ───────────────────────────────────────────────────
  //
  // Four of the eight metrics are disabled upstream by default, so most
  // deployments are missing most of the catalog. Sweeping streams the catalog
  // says are absent collected the same six 400s on every load, forever.

  it("queries only the streams the catalog says exist", async () => {
    const read = readerFor({});
    await collectInstanceMetrics(read, WINDOW, {
      existingStreams: new Set(["postgresql_backends", "mysql_threads"]),
    });
    const streamsRead = (read as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(streamsRead.slice().sort()).toEqual(["mysql_threads", "postgresql_backends"]);
  });

  it("reports a catalog-absent stream as absent, not failed", async () => {
    const read = readerFor({});
    const result = await collectInstanceMetrics(read, WINDOW, {
      existingStreams: new Set(["postgresql_backends"]),
    });
    // Not queried ⇒ nothing reported, and NOT "could not be read": the stream
    // does not exist, which is the ordinary not-enabled case.
    expect(result.failedStreams).toEqual([]);
  });

  it("sweeps everything when the catalog is unknown or empty", async () => {
    for (const catalog of [null, new Set<string>()]) {
      const read = readerFor({});
      await collectInstanceMetrics(read, WINDOW, { existingStreams: catalog });
      expect((read as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
        DBM_INSTANCE_METRICS.length,
      );
    }
  });

  // ── the optional-column fallback ─────────────────────────────────────────
  //
  // Seen live: a stream that exists whose collector does not emit the
  // per-database label — `unknown field 'postgresql_database_name'`. The split is the
  // optional part of the projection; the health signal must survive it.

  it("retries a failed read once without the optional series columns", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream, sql) => {
      if (stream !== "postgresql_backends") return [];
      if (sql.includes("postgresql_database_name"))
        throw new Error("unknown field 'postgresql_database_name'");
      return [pgBackends("pgprod-1", 20)];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.connections?.latest).toBe(20);
    expect(result.failedStreams).not.toContain("postgresql_backends");
    const retrySql = (read as ReturnType<typeof vi.fn>).mock.calls
      .filter((c) => c[0] === "postgresql_backends")
      .map((c) => c[1] as string);
    expect(retrySql).toHaveLength(2);
    expect(retrySql[1]).not.toContain("postgresql_database_name");
  });

  it("marks the stream failed when the stripped retry fails too", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream) => {
      if (stream === "postgresql_backends") throw new Error("permission denied");
      return [];
    });
    const result = await collectInstanceMetrics(read, WINDOW);
    expect(result.failedStreams).toContain("postgresql_backends");
    // One retry, not a loop.
    const calls = (read as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "postgresql_backends",
    );
    expect(calls).toHaveLength(2);
  });

  // ── schema-driven projection ─────────────────────────────────────────────
  //
  // The spec's column names are a claim about the collector, and the claim has
  // been wrong before. When the caller supplies the stream's real fields the
  // SQL is built from the intersection, so a renamed optional column costs the
  // split — never a 400 — and a renamed load-bearing column costs the stream
  // without wasting the request.

  it("drops an optional column the schema does not carry, without a retry", async () => {
    const read = readerFor({ postgresql_backends: [pgBackends("pgprod-1", 20)] });
    const result = await collectInstanceMetrics(read, WINDOW, {
      fieldsByStream: new Map([
        ["postgresql_backends", new Set(["_timestamp", "value", "service_instance_id"])],
      ]),
    });
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.connections?.latest).toBe(20);
    const calls = (read as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "postgresql_backends",
    );
    // First attempt already correct: no field the stream lacks, no retry.
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).not.toContain("postgresql_database_name");
  });

  it("keeps the full projection when the schema carries every column", async () => {
    const read = readerFor({});
    await collectInstanceMetrics(read, WINDOW, {
      fieldsByStream: new Map([
        [
          "postgresql_backends",
          new Set(["_timestamp", "value", "service_instance_id", "postgresql_database_name"]),
        ],
      ]),
    });
    const calls = (read as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "postgresql_backends",
    );
    expect(calls[0][1]).toContain("postgresql_database_name");
  });

  it("marks a stream failed without querying when its identity column is gone", async () => {
    const read = readerFor({});
    const result = await collectInstanceMetrics(read, WINDOW, {
      fieldsByStream: new Map([["postgresql_backends", new Set(["_timestamp", "value"])]]),
    });
    // Identity is load-bearing: without it the fold cannot key instances, so
    // the request would only buy rows we must discard.
    expect(result.failedStreams).toContain("postgresql_backends");
    const calls = (read as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === "postgresql_backends",
    );
    expect(calls).toHaveLength(0);
  });

  it("marks a stream failed without querying when its filter column is gone", async () => {
    const read = readerFor({});
    const result = await collectInstanceMetrics(read, WINDOW, {
      fieldsByStream: new Map([
        ["mysql_threads", new Set(["_timestamp", "value", "mysql_instance_endpoint"])],
      ]),
    });
    // mysql.threads carries several kinds in one stream; unfiltered, the
    // numbers would be real but mean the wrong thing.
    expect(result.failedStreams).toContain("mysql_threads");
    expect(
      (read as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "mysql_threads"),
    ).toHaveLength(0);
  });

  it("keeps the trust-then-retry path for a stream with no schema entry", async () => {
    const read: DbmMetricStreamReader = vi.fn(async (stream, sql) => {
      if (stream !== "postgresql_backends") return [];
      if (sql.includes("postgresql_database_name")) throw new Error("unknown field");
      return [pgBackends("pgprod-1", 20)];
    });
    // A schema map that simply lacks this stream (fetch failed for it).
    const result = await collectInstanceMetrics(read, WINDOW, {
      fieldsByStream: new Map([["mysql_threads", new Set(["kind"])]]),
    });
    expect(result.metricsByKey.get("postgresql|pgprod-1")?.connections?.latest).toBe(20);
  });
});
