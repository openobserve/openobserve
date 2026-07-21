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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  aggregateStepStats,
  bucketInterval,
  buildHistogramSql,
  buildKpiSql,
  buildLastRunSql,
  buildRunsSql,
  buildRunsWithStepsSql,
  buildRunDetailSql,
  buildProtocolRunDetailSql,
  mapHistogram,
  mapKpi,
  mapProtocolRunDetail,
  mapRun,
  mapRunDetail,
  SYNTHETIC_RESULTS_STREAM,
  type ProtocolRunDetail,
  type StepStatsResult,
  type SyntheticBucket,
  type SyntheticKpi,
  type SyntheticRun,
  type SyntheticRunDetail,
} from "@/composables/synthetics/syntheticResultsSchema";
import useStreams from "@/composables/useStreams";

const EMPTY_KPI: SyntheticKpi = {
  uptimePct: 0,
  p95Ms: 0,
  failedRuns: 0,
  totalRuns: 0,
  retriedRuns: 0,
  lastRunStatus: null,
  lastRunAt: null,
};

/**
 * Orchestration layer for KPI cards and Response Time chart.
 * Runs data is fetched separately via the REST /runs endpoint.
 */
export function useSyntheticResults() {
  const store = useStore();
  const { getStream } = useStreams();
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  const kpi = ref<SyntheticKpi>({ ...EMPTY_KPI });
  const buckets = ref<SyntheticBucket[]>([]);
  const runs = ref<SyntheticRun[]>([]);
  const runDetail = ref<SyntheticRunDetail | null>(null);
  const protocolRunDetail = ref<ProtocolRunDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoadedOnce = ref(false);

  // Per-query loading signals — each section of the UI gates its own
  // skeleton independently, so fast queries (KPI, histogram) render
  // while the slow runs-list query is still in flight.
  const kpiLoading = ref(false);
  const histogramLoading = ref(false);
  const runsLoading = ref(false);
  const kpiHasLoadedOnce = ref(false);
  const histogramHasLoadedOnce = ref(false);
  const runsHasLoadedOnce = ref(false);
  const stepsLoading = ref(false);
  const stepsHasLoadedOnce = ref(false);

  // Per-group error messages — set when an individual query fails so
  // each UI section can surface the error instead of silently rendering
  // zeros or empty charts.
  const kpiError = ref<string | null>(null);
  const histogramError = ref<string | null>(null);
  const runsError = ref<string | null>(null);
  const stepsError = ref<string | null>(null);

  const stepStats = ref<StepStatsResult>({
    stepFailures: [],
    stepDurations: [],
    stepGroups: [],
    flakySteps: [],
    trendBuckets: [],
    failureInstances: [],
  });

  // ── Stream schema fields ─────────────────────────────────────────────────
  //
  // The stream schema only contains fields some ingested row has carried
  // (browser-only fields are absent on protocol-only deployments, `error`
  // is absent until a run has failed, …) and the search API rejects queries
  // naming absent fields. Query builders take this set and substitute
  // literals for missing columns. getStream caches, so repeat calls are cheap.
  async function fetchSchemaFields(): Promise<Set<string>> {
    try {
      const stream: any = await getStream(SYNTHETIC_RESULTS_STREAM, "logs", true);
      return new Set(
        ((stream?.schema ?? []) as { name: string }[]).map((f) => f.name),
      );
    } catch {
      // Schema not available — an empty set selects literals for every
      // optional column, which cannot fail.
      return new Set();
    }
  }

  // ── Effective p95 — falls back to client-side computation from runs ──────
  //
  // The SQL approx_percentile_cont may return 0 when the DataFusion fork
  // can't infer the field type. When that happens and runs data is available,
  // compute p95 from the in-memory run durations.
  const effectiveP95Ms = computed(() => {
    const sqlP95 = kpi.value.p95Ms;
    if (sqlP95 > 0) return sqlP95;
    const durations = runs.value
      .map((r) => r.durationMs)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (durations.length === 0) return 0;
    const idx = Math.ceil(durations.length * 0.95) - 1;
    return durations[Math.max(0, Math.min(idx, durations.length - 1))];
  });

  // ── Steps: fetch via synthetics_results log stream ─────────────────────
  //
  // Step-level fields (recorded_steps, last_attempt_steps, retry_history)
  // are queried directly from the synthetics_results log stream, the same
  // way buildRunDetailSql does for per-run detail views. This avoids the
  // REST /runs endpoint's 200-row page limit and fetches all runs in the
  // time window in a single streaming query.
  //
  // The retry_history column is conditionally included — it may not exist
  // on instances where the probe hasn't written it yet.
  async function fetchAndAggregateSteps(
    monitorId: string,
    startTime: number,
    endTime: number,
  ): Promise<StepStatsResult> {
    try {
      let hasRetryHistory = false;
      try {
        const stream: any = await getStream(
          SYNTHETIC_RESULTS_STREAM, "logs", true,
        );
        const schema: { name: string }[] = stream?.schema ?? [];
        hasRetryHistory = schema.some((f) => f.name === "retry_history");
      } catch {
        // Schema not available — omit retry_history, which is safe.
      }

      const STEP_RUNS_LIMIT = 5000;
      const hits: Record<string, unknown>[] = await executeQuery(
        buildRunsWithStepsSql(monitorId, STEP_RUNS_LIMIT, hasRetryHistory),
        startTime,
        endTime,
        "logs",
      );
      if (!hits.length) return emptyStepStats();

      return aggregateStepStats(hits, startTime, endTime);
    } catch {
      return emptyStepStats();
    }
  }

  function emptyStepStats(): StepStatsResult {
    return {
      stepFailures: [],
      stepDurations: [],
      stepGroups: [],
      flakySteps: [],
      trendBuckets: [],
      failureInstances: [],
    };
  }

  async function fetchAll(
    monitorId: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !startTime || !endTime) return;
    loading.value = true;
    kpiLoading.value = true;
    histogramLoading.value = true;
    runsLoading.value = true;
    stepsLoading.value = true;
    error.value = null;

    // Clear per-group errors on each fresh fetch so a successful retry
    // removes any previously shown error state.
    kpiError.value = null;
    histogramError.value = null;
    runsError.value = null;
    stepsError.value = null;

    try {
      const interval = bucketInterval(endTime - startTime);

      const schemaFields = await fetchSchemaFields();
      const hasAttemptsField = schemaFields.has("attempts");

      // Group 1: KPI + last-run — both feed KPI cards. Resolves
      // independently so the KPI section renders as soon as these
      // fast queries complete, without waiting for the runs list.
      const kpiPromise = Promise.all([
        executeQuery(buildKpiSql(monitorId, hasAttemptsField), startTime, endTime, "logs"),
        executeQuery(buildLastRunSql(monitorId), startTime, endTime, "logs"),
      ]).then(([kpiRows, lastRunRows]) => {
        kpi.value = mapKpi(kpiRows[0] ?? null, lastRunRows[0] ?? null);
      }).catch((e: unknown) => {
        kpi.value = { ...EMPTY_KPI };
        kpiError.value = e instanceof Error ? e.message : String(e ?? "KPI query failed");
      }).finally(() => {
        kpiLoading.value = false;
        kpiHasLoadedOnce.value = true;
      });

      // Group 2: Histogram — feeds response-time and errors charts.
      const histogramPromise = executeQuery(
        buildHistogramSql(monitorId, interval), startTime, endTime, "logs",
      ).then((histogramRows) => {
        buckets.value = mapHistogram(histogramRows, startTime, endTime);
      }).catch((e: unknown) => {
        buckets.value = [];
        histogramError.value = e instanceof Error ? e.message : String(e ?? "Histogram query failed");
      }).finally(() => {
        histogramLoading.value = false;
        histogramHasLoadedOnce.value = true;
      });

      // Group 3: Runs list — feeds timeline, breakdown cards, table,
      // steps tab, and errors tab. Typically the slowest query.
      const runsPromise = executeQuery(
        buildRunsSql(monitorId, 500, schemaFields), startTime, endTime, "logs",
      ).then((runsRows) => {
        runs.value = runsRows.map(mapRun);
      }).catch((e: unknown) => {
        runs.value = [];
        runsError.value = e instanceof Error ? e.message : String(e ?? "Runs query failed");
      }).finally(() => {
        runsLoading.value = false;
        runsHasLoadedOnce.value = true;
      });

      // Group 4: Steps — fetched via REST /runs API because the log
      // stream doesn't carry the step-level JSON fields.
      const stepsPromise = fetchAndAggregateSteps(
        monitorId, startTime, endTime,
      ).then((stats) => {
        stepStats.value = stats;
      }).catch((e: unknown) => {
        stepsError.value = e instanceof Error ? e.message : String(e ?? "Steps query failed");
      }).finally(() => {
        stepsLoading.value = false;
        stepsHasLoadedOnce.value = true;
      });

      // Wait for all to settle so callers that await fetchAll still
      // get a meaningful completion signal.
      await Promise.all([kpiPromise, histogramPromise, runsPromise, stepsPromise]);
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to load results";
      kpi.value = { ...EMPTY_KPI };
      buckets.value = [];
    } finally {
      loading.value = false;
      hasLoadedOnce.value = true;
    }
  }

  async function fetchRun(
    monitorId: string,
    runId: string,
    executionId: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !runId || !executionId) return;
    loading.value = true;
    error.value = null;
    runDetail.value = null;
    try {
      const rows = await executeQuery(
        buildRunDetailSql(monitorId, runId, executionId, await fetchSchemaFields()),
        startTime,
        endTime,
        "logs",
      );
      if (rows.length > 0) {
        runDetail.value = mapRunDetail(rows[0]);
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to load run";
      runDetail.value = null;
    } finally {
      loading.value = false;
      hasLoadedOnce.value = true;
    }
  }

  /** Detail row for a protocol (http/tcp/tls/ssh) run — no steps/replay. */
  async function fetchProtocolRun(
    monitorId: string,
    runId: string,
    executionId: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !runId || !executionId) return;
    loading.value = true;
    error.value = null;
    protocolRunDetail.value = null;
    try {
      const rows = await executeQuery(
        buildProtocolRunDetailSql(monitorId, runId, executionId, await fetchSchemaFields()),
        startTime,
        endTime,
        "logs",
      );
      if (rows.length > 0) {
        protocolRunDetail.value = mapProtocolRunDetail(rows[0]);
      }
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to load run";
      protocolRunDetail.value = null;
    } finally {
      loading.value = false;
      hasLoadedOnce.value = true;
    }
  }

  async function fetchSteps(
    monitorId: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !startTime || !endTime) return;
    stepsLoading.value = true;
    try {
      stepStats.value = await fetchAndAggregateSteps(monitorId, startTime, endTime);
    } catch {
      stepStats.value = emptyStepStats();
    } finally {
      stepsLoading.value = false;
      stepsHasLoadedOnce.value = true;
    }
  }

  return {
    kpi,
    buckets,
    runs,
    runDetail,
    protocolRunDetail,
    loading,
    error,
    hasLoadedOnce,
    kpiLoading,
    histogramLoading,
    runsLoading,
    kpiHasLoadedOnce,
    histogramHasLoadedOnce,
    runsHasLoadedOnce,
    stepsLoading,
    stepsHasLoadedOnce,
    stepStats,
    kpiError,
    histogramError,
    runsError,
    stepsError,
    effectiveP95Ms,
    fetchAll,
    fetchRun,
    fetchProtocolRun,
    fetchSteps,
    cancelAll,
  };
}

export default useSyntheticResults;
