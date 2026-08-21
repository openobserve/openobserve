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
import stream from "./stream";
import type { StreamPageParams } from "./stream";
import { streamKeys } from "./stream.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const streamNameListQuery = (org: string, type: string) =>
  queryOptions({
    queryKey: streamKeys.nameList(org, type),
    // `schema: false` deliberately — schemas are fetched per stream on demand.
    queryFn: async (): Promise<any[]> => (await stream.nameList(org, type, false)).data.list ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

export const streamPageQuery = (org: string, type: string, params: StreamPageParams) =>
  queryOptions({
    queryKey: streamKeys.page(org, type, params),
    queryFn: async (): Promise<{ list: any[]; total: number }> => {
      const res = await stream.nameList(
        org,
        type,
        false,
        params.offset,
        params.limit,
        params.keyword ?? "",
        params.sort ?? "",
        params.asc ?? false,
      );
      return { list: res.data.list ?? [], total: res.data.total ?? 0 };
    },
    refetchOnWindowFocus: true,
  });
