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

  async function fetchAll(
    monitorId: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !startTime || !endTime) return;
    loading.value = true;
    error.value = null;
    try {
      const safe = (p: Promise<any[]>) => p.catch(() => [] as any[]);
      const interval = bucketInterval(endTime - startTime);
      const [kpiRows, lastRunRows, histogramRows, runsRows] = await Promise.all([
        safe(executeQuery(buildKpiSql(monitorId), startTime, endTime, "logs")),
        safe(executeQuery(buildLastRunSql(monitorId), startTime, endTime, "logs")),
        safe(executeQuery(buildHistogramSql(monitorId, interval), startTime, endTime, "logs")),
        safe(executeQuery(buildRunsSql(monitorId, 500), startTime, endTime, "logs")),
      ]);

      kpi.value = mapKpi(kpiRows[0] ?? null, lastRunRows[0] ?? null);
      buckets.value = mapHistogram(histogramRows, startTime, endTime);
      runs.value = runsRows.map(mapRun);
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
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!monitorId || !runId) return;
    loading.value = true;
    error.value = null;
    runDetail.value = null;
    try {
      const rows = await executeQuery(
        buildRunDetailSql(monitorId, runId),
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
    fetchAll,
    fetchRun,
    cancelAll,
  };
}

export default useSyntheticResults;
