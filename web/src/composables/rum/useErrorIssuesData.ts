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
  TREND_TOP_N,
  buildDenominatorsSql,
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
  pickLatestDeploy,
  type DeployInfo,
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
  const isLoadingTrends = ref(false);

  // Supersede in-flight runs: only the latest fetchAll may commit results.
  let runId = 0;

  const issuesTruncated = computed(
    () => issues.value.length >= ISSUES_LIMIT,
  );

  const kpis = computed(() => {
    const { totalErrors, errorSessions, usersAffected } = errorTotals.value;
    const { totalSessions, totalUsers } = denominators.value;
    const crashFreePct =
      totalSessions > 0 ? (1 - errorSessions / totalSessions) * 100 : null;
    return {
      totalErrors,
      uniqueIssues: issues.value.length,
      issuesTruncated: issuesTruncated.value,
      errorSessions,
      totalSessions,
      crashFreePct,
      usersAffected,
      totalUsers,
      newIssues: issues.value.filter((issue) => issue.status === "new")
        .length,
      deployVersion: latestDeploy.value?.version ?? null,
    };
  });

  const deploySpikeFactor = computed(() => {
    if (!latestDeploy.value || !chartSeries.value.length) return null;
    const deployTs = latestDeploy.value.firstSeen;
    const deployIndex = chartSeries.value.findIndex(
      (bucket) => bucket.ts >= deployTs,
    );
    return computeDeploySpikeFactor(
      chartSeries.value.map((bucket) => bucket.handled + bucket.unhandled),
      deployIndex,
    );
  });

  const runSearch = (
    sql: string,
    params: FetchIssuesParams,
    size: number,
  ): Promise<any[]> => {
    const req = buildQueryPayload({
      sqlMode: false,
      streamName: "_rumdata",
      timestamp_column: store.state.zoConfig.timestamp_column,
      timestamps: { startTime: params.startTime, endTime: params.endTime },
      size,
    } as any);
    // buildQueryPayload encodes its template SQL before we override it, so
    // the replacement must be re-encoded when base64 mode is active.
    req.query.sql =
      req.encoding === "base64" ? b64EncodeUnicode(sql) : sql;
    req.query.from = 0;
    req.query.size = size;
    delete req.aggs;
    return searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        },
        "RUM",
      )
      .then((res) => res.data.hits ?? []);
  };

  const fetchTrends = async (
    ctx: IssueQueryContext,
    params: FetchIssuesParams,
    interval: string,
    intervalMicros: number,
    currentRun: number,
  ) => {
    const topMessages = issues.value
      .slice(0, TREND_TOP_N)
      .map((issue) => issue.error_message ?? "")
      .filter(Boolean);
    const sql = buildTrendsSql(ctx, interval, topMessages);
    if (!sql) return;
    isLoadingTrends.value = true;
    try {
      const hits = await runSearch(sql, params, 5000);
      if (currentRun !== runId) return;
      trendBuckets.value = pivotTrends(
        hits,
        params.startTime,
        params.endTime,
        intervalMicros,
      );
    } catch {
      // Non-fatal: rows render without sparklines.
      if (currentRun === runId) trendBuckets.value = {};
    } finally {
      if (currentRun === runId) isLoadingTrends.value = false;
    }
  };

  const fetchAll = async (params: FetchIssuesParams): Promise<void> => {
    const currentRun = ++runId;
    const ctx: IssueQueryContext = {
      streamName: "_rumdata",
      timestampColumn: store.state.zoConfig.timestamp_column || "_timestamp",
      schema: params.schema,
      userQuery: params.userQuery,
      service: params.service,
    };
    const interval = getTimeInterval(params.startTime, params.endTime)
      .interval;
    const intervalMicros = intervalToMicros(interval);

    isLoadingIssues.value = true;
    isLoadingChart.value = true;
    isLoadingKpis.value = true;
    trendBuckets.value = {};

    const [issuesR, chartR, kpisR, denomR, deploysR] =
      await Promise.allSettled([
        runSearch(buildIssuesSql(ctx), params, ISSUES_LIMIT),
        runSearch(buildErrorsHistogramSql(ctx, interval), params, 2000),
        runSearch(buildErrorKpisSql(ctx), params, 10),
        runSearch(buildDenominatorsSql(ctx), params, 10),
        runSearch(buildDeploysSql(ctx), params, 10),
      ]);
    if (currentRun !== runId) return;

    // Deploys resolve before issues: status derivation needs the deploy ts.
    const deploys: DeployInfo[] =
      deploysR.status === "fulfilled"
        ? deploysR.value.map((hit: any) => ({
            version: String(hit.version),
            firstSeen: Number(hit.first_seen) || 0,
          }))
        : [];
    latestDeploy.value = pickLatestDeploy(
      deploys,
      params.startTime,
      params.endTime,
      intervalMicros,
    );
    const deployTs = latestDeploy.value?.firstSeen ?? null;

    if (issuesR.status === "fulfilled") {
      issues.value = issuesR.value.map((hit: any) => ({
        ...hit,
        events: Number(hit.events) || 0,
        users_affected:
          hit.users_affected !== undefined
            ? Number(hit.users_affected) || 0
            : undefined,
        status: computeIssueStatus(
          Number(hit.first_seen) || 0,
          deployTs,
          params.startTime,
          params.endTime,
        ),
      }));
    } else {
      issues.value = [];
      toast({
        message:
          (issuesR.reason as any)?.response?.data?.message ||
          "Error while fetching error events",
        variant: "error",
      });
    }
    isLoadingIssues.value = false;

    chartSeries.value =
      chartR.status === "fulfilled"
        ? pivotStackedHistogram(
            chartR.value,
            params.startTime,
            params.endTime,
            intervalMicros,
          )
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

    await fetchTrends(ctx, params, interval, intervalMicros, currentRun);
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
    isLoadingTrends,
    fetchAll,
    // Exposed for callers needing the users-field fallback (e.g. columns).
    pickUserField,
  };
};

export default useErrorIssuesData;
