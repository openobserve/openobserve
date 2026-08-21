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
import settings from "./settings";
import { settingKeys } from "./settings.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const settingQuery = (org: string, key: string, userId?: string) =>
  queryOptions({
    queryKey: settingKeys.one(org, key, userId),
    queryFn: async (): Promise<unknown> => {
      try {
        return (await settings.getSetting(org, key, userId)).data?.setting_value ?? null;
      } catch (e: any) {
        // "Never set" is a normal state — cache the null so an unset favourites
        // list stops re-requesting on every mount.
        if (e?.response?.status === 404) return null;
        throw e;
      }
    },
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });
