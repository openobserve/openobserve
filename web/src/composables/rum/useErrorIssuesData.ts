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

import { computed, ref, type Ref } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import useQuery from "@/composables/useQuery";
import { toast } from "@/lib/feedback/Toast/useToast";
import { b64EncodeUnicode } from "@/utils/zincutils";
import {
  ISSUES_LIMIT,
  buildDenominatorsSql,
  buildDeployLookbackSql,
  buildDeploysSql,
  buildErrorKpisSql,
  buildErrorsHistogramSql,
  buildIssuesSql,
  buildTrendsSql,
  pickUserField,
  pivotStackedHistogram,
  pivotTrends,
  type IssueQueryContext,
  type StackedBucket,
} from "@/utils/rum/errorIssueQueries";
import {
  computeDeploySpikeFactor,
  computeIssueStatus,
  intervalToMicros,
  issueKey,
  pickLatestDeploy,
  type DeployInfo,
  type IssueSignature,
  type IssueStatus,
} from "@/utils/rum/errorIssueUtils";

export interface ErrorIssue {
  zo_sql_timestamp: number;
  first_seen: number;
  events: number;
  users_affected?: number;
  sessions_affected?: number;
  error_type?: string;
  error_message?: string;
  error_handling?: string;
  latest_error_id?: string;
  error_stack?: string;
  service?: string;
  view_url?: string;
  session_id?: string;
  status: IssueStatus;
}

export interface FetchIssuesParams {
  startTime: number;
  endTime: number;
  schema: Record<string, boolean>;
  userQuery: string;
  service: string;
}

// Aborting a superseded/unmounted run rejects its in-flight requests. Those are OUR
// cancellations, not failures, so they must not raise an error toast or squiggle.
const isAbortError = (err: any): boolean =>
  err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || err?.name === "AbortError";

const useErrorIssuesData = () => {
  const store = useStore();
  const { getTimeInterval, buildQueryPayload } = useQuery();

  const issues: Ref<ErrorIssue[]> = ref([]);
  const trendBuckets: Ref<Record<string, number[]>> = ref({});
  const chartSeries: Ref<StackedBucket[]> = ref([]);
  const latestDeploy: Ref<DeployInfo | null> = ref(null);
  const errorTotals = ref({
    totalErrors: 0,
    errorSessions: 0,
    usersAffected: 0,
  });
  const denominators = ref({ totalSessions: 0, totalUsers: 0 });

  const isLoadingIssues = ref(false);
  const isLoadingChart = ref(false);
  const isLoadingKpis = ref(false);

  // Raw server error ({ code, message, error_detail }) from the last issues
  // search, or null when the last run succeeded. The view watches this to
  // squiggle the offending field in the filter editor.
  const lastQueryError = ref<any>(null);

  // Supersede in-flight runs: only the latest fetchAll may commit results.
  let runId = 0;
  // runId only discards STALE RESULTS — the requests behind them still run to completion
  // and still hold slots in the server's per-user work-group concurrency queue. Entering
  // this tab fires 5 concurrent searches (issues, chart, kpis, denominators, deploys) plus
  // a lazy trend fetch per visible row, so abandoned runs are what leave the queue full
  // for the next tab, whose overflow then gets cancelled and returns HTTP 429.
  // This aborts them for real.
  let runController = new AbortController();

  const issuesTruncated = computed(() => issues.value.length >= ISSUES_LIMIT);

  const kpis = computed(() => {
    const { totalErrors, errorSessions, usersAffected } = errorTotals.value;
    const { totalSessions, totalUsers } = denominators.value;
    const crashFreePct = totalSessions > 0 ? (1 - errorSessions / totalSessions) * 100 : null;
    return {
      totalErrors,
      uniqueIssues: issues.value.length,
      issuesTruncated: issuesTruncated.value,
      errorSessions,
      totalSessions,
      crashFreePct,
      usersAffected,
      totalUsers,
      newIssues: issues.value.filter((issue) => issue.status === "new").length,
      deployVersion: latestDeploy.value?.version ?? null,
    };
  });

  const deploySpikeFactor = computed(() => {
    if (!latestDeploy.value || !chartSeries.value.length) return null;
    const deployTs = latestDeploy.value.firstSeen;
    const deployIndex = chartSeries.value.findIndex((bucket) => bucket.ts >= deployTs);
    return computeDeploySpikeFactor(
      chartSeries.value.map((bucket) => bucket.handled + bucket.unhandled),
      deployIndex,
    );
  });

  const runSearch = (
    sql: string,
    params: FetchIssuesParams,
    size: number,
    rangeOverride?: { startTime: number; endTime: number },
    signal?: AbortSignal,
  ): Promise<any[]> => {
    const range = rangeOverride ?? params;
    const req = buildQueryPayload({
      sqlMode: false,
      streamName: "_rumdata",
      timestamp_column: store.state.zoConfig.timestamp_column,
      timestamps: { startTime: range.startTime, endTime: range.endTime },
      size,
    } as any);
    // buildQueryPayload encodes its template SQL before we override it, so
    // the replacement must be re-encoded when base64 mode is active.
    req.query.sql = req.encoding === "base64" ? b64EncodeUnicode(sql) : sql;
    req.query.from = 0;
    req.query.size = size;
    delete req.aggs;
    return searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
          signal,
        },
        "RUM",
      )
      .then((res) => res.data.hits ?? []);
  };

  // ── Lazy per-row trends ─────────────────────────────────────────
  // Trend sparklines are fetched per issue when the row scrolls into
  // view (same pattern as the sessions activity sparkline): cached by
  // issue key, deduplicated in flight, capped at 4 concurrent queries.
  const TREND_CONCURRENCY = 4;
  let trendContext: {
    ctx: IssueQueryContext;
    params: FetchIssuesParams;
    interval: string;
    intervalMicros: number;
  } | null = null;
  const trendInFlight = new Map<string, Promise<void>>();
  let trendActiveQueries = 0;
  const trendQueue: Array<() => void> = [];

  const acquireTrendSlot = (): Promise<void> =>
    new Promise((resolve) => {
      if (trendActiveQueries < TREND_CONCURRENCY) {
        trendActiveQueries++;
        resolve();
      } else {
        trendQueue.push(() => {
          trendActiveQueries++;
          resolve();
        });
      }
    });

  const releaseTrendSlot = () => {
    trendActiveQueries--;
    trendQueue.shift()?.();
  };

  // Trend sparklines are the lowest-priority searches on the page — one per visible row,
  // fired lazily as rows scroll into view. They are held behind this gate while a load's
  // issues list and window aggregates are in flight, so they never compete with those for
  // the server's 4 work-group slots (the same staging the sessions activity sparklines
  // use). The current load releases the gate once its aggregates settle.
  let trendGate: Promise<void> = Promise.resolve();
  let releaseTrendGateFn: (() => void) | null = null;
  const holdTrendQueries = () => {
    if (releaseTrendGateFn) return;
    trendGate = new Promise((resolve) => {
      releaseTrendGateFn = resolve;
    });
  };
  const releaseTrendQueries = () => {
    releaseTrendGateFn?.();
    releaseTrendGateFn = null;
  };

  /**
   * Fetch the histogram for one issue's sparkline. `trendBuckets[key]`
   * stays absent until resolution (cell shows a skeleton), then holds the
   * bucket array — empty on failure/no data (cell shows an em-dash).
   */
  const fetchTrend = (issue: IssueSignature): Promise<void> => {
    const key = issueKey(issue);
    if (trendBuckets.value[key] || !trendContext) return Promise.resolve();
    const inFlight = trendInFlight.get(key);
    if (inFlight) return inFlight;

    const currentRun = runId;
    // Capture the controller for THIS run: fetchAll swaps in a new one, and a trend
    // request must observe the run it belongs to, not whichever is current when its
    // queued slot finally frees.
    const trendSignal = runController.signal;
    const { ctx, params, interval, intervalMicros } = trendContext;
    const sql = buildTrendsSql(ctx, interval, [issue.error_message ?? ""]);
    if (!sql) {
      trendBuckets.value = { ...trendBuckets.value, [key]: [] };
      return Promise.resolve();
    }

    const request = (async () => {
      // Wait behind this load's issues list + window aggregates before taking a slot, so
      // the rows that render after stage 1 don't fire their trend queries on top of the
      // aggregate fan-out and blow past the work-group limit.
      await trendGate;
      // Superseded or unmounted before a slot was even taken — nothing to release.
      if (currentRun !== runId || trendSignal.aborted) return;
      await acquireTrendSlot();
      try {
        if (currentRun !== runId || trendSignal.aborted) return;
        const hits = await runSearch(sql, params, 2000, undefined, trendSignal);
        if (currentRun !== runId) return;
        const pivoted = pivotTrends(hits, params.startTime, params.endTime, intervalMicros);
        // A message shared by several signatures resolves siblings too.
        trendBuckets.value = {
          ...trendBuckets.value,
          [key]: pivoted[key] ?? [],
          ...pivoted,
        };
      } catch {
        if (currentRun === runId) {
          trendBuckets.value = { ...trendBuckets.value, [key]: [] };
        }
      } finally {
        releaseTrendSlot();
      }
    })().finally(() => {
      trendInFlight.delete(key);
    });
    trendInFlight.set(key, request);
    return request;
  };

  // Shape a raw issues hit into an ErrorIssue. deployTs may be null on first paint (the
  // deploy query lands in stage 2); computeIssueStatus falls back to a window heuristic.
  const mapIssue = (
    hit: any,
    deployTs: number | null,
    params: FetchIssuesParams,
  ): ErrorIssue => ({
    ...hit,
    events: Number(hit.events) || 0,
    users_affected:
      hit.users_affected !== undefined ? Number(hit.users_affected) || 0 : undefined,
    status: computeIssueStatus(
      Number(hit.first_seen) || 0,
      deployTs,
      params.startTime,
      params.endTime,
    ),
  });

  // Zero the above-the-table state (chart, KPI cards, deploy marker) without querying —
  // used when the list is empty or failed, so no follow-up searches are spent.
  const clearAggregates = () => {
    chartSeries.value = [];
    latestDeploy.value = null;
    errorTotals.value = { totalErrors: 0, errorSessions: 0, usersAffected: 0 };
    denominators.value = { totalSessions: 0, totalUsers: 0 };
    isLoadingChart.value = false;
    isLoadingKpis.value = false;
  };

  const fetchAll = async (params: FetchIssuesParams): Promise<void> => {
    const currentRun = ++runId;
    // Supersede whatever the previous run left in flight before starting.
    runController.abort();
    runController = new AbortController();
    const signal = runController.signal;
    const ctx: IssueQueryContext = {
      streamName: "_rumdata",
      timestampColumn: store.state.zoConfig.timestamp_column || "_timestamp",
      schema: params.schema,
      userQuery: params.userQuery,
      service: params.service,
    };
    const interval = getTimeInterval(params.startTime, params.endTime).interval;
    const intervalMicros = intervalToMicros(interval);

    isLoadingIssues.value = true;
    isLoadingChart.value = true;
    isLoadingKpis.value = true;
    trendBuckets.value = {};
    // New run: lazy trend fetches use this context; stale in-flight
    // requests are discarded by the runId guard.
    trendContext = { ctx, params, interval, intervalMicros };
    trendInFlight.clear();

    // Hold the per-row trend sparklines until this load's list + aggregates finish.
    holdTrendQueries();

    try {
      // ── Stage 1: the issues list ──────────────────────────────────────────────
      // The search the user actually came for. Everything else (chart, KPI cards, deploy
      // marker) sits ABOVE the table and only makes sense once there are issues to
      // describe. Fire it ALONE and wait: firing all five searches at once is 5 concurrent
      // against a 4-search work-group cap, and the overflow — queued, then cancelled —
      // comes back as HTTP 429 (ErrorCodes::SearchCancelQuery maps to 429).
      let issuesHits: any[];
      try {
        issuesHits = await runSearch(buildIssuesSql(ctx), params, ISSUES_LIMIT, undefined, signal);
      } catch (err) {
        if (currentRun !== runId) return;
        issues.value = [];
        lastQueryError.value = (err as any)?.response?.data ?? null;
        isLoadingIssues.value = false;
        // A superseded/aborted run is our own cancellation, not a failure — no toast.
        if (!isAbortError(err)) {
          toast({
            message:
              (err as any)?.response?.data?.message || "Error while fetching error events",
            variant: "error",
          });
        }
        // No usable list → nothing above the table is worth fetching. Zero it and stop.
        clearAggregates();
        return;
      }
      if (currentRun !== runId) return;

      lastQueryError.value = null;
      // Render the list immediately with a provisional status (no deploy ts yet); stage 2
      // refines "new vs ongoing" once the deploy query lands.
      issues.value = issuesHits.map((hit: any) => mapIssue(hit, null, params));
      isLoadingIssues.value = false;

      if (issuesHits.length === 0) {
        // Empty window: the chart, KPI and deploy queries all share this WHERE clause and
        // range, so they would only confirm zero. Skip them and clear the strip.
        clearAggregates();
        return;
      }

      // ── Stage 2: the above-the-table aggregates ───────────────────────────────
      // Only reached when the list has rows. Four concurrent searches — at the cap, and
      // the trend sparklines are still held, so nothing overflows.
      const [chartR, kpisR, denomR, deploysR] = await Promise.allSettled([
        runSearch(buildErrorsHistogramSql(ctx, interval), params, 2000, undefined, signal),
        runSearch(buildErrorKpisSql(ctx), params, 10, undefined, signal),
        runSearch(buildDenominatorsSql(ctx), params, 10, undefined, signal),
        runSearch(buildDeploysSql(ctx), params, 10, undefined, signal),
      ]);
      if (currentRun !== runId) return;

      const deploys: DeployInfo[] =
        deploysR.status === "fulfilled"
          ? deploysR.value.map((hit: any) => ({
              version: String(hit.version),
              firstSeen: Number(hit.first_seen) || 0,
            }))
          : [];
      let deployCandidate = pickLatestDeploy(
        deploys,
        params.startTime,
        params.endTime,
        intervalMicros,
      );
      // Verify the candidate is genuinely new: MIN(_timestamp) is bounded by
      // the window, so a long-lived version with sparse traffic can "first
      // appear" mid-window and fake a deploy. Any events in the equal-length
      // lookback range before the window disqualify it. Unverifiable (query
      // error) also hides the marker — a false deploy is worse than none.
      if (deployCandidate) {
        const lookbackSpan = params.endTime - params.startTime;
        try {
          const lookbackHits = await runSearch(
            buildDeployLookbackSql(ctx, deployCandidate.version),
            params,
            10,
            {
              startTime: params.startTime - lookbackSpan,
              endTime: params.startTime - 1,
            },
            signal,
          );
          if (currentRun !== runId) return;
          if (Number(lookbackHits[0]?.prior_events) > 0) deployCandidate = null;
        } catch {
          if (currentRun !== runId) return;
          deployCandidate = null;
        }
      }
      latestDeploy.value = deployCandidate;
      const deployTs = latestDeploy.value?.firstSeen ?? null;

      // Deploy ts is known now — re-derive each issue's new/ongoing status.
      if (deployTs !== null) {
        issues.value = issues.value.map((issue) => ({
          ...issue,
          status: computeIssueStatus(
            Number(issue.first_seen) || 0,
            deployTs,
            params.startTime,
            params.endTime,
          ),
        }));
      }

      chartSeries.value =
        chartR.status === "fulfilled"
          ? pivotStackedHistogram(chartR.value, params.startTime, params.endTime, intervalMicros)
          : [];
      isLoadingChart.value = false;

      // KPI queries degrade independently — cards show zeros/absent values.
      const kpiHit = kpisR.status === "fulfilled" ? kpisR.value[0] : null;
      errorTotals.value = {
        totalErrors: Number(kpiHit?.total_errors) || 0,
        errorSessions: Number(kpiHit?.error_sessions) || 0,
        usersAffected: Number(kpiHit?.users_affected) || 0,
      };
      const denomHit = denomR.status === "fulfilled" ? denomR.value[0] : null;
      denominators.value = {
        totalSessions: Number(denomHit?.total_sessions) || 0,
        totalUsers: Number(denomHit?.total_users) || 0,
      };
      isLoadingKpis.value = false;
    } finally {
      // Stage 3: release the trend sparklines — but only if THIS load is still current.
      // holdTrendQueries() is a no-op while the gate is already held, so a superseded load
      // must not release it: the load that replaced it owns the gate and releases it when
      // its own stages finish.
      if (currentRun === runId) releaseTrendQueries();
    }
  };

  return {
    issues,
    trendBuckets,
    chartSeries,
    latestDeploy,
    deploySpikeFactor,
    kpis,
    issuesTruncated,
    isLoadingIssues,
    isLoadingChart,
    isLoadingKpis,
    fetchAll,
    fetchTrend,
    /**
     * Abort every search this composable has in flight. Call on unmount: the server
     * keeps a work-group slot reserved until each request completes, so an abandoned
     * run starves whichever view the user opened next.
     */
    cancelAll: () => {
      runController.abort();
      runController = new AbortController();
      trendInFlight.clear();
      // Release the gate so a held-but-abandoned load never leaves future trend fetches
      // waiting forever on it.
      releaseTrendQueries();
      isLoadingIssues.value = false;
      isLoadingChart.value = false;
      isLoadingKpis.value = false;
    },
    // Raw server error from the last issues search (for editor highlighting).
    lastQueryError,
    // Exposed for callers needing the users-field fallback (e.g. columns).
    pickUserField,
  };
};

export default useErrorIssuesData;
