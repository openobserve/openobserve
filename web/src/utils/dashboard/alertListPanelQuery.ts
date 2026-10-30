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
import http from "@/services/http";
import { orgKey } from "@/composables/query/keys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";

/** Under the org's `alerts` key, so every alert write that refreshes alerts refreshes the panel too. */
export const alertListPanelKey = (org: string, folderId: string) =>
  orgKey(org, "alerts", "panel", folderId || "__all__");

/** The alerts an alert list panel shows: the Alerts page's list endpoint; a 403 is an answer, not a toast. */
export const alertListPanelQuery = (org: string, folderId: string) =>
  queryOptions({
    queryKey: alertListPanelKey(org, folderId),
    queryFn: async (): Promise<{ alerts: any[]; forbidden: boolean }> => {
      let url = `/api/v2/${org}/alerts?sort_by=name&desc=false&name=`;
      if (folderId) url += `&folder=${encodeURIComponent(folderId)}`;
      try {
        const res = await http().get(url, { skipAccessToast: true });
        return { alerts: res.data?.list ?? [], forbidden: false };
      } catch (err: any) {
        if (err?.response?.status === 403) return { alerts: [], forbidden: true };
        throw err;
      }
    },
    staleTime: LIVE_STALE_TIME,
  });
