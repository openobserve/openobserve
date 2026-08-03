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
  buildRetryAttributionSql,
  foldRetryAttribution,
  buildLastRunSql,
  buildRunsSql,
  buildRunsWithStepsSql,
  buildStepDefsSql,
  foldStepDefs,
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
  passedRuns: 0,
  warningRuns: 0,
  failedRuns: 0,
  errorRuns: 0,
  totalRuns: 0,
  retriedRuns: 0,
  flakyExecutions: 0,
  degradedExecutions: 0,
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
    // Same shape `emptyStepStats()` returns; the initial value was missed when
    // `coverage` was added, and only `tsconfig.app.json` is strict enough to say so.
    coverage: { executions: 0, fromMs: 0, toMs: 0, truncated: false },
  });

  // ── Stream schema fields ─────────────────────────────────────────────────
  //
  // The stream schema only contains fields some ingested row has carried
  // (browser-only fields are absent on protocol-only deployments, `error`
  // is absent until a run has failed, …) and the search API rejects queries
  // naming absent fields. Query builders take this set and substitute
  // literals for missing columns. getStream caches, so repeat calls are cheap.
  /**
   * Field names present in the stream schema.
   *
   * On failure this returns an EMPTY set, which makes every optional column
   * select a typed literal instead of its name. That is the only option that
   * cannot fail — naming a column the schema lacks is rejected outright by the
   * search API, and the schema genuinely lacks `status_reason` until some run
   * has been a `warning`.
   *
   * The cost is that a schema-fetch failure is indistinguishable from a stream
   * that has none of these fields: `init_ms` reads 0, `attempts` reads 0 and
   * `retry_history` reads '', so the run detail renders with no init chip, no
   * queue delay and no attempts strip — a fetch failure presented as a run that
   * simply had none of those things.
   *
   * Hence the log. It is the only signal that the degraded render is a failure
   * rather than the data, and it cost real debugging time to work that out once.
   */
  async function fetchSchemaFields(): Promise<Set<string>> {
    try {
      const stream: any = await getStream(SYNTHETIC_RESULTS_STREAM, "logs", true);
      const fields = ((stream?.schema ?? []) as { name: string }[]).map((f) => f.name);
      if (!fields.length) {
        // eslint-disable-next-line no-console
        console.warn(
          "[synthetics] stream schema returned no fields; optional columns will render as empty",
        );
      }
      return new Set(fields);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.warn(
        "[synthetics] stream schema unavailable — optional columns (init_ms, attempts, " +
          "retry_history, …) will render as empty, NOT as absent data:",
        e,
      );
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
      let hasRetryAttribution = false;
      let hasStatusReason = false;
      try {
        const stream: any = await getStream(SYNTHETIC_RESULTS_STREAM, "logs", true);
        const schema: { name: string }[] = stream?.schema ?? [];
        hasRetryHistory = schema.some((f) => f.name === "retry_history");
        hasRetryAttribution = schema.some((f) => f.name === "retry_step_ids");
        hasStatusReason = schema.some((f) => f.name === "status_reason");
      } catch {
        // Schema not available — omit retry_history, which is safe.
      }
      // C7 — once the probe writes `retry_step_ids`, the flaky column is
      // answered by three scalars on the rows that actually retried, so the
      // ~1 KB-per-attempt `retry_history` blob stops being fetched across all
      // 5000 rows. Until then the old path still works, unchanged.
      const useAttribution = hasRetryAttribution;
      const selectRetryHistory = hasRetryHistory && !useAttribution;
      /** Set when the attribution query failed, so its results are not treated
       *  as "nothing retried". */
      let attributionFailed = false;

      const STEP_RUNS_LIMIT = 5000;
      // Two queries rather than one (P1a): the wide tally without
      // `recorded_steps`, and a bounded fetch of the step definitions. Selecting
      // the definitions on all 5000 rows shipped the same ~4 KB blob 5000 times
      // — roughly 60% of this panel's payload.
      const STEP_DEFS_LIMIT = 100;
      const [hits, defHits, retryHits] = await Promise.all([
        executeQuery(
          buildRunsWithStepsSql(monitorId, STEP_RUNS_LIMIT, selectRetryHistory),
          startTime,
          endTime,
          "logs",
        ) as Promise<Record<string, unknown>[]>,
        executeQuery(
          buildStepDefsSql(monitorId, STEP_DEFS_LIMIT),
          startTime,
          endTime,
          "logs",
        ) as Promise<Record<string, unknown>[]>,
        useAttribution
          ? (executeQuery(
              buildRetryAttributionSql(monitorId, STEP_RUNS_LIMIT, hasStatusReason),
              startTime,
              endTime,
              "logs",
            ).catch((e: unknown) => {
              // Isolated deliberately. These three queries share a Promise.all,
              // so an unhandled rejection here emptied the ENTIRE Steps tab —
              // Fail Rate, durations and all — to report one missing column.
              // Degrade the flaky column instead, and say so rather than
              // rendering a silent zero.
              // eslint-disable-next-line no-console
              console.warn("[synthetics] retry attribution query failed:", e);
              attributionFailed = true;
              return [] as Record<string, unknown>[];
            }) as Promise<Record<string, unknown>[]>)
          : Promise.resolve([] as Record<string, unknown>[]),
      ]);
      const stepDefs = foldStepDefs(defHits);
      if (!hits.length) return emptyStepStats();

      return aggregateStepStats(
        hits,
        startTime,
        endTime,
        stepDefs,
        useAttribution && !attributionFailed ? foldRetryAttribution(retryHits) : undefined,
        STEP_RUNS_LIMIT,
      );
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
      coverage: { executions: 0, fromMs: 0, toMs: 0, truncated: false },
    };
  }

  /**
   * Loads everything the Overview tab needs.
   *
   * Steps are deliberately NOT part of this: the step aggregation reads the
   * REST /runs endpoint row by row and is the most expensive query on the page,
   * while the Steps tab is the one the fewest visits ever open. Callers drive it
   * separately through `fetchSteps` when the tab is actually in view.
   */
  async function fetchAll(monitorId: string, startTime: number, endTime: number): Promise<void> {
    if (!monitorId || !startTime || !endTime) return;
    loading.value = true;
    kpiLoading.value = true;
    histogramLoading.value = true;
    runsLoading.value = true;
    error.value = null;

    // Clear per-group errors on each fresh fetch so a successful retry
    // removes any previously shown error state.
    kpiError.value = null;
    histogramError.value = null;
    runsError.value = null;

    try {
      const interval = bucketInterval(endTime - startTime);

      const schemaFields = await fetchSchemaFields();
      const hasAttemptsField = schemaFields.has("attempts");
      const hasStatusReasonField = schemaFields.has("status_reason");

      // Group 1: KPI + last-run — both feed KPI cards. Resolves
      // independently so the KPI section renders as soon as these
      // fast queries complete, without waiting for the runs list.
      const kpiPromise = Promise.all([
        executeQuery(
          buildKpiSql(monitorId, hasAttemptsField, hasStatusReasonField),
          startTime,
          endTime,
          "logs",
        ),
        executeQuery(buildLastRunSql(monitorId), startTime, endTime, "logs"),
      ])
        .then(([kpiRows, lastRunRows]) => {
          kpi.value = mapKpi(kpiRows[0] ?? null, lastRunRows[0] ?? null);
        })
        .catch((e: unknown) => {
          kpi.value = { ...EMPTY_KPI };
          kpiError.value = e instanceof Error ? e.message : String(e ?? "KPI query failed");
        })
        .finally(() => {
          kpiLoading.value = false;
          kpiHasLoadedOnce.value = true;
        });

      // Group 2: Histogram — feeds response-time and errors charts.
      const histogramPromise = executeQuery(
        buildHistogramSql(monitorId, interval),
        startTime,
        endTime,
        "logs",
      )
        .then((histogramRows) => {
          buckets.value = mapHistogram(histogramRows, startTime, endTime);
        })
        .catch((e: unknown) => {
          buckets.value = [];
          histogramError.value =
            e instanceof Error ? e.message : String(e ?? "Histogram query failed");
        })
        .finally(() => {
          histogramLoading.value = false;
          histogramHasLoadedOnce.value = true;
        });

      // Group 3: Runs list — feeds timeline, breakdown cards, table,
      // steps tab, and errors tab. Typically the slowest query.
      const runsPromise = executeQuery(
        buildRunsSql(monitorId, 1000, schemaFields),
        startTime,
        endTime,
        "logs",
      )
        .then((runsRows) => {
          runs.value = runsRows.map(mapRun);
        })
        .catch((e: unknown) => {
          runs.value = [];
          runsError.value = e instanceof Error ? e.message : String(e ?? "Runs query failed");
        })
        .finally(() => {
          runsLoading.value = false;
          runsHasLoadedOnce.value = true;
        });

      // Wait for all to settle so callers that await fetchAll still
      // get a meaningful completion signal.
      await Promise.all([kpiPromise, histogramPromise, runsPromise]);
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

  /**
   * Step aggregation for the Steps tab — fetched via the REST /runs API because
   * the log stream doesn't carry the step-level JSON fields.
   *
   * Called on its own rather than from `fetchAll`, so the Steps tab pays for
   * this only when it is opened or its window changes underneath it.
   */
  async function fetchSteps(monitorId: string, startTime: number, endTime: number): Promise<void> {
    if (!monitorId || !startTime || !endTime) return;
    stepsLoading.value = true;
    stepsError.value = null;
    try {
      stepStats.value = await fetchAndAggregateSteps(monitorId, startTime, endTime);
    } catch (e: unknown) {
      stepStats.value = emptyStepStats();
      stepsError.value = e instanceof Error ? e.message : String(e ?? "Steps query failed");
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
