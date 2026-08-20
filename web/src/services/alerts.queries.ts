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

export const alertDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: alertKeys.detail(org, id),
    queryFn: async () => (await alerts.get_by_alert_id(org, id)).data,
  });

export const alertHistoryQuery = (org: string, query: AlertHistoryQuery) =>
  queryOptions({
    queryKey: alertKeys.history(org, query),
    queryFn: async () => (await alerts.getHistory(org, query)).data ?? {},
    refetchOnWindowFocus: true,
  });
