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

import { ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import {
  bucketInterval,
  buildHistogramSql,
  buildKpiSql,
  buildLastRunSql,
  buildRunsSql,
  buildRunDetailSql,
  mapHistogram,
  mapKpi,
  mapRun,
  mapRunDetail,
  type SyntheticBucket,
  type SyntheticKpi,
  type SyntheticRun,
  type SyntheticRunDetail,
} from "@/composables/synthetics/syntheticResultsSchema";

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
 * Runs data is fetched separately via the REST /runs endpoint in MonitorResultsDashboard.
 */
export function useSyntheticResults() {
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  const kpi = ref<SyntheticKpi>({ ...EMPTY_KPI });
  const buckets = ref<SyntheticBucket[]>([]);
  const runs = ref<SyntheticRun[]>([]);
  const runDetail = ref<SyntheticRunDetail | null>(null);
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
    error.value = null;
    try {
      const safe = (p: Promise<any[]>) => p.catch(() => [] as any[]);
      const interval = bucketInterval(endTime - startTime);

      // Group 1: KPI + last-run — both feed KPI cards. Resolves
      // independently so the KPI section renders as soon as these
      // fast queries complete, without waiting for the runs list.
      const kpiPromise = Promise.all([
        safe(executeQuery(buildKpiSql(monitorId), startTime, endTime, "logs")),
        safe(executeQuery(buildLastRunSql(monitorId), startTime, endTime, "logs")),
      ]).then(([kpiRows, lastRunRows]) => {
        kpi.value = mapKpi(kpiRows[0] ?? null, lastRunRows[0] ?? null);
      }).finally(() => {
        kpiLoading.value = false;
        kpiHasLoadedOnce.value = true;
      });

      // Group 2: Histogram — feeds response-time and errors charts.
      const histogramPromise = safe(
        executeQuery(buildHistogramSql(monitorId, interval), startTime, endTime, "logs"),
      ).then((histogramRows) => {
        buckets.value = mapHistogram(histogramRows, startTime, endTime);
      }).finally(() => {
        histogramLoading.value = false;
        histogramHasLoadedOnce.value = true;
      });

      // Group 3: Runs list — feeds timeline, breakdown cards, table,
      // steps tab, and errors tab. Typically the slowest query.
      const runsPromise = safe(
        executeQuery(buildRunsSql(monitorId, 500), startTime, endTime, "logs"),
      ).then((runsRows) => {
        runs.value = runsRows.map(mapRun);
      }).finally(() => {
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
        buildRunDetailSql(monitorId, runId, executionId),
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

  return {
    kpi,
    buckets,
    runs,
    runDetail,
    loading,
    error,
    hasLoadedOnce,
    kpiLoading,
    histogramLoading,
    runsLoading,
    kpiHasLoadedOnce,
    histogramHasLoadedOnce,
    runsHasLoadedOnce,
    fetchAll,
    fetchRun,
    cancelAll,
  };
}

export default useSyntheticResults;
