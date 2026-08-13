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
   * comment). Rather than trusting the
   * claim, the SQL is built from its intersection with the schema: a missing
   * optional column is dropped before the request instead of discovered by a
   * 400, and a missing identity or filter column marks the stream unreadable
   * without wasting the request at all — those columns are load-bearing, and
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
