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
import regexPatterns from "./regex_pattern";
import { regexPatternKeys } from "./regex_pattern.querykeys";
import {
  CONFIG_STALE_TIME,
  LONG_GC_TIME,
  SESSION_STALE_TIME,
} from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const regexPatternsQuery = (org: string) =>
  queryOptions({
    queryKey: regexPatternKeys.list(org),
    queryFn: async (): Promise<any[]> => (await regexPatterns.list(org)).data?.patterns ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

export const builtInRegexPatternsQuery = (org: string) =>
  queryOptions({
    queryKey: regexPatternKeys.builtIn(org),
    queryFn: async (): Promise<any[]> =>
      (await regexPatterns.getBuiltInPatterns(org)).data.patterns ?? [],
    staleTime: SESSION_STALE_TIME,
    gcTime: SESSION_STALE_TIME,
    persister: localStoragePersister,
  });
