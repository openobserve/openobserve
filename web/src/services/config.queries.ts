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
import zo_config from "./config";
import { configKeys } from "./config.querykeys";
import { SESSION_STALE_TIME } from "@/composables/query/cachePolicy";

/** Not org-scoped: rooted at the global segment so only logout purges it. */
export const configQuery = () =>
  queryOptions({
    queryKey: configKeys.get(),
    queryFn: async () => (await zo_config.get_config()).data,
    staleTime: SESSION_STALE_TIME,
    gcTime: SESSION_STALE_TIME,
  });
