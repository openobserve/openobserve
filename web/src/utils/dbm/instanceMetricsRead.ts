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
 * The best-effort collection pass over every metric stream in the catalog.
 *
 * Best-effort is the entire contract, and it is load-bearing rather than
 * defensive: four of the eight metrics are `enabled: false` upstream, so a
 * stream that does not exist is the ORDINARY case. One 404 must not take the
 * other seven with it, and no failure here may reach the caller as a rejection
 * — the query table must render exactly as it does today whatever the metrics
 * read did.
 *
 * Reads run concurrently: eight sequential round trips against a slow backend
 * would be the "degrades the query view" outcome even though every one of them
 * eventually succeeded.
 *
 * A stream that ERRORED and a stream that returned nothing are recorded
 * separately, because they send the reader to different places — "you cannot
 * read this stream" versus "nothing is reporting".
 */

import {
  DBM_INSTANCE_METRICS,
  buildInstanceMetricsSql,
  foldMetricRows,
  type DbmInstanceMetricSet,
  type DbmMetricRow,
} from "./instanceMetrics";

export type DbmMetricStreamReader = (
  stream: string,
  sql: string,
  window: { startTime: number; endTime: number },
) => Promise<Record<string, unknown>[]>;

export interface DbmMetricsCollection {
  metricsByKey: Map<string, DbmInstanceMetricSet>;
  /** Streams whose read threw — distinct from a stream that was simply empty. */
  failedStreams: string[];
}

/**
 * How many stream reads may be open at once.
 *
 * Not a throughput knob — a courtesy one. A browser allows six connections per
 * origin, so firing all eight at once puts every request the user makes next
 * (expanding a row, changing the range) behind them. Three leaves the page
 * responsive while still finishing the sweep in three rounds.
 */
const MAX_IN_FLIGHT = 3;

/** Run `task` over `items`, at most `size` at a time, preserving input order. */
const inBatches = async <T, R>(
  items: readonly T[],
  size: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(task))));
  }
  return results;
};

/** Every stream the catalog can ask for, for callers prefetching schemas. */
export const DBM_METRIC_STREAM_NAMES: readonly string[] = [
  ...new Set(DBM_INSTANCE_METRICS.map((spec) => spec.stream)),
];

export interface DbmMetricsCollectOptions {
  /**
   * The metric streams that exist on this instance, when the caller knows.
   *
   * Four of the eight metrics are `enabled: false` in the collector's
   * defaults, so most deployments are missing most of this catalog — and
   * without this filter every load re-asked all eight and collected the same
   * six 400s forever. `null` means "unknown" (the catalog read failed or is
   * empty, e.g. under list-permission RBAC), and falls back to sweeping
   * everything: a wasted 400 is recoverable, a health column silently blanked
   * by a permissions quirk is not.
   */
  existingStreams?: ReadonlySet<string> | null;
  /**
   * Each stream's ACTUAL fields, when the caller fetched its schema.
   *
   * The spec's column names are a claim about the collector, never trusted
   * ahead of the stream's own schema (see the `DBM_INSTANCE_METRICS` catalog
   * comment). The SQL is built from the intersection of the two: a missing
   * optional column is dropped before the request instead of discovered by a
   * 400, and a missing identity or filter column marks the stream unreadable
   * without spending the request at all — those columns are load-bearing, and
   * querying around them would return numbers with the wrong meaning.
   *
   * A stream with no entry keeps the trust-then-retry path, so schema-fetch
   * failure degrades to today's behaviour rather than blanking the column.
   */
  fieldsByStream?: ReadonlyMap<string, ReadonlySet<string>> | null;
}

export const collectInstanceMetrics = async (
  read: DbmMetricStreamReader,
  window: { startTime: number; endTime: number },
  options: DbmMetricsCollectOptions = {},
): Promise<DbmMetricsCollection> => {
  const metricsByKey = new Map<string, DbmInstanceMetricSet>();
  const failedStreams: string[] = [];

  const { existingStreams, fieldsByStream } = options;
  const specs =
    existingStreams && existingStreams.size > 0
      ? DBM_INSTANCE_METRICS.filter((spec) => existingStreams.has(spec.stream))
      : DBM_INSTANCE_METRICS;

  const readOne = async (spec: (typeof DBM_INSTANCE_METRICS)[number]) => {
    let effective = spec;
    const fields = fieldsByStream?.get(spec.stream);
    if (fields && fields.size > 0) {
      // See DbmMetricsCollectOptions.fieldsByStream for why each column class
      // is treated differently.
      if (!fields.has(spec.identityColumn)) return { spec, failed: true as const };
      if (spec.filter && !fields.has(spec.filter.column)) return { spec, failed: true as const };
      const present = (spec.seriesColumns ?? []).filter((column) => fields.has(column));
      if (present.length !== (spec.seriesColumns?.length ?? 0)) {
        effective = { ...spec, seriesColumns: present };
      }
    }
    try {
      const rows = await read(spec.stream, buildInstanceMetricsSql(effective, window), window);
      // A shape that is not a list is not rows. Treating it as none keeps a
      // proxy returning an error body with a 200 from crashing the fold.
      return { spec: effective, rows: Array.isArray(rows) ? (rows as DbmMetricRow[]) : [] };
    } catch {
      // The series columns are the OPTIONAL part of the projection: they buy
      // the per-database split, and not every collector emits the label (see
      // the `DBM_INSTANCE_METRICS` catalog comment on spec'd names). Losing
      // the whole health signal over an optional column inverts the contract,
      // so retry once without them. The stripped spec is used for the fold too,
      // so query and fold stay in agreement; its same-timestamp rows collapse
      // as duplicates, which is exact when the receiver reports instance-level
      // totals and a lower bound — never an invention — when it does not.
      if (!effective.seriesColumns?.length) return { spec, failed: true as const };
      const stripped = { ...effective, seriesColumns: [] };
      try {
        const rows = await read(spec.stream, buildInstanceMetricsSql(stripped, window), window);
        return { spec: stripped, rows: Array.isArray(rows) ? (rows as DbmMetricRow[]) : [] };
      } catch {
        return { spec, failed: true as const };
      }
    }
  };

  for (const settled of await inBatches(specs, MAX_IN_FLIGHT, readOne)) {
    if ("failed" in settled) {
      failedStreams.push(settled.spec.stream);
      continue;
    }
    for (const [key, series] of foldMetricRows(settled.rows, settled.spec)) {
      const set = metricsByKey.get(key) ?? {};
      set[settled.spec.role] = series;
      metricsByKey.set(key, set);
    }
  }

  return { metricsByKey, failedStreams };
};

/**
 * Fold the SERVER's instance-metrics sweep into the same map the browser-side
 * sweep produced.
 *
 * The expensive half of this read moved server-side — one UNION ALL over the
 * metric streams that exist, in place of a stream catalog call, a schema call
 * per stream and a search per stream. The FOLD did not move, and deliberately:
 * per-series grouping, counter differencing with reset detection, gauge-vs-
 * counter figures, the `mariadb`→`mysql` alias and host normalisation across
 * the two vantages are the rules that decide what the health column SAYS, they
 * are pinned by `instanceMetrics.spec.ts`, and a second implementation of them
 * in Rust would be a second set of rules with no test able to watch the two
 * drift apart.
 *
 * So the server returns rows in the shape [`foldMetricRows`] already consumes,
 * tagged with the role each belongs to, and this routes them. Every rule below
 * this line is the one that always ran.
 *
 * The spec for each row comes from the SERVER's `streams` list intersected
 * with the local catalog: the server says which streams it really swept and
 * with which aggregate, and the local catalog supplies the identity column the
 * fold reads back. A role the local catalog does not know is dropped rather
 * than guessed.
 */
export const foldServerInstanceMetrics = (
  hits: readonly DbmServerMetricHit[],
  streams: readonly DbmServerMetricStream[],
): DbmMetricsCollection => {
  const metricsByKey = new Map<string, DbmInstanceMetricSet>();
  // Group the flat result set back into one bucket per (system, role) — the
  // grain a spec describes, and the grain `foldMetricRows` folds at.
  const byRole = new Map<string, DbmMetricRow[]>();
  for (const hit of hits) {
    const role = String(hit.role ?? "");
    if (!role) continue;
    const bucket = byRole.get(role);
    if (bucket) bucket.push(rowFor(hit));
    else byRole.set(role, [rowFor(hit)]);
  }

  for (const declared of streams) {
    // The local spec carries the identity and series columns the fold reads
    // back; the server's entry carries which streams were actually swept.
    const spec = DBM_INSTANCE_METRICS.find(
      (candidate) => candidate.stream === declared.stream && candidate.role === declared.role,
    );
    if (!spec) continue;
    const rows = byRole.get(declared.role);
    if (!rows?.length) continue;

    // Only this stream's OWN engine's rows.
    //
    // One role can be served by two engines — `connections` is both
    // `postgresql_backends` and `mysql_threads` — so the role bucket holds
    // both engines' rows and each spec must take only its own. The filter is
    // on the SERVER's engine tag: it knows which union arm produced each row,
    // where the client could only infer it from which identity column looks
    // populated.
    //
    // `foldMetricRows` would drop the foreign rows anyway (it resolves the
    // identity through `receiverHostOf`, which reads the column THIS engine
    // publishes, and a Postgres row carries no `mysql_instance_endpoint`), so
    // this is belt-and-braces rather than the load-bearing guard — the guard
    // is `rowFor` placing each instance under its own engine's column, which
    // `routes one role served by two engines to the right engine each` pins.
    // Kept because it states the intent at the point the grouping happens, and
    // because relying on a null identity to do a filter's job is exactly how a
    // later refactor of `rowFor` turns into a silent cross-engine fold.
    const mine = rows.filter((row) => row.o2_metric_system === spec.system);
    if (!mine.length) continue;

    // The server already applied the filter in SQL and already resolved the
    // per-series label, so the spec handed to the fold names neither: a
    // `filter` would be re-checked against a column the wire row does not
    // carry and drop every row, and a `seriesColumns` entry would group on a
    // column that is now uniformly `o2_metric_series`.
    const folding = {
      ...spec,
      filter: undefined,
      seriesColumns: ["o2_metric_series"] as const,
      aggregate: declared.aggregate,
      cumulative: declared.cumulative,
    };
    for (const [key, series] of foldMetricRows(mine, folding)) {
      const set = metricsByKey.get(key) ?? {};
      set[spec.role] = series;
      metricsByKey.set(key, set);
    }
  }

  // The server sweeps best-effort and reports which streams it read; a stream
  // it never read is ABSENT, which is "the receiver is not reporting" and not
  // "we could not read it". The unreadable case is now a whole-endpoint
  // failure, which the caller handles as a blank column.
  return { metricsByKey, failedStreams: [] };
};

/** One wire row, in the shape the fold reads. */
export interface DbmServerMetricHit {
  role: string;
  /** The engine whose union arm produced this row. */
  system: string;
  instance: string;
  series: string | null;
  value: number;
  _timestamp: number;
}

/** One swept stream's spec, as the server reports it. */
export interface DbmServerMetricStream {
  stream: string;
  role: string;
  system: string;
  cumulative: boolean;
  aggregate: "sum" | "single" | "max";
}

/**
 * A wire row as a `DbmMetricRow`.
 *
 * The instance is placed under the identity column ITS OWN ENGINE publishes,
 * because `receiverHostOf` reads exactly that column and reading the other
 * one produces a populated key that joins to nothing. The engine comes from
 * the row (the server projects it per union arm) rather than from the role,
 * which two engines share.
 */
const rowFor = (hit: DbmServerMetricHit): DbmMetricRow => ({
  _timestamp: Number(hit._timestamp),
  value: Number(hit.value),
  o2_metric_series: hit.series ?? "",
  o2_metric_system: hit.system,
  // `receiverHostOf` looks the column up by engine, so only the engine's own
  // column is populated; the other stays absent, as it is in the raw stream.
  [hit.system === "mysql" ? "mysql_instance_endpoint" : "service_instance_id"]: hit.instance,
});
