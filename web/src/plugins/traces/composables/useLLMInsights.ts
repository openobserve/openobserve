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

import { ref, type Ref } from "vue";
import { b64EncodeUnicode } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";
import { useStore } from "vuex";

export interface LLMKPI {
  requestCount: number;
  traceCount: number;
  errorCount: number;
  totalTokens: number;
  totalCost: number;
  avgDurationMicros: number;
  p95DurationMicros: number;
}

export interface LLMSparklineSeries {
  cost: number[];
  tokens: number[];
  traces: number[];
  p95Micros: number[];
  errorRate: number[];
}

const EMPTY_KPI: LLMKPI = {
  requestCount: 0,
  traceCount: 0,
  errorCount: 0,
  totalTokens: 0,
  totalCost: 0,
  avgDurationMicros: 0,
  p95DurationMicros: 0,
};

export function useLLMInsights() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();

  const kpi = ref<LLMKPI>({ ...EMPTY_KPI });
  const kpiPrev = ref<LLMKPI>({ ...EMPTY_KPI });
  const sparklines = ref<LLMSparklineSeries>({
    cost: [],
    tokens: [],
    traces: [],
    p95Micros: [],
    errorRate: [],
  });
  const loading = ref(false);
  const error = ref<string | null>(null);
  const hasLoadedOnce = ref(false);
  const availableStreams = ref<string[]>([]);
  const streamsLoaded = ref(false);

  let activeTraceIds: string[] = [];

  function cancelAll() {
    activeTraceIds.forEach((id) => {
      cancelStreamQueryBasedOnRequestId({
        trace_id: id,
        org_id: store.state.selectedOrganization.identifier,
      });
    });
    activeTraceIds = [];
  }

  function executeQuery(
    sql: string,
    streamName: string,
    startTime: number,
    endTime: number,
    onData: (hits: any[]) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const traceId = generateTraceContext().traceId;
      activeTraceIds.push(traceId);

      const useBase64 = store.state.zoConfig?.sql_base64_enabled;
      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query: {
              sql: useBase64 ? b64EncodeUnicode(sql) : sql,
              start_time: startTime,
              end_time: endTime,
              from: 0,
              size: 100,
            },
            ...(useBase64 ? { encoding: "base64" } : {}),
          },
          type: "search",
          pageType: "traces",
          searchType: "ui",
          traceId,
          org_id: store.state.selectedOrganization.identifier,
        },
        {
          data: (_payload: any, response: any) => {
            const hits: any[] = response.content?.results?.hits || [];
            if (hits.length > 0) onData(hits);
          },
          error: (response: any) => {
            activeTraceIds = activeTraceIds.filter((t) => t !== traceId);
            const message =
              response?.message ||
              response?.error ||
              response?.error_detail ||
              "Failed to fetch query data";
            const err: any = new Error(message);
            err.status = response?.status;
            err.code = response?.code;
            err.raw = response;
            reject(err);
          },
          complete: () => {
            activeTraceIds = activeTraceIds.filter((t) => t !== traceId);
            resolve();
          },
          reset: () => {},
        },
      );
    });
  }

  async function fetchKPIInto(
    target: Ref<LLMKPI>,
    streamName: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    // Reads only the new OTEL gen_ai_* semantic-convention fields. DataFusion
    // validates column references at parse time, so referencing a legacy
    // column that doesn't exist on the stream's schema fails the query — the
    // safe path forward is to use the standard fields exclusively.
    //
    // Errors are counted across all spans (not just those tagged with
    // `gen_ai_operation_name`) because OTel SDKs typically propagate the
    // failure to a deeper child span (e.g. `tool.tools_call`) that doesn't
    // itself carry the gen_ai operation attribute.
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE gen_ai_operation_name IS NOT NULL) as request_count,
        approx_distinct(trace_id) as trace_count,
        COUNT(*) FILTER (WHERE span_status = 'ERROR') as error_count,
        COALESCE(SUM(gen_ai_usage_total_tokens), 0) as total_tokens,
        COALESCE(SUM(gen_ai_usage_cost), 0) as total_cost,
        COALESCE(AVG(duration), 0) as avg_duration,
        COALESCE(approx_percentile_cont(duration, 0.95), 0) as p95_duration
      FROM "${streamName}"
    `;

    target.value = { ...EMPTY_KPI };
    await executeQuery(sql, streamName, startTime, endTime, (hits) => {
      const row = hits[0];
      target.value = {
        requestCount: Number(row.request_count) || 0,
        traceCount: Number(row.trace_count) || 0,
        errorCount: Number(row.error_count) || 0,
        totalTokens: Number(row.total_tokens) || 0,
        totalCost: Number(row.total_cost) || 0,
        avgDurationMicros: Number(row.avg_duration) || 0,
        p95DurationMicros: Number(row.p95_duration) || 0,
      };
    });
  }

  function bucketInterval(durationMicros: number): string {
    const seconds = durationMicros / 1_000_000;
    const target = seconds / 30;
    if (target < 30) return "10 seconds";
    if (target < 120) return "1 minute";
    if (target < 600) return "5 minutes";
    if (target < 1800) return "15 minutes";
    if (target < 3600) return "30 minutes";
    if (target < 21_600) return "1 hour";
    if (target < 86_400) return "6 hours";
    return "1 day";
  }

  async function fetchSparklines(
    streamName: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    const interval = bucketInterval(endTime - startTime);

    const mainSql = `
      SELECT
        histogram(_timestamp, '${interval}') as ts,
        COUNT(*) FILTER (WHERE gen_ai_operation_name IS NOT NULL) as request_count,
        approx_distinct(trace_id) as trace_count,
        COUNT(*) FILTER (WHERE span_status = 'ERROR') as error_count,
        COALESCE(SUM(gen_ai_usage_total_tokens), 0) as total_tokens,
        COALESCE(SUM(gen_ai_usage_cost), 0) as total_cost,
        COALESCE(approx_percentile_cont(duration, 0.95), 0) as p95_duration
      FROM "${streamName}"
      GROUP BY ts
      ORDER BY ts
    `;

    const series: LLMSparklineSeries = {
      cost: [],
      tokens: [],
      traces: [],
      p95Micros: [],
      errorRate: [],
    };

    const bucketOrder: string[] = [];
    const bucketIndex = new Map<string, number>();
    const ensureBucket = (ts: any): number => {
      const key = String(ts);
      let idx = bucketIndex.get(key);
      if (idx === undefined) {
        idx = bucketOrder.length;
        bucketOrder.push(key);
        bucketIndex.set(key, idx);
        series.cost.push(0);
        series.tokens.push(0);
        series.traces.push(0);
        series.p95Micros.push(0);
        series.errorRate.push(0);
      }
      return idx;
    };

    await executeQuery(mainSql, streamName, startTime, endTime, (hits) => {
      for (const row of hits) {
        const idx = ensureBucket(row.ts);
        const requestCount = Number(row.request_count) || 0;
        const errorCount = Number(row.error_count) || 0;
        series.tokens[idx] = Number(row.total_tokens) || 0;
        series.traces[idx] = Number(row.trace_count) || 0;
        series.p95Micros[idx] = Number(row.p95_duration) || 0;
        series.cost[idx] = Number(row.total_cost) || 0;
        series.errorRate[idx] =
          requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
      }
    });

    sparklines.value = series;
  }

  async function fetchAll(
    streamName: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    if (!streamName || !startTime || !endTime) return;
    loading.value = true;
    error.value = null;

    const windowDuration = endTime - startTime;
    const prevEnd = startTime;
    const prevStart = startTime - windowDuration;

    try {
      await Promise.all([
        fetchKPIInto(kpi, streamName, startTime, endTime),
        fetchKPIInto(kpiPrev, streamName, prevStart, prevEnd),
        fetchSparklines(streamName, startTime, endTime),
      ]);
      hasLoadedOnce.value = true;
    } catch (e: any) {
      error.value = e?.message || "Failed to fetch LLM insights";
      console.error("LLM Insights fetch error:", e);
    } finally {
      loading.value = false;
    }
  }

  return {
    kpi,
    kpiPrev,
    sparklines,
    loading,
    error,
    hasLoadedOnce,
    availableStreams,
    streamsLoaded,
    fetchAll,
    cancelAll,
  };
}
