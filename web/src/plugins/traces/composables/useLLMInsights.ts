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
import { gt } from "@/types/i18n";
import { b64EncodeUnicode, generateTraceContext } from "@/utils/zincutils";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { buildAgentTraceFilter } from "../llmAgentFilter";
import { compactSql } from "../config/llmInsightsPanels";
import { traceUsageSum } from "../llmAttribution";
import { TRACE_ERRORED_SQL } from "../llmTraceOutcome";
import useHttpStreaming from "@/composables/useStreamingSearch";
import { streamQueryError } from "./useLLMStreamQuery";
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

/** `WHERE <agent> AND <page filters>`, or "" for the whole stream. */
function scopeWhere(
  agent: GenAiAgentListItem | null | undefined,
  streamName: string,
  extraFilter: string,
): string {
  const clause = [buildAgentTraceFilter(agent, streamName), extraFilter]
    .filter(Boolean)
    .join(" AND ");
  return clause ? `WHERE ${clause}` : "";
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
 * loading/error flags, the discovered list of LLM streams) plus three
 * methods (`fetchAll`, `restore`, `cancelAll`).
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
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

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
          error: (_payload: any, response: any) => {
            activeTraceIds = activeTraceIds.filter((t) => t !== traceId);
            reject(streamQueryError(response));
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
   */
  async function fetchLatency(
    streamName: string,
    startTime: number,
    endTime: number,
    agent?: GenAiAgentListItem | null,
    extraFilter = "",
  ): Promise<number> {
    const sql = compactSql(`
      SELECT
        COALESCE(approx_percentile_cont(duration, 0.95) FILTER (WHERE gen_ai_operation_name IS NOT NULL), 0) as p95_duration
      FROM "${streamName}"
      ${scopeWhere(agent, streamName, extraFilter)}
    `);

    let p95 = 0;
    await executeQuery(sql, streamName, startTime, endTime, (hits) => {
      p95 = Number(hits[0].p95_duration) || 0;
    });
    return p95;
  }

  /**
   * Internal — fetch the bucketed time-series powering the sparklines
   * under each KPI card, plus the KPI totals. Two queries run in parallel:
   *
   *   - the histogram: sparkline series, and the request total summed over
   *     its buckets;
   *   - a whole-window per-trace query for the trace and error counts and
   *     the token and cost totals, exact so they agree with the per-trace
   *     panels. Distinct counts are not additive: a trace with spans in two
   *     buckets would be counted in both.
   *
   * `histogram(_timestamp)` is intentionally called WITHOUT an explicit
   * interval — the backend picks an appropriate bucket width for the
   * query window. We consume the returned rows in `ORDER BY ts` order,
   * so the frontend never needs to know the interval.
   *
   * Each trace's tokens and cost follow `traceUsageSum` (its LLM calls'
   * usage, else its agent span's), the rule Cost by, Users and Sessions use.
   * The sparklines apply it per bucket, so they only trace the shape. The
   * per-bucket error-rate SERIES divides each bucket's error count by its
   * trace count.
   */
  async function fetchSummary(
    streamName: string,
    startTime: number,
    endTime: number,
    agent?: GenAiAgentListItem | null,
    extraFilter = "",
  ): Promise<{ totals: Omit<LLMKPI, "p95DurationMicros">; series: LLMSparklineSeries }> {
    // One size must cover every bucket — there's no pagination here. 10_000
    // is a wide margin (even a 1-year window at a coarse interval stays under).
    const size = 10_000;

    const where = scopeWhere(agent, streamName, extraFilter);
    const mainSql = compactSql(`
      SELECT
        histogram(_timestamp) as ts,
        COUNT(*) FILTER (WHERE gen_ai_operation_name IS NOT NULL) as request_count,
        approx_distinct(trace_id) as trace_count,
        approx_distinct(trace_id) FILTER (WHERE span_status = 'ERROR') as error_count,
        ${traceUsageSum("gen_ai_usage_total_tokens")} as total_tokens,
        ${traceUsageSum("gen_ai_usage_cost")} as total_cost,
        COALESCE(approx_percentile_cont(duration, 0.95) FILTER (WHERE gen_ai_operation_name IS NOT NULL), 0) as p95_duration
      FROM "${streamName}"
      ${where}
      GROUP BY ts
      ORDER BY ts
    `);
    const totalsSql = compactSql(`
      SELECT
        COUNT(*) as trace_count,
        SUM(errored) as error_count,
        SUM(tokens) as total_tokens,
        SUM(cost) as total_cost
      FROM (
        SELECT trace_id,
          ${TRACE_ERRORED_SQL} as errored,
          ${traceUsageSum("gen_ai_usage_total_tokens")} as tokens,
          ${traceUsageSum("gen_ai_usage_cost")} as cost
        FROM "${streamName}"
        ${where}
        GROUP BY trace_id
      )
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

    const histogram = executeQuery(
      mainSql,
      streamName,
      startTime,
      endTime,
      (hits) => {
        // Rows arrive in `ORDER BY ts` order (across streaming chunks too),
        // so appending preserves the time-series order for the sparkline.
        for (const row of hits) {
          const traceCount = Number(row.trace_count) || 0;
          const errorCount = Number(row.error_count) || 0;
          const tokens = Number(row.total_tokens) || 0;
          const cost = Number(row.total_cost) || 0;

          series.tokens.push(tokens);
          series.traces.push(traceCount);
          series.p95Micros.push(Number(row.p95_duration) || 0);
          series.cost.push(cost);
          series.errorRate.push(traceCount > 0 ? (errorCount / traceCount) * 100 : 0);

          totals.requestCount += Number(row.request_count) || 0;
        }
      },
      size,
    );
    const counts = executeQuery(totalsSql, streamName, startTime, endTime, (hits) => {
      totals.traceCount = Number(hits[0].trace_count) || 0;
      totals.errorCount = Number(hits[0].error_count) || 0;
      totals.totalTokens = Number(hits[0].total_tokens) || 0;
      totals.totalCost = Number(hits[0].total_cost) || 0;
    });
    await Promise.all([histogram, counts]);

    return { totals, series };
  }

  /**
   * The single public fetch entry point. Kicks off two INDEPENDENT parts:
   *   - summary (histogram + whole-window trace/error counts) → `sparklines`
   *       + every `kpi` total but P95; drives `loading` (the KPI strip skeleton)
   *   - whole-window P95  → `kpi.p95DurationMicros`
   *       drives `p95Loading` (just the P95 card's loader)
   *
   * The two are decoupled ON PURPOSE: the summary cards render as soon as
   * their queries land instead of waiting on the slower P95 query, so
   * only the P95 card shows a loader while it's still in flight. A P95
   * failure degrades that card to "0" rather than failing the whole strip.
   *
   * `error` (cleared on entry, populated only on a summary rejection)
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
  // Bumped per fetchAll; a response only lands if its call is still the latest,
  // so a slower earlier load can't overwrite the tiles of a newer selection.
  let fetchSeq = 0;

  async function fetchAll(
    streamName: string,
    startTime: number,
    endTime: number,
    agent?: GenAiAgentListItem | null,
    extraFilter = "",
  ): Promise<{ kpi: LLMKPI; sparklines: LLMSparklineSeries } | null> {
    if (!streamName || !startTime || !endTime) return null;
    const seq = ++fetchSeq;
    const isLatest = () => seq === fetchSeq;
    loading.value = true;
    p95Loading.value = true;
    error.value = null;

    // This call's own results; the snapshot returned to the caller (KPI cache)
    // is built from these, never from the shared refs.
    const own: {
      summary?: { totals: Omit<LLMKPI, "p95DurationMicros">; series: LLMSparklineSeries };
      p95: number;
    } = { p95: 0 };

    // Summary: powers the sparklines and every KPI total but P95. Drives
    // the main strip skeleton via `loading` — resolves independently of P95.
    const summaryPromise = fetchSummary(streamName, startTime, endTime, agent, extraFilter)
      .then((summary) => {
        own.summary = summary;
        if (!isLatest()) return;
        const { totals, series } = summary;
        sparklines.value = series;
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
        if (!isLatest()) return;
        error.value = e?.message || gt("traces.failedToFetchLlmInsights");
        console.error("LLM Insights summary fetch error:", e);
      })
      .finally(() => {
        if (isLatest()) loading.value = false;
      });

    // Separate whole-window P95 with its own loader — never blocks the strip.
    // On failure the card degrades to "0" instead of failing the whole page.
    const p95Promise = fetchLatency(streamName, startTime, endTime, agent, extraFilter)
      .then((p95DurationMicros) => {
        own.p95 = p95DurationMicros;
      })
      .catch((e: any) => {
        console.error("LLM Insights P95 fetch error:", e);
        own.p95 = 0;
      })
      .finally(() => {
        if (!isLatest()) return;
        kpi.value = { ...kpi.value, p95DurationMicros: own.p95 };
        p95Loading.value = false;
      });

    await Promise.all([summaryPromise, p95Promise]);
    // Superseded or failed: nothing for the caller to cache.
    if (!isLatest() || !own.summary) return null;
    return {
      kpi: { ...EMPTY_KPI, ...own.summary.totals, p95DurationMicros: own.p95 },
      sparklines: own.summary.series,
    };
  }

  /**
   * Shows a cached selection's numbers. Supersedes any in-flight `fetchAll`, so
   * a slower load for the previous selection can't land on top of them.
   */
  function restore(snapshot: { kpi: LLMKPI; sparklines: LLMSparklineSeries }) {
    fetchSeq++;
    kpi.value = snapshot.kpi;
    sparklines.value = snapshot.sparklines;
    error.value = null;
    loading.value = false;
    p95Loading.value = false;
    hasLoadedOnce.value = true;
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
    restore,
    cancelAll,
  };
}
