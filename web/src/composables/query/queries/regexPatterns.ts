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

/**
 * Built-in regex patterns — ship with the release, so they are static for the
 * session and persisted. Replaces the bespoke `RegexPatternCache`
 * sessionStorage class.
 *
 * Org-scoped despite being "built-in" because the endpoint is.
 */

import regexPatternsService from "@/services/regex_pattern";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

export const builtInRegexPatternsQueryOptions = (org: string) => ({
  queryKey: qk.settings.builtInRegexPatterns(org),
  queryFn: async (): Promise<any[]> =>
    (await regexPatternsService.getBuiltInPatterns(org)).data.patterns ?? [],
  ...tierOptions("SESSION_STATIC"),
});

export const fetchBuiltInRegexPatterns = (org: string): Promise<any[]> =>
  queryClient.fetchQuery(builtInRegexPatternsQueryOptions(org));

/** Manual refresh from the tab's refresh button. */
export const refetchBuiltInRegexPatterns = (org: string): Promise<any[]> =>
  queryClient.fetchQuery({ ...builtInRegexPatternsQueryOptions(org), staleTime: 0 });

export const isBuiltInRegexPatternsCached = (org: string): boolean =>
  queryClient.getQueryData(qk.settings.builtInRegexPatterns(org)) !== undefined;
