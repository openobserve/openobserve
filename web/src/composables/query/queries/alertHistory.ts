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

/**
 * Alert history — server-paginated. Every server-applied parameter (time range,
 * page window, sort, alert filter) is in the key, so paging back to a page
 * already fetched is a cache hit and the table keeps its rows.
 */

import alertsService from "@/services/alerts";
import { qk, stableFilters } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

export interface AlertHistoryQuery {
  // string | number because the two callers build these differently and the
  // wrapper must not change what either of them sends.
  start_time: string | number;
  end_time: string | number;
  from: string | number;
  size: string | number;
  alert_id?: string;
  sort_by?: string;
  sort_order?: string;
  [extra: string]: unknown;
}

const options = (org: string, query: AlertHistoryQuery) => ({
  queryKey: qk.alerts.history(org, query.alert_id ?? "__all__", stableFilters(query) as never),
  queryFn: async (): Promise<any> => (await alertsService.getHistory(org, query)).data ?? {},
  ...tierOptions("ENTITY_LIST"),
});

export const fetchAlertHistoryPage = (org: string, query: AlertHistoryQuery): Promise<any> =>
  queryClient.fetchQuery(options(org, query));

export const refetchAlertHistory = (org: string, query: AlertHistoryQuery): Promise<any> =>
  queryClient.fetchQuery({ ...options(org, query), staleTime: 0 });

/** Warm the next page once the current one has settled. */
export const prefetchAlertHistoryPage = (org: string, query: AlertHistoryQuery): void => {
  void queryClient.prefetchQuery(options(org, query));
};
