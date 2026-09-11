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
import type { ReportListFilters } from "./reports";

/**
 * Keys only, dependency-free apart from `orgKey`, so a write in another domain
 * can drop this scope without importing this domain's transport — and so two
 * domains invalidating each other cannot form an import cycle.
 *
 * `all` is the invalidation scope; the rest are entries beneath it.
 */
export const reportKeys = {
  all: (org: string) => orgKey(org, "reports"),
  list: (org: string, filters: ReportListFilters) =>
    orgKey(
      org,
      "reports",
      "list",
      filters.folder ?? "__all__",
      stableFilters({ isCache: filters.isCache, nameQuery: filters.nameQuery }),
    ),
  detail: (org: string, id: string) => orgKey(org, "reports", "detail", id),
};
