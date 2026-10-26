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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import { quantizeRange } from "@/composables/query/queryClient";
import reports from "./reports";
import type {
  ReportHistoryQuery,
  ReportHistoryResponse,
  ReportListFilters,
  TriggerReportResponse,
} from "./reports";
import { reportKeys } from "./reports.querykeys";
import { LIVE_STALE_TIME, NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";

export const reportsQuery = (org: string, filters: ReportListFilters) =>
  queryOptions({
    queryKey: reportKeys.list(org, filters),
    queryFn: async (): Promise<any[]> =>
      (
        await reports.listByFolderId(
          org,
          filters.folder,
          undefined,
          filters.isCache,
          filters.nameQuery || undefined,
        )
      ).data ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

/** Background callers pass `silentForbidden` so a 403 stays out of the grouped access toast. */
export const reportByIdQuery = (
  org: string,
  reportId: string,
  options?: { silentForbidden?: boolean },
) =>
  queryOptions({
    queryKey: reportKeys.detail(org, reportId),
    queryFn: async () => (await reports.getReportById(org, reportId, options)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const reportHistoryQuery = (org: string, query: ReportHistoryQuery) => {
  // Callers anchor the range to a raw `now`; only the key buckets, so this minute's runs stay in.
  const bucketed = quantizeRange(query.start_time, query.end_time);
  return queryOptions({
    queryKey: reportKeys.history(org, {
      ...query,
      start_time: bucketed.start,
      end_time: bucketed.end,
    }),
    queryFn: async (): Promise<ReportHistoryResponse> =>
      (await reports.getHistory(org, query)).data,
    staleTime: LIVE_STALE_TIME,
  });
};

export const reportRunQuery = (
  org: string,
  reportId: string | undefined,
  timestamp: number,
  retries: number,
  orgWide = false,
) =>
  queryOptions({
    queryKey: reportKeys.run(org, reportId, timestamp, retries, orgWide),
    queryFn: async (): Promise<ReportHistoryResponse> =>
      (
        await reports.getHistory(org, {
          ...(orgWide ? { run_report_id: reportId } : { report_id: reportId }),
          start_time: timestamp,
          end_time: timestamp + 1,
          retries,
          size: 3,
          from: 0,
          sort_by: "_timestamp",
          sort_order: "asc",
        })
      ).data,
    staleTime: LIVE_STALE_TIME,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** Three save shapes, one scope: `reportKeys.all` also covers the cross-folder search entry a Vuex prune never reached. */
export const saveReportMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { payload: any; reportId?: string; folderId?: string; isEdit: boolean }) => {
      if (vars.isEdit && vars.reportId) {
        return reports.updateReportById(org, vars.reportId, vars.payload);
      }
      if (vars.isEdit) return reports.updateReport(org, vars.payload);
      return reports.createReportV2(org, vars.payload, vars.folderId);
    },
    // The form composes create-vs-update wording for both outcomes itself.
    meta: { invalidates: [reportKeys.all(org)], silentError: true },
  });

type ReportRunOperation = Readonly<{ org: string; reportId: string }>;

/** A recorded error changes metadata too; variables pin settlement across option changes. */
export const triggerReportMutation = (org: string) =>
  mutationOptions({
    onMutate: (variables: string | ReportRunOperation): ReportRunOperation =>
      typeof variables === "string" ? { org, reportId: variables } : { ...variables },
    mutationFn: async (variables: string | ReportRunOperation) => {
      const operation = typeof variables === "string" ? { org, reportId: variables } : variables;
      return (await reports.triggerReportById(operation.org, operation.reportId)).data;
    },
    onSettled: (_data, error, _variables, operation, context) => {
      const recorded = (error as { response?: { data?: TriggerReportResponse } } | null)?.response
        ?.data?.run;
      if (!operation || (error && !recorded)) return;
      void context.client.invalidateQueries({ queryKey: reportKeys.all(operation.org) });
    },
    meta: { silentError: true },
  });
