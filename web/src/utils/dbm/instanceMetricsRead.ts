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

export const collectInstanceMetrics = async (
  read: DbmMetricStreamReader,
  window: { startTime: number; endTime: number },
): Promise<DbmMetricsCollection> => {
  const metricsByKey = new Map<string, DbmInstanceMetricSet>();
  const failedStreams: string[] = [];

  const readOne = async (spec: (typeof DBM_INSTANCE_METRICS)[number]) => {
    try {
      const rows = await read(spec.stream, buildInstanceMetricsSql(spec, window), window);
      // A shape that is not a list is not rows. Treating it as none keeps a
      // proxy returning an error body with a 200 from crashing the fold.
      return { spec, rows: Array.isArray(rows) ? (rows as DbmMetricRow[]) : [] };
    } catch {
      return { spec, failed: true as const };
    }
  };

  for (const settled of await inBatches(DBM_INSTANCE_METRICS, MAX_IN_FLIGHT, readOne)) {
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
