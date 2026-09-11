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
import cipherKeys from "./cipher_keys";
import { cipherKeyKeys } from "./cipher_keys.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";

export const cipherKeysQuery = (org: string) =>
  queryOptions({
    queryKey: cipherKeyKeys.list(org),
    queryFn: async (): Promise<any[]> => (await cipherKeys.list(org)).data?.keys ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
  });

export const cipherKeyDetailQuery = (org: string, name: string) =>
  queryOptions({
    queryKey: cipherKeyKeys.detail(org, name),
    queryFn: async () => (await cipherKeys.get_by_name(org, name)).data,
  });
