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
import aiToolsets from "./ai_toolsets";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const aiToolsetsQuery = (org: string) =>
  queryOptions({
    queryKey: aiToolsetKeys.list(org),
    queryFn: async (): Promise<any[]> =>
      (await aiToolsets.list(org, { limit: 100000 })).data?.toolsets ?? [],
    staleTime: NORMAL_STALE_TIME,
    persister: localStoragePersister,
  });
