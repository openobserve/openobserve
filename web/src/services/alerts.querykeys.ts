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

import { orgKey } from "@/composables/query/keys";
import { stableFilters } from "@/composables/query/queryClient";
import type { AlertHistoryQuery } from "./alerts";

/**
 * Keys only, dependency-free apart from `orgKey`, so a write in another domain
 * can drop this scope without importing this domain's transport — and so two
 * domains invalidating each other cannot form an import cycle.
 *
 * `all` is the invalidation scope; the rest are entries beneath it.
 */
export const alertKeys = {
  all: (org: string) => orgKey(org, "alerts"),
  list: (org: string, folderId: string, query?: string, alertType?: string) =>
    query
      ? orgKey(org, "alerts", "search", folderId || "__all__", {
          q: query,
          type: alertType || "all",
        })
      : orgKey(org, "alerts", "list", folderId, alertType || "all"),
  detail: (org: string, id: string) => orgKey(org, "alerts", "detail", id),
  /** Every folder's alerts with their destination/template refs — the dep graph. */
  dependencies: (org: string) => orgKey(org, "alerts", "dependencies"),
  historyAll: (org: string) => orgKey(org, "alerts", "history"),
  history: (org: string, query: AlertHistoryQuery) =>
    orgKey(
      org,
      "alerts",
      "history",
      query.alert_id ?? "__all__",
      stableFilters(query as Record<string, unknown>),
    ),
};
