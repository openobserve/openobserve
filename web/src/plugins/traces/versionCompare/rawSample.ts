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

// rawSample.ts — uniform-random raw-sample query for the version-compare
// bootstrap. `useLLMInsights.fetchSummary` returns histogram-bucketed
// aggregates (SUM(cost), approx_percentile_cont(duration)) — great for the
// KPI strip, but bootstrap resampling (stats.ts `bootstrapDiffCI`) needs the
// underlying per-span *samples*, not pre-aggregated numbers.
//
// The Task-0 spike confirmed `ORDER BY rand()` works on the streaming-search
// path, so we use it directly (no fallback to a deterministic slice needed).
// `ORDER BY rand() LIMIT <cap>` is what makes this a uniform random sample of
// the window instead of the first/last N rows — a non-random slice would bias
// the bootstrap toward whatever ordering the storage layer happens to return.

import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import { SAMPLE_CAP } from "./constants";

/**
 * Build the SQL for a uniform-random raw-sample of LLM spans in a window.
 *
 * Cost column choice: `useLLMInsights.fetchSummary` computes the KPI's
 * `totalCost` as `COALESCE(SUM(gen_ai_usage_cost), 0) as total_cost` — i.e.
 * the per-span column is `gen_ai_usage_cost`. To keep the bootstrap sample's
 * cost distribution consistent with (a sample of) the same values that feed
 * the KPI card, we select the raw per-span `gen_ai_usage_cost` column here
 * (aliased `cost`) rather than re-deriving/summing it — the bootstrap needs
 * per-trace observations, not a pre-aggregated total.
 *
 * @param stream source trace stream name
 * @param agentFilter bare predicate from `buildAgentTraceFilter` (no leading
 *   `AND`/`WHERE`), or `""` when no agent is selected
 * @param startMicros window start, epoch micros
 * @param endMicros window end, epoch micros
 * @param cap max rows to sample (caller passes `SAMPLE_CAP` by default)
 */
export function buildRawSampleSql(
  stream: string,
  agentFilter: string,
  startMicros: number,
  endMicros: number,
  cap: number,
): string {
  const agentClause = agentFilter ? ` AND (${agentFilter})` : "";
  return (
    `SELECT duration, gen_ai_usage_cost as cost ` +
    `FROM "${stream}" ` +
    `WHERE _timestamp >= ${startMicros} AND _timestamp <= ${endMicros} ` +
    `AND gen_ai_operation_name IS NOT NULL${agentClause} ` +
    `ORDER BY rand() LIMIT ${cap}`
  );
}

/** Minimal shape of a hit row this query returns. */
interface RawSampleHit {
  duration?: number | string;
  cost?: number | string;
}

/**
 * Result of a query-runner invocation: the raw hit rows collected across
 * the streaming response.
 */
// The runner receives the window in microseconds as well as the SQL, because
// the streaming-search payload needs `start_time`/`end_time` set for the engine
// to scan the right partitions — the time predicate baked into the SQL string
// is NOT sufficient on its own (with 0/0 the search returns no rows).
export type RawSampleQueryRunner = (
  sql: string,
  startMicros: number,
  endMicros: number,
) => Promise<RawSampleHit[]>;

/**
 * Fetch a uniform-random raw sample of `{ duration, cost }` for the
 * bootstrap. Thin wrapper around `buildRawSampleSql` — the actual streaming
 * transport is injected via `runner` so this stays unit-testable without
 * standing up `useHttpStreaming`/Vuex/store context. In production code, the
 * caller supplies a `runner` built the same way `useLLMInsights.executeQuery`
 * does (via `fetchQueryDataWithHttpStream` from
 * `@/composables/useStreamingSearch`, base64-encoding the SQL when
 * `store.state.zoConfig?.sql_base64_enabled` is set, and generating a
 * `traceId` via `generateTraceContext()`).
 */
export async function fetchRawSample(
  stream: string,
  agentFilter: string,
  startMicros: number,
  endMicros: number,
  runner: RawSampleQueryRunner,
  cap: number = SAMPLE_CAP,
): Promise<{ durations: number[]; costs: number[] }> {
  const sql = buildRawSampleSql(stream, agentFilter, startMicros, endMicros, cap);
  const hits = await runner(sql, startMicros, endMicros);

  const durations: number[] = [];
  const costs: number[] = [];
  for (const hit of hits) {
    durations.push(Number(hit.duration) || 0);
    costs.push(Number(hit.cost) || 0);
  }
  return { durations, costs };
}

// Re-exported so call sites building a real runner (e.g. an
// `executeQuery`-style helper) can reuse the same trace-id/base64 encoding
// conventions as `useLLMInsights` without duplicating the import list.
export { b64EncodeUnicode, generateTraceContext };
