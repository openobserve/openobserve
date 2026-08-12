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

import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";
import {
  CONFIG_STALE_TIME,
  LONG_GC_TIME,
  SESSION_STALE_TIME,
} from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";
type PatternPayload = {
  name: string;
  pattern: string;
  description: string;
};
const regexPatterns = {
  list: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/re_patterns`);
  },
  create: (org_identifier: string, payload: PatternPayload) => {
    return http().post(`/api/${org_identifier}/re_patterns`, payload);
  },
  update: (org_identifier: string, id: string, payload: any) => {
    return http().put(`/api/${org_identifier}/re_patterns/${id}`, payload);
  },
  delete: (org_identifier: string, id: string) => {
    return http().delete(`/api/${org_identifier}/re_patterns/${id}`);
  },
  bulkDelete: (org_identifier: string, data: any) => {
    return http().delete(`/api/${org_identifier}/re_patterns/bulk`, { data });
  },
  test: (org_identifier: string, pattern: string, test_records: Array<string>, policy?: string) => {
    const payload: any = { pattern, test_records };
    if (policy) {
      payload.policy = policy;
    }
    return http().post(`/api/${org_identifier}/re_patterns/test`, payload);
  },
  getBuiltInPatterns: (
    org_identifier: string,
    params?: {
      search?: string;
      tags?: string[];
    },
  ) => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append("search", params.search);
    if (params?.tags) params.tags.forEach((tag) => queryParams.append("tags", tag));

    const queryString = queryParams.toString();
    const url = `/api/${org_identifier}/re_patterns/built-in${queryString ? "?" + queryString : ""}`;

    return http().get(url);
  },
};

export default regexPatterns;

export const regexPatternsQuery = defineQuery<[], any[]>({
  key: ["settings", "regexPatterns"],
  fetch: async (org) => (await regexPatterns.list(org)).data?.patterns ?? [],
  staleTime: CONFIG_STALE_TIME,
  gcTime: LONG_GC_TIME,
  persister: localStoragePersister,
  scope: ["settings", "regexPatterns"],
});

/** Ships with the release, so static for the session. Replaces RegexPatternCache. */
export const builtInRegexPatternsQuery = defineQuery<[], any[]>({
  key: ["settings", "builtInRegexPatterns"],
  fetch: async (org) => (await regexPatterns.getBuiltInPatterns(org)).data.patterns ?? [],
  staleTime: SESSION_STALE_TIME,
  gcTime: SESSION_STALE_TIME,
  persister: localStoragePersister,
  scope: ["settings", "builtInRegexPatterns"],
});
