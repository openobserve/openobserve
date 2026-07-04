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
import { b64EncodeUnicode } from "@/utils/zincutils";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { buildAgentTraceFilter } from "../llmAgentFilter";
import { compactSql } from "../config/llmInsightsPanels";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { generateTraceContext } from "@/utils/zincutils";
import { useStore } from "vuex";

export interface LLMKPI {
  requestCount: number;
  traceCount: number;
  errorCount: number;
  totalTokens: number;
  totalCost: number;
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
  p95DurationMicros: 0,
};

/**
 * Composable that owns the LLM Insights dashboard's state + fetch flow.
 *
 * Returns a bag of refs (whole-window KPI numbers, sparkline series,
 * loading/error flags, the discovered list of LLM streams) plus two
 * methods (`fetchAll`, `cancelAll`).
 *
 * State is per-mount: a fresh component instance gets a fresh set of
 * refs. The dashboard's `onMounted` is the single trigger for the
 * initial fetch, and `fetchAll` is also invoked on Refresh / stream
 * change. There's no caching layer — the dashboard always pulls fresh
 * numbers when asked (the parent's `Index.vue → searchData` decides
 * when to ask).
 *
 * @example
 *   const { kpi, sparklines, loading, error, fetchAll } =
 *     useLLMInsights();
 *   await fetchAll("default", 1700000000000000, 1700001000000000);
 *   console.log(kpi.value.totalCost, kpi.value.totalTokens);
 */
export function useLLMInsights() {
  const store = useStore();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreaming();

  const kpi = ref<LLMKPI>({ ...EMPTY_KPI });
  const sparklines = ref<LLMSparklineSeries>({
    cost: [],
    tokens: [],
    traces: [],
    p95Micros: [],
    errorRate: [],
  });
  const loading = ref(false);
  // Separate flag for the P95 card — it rides its own whole-window query, so
  // the rest of the strip (histogram-backed) never blocks on it.
  const p95Loading = ref(false);
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
   * Internal — fetch the whole-window P95 latency (the one KPI card that
   * can't be derived from the histogram, since percentiles aren't
   * additive across buckets — you can't average per-bucket P95s to get
   * the overall P95).
   *
   * Scoped to LLM calls via a per-aggregate FILTER on
   * `gen_ai_operation_name IS NOT NULL` — "P95 Latency" means "how slow
   * are the model calls", so the fast child/tool spans must be excluded
   * or they drag the tail down. This matches the dedicated Latency trend
   * panel and the sparkline's per-bucket P95.
   *
   * @example (internal)
   *   const p95 = await fetchLatency("default", 100, 200);
   */
  async function fetchLatency(
    streamName: string,
    startTime: number,
    endTime: number,
    agent?: GenAiAgentListItem | null,
  ): Promise<number> {
    const agentFilter = buildAgentTraceFilter(agent, streamName);
    const sql = compactSql(`
      SELECT
        COALESCE(approx_percentile_cont(duration, 0.95) FILTER (WHERE gen_ai_operation_name IS NOT NULL), 0) as p95_duration
      FROM "${streamName}"
      ${agentFilter ? `WHERE ${agentFilter}` : ""}
    `);

    let p95 = 0;
    await executeQuery(sql, streamName, startTime, endTime, (hits) => {
      p95 = Number(hits[0].p95_duration) || 0;
    });
    return p95;
  }

  /**
   * Internal — fetch the bucketed time-series powering the sparklines
   * under each KPI card, and derive the additive KPI totals (cost,
   * tokens, traces, errors, requests) by summing those same buckets.
   * One SQL query serves both the strip and the sparklines, so we don't
   * pay for a separate whole-window rollup.
   *
   * `histogram(_timestamp)` is intentionally called WITHOUT an explicit
   * interval — the backend picks an appropriate bucket width for the
   * query window. We consume the returned rows in `ORDER BY ts` order,
   * so the frontend never needs to know the interval.
   *
   * Summing is exact for the additive aggregates (SUM(tokens), SUM(cost),
   * COUNT(requests)). `trace_count` / `error_count` use `approx_distinct`,
   * so a trace with spans in two buckets is counted in both — the sums
   * can run slightly high, which is an accepted tradeoff for serving the
   * whole strip from one query. The error-rate CARD divides the summed
   * error count by the summed trace count; the per-bucket error-rate
   * SERIES is computed the same way per bucket.
   *
   * @example (internal)
   *   const totals = await fetchSummary("default", 100, 200);
   *   // sparklines.value.cost is now an array of per-bucket cost values
   *   // totals.totalCost is the summed whole-window cost
   */
  async function fetchSummary(
    streamName: string,
    startTime: number,
    endTime: number,
    agent?: GenAiAgentListItem | null,
  ): Promise<Omit<LLMKPI, "p95DurationMicros">> {
    // We need every bucket to render the sparkline — there is no
    // pagination story here. Pass a generous size so the streaming
    // endpoint never truncates the response. Even a 1-year window at a
    // coarse auto-interval stays well under this, so 10_000 leaves a
    // wide safety margin.
    const size = 10_000;

    const agentFilter = buildAgentTraceFilter(agent, streamName);
    const mainSql = compactSql(`
      SELECT
        histogram(_timestamp) as ts,
        COUNT(*) FILTER (WHERE gen_ai_operation_name IS NOT NULL) as request_count,
        approx_distinct(trace_id) as trace_count,
        approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') as error_count,
        COALESCE(SUM(gen_ai_usage_total_tokens), 0) as total_tokens,
        COALESCE(SUM(gen_ai_usage_cost), 0) as total_cost,
        COALESCE(approx_percentile_cont(duration, 0.95) FILTER (WHERE gen_ai_operation_name IS NOT NULL), 0) as p95_duration
      FROM "${streamName}"
      ${agentFilter ? `WHERE ${agentFilter}` : ""}
      GROUP BY ts
      ORDER BY ts
    `);

    const series: LLMSparklineSeries = {
      cost: [],
      tokens: [],
      traces: [],
      p95Micros: [],
      errorRate: [],
    };
    const totals = {
      requestCount: 0,
      traceCount: 0,
      errorCount: 0,
      totalTokens: 0,
      totalCost: 0,
    };

    await executeQuery(
      mainSql,
      streamName,
      startTime,
      endTime,
      (hits) => {
        // Rows arrive in `ORDER BY ts` order (across streaming chunks too),
        // so appending preserves the time-series order for the sparkline.
        for (const row of hits) {
          const requestCount = Number(row.request_count) || 0;
          const traceCount = Number(row.trace_count) || 0;
          const errorCount = Number(row.error_count) || 0;
          const tokens = Number(row.total_tokens) || 0;
          const cost = Number(row.total_cost) || 0;

          series.tokens.push(tokens);
          series.traces.push(traceCount);
          series.p95Micros.push(Number(row.p95_duration) || 0);
          series.cost.push(cost);
          series.errorRate.push(
            traceCount > 0 ? (errorCount / traceCount) * 100 : 0,
          );

          totals.requestCount += requestCount;
          totals.traceCount += traceCount;
          totals.errorCount += errorCount;
          totals.totalTokens += tokens;
          totals.totalCost += cost;
        }
      },
      size,
    );

    sparklines.value = series;
    return totals;
  }

  /**
   * The single public fetch entry point. Kicks off two INDEPENDENT queries:
   *   - histogram summary → `sparklines` + the additive `kpi` totals
   *       drives `loading` (the main KPI strip skeleton)
   *   - whole-window P95  → `kpi.p95DurationMicros`
   *       drives `p95Loading` (just the P95 card's loader)
   *
   * The two are decoupled ON PURPOSE: the histogram-backed cards render as
   * soon as that query lands instead of waiting on the slower P95 query, so
   * only the P95 card shows a loader while it's still in flight. A P95
   * failure degrades that card to "0" rather than failing the whole strip.
   *
   * `error` (cleared on entry, populated only on the histogram rejection)
   * is caught internally so callers don't wrap in try/catch — they read
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
    agent?: GenAiAgentListItem | null,
  ): Promise<void> {
    if (!streamName || !startTime || !endTime) return;
    loading.value = true;
    p95Loading.value = true;
    error.value = null;

    // Histogram: powers the sparklines AND the additive KPI totals. Drives
    // the main strip skeleton via `loading` — resolves independently of P95.
    const summaryPromise = fetchSummary(streamName, startTime, endTime, agent)
      .then((totals) => {
        // Preserve whatever the (independent) P95 query has set so far — it's
        // patched into `p95DurationMicros` separately when it resolves.
        kpi.value = {
          ...EMPTY_KPI,
          ...totals,
          p95DurationMicros: kpi.value.p95DurationMicros,
        };
        hasLoadedOnce.value = true;
      })
      .catch((e: any) => {
        error.value = e?.message || "Failed to fetch LLM insights";
        console.error("LLM Insights summary fetch error:", e);
      })
      .finally(() => {
        loading.value = false;
      });

    // Separate whole-window P95 with its own loader — never blocks the strip.
    // On failure the card degrades to "0" instead of failing the whole page.
    const p95Promise = fetchLatency(streamName, startTime, endTime, agent)
      .then((p95DurationMicros) => {
        kpi.value = { ...kpi.value, p95DurationMicros };
      })
      .catch((e: any) => {
        console.error("LLM Insights P95 fetch error:", e);
        kpi.value = { ...kpi.value, p95DurationMicros: 0 };
      })
      .finally(() => {
        p95Loading.value = false;
      });

    // Await both so callers (e.g. the KPI cache) see a fully-populated `kpi`.
    await Promise.all([summaryPromise, p95Promise]);
  }

  return {
    kpi,
    sparklines,
    loading,
    p95Loading,
    error,
    hasLoadedOnce,
    availableStreams,
    streamsLoaded,
    fetchAll,
    cancelAll,
  };
}
