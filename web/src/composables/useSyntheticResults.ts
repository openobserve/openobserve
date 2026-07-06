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
  mapHistogram,
  mapKpi,
  mapRun,
  type SyntheticBucket,
  type SyntheticKpi,
  type SyntheticRun,
} from "@/composables/synthetics/syntheticResultsSchema";

const EMPTY_KPI: SyntheticKpi = {
  uptimePct: 0,
  p95Ms: 0,
  failedRuns: 0,
  totalRuns: 0,
  lastRunStatus: null,
  lastRunAt: null,
};

const RUNS_LIMIT = 100;

/**
 * Orchestration layer for the Monitor Results page. Builds SQL via the schema
 * module, runs the queries through the shared streaming-search runner, and maps
 * every raw response into typed models before exposing them. Components bind to
 * `kpi` / `buckets` / `runs` only — they never see raw hits or field names.
 */
export function useSyntheticResults() {
  const { executeQuery, cancelAll } = useLLMStreamQuery();

  const kpi = ref<SyntheticKpi>({ ...EMPTY_KPI });
  const buckets = ref<SyntheticBucket[]>([]);
  const runs = ref<SyntheticRun[]>([]);
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
      const [kpiRows, lastRunRows, histogramRows, runRows] = await Promise.all([
        safe(executeQuery(buildKpiSql(monitorId), startTime, endTime, "logs")),
        safe(executeQuery(buildLastRunSql(monitorId), startTime, endTime, "logs")),
        safe(executeQuery(buildHistogramSql(monitorId, interval), startTime, endTime, "logs")),
        safe(executeQuery(buildRunsSql(monitorId, RUNS_LIMIT), startTime, endTime, "logs")),
      ]);

      kpi.value = mapKpi(kpiRows[0] ?? null, lastRunRows[0] ?? null);
      buckets.value = mapHistogram(histogramRows, startTime, endTime);
      runs.value = runRows.map(mapRun);
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : "Failed to load results";
      kpi.value = { ...EMPTY_KPI };
      buckets.value = [];
      runs.value = [];
    } finally {
      loading.value = false;
      hasLoadedOnce.value = true;
    }
  }

  return {
    kpi,
    buckets,
    runs,
    loading,
    error,
    hasLoadedOnce,
    fetchAll,
    cancelAll,
  };
}

export default useSyntheticResults;
