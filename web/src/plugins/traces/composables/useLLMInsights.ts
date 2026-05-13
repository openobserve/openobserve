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

/**
 * Composable that owns the LLM Insights dashboard's state + fetch flow.
 *
 * Returns a bag of refs (KPI numbers for current + previous window,
 * sparkline series, loading/error flags, the discovered list of LLM
 * streams) plus two methods (`fetchAll`, `cancelAll`).
 *
 * State is per-mount: a fresh component instance gets a fresh set of
 * refs. The dashboard's `onMounted` is the single trigger for the
 * initial fetch, and `fetchAll` is also invoked on Refresh / stream
 * change. There's no caching layer — the dashboard always pulls fresh
 * numbers when asked (the parent's `Index.vue → searchData` decides
 * when to ask).
 *
 * @example
 *   const { kpi, kpiPrev, sparklines, loading, error, fetchAll } =
 *     useLLMInsights();
 *   await fetchAll("default", 1700000000000000, 1700001000000000);
 *   console.log(kpi.value.totalCost, kpi.value.totalTokens);
 */
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

  /**
   * Cancel every in-flight query started by THIS composable instance.
   * Called from the parent on org switch / unmount paths to free up
   * server-side resources and prevent stale results from arriving
   * after the user has moved on.
   *
   * @example
   *   onUnmounted(() => cancelAll());
   */
  function cancelAll() {
    activeTraceIds.forEach((id) => {
      cancelStreamQueryBasedOnRequestId({
        trace_id: id,
        org_id: store.state.selectedOrganization.identifier,
      });
    });
    activeTraceIds = [];
  }

  /**
   * Internal — fire one SQL query against the streaming search endpoint.
   *
   * Differs from `useLLMStreamQuery.executeQuery` in that this one drives
   * an `onData` callback as hits arrive (so we can update KPI / sparkline
   * series in-place) instead of accumulating + returning at completion.
   *
   * Resolves on `complete`. Rejects with an `Error` enriched with
   * `.status`, `.code`, `.raw` on the streaming endpoint's error event.
   *
   * @example (internal usage)
   *   await executeQuery("SELECT count(*) ...", "default", 100, 200, (hits) => {
   *     target.value.requestCount = Number(hits[0].count);
   *   });
   */
  function executeQuery(
    sql: string,
    streamName: string,
    startTime: number,
    endTime: number,
    onData: (hits: any[]) => void,
    size: number = 100,
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
              size,
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

  /**
   * Internal — fetch one KPI summary into the given ref. Used twice per
   * `fetchAll` call: once for the current window (→ `kpi`) and once for
   * the immediately preceding window of the same length (→ `kpiPrev`).
   * The "prev" numbers feed the "% vs prev" trend chips on the cards.
   *
   * Writes `{ ...EMPTY_KPI }` first so a partial response (server returns
   * 0 hits) leaves the target at a clean zero state instead of stale
   * values from a previous fetch.
   *
   * @example (internal)
   *   await fetchKPIInto(kpi, "default", 100, 200);          // current window
   *   await fetchKPIInto(kpiPrev, "default", 0, 100);        // previous window
   */
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

  /**
   * Pick a histogram bucket width that yields ~30 buckets across the
   * given window. Local copy of the same logic in
   * `config/llmInsightsPanels.ts → pickInterval` — duplicated so this
   * composable has zero coupling to the panels config (the sparkline
   * fetch needs the same alignment, but doesn't render any panel).
   *
   * @example (internal)
   *   bucketInterval(60 * 60 * 1_000_000) // "5 minutes" (1 hr window)
   */
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

  function intervalSeconds(interval: string): number {
    switch (interval) {
      case "10 seconds":
        return 10;
      case "1 minute":
        return 60;
      case "5 minutes":
        return 300;
      case "15 minutes":
        return 900;
      case "30 minutes":
        return 1800;
      case "1 hour":
        return 3600;
      case "6 hours":
        return 21_600;
      case "1 day":
        return 86_400;
      default:
        return 60;
    }
  }

  /**
   * Build the full UTC-aligned bucket grid for the given window. The
   * server's `histogram()` function aligns bucket starts to UTC interval
   * boundaries and emits an ISO-like key ("2026-05-08T06:00:00") for
   * each bucket *that has at least one matching row*. Sparse streams
   * therefore produce 1 hit even across a 2-week window, and the
   * sparkline would collapse to a single point.
   *
   * Pre-filling every bucket key with zeros guarantees a properly
   * shaped time-series no matter how sparse the data is — the chart
   * draws a flat line with peaks where real activity occurred, which is
   * what users expect from a trend sparkline.
   */
  function buildBucketGrid(
    startTimeMicros: number,
    endTimeMicros: number,
    intervalSecs: number,
  ): string[] {
    const stepMs = intervalSecs * 1000;
    const startMs = Math.floor(startTimeMicros / 1000 / stepMs) * stepMs;
    const endMs = Math.ceil(endTimeMicros / 1000 / stepMs) * stepMs;
    const keys: string[] = [];
    for (let t = startMs; t < endMs; t += stepMs) {
      // Match server format "YYYY-MM-DDTHH:mm:ss" (UTC, no Z, no millis).
      keys.push(new Date(t).toISOString().slice(0, 19));
    }
    return keys;
  }

  /**
   * Internal — fetch the bucketed time-series powering the sparklines
   * under each KPI card. One SQL query produces all 5 series (cost,
   * tokens, traces, p95 latency, error rate) so we don't pay for 5
   * round-trips per render.
   *
   * The error-rate series is computed client-side as
   * `error_count / request_count` per bucket — keeps the SQL simple and
   * lets a future frontend tweak (e.g. "errors per trace" instead) ship
   * without a backend change.
   *
   * Buckets are ordered by their `histogram()` timestamp string. We
   * keep an `ensureBucket` helper to materialise zero-filled positions
   * the first time a row arrives for a new bucket — guarantees all 5
   * series have the same length / x-coordinates.
   *
   * @example (internal)
   *   await fetchSparklines("default", 100, 200);
   *   // sparklines.value.cost is now an array of per-bucket cost values
   */
  async function fetchSparklines(
    streamName: string,
    startTime: number,
    endTime: number,
  ): Promise<void> {
    const interval = bucketInterval(endTime - startTime);
    // We need every bucket to render the sparkline — there is no
    // pagination story here. Pass a generous size so the streaming
    // endpoint never truncates the response. With the bucket ladder
    // capping at "1 day", the most we can ever produce is ~bucket
    // count for the largest window users pick (e.g. 1 year = 365
    // rows). 10_000 leaves a wide safety margin.
    const size = 10_000;

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

    const intervalSecs = intervalSeconds(interval);
    const bucketKeys = buildBucketGrid(startTime, endTime, intervalSecs);
    const bucketIndex = new Map<string, number>();
    bucketKeys.forEach((k, i) => bucketIndex.set(k, i));

    const series: LLMSparklineSeries = {
      cost: new Array(bucketKeys.length).fill(0),
      tokens: new Array(bucketKeys.length).fill(0),
      traces: new Array(bucketKeys.length).fill(0),
      p95Micros: new Array(bucketKeys.length).fill(0),
      errorRate: new Array(bucketKeys.length).fill(0),
    };

    await executeQuery(
      mainSql,
      streamName,
      startTime,
      endTime,
      (hits) => {
        for (const row of hits) {
          const idx = bucketIndex.get(String(row.ts));
          if (idx === undefined) continue;
          const requestCount = Number(row.request_count) || 0;
          const errorCount = Number(row.error_count) || 0;
          series.tokens[idx] = Number(row.total_tokens) || 0;
          series.traces[idx] = Number(row.trace_count) || 0;
          series.p95Micros[idx] = Number(row.p95_duration) || 0;
          series.cost[idx] = Number(row.total_cost) || 0;
          series.errorRate[idx] =
            requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
        }
      },
      size,
    );

    sparklines.value = series;
  }

  /**
   * The single public fetch entry point. Kicks off (in parallel):
   *   - KPI summary for the current window     → `kpi`
   *   - KPI summary for the previous window    → `kpiPrev` (for trend chips)
   *   - bucketed sparkline series              → `sparklines`
   *
   * Manages `loading` (true while any sub-query is in flight) and
   * `error` (cleared on entry, populated on rejection). Catches errors
   * itself so callers don't have to wrap in try/catch — they read
   * `error.value` after `await fetchAll(...)` resolves.
   *
   * Bails out as a no-op for missing/zero arguments — the dashboard
   * renders the streamLoaded skeleton until a real window is in props.
   *
   * @example
   *   await fetchAll("default", 1700000000000000, 1700001000000000);
   *   if (error.value) console.error(error.value);
   *   else console.log(kpi.value.totalCost);
   */
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
