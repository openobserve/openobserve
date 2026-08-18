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
 * Instance metrics for the Databases page — a READ-TIME join against metrics
 * the user's collector already ships. Nothing here ingests anything.
 *
 * Three things this module exists to get right, each a defect in the obvious
 * version:
 *
 *  • A connection COUNT means nothing. `postgresql.backends` is rendered
 *    against `postgresql.connection.max` as a ratio, and where no limit is
 *    published the count says so rather than implying a denominator.
 *
 *  • A point-in-time gauge cannot be overlaid on a latency spike, which is the
 *    only reason anyone reads these numbers at 3am. Every metric therefore
 *    folds to a TIMESTAMPED series, not a scalar.
 *
 *  • The two vantages disagree about what an instance is called, and behind a
 *    pooler they never agree. A Databases row is the address the CLIENT
 *    dialled — `server.address`, port already stripped — while the receiver
 *    reports the endpoint it was configured with, `host:port`. Both sides
 *    normalise to a bare lowercase host, joined as `(system, host)`. When that
 *    fails the row says so and names the likely cause: a blank cell is how a
 *    reader concludes the feature is broken rather than unmatched.
 *
 * The engine asymmetries are upstream's, and all three bite: postgresqlreceiver
 * puts the endpoint in `service.instance.id` while mysqlreceiver puts a UUID
 * there and the endpoint in `mysql.instance.endpoint`; mysqlreceiver publishes
 * no `max_connections` (the setup card's `sqlquery/mysql_limits` recipe fills
 * the gap); and replication lag is BYTES on one engine and SECONDS on the
 * other.
 */

import type { DbTotalsRow } from "@/services/db_monitoring";

export type DbmMetricAggregate = "sum" | "single" | "max";

export type DbmMetricRole =
  "connections" | "connectionLimit" | "replicationLag" | "cacheHit" | "cacheRead" | "deadlocks";

export interface DbmMetricSpec {
  /** Canonical engine token, matching the client vantage's `db_system`. */
  system: string;
  role: DbmMetricRole;
  /** The metric name as OpenObserve stores it — one stream per metric. */
  stream: string;
  /** Upstream ships it on, so absence means the receiver is not reporting. */
  defaultEnabled: boolean;
  /** A monotonic counter: the window's figure is its delta, not its reading. */
  cumulative: boolean;
  /**
   * How rows sharing a timestamp combine into the instance's figure:
   *   `sum`    — one row per database, and only their total is the instance's.
   *   `single` — one reading per instance, repeated; summing it would multiply
   *              the denominator and halve every saturation figure.
   *   `max`    — one row per REPLICA. An instance's lag is its worst replica's;
   *              summing reports a lag no replica actually has.
   */
  aggregate: DbmMetricAggregate;
  /**
   * Columns that split one instance's rows into separate series — the database
   * on a per-database metric, the replica on replication lag. They are grouped
   * on by the fold, so the SQL projects them from this same list: a column in
   * the grouping but not the SELECT collapses every series into one and lets
   * same-timestamp rows overwrite each other.
   */
  seriesColumns?: readonly string[];
  /** The column carrying this engine's instance endpoint. */
  identityColumn: string;
  /** Narrows a stream carrying several series, e.g. mysql.threads' kinds. */
  filter?: { column: string; value: string };
}

export interface DbmMetricRow {
  _timestamp: number;
  value: number;
  service_instance_id?: string;
  mysql_instance_endpoint?: string;
  postgresql_database_name?: string;
  [column: string]: unknown;
}

/** One reading and when it was taken — the strip needs both. */
export interface DbmMetricPoint {
  timestamp: number;
  value: number;
}

export interface DbmMetricSeries {
  /**
   * The window's figure: a gauge's last reading, a counter's delta. `null`
   * when it cannot be determined — one sample of a counter differences to
   * nothing, and calling that `0` is a measurement we never made.
   */
  latest: number | null;
  series: number[];
  points: DbmMetricPoint[];
}

export type DbmInstanceMetricSet = Partial<Record<DbmMetricRole, DbmMetricSeries>>;

export type DbmSaturationState = "measured" | "no-limit" | "absent";

export interface DbmSaturation {
  state: DbmSaturationState;
  used: number | null;
  limit: number | null;
  ratio: number | null;
}

/**
 * Every state describes a read that happened — matched, matched nothing, or
 * returned nothing. (A fourth `disabled` state existed while the join sat
 * behind `ZO_DB_MONITORING_INSTANCE_METRICS`; that per-signal knob is gone —
 * with DBM enabled the join always runs.)
 */
export type DbmMetricsState = "matched" | "unmatched" | "no-data";

export interface DbmReplicationLag {
  value: number;
  /** Postgres reports bytes of WAL; MySQL reports seconds behind the source. */
  unit: "bytes" | "seconds";
}

/** What the metrics read could not do, so the merge can name the right cause. */
export interface DbmMergeContext {
  failedStreams?: string[];
}

export interface DbmRowMetrics {
  state: DbmMetricsState;
  saturation: DbmSaturation;
  cacheHitRatio: number | null;
  replicationLag: DbmReplicationLag | null;
  deadlocks: number | null;
  connectionSeries: number[];
  connectionPoints: DbmMetricPoint[];
  /** Why no receiver instance matched, so the cell can say it. */
  unmatchedReason: DbmUnmatchedReason | null;
}

export type DbmUnmatchedReason = "pooler" | "loopback" | "no-receiver" | "unreadable";

const PG = "postgresql";
const MYSQL = "mysql";
const MARIADB = "mariadb";

/**
 * Engines that RIDE another engine's metric streams.
 *
 * No mariadb receiver exists upstream — a MariaDB server is scraped by the
 * MYSQL receiver pointed at it, so its readings land in the `mysql_*` streams
 * under `mysql.*` metric names (verified against the capture rig's catalog,
 * which holds no `mariadb_*` metric stream). The join must therefore look a
 * `mariadb` client row up under the `mysql` identity, or the health column
 * stays permanently empty for MariaDB.
 *
 * An ALIAS at the join, deliberately not duplicate `mariadb` catalog entries:
 * duplicated specs would read every mysql stream a second time, and — because
 * the receiver cannot say which engine an endpoint really is — would fabricate
 * a second `mariadb` fleet row for every MySQL instance the metrics discover.
 */
const METRIC_SYSTEM_ALIASES: Readonly<Record<string, string>> = { [MARIADB]: MYSQL };

/** The engine whose metric streams carry this system's readings, lowercased. */
export const metricSystemFor = (system: string | null | undefined): string => {
  const engine = (system ?? "").trim().toLowerCase();
  return METRIC_SYSTEM_ALIASES[engine] ?? engine;
};

/** postgresqlreceiver writes its endpoint here; mysqlreceiver writes a UUID. */
const PG_IDENTITY = "service_instance_id";
/** mysqlreceiver's endpoint — the only MySQL column worth joining on. */
const MYSQL_IDENTITY = "mysql_instance_endpoint";

/**
 * The metrics we read, and everything about each the reader cannot infer.
 *
 * Stream names are the metric names after OpenObserve's sanitisation (every run
 * outside `[A-Za-z0-9_:]` becomes `_`), so a typo here reads an empty stream
 * forever and is indistinguishable from a receiver that is switched off.
 *
 * Every column name below is a CLAIM about the collector, not a fact about the
 * stream: collectors rename attributes across versions, so a spec'd name — and
 * especially a semconv-promised one — is never trusted ahead of the stream's
 * own schema. The labels name RECEIVER attributes for that reason (the
 * receiver writes `postgresql_database_name` where semconv promises
 * `db.namespace`), and the read layer intersects the spec with the live schema
 * before building SQL (`DbmMetricsCollectOptions.fieldsByStream`).
 *
 * The MySQL `connectionLimit` does NOT come from mysqlreceiver — it publishes
 * no `max_connections`, and its `mysql.connection.count` counts attempts while
 * `mysql.max_used_connections` is a high-water mark, so either under a
 * saturation percentage would be a fabricated denominator. The limit comes
 * from the MySQL setup card's `sqlquery/mysql_limits` recipe (`SELECT
 * @@max_connections` emitted as `mysql.connection.max`), so the stream exists
 * only where that recipe is installed — `defaultEnabled: false`, and a MySQL
 * row without it renders the honest count-with-no-denominator state.
 */
export const DBM_INSTANCE_METRICS: readonly DbmMetricSpec[] = [
  {
    system: PG,
    role: "connections",
    stream: "postgresql_backends",
    defaultEnabled: true,
    cumulative: false,
    // One row per database per scrape. The label is the RECEIVER's attribute
    // (`postgresql.database.name`, sanitised), NOT semconv `db.namespace` —
    // see the catalog comment above on trusting schemas over specs.
    aggregate: "sum",
    seriesColumns: ["postgresql_database_name"],
    identityColumn: PG_IDENTITY,
  },
  {
    system: PG,
    role: "connectionLimit",
    stream: "postgresql_connection_max",
    defaultEnabled: true,
    cumulative: false,
    aggregate: "single",
    identityColumn: PG_IDENTITY,
  },
  {
    system: PG,
    role: "replicationLag",
    stream: "postgresql_replication_data_delay",
    defaultEnabled: true,
    cumulative: false,
    // One row per replica (`replication_client` is the replica's address).
    aggregate: "max",
    seriesColumns: ["replication_client"],
    identityColumn: PG_IDENTITY,
  },
  {
    system: PG,
    role: "cacheHit",
    stream: "postgresql_blks_hit",
    defaultEnabled: false,
    cumulative: true,
    aggregate: "sum",
    seriesColumns: ["postgresql_database_name"],
    identityColumn: PG_IDENTITY,
  },
  {
    system: PG,
    role: "cacheRead",
    stream: "postgresql_blks_read",
    defaultEnabled: false,
    cumulative: true,
    aggregate: "sum",
    seriesColumns: ["postgresql_database_name"],
    identityColumn: PG_IDENTITY,
  },
  {
    system: PG,
    role: "deadlocks",
    stream: "postgresql_deadlocks",
    defaultEnabled: false,
    cumulative: true,
    aggregate: "sum",
    seriesColumns: ["postgresql_database_name"],
    identityColumn: PG_IDENTITY,
  },
  {
    system: MYSQL,
    role: "connections",
    stream: "mysql_threads",
    defaultEnabled: true,
    cumulative: false,
    aggregate: "sum",
    identityColumn: MYSQL_IDENTITY,
    // One stream carries all four thread kinds; `created` is a lifetime total,
    // and summing it into the connection count reads as massive saturation.
    filter: { column: "kind", value: "connected" },
  },
  {
    system: MYSQL,
    role: "replicationLag",
    stream: "mysql_replica_time_behind_source",
    defaultEnabled: false,
    cumulative: false,
    aggregate: "max",
    identityColumn: MYSQL_IDENTITY,
  },
  {
    system: MYSQL,
    role: "connectionLimit",
    // `mysql.connection.max` from the setup card's sqlquery/mysql_limits
    // recipe (see the module note above) — the twin of
    // `postgresql_connection_max`, and `single` for the same reason: one
    // reading per instance, and summing repeats of it would multiply the
    // denominator and halve every saturation figure.
    stream: "mysql_connection_max",
    defaultEnabled: false,
    cumulative: false,
    aggregate: "single",
    identityColumn: MYSQL_IDENTITY,
  },
];

const IDENTITY_COLUMNS: Record<string, string> = {
  [PG]: PG_IDENTITY,
  [MYSQL]: MYSQL_IDENTITY,
};

/** The key's separator. Not a colon — an IPv6 host is full of those. */
const KEY_SEPARATOR = "|";

/** A stream name is interpolated as a table name and can never be escaped. */
const SAFE_STREAM = /^[A-Za-z0-9_:-]+$/;

/**
 * A receiver endpoint or a client address, reduced to the bare host the two
 * vantages can agree on: lowercased, port removed, trailing root dot dropped.
 *
 * The port has to go because the client side never has one — the span
 * canonicalizer strips it — so keeping it would mean the two never match.
 */
export const normalizeInstanceHost = (value: string | null | undefined): string | null => {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  let host = raw;
  if (host.startsWith("[")) {
    // [IPv6]:port — the brackets exist precisely to delimit the address.
    const end = host.indexOf("]");
    if (end > 0) host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    // Only a trailing all-digit segment is a port, and only when there is a
    // single colon: a bare IPv6 address is nothing but colons and must survive
    // whole. `:5432` strips to nothing, which is correctly no host at all.
    if (colon >= 0 && colon === host.indexOf(":") && /^\d+$/.test(host.slice(colon + 1))) {
      host = host.slice(0, colon);
    }
  }

  host = host.replace(/\.$/, "").trim().toLowerCase();
  return host || null;
};

/**
 * The join key. The engine is part of it because two engines routinely share a
 * host, and folding them would report one's connections under the other.
 */
export const instanceIdentityKey = (
  system: string | null | undefined,
  host: string | null | undefined,
): string | null => {
  const engine = (system ?? "").trim().toLowerCase();
  const resolved = normalizeInstanceHost(host);
  if (!engine || !resolved) return null;
  return `${engine}${KEY_SEPARATOR}${resolved}`;
};

/** Split a key back into its parts. The host may itself contain colons. */
export const splitIdentityKey = (key: string): { system: string; host: string } | null => {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at <= 0) return null;
  const host = key.slice(at + KEY_SEPARATOR.length);
  return host ? { system: key.slice(0, at), host } : null;
};

/**
 * The instance a metric row describes, read from the column THIS engine
 * publishes it in. MySQL's `service_instance_id` is a UUID v5 of the endpoint,
 * so falling back to it would produce a populated key that joins to nothing.
 */
export const receiverHostOf = (row: DbmMetricRow, system: string): string | null => {
  const column = IDENTITY_COLUMNS[(system ?? "").trim().toLowerCase()];
  if (!column) return null;
  const value = row[column];
  return typeof value === "string" ? normalizeInstanceHost(value) : null;
};

/**
 * One metric stream over the window.
 *
 * Both bounds are repeated in the SQL even though the search API is given the
 * same window: the API's window selects partitions, and a predicate is what
 * makes the query correct on its own terms.
 */
export const buildInstanceMetricsSql = (
  spec: DbmMetricSpec,
  window: { startTime: number; endTime: number },
): string => {
  if (!SAFE_STREAM.test(spec.stream)) {
    throw new Error(`unsafe metrics stream name: ${spec.stream}`);
  }
  if (!Number.isFinite(window.startTime) || !Number.isFinite(window.endTime)) {
    throw new Error("metrics window bounds must be finite");
  }
  // Newest FIRST. The search API caps the rows it returns, and ordered oldest
  // first that cap silently discards the most recent readings — "latest" then
  // becomes a value from early in the window and a saturated instance reads as
  // calm. The fold re-sorts, so the cap costs history rather than currency.
  //
  // The filter column is PROJECTED as well as constrained. `foldMetricRows`
  // re-checks the filter against the row it is handed, so a column that is in
  // the WHERE but not the SELECT reads back `undefined`, fails its own filter,
  // and drops every row — with the query and the fold each correct alone.
  const filter = spec.filter ? ` AND ${spec.filter.column} = '${spec.filter.value}'` : "";
  // Every column the fold reads back — the filter it re-checks and the columns
  // it groups series by — has to be in the projection, and both come from the
  // spec so the query and the fold cannot drift apart.
  const extra = [...(spec.seriesColumns ?? []), ...(spec.filter ? [spec.filter.column] : [])];
  const extraColumns = extra.length ? `, ${extra.join(", ")}` : "";
  return (
    `SELECT _timestamp, value, ${spec.identityColumn}${extraColumns} ` +
    `FROM "${spec.stream}" ` +
    `WHERE _timestamp >= ${window.startTime} AND _timestamp <= ${window.endTime}${filter} ` +
    `ORDER BY _timestamp DESC`
  );
};

/**
 * Rows to one series per instance.
 *
 * Rows are grouped per SERIES first — one instance can emit a row per database
 * or a row per replica — and only then combined per the spec's `aggregate`.
 * The order matters for a cumulative counter: summing the databases and then
 * differencing reads a database that came into view mid-window as a burst of
 * activity, because it brings its whole since-boot total with it. Differencing
 * each series and summing the deltas cannot.
 *
 * A cumulative counter reports its window DELTA. A counter that went backwards
 * restarted, so the post-reset reading is the most the window can honestly
 * claim; a single sample differences to nothing at all and reports `null`
 * rather than a zero that would read as a clean bill of health.
 */
export const foldMetricRows = (
  rows: DbmMetricRow[],
  spec: DbmMetricSpec,
): Map<string, DbmMetricSeries> => {
  // instance -> series (database, replica, or the instance itself) -> samples
  const byInstance = new Map<string, Map<string, Map<number, number>>>();

  for (const row of rows) {
    if (spec.filter && String(row[spec.filter.column] ?? "") !== spec.filter.value) continue;
    const key = instanceIdentityKey(spec.system, receiverHostOf(row, spec.system));
    if (!key) continue;

    const value = Number(row.value);
    const timestamp = Number(row._timestamp);
    if (!Number.isFinite(value) || !Number.isFinite(timestamp)) continue;

    let series = byInstance.get(key);
    if (!series) {
      series = new Map<string, Map<number, number>>();
      byInstance.set(key, series);
    }
    const seriesKey = seriesKeyOf(row, spec);
    let samples = series.get(seriesKey);
    if (!samples) {
      samples = new Map<number, number>();
      series.set(seriesKey, samples);
    }
    // Two rows of ONE series at one timestamp is a duplicate, not a quantity.
    samples.set(timestamp, value);
  }

  const folded = new Map<string, DbmMetricSeries>();
  for (const [key, series] of byInstance) {
    const perSeries = [...series.values()].map((samples) =>
      [...samples.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([timestamp, value]) => ({ timestamp, value })),
    );
    const points = combinePoints(perSeries, spec.aggregate);
    folded.set(key, {
      latest: instanceFigure(perSeries, spec),
      series: points.map((point) => point.value),
      points,
    });
  }
  return folded;
};

/**
 * What distinguishes two rows of one instance at one timestamp — read from the
 * catalog, not guessed from column names. A metric with no series columns is
 * one series, and its duplicate rows at a timestamp are the same reading
 * twice rather than a quantity to add up.
 */
const seriesKeyOf = (row: DbmMetricRow, spec: DbmMetricSpec): string =>
  (spec.seriesColumns ?? []).map((column) => String(row[column] ?? "")).join("\u0000");

/** The per-timestamp shape the strip draws, combined across the instance's series. */
const combinePoints = (
  perSeries: DbmMetricPoint[][],
  aggregate: DbmMetricAggregate,
): DbmMetricPoint[] => {
  const byTimestamp = new Map<number, number>();
  for (const points of perSeries) {
    for (const point of points) {
      const existing = byTimestamp.get(point.timestamp);
      if (existing === undefined) {
        byTimestamp.set(point.timestamp, point.value);
      } else if (aggregate === "sum") {
        byTimestamp.set(point.timestamp, existing + point.value);
      } else if (aggregate === "max") {
        byTimestamp.set(point.timestamp, Math.max(existing, point.value));
      }
    }
  }
  return [...byTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, value]) => ({ timestamp, value }));
};

/**
 * The instance's figure for the window.
 *
 * A cumulative counter is differenced PER SERIES and the deltas summed, so a
 * database appearing or disappearing partway through cannot manufacture one. A
 * gauge takes the newest reading of each series and combines those.
 */
const instanceFigure = (perSeries: DbmMetricPoint[][], spec: DbmMetricSpec): number | null => {
  const figures = perSeries
    .map((points) => seriesFigure(points, spec.cumulative))
    .filter((value): value is number => value !== null);
  if (figures.length === 0) return null;
  if (spec.aggregate === "max") return Math.max(...figures);
  if (spec.aggregate === "single") return figures[0];
  return figures.reduce((total, value) => total + value, 0);
};

const seriesFigure = (points: DbmMetricPoint[], cumulative: boolean): number | null => {
  if (points.length === 0) return null;
  const last = points[points.length - 1].value;
  if (!cumulative) return last;
  // One sample cannot be differenced — that is unknown, not zero.
  if (points.length < 2) return null;
  const first = points[0].value;
  // Went backwards: the counter restarted, so everything before it is lost and
  // the post-reset reading is the floor of what this window saw.
  return last >= first ? last - first : last;
};

/**
 * Connections against the limit.
 *
 * The three states are genuinely different facts and each renders differently:
 * a ratio we measured, a count with no published limit (every MySQL instance,
 * permanently), and no reading at all.
 */
export const connectionSaturation = (
  used: number | null | undefined,
  limit: number | null | undefined,
): DbmSaturation => {
  // A negative count cannot be a real reading, and -5% is a figure the page
  // would have to explain rather than report.
  const current =
    Number.isFinite(used as number) && (used as number) >= 0 ? (used as number) : null;
  const ceiling =
    Number.isFinite(limit as number) && (limit as number) > 0 ? (limit as number) : null;
  if (current === null) return { state: "absent", used: null, limit: ceiling, ratio: null };
  if (ceiling === null) return { state: "no-limit", used: current, limit: null, ratio: null };
  // Deliberately uncapped: being over the limit is the thing worth seeing.
  return { state: "measured", used: current, limit: ceiling, ratio: current / ceiling };
};

/**
 * Hits as a share of all block reads.
 *
 * A window that touched no blocks is `null`, not 1 — "100% cache hit" on an
 * idle database is a measurement nobody made.
 */
export const cacheHitRatio = (
  hits: number | null | undefined,
  reads: number | null | undefined,
): number | null => {
  if (!Number.isFinite(hits as number) || !Number.isFinite(reads as number)) return null;
  const hit = hits as number;
  const read = reads as number;
  if (hit < 0 || read < 0) return null;
  const total = hit + read;
  return total > 0 ? hit / total : null;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The likeliest reason a client-vantage row found no receiver instance. Each
 * points at a different fix, which is why the cell names one.
 */
export const unmatchedReason = (
  system: string,
  host: string | null | undefined,
  knownKeys: string[],
): DbmUnmatchedReason => {
  // The ALIASED engine: a MariaDB row's metrics live under the mysql keys, so
  // "is this engine reported at all" must ask about mysql or every MariaDB
  // miss blames a receiver that is running.
  const engine = metricSystemFor(system);
  const resolved = normalizeInstanceHost(host);
  // Upstream swaps a loopback endpoint for the collector's own hostname, so a
  // client row pointing at localhost cannot match however healthy everything is.
  if (resolved && LOOPBACK_HOSTS.has(resolved)) return "loopback";
  const engineReported = knownKeys.some((key) => key.startsWith(`${engine}${KEY_SEPARATOR}`));
  // The receiver watches this engine, just not at the address the client
  // dialled — which is what a pooler in between looks like.
  return engineReported ? "pooler" : "no-receiver";
};

const EMPTY_SATURATION: DbmSaturation = { state: "absent", used: null, limit: null, ratio: null };

// Aliased: MariaDB's lag rides `mysql.replica.time_behind_source`, which is
// seconds behind the source — the mysql semantics, not Postgres's WAL bytes.
const lagUnitFor = (system: string): "bytes" | "seconds" =>
  metricSystemFor(system) === MYSQL ? "seconds" : "bytes";

/** The row-shaped view of one instance's metrics. */
export const metricsForSet = (system: string, set: DbmInstanceMetricSet): DbmRowMetrics => {
  const lag = set.replicationLag?.latest;
  return {
    state: "matched",
    saturation: connectionSaturation(set.connections?.latest, set.connectionLimit?.latest),
    cacheHitRatio: cacheHitRatio(set.cacheHit?.latest, set.cacheRead?.latest),
    replicationLag:
      lag === null || lag === undefined ? null : { value: lag, unit: lagUnitFor(system) },
    deadlocks: set.deadlocks?.latest ?? null,
    connectionSeries: set.connections?.series ?? [],
    connectionPoints: set.connections?.points ?? [],
    unmatchedReason: null,
  };
};

export const absentMetrics = (
  state: DbmMetricsState,
  unmatched: DbmUnmatchedReason | null,
): DbmRowMetrics => ({
  state,
  saturation: EMPTY_SATURATION,
  cacheHitRatio: null,
  replicationLag: null,
  deadlocks: null,
  connectionSeries: [],
  connectionPoints: [],
  unmatchedReason: unmatched,
});

/** Whether a stream we could not read was one this engine would have used. */
const engineHadUnreadableStream = (system: string, failedStreams: string[]): boolean => {
  // Aliased for the same reason as the key lookup: MariaDB's readings come
  // from the mysql streams, so an unreadable mysql stream is ITS problem too.
  const engine = metricSystemFor(system);
  const streams = new Set(
    DBM_INSTANCE_METRICS.filter((spec) => spec.system === engine).map((spec) => spec.stream),
  );
  return failedStreams.some((stream) => streams.has(stream));
};

/**
 * The metrics for one client-vantage row, or a stated reason there are none.
 */
export const resolveRowMetrics = (
  system: string,
  instance: string,
  metricsByKey: Map<string, DbmInstanceMetricSet>,
  context: DbmMergeContext = {},
): DbmRowMetrics => {
  const failedStreams = context.failedStreams ?? [];
  // The ALIASED system: the fold keys every reading under the engine whose
  // receiver produced it, so a MariaDB row must look itself up under mysql.
  const key = instanceIdentityKey(metricSystemFor(system), instance);
  const set = key ? metricsByKey.get(key) : undefined;
  if (set) return metricsForSet(system, set);

  // Nothing was read at all — the page asked and got nothing back. That is not
  // the same claim as "the receiver has never heard of this instance".
  if (metricsByKey.size === 0 && failedStreams.length === 0) {
    return absentMetrics("no-data", null);
  }
  // A stream we could not READ is a permission or retention problem, not a
  // collector that is switched off, and sends the reader somewhere else.
  const reason = engineHadUnreadableStream(system, failedStreams)
    ? "unreadable"
    : unmatchedReason(system, instance, [...metricsByKey.keys()]);
  return absentMetrics("unmatched", reason);
};

/**
 * Attach each row's instance metrics, or state why there are none.
 *
 * Strictly additive: every input row comes back, in order, with its query-side
 * figures untouched. A metrics failure must never remove or reorder a database
 * the page would otherwise show.
 */
export const mergeInstanceMetrics = <T extends DbTotalsRow>(
  rows: T[],
  metricsByKey: Map<string, DbmInstanceMetricSet>,
  context: DbmMergeContext = {},
): (T & { metrics?: DbmRowMetrics })[] =>
  rows.map((row) => ({
    ...row,
    metrics: resolveRowMetrics(row.db_system, row.db_instance, metricsByKey, context),
  }));
