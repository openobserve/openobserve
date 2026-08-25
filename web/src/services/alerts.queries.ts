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

import { queryOptions } from "@tanstack/vue-query";
import { quantizeRange } from "@/composables/query/queryClient";
import alerts from "./alerts";
import type { AlertHistoryQuery } from "./alerts";
import { alertKeys } from "./alerts.querykeys";

export const alertsListQuery = (
  org: string,
  folderId: string,
  query?: string,
  alertType?: string,
) =>
  queryOptions({
    queryKey: alertKeys.list(org, folderId, query, alertType),
    queryFn: async (): Promise<any[]> =>
      (
        await alerts.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          org,
          folderId,
          query ?? "",
          alertType ?? "",
        )
      ).data?.list ?? [],
    refetchOnWindowFocus: true,
  });

/**
 * The dependency graph's alert read: every folder, with the destination and
 * template refs the default path omits. Cached so the graph shares one entry
 * across the alert, destination and template pages instead of re-downloading
 * the org's full alert list per page.
 */
export const alertDependenciesQuery = (org: string) =>
  queryOptions({
    queryKey: alertKeys.dependencies(org),
    queryFn: async (): Promise<any[]> => {
      const res = await alerts.listByFolderId(
        1,
        0,
        "name",
        false,
        "",
        org,
        undefined,
        undefined,
        undefined,
        true,
      );
      return res.data?.list ?? res.data ?? [];
    },
  });

export const alertDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: alertKeys.detail(org, id),
    queryFn: async () => (await alerts.get_by_alert_id(org, id)).data,
  });

export const alertHistoryQuery = (org: string, query: AlertHistoryQuery) => {
  // Callers anchor start/end to a raw `now`, so without quantizing, every open
  // mints a new key and the cache never hits.
  const start = Number(query.start_time);
  const end = Number(query.end_time);
  const q: AlertHistoryQuery = { ...query };
  if (Number.isFinite(start) && Number.isFinite(end)) {
    const bucketed = quantizeRange(start, end);
    q.start_time = bucketed.start;
    q.end_time = bucketed.end;
  }
  return queryOptions({
    queryKey: alertKeys.history(org, q),
    queryFn: async () => (await alerts.getHistory(org, q)).data ?? {},
    refetchOnWindowFocus: true,
  });
};
