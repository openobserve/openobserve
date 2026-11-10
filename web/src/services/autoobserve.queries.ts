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

import { infiniteQueryOptions, queryOptions } from "@tanstack/vue-query";
import autoobserve, {
  type AutoObserveCoverage,
  type AutoObserveCoverageView,
  type AutoObserveIncidentList,
  type AutoObservePagingSettings,
  type AutoObserveSuggestionList,
} from "./autoobserve";
import { autoobserveKeys } from "./autoobserve.querykeys";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import type { IssuesRange } from "@/components/autoobserve/v2/fixtures";
import {
  PAGED_POLL_MS,
  anyLive,
  issuesRangeStart,
  nextIssuesOffset,
} from "@/components/autoobserve/live/incidentsCopy";

export const autoobserveCoverageQuery = (org: string, view: AutoObserveCoverageView) =>
  queryOptions({
    queryKey: autoobserveKeys.coverage(org, view),
    queryFn: async (): Promise<AutoObserveCoverage> => (await autoobserve.coverage(org, view)).data,
    staleTime: LIVE_STALE_TIME,
  });

// One page of proposed suggestions in the panel's rank order; total counts every proposed one.
export const autoobserveSuggestionsPageQuery = (
  org: string,
  limit: number,
  offset: number,
  kind?: string,
) =>
  queryOptions({
    queryKey: autoobserveKeys.suggestionsPage(org, limit, offset, kind),
    queryFn: async (): Promise<AutoObserveSuggestionList> =>
      (
        await autoobserve.suggestions(org, {
          status: "proposed",
          sort: "priority",
          limit,
          offset,
          ...(kind ? { kind } : {}),
        })
      ).data,
    staleTime: LIVE_STALE_TIME,
  });

const LOCATE_PAGE = 500;
const LOCATE_CAP = 5_000;

// The list route has no id filter, so a linked suggestion's rank is found by scanning in the drawer's order; -1 when it is no longer proposed.
export const autoobserveSuggestionRankQuery = (org: string, id: string, kind?: string) =>
  queryOptions({
    queryKey: autoobserveKeys.suggestionRank(org, id, kind),
    queryFn: async (): Promise<number> => {
      for (let offset = 0; offset < LOCATE_CAP; offset += LOCATE_PAGE) {
        const page = (
          await autoobserve.suggestions(org, {
            status: "proposed",
            sort: "priority",
            limit: LOCATE_PAGE,
            offset,
            ...(kind ? { kind } : {}),
          })
        ).data;
        const at = page.suggestions.findIndex((s) => s.id === id);
        if (at >= 0) return offset + at;
        if (page.suggestions.length < LOCATE_PAGE || offset + LOCATE_PAGE >= page.total) break;
      }
      return -1;
    },
    staleTime: LIVE_STALE_TIME,
  });

// Every proposed coverage gap, page by page, so the group's count and its review list hold the same gaps.
export const autoobserveGapSuggestionsQuery = (org: string, pageSize: number) =>
  queryOptions({
    queryKey: autoobserveKeys.gapSuggestions(org, pageSize),
    queryFn: async (): Promise<AutoObserveSuggestionList> => {
      const all: AutoObserveSuggestionList["suggestions"] = [];
      for (;;) {
        const page = (
          await autoobserve.suggestions(org, {
            status: "proposed",
            kind: "coverage_gap",
            sort: "priority",
            limit: pageSize,
            offset: all.length,
          })
        ).data;
        all.push(...page.suggestions);
        if (page.suggestions.length < pageSize || all.length >= page.total) break;
      }
      return { suggestions: all, total: all.length, limit: pageSize, offset: 0 };
    },
    staleTime: LIVE_STALE_TIME,
  });

// Null when the server has no paging route, so every surface keeps what it shows today.
export const autoobservePagingQuery = (org: string) =>
  queryOptions({
    queryKey: autoobserveKeys.pagingSettings(org),
    queryFn: async (): Promise<AutoObservePagingSettings | null> => {
      try {
        return (await autoobserve.pagingSettings(org)).data;
      } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status === 404) return null;
        throw error;
      }
    },
    staleTime: LIVE_STALE_TIME,
    retry: false,
    // Surfaces mount the switch only once the read settles, so a failed read refetched on mount would loop.
    retryOnMount: false,
  });

// Polls only while a listed analysis is live, as the incident list does; otherwise the stale time decides.
export const autoobserveIncidentsPageQuery = (org: string, limit: number, offset: number) =>
  queryOptions({
    queryKey: autoobserveKeys.incidentsPage(org, limit, offset),
    queryFn: async (): Promise<AutoObserveIncidentList> =>
      (await autoobserve.incidents(org, { limit, offset })).data,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => (anyLive(query.state.data) ? PAGED_POLL_MS : false),
  });

// Pages newest first until one reaches past the range start or the cap; polls like the single page.
export const autoobserveIncidentsPagesQuery = (
  org: string,
  range: IssuesRange,
  pageSize: number,
  cap: number,
) =>
  infiniteQueryOptions({
    queryKey: autoobserveKeys.incidentsPages(org, range, pageSize, cap),
    queryFn: async ({ pageParam }): Promise<AutoObserveIncidentList> =>
      (await autoobserve.incidents(org, { limit: pageSize, offset: pageParam })).data,
    initialPageParam: 0,
    getNextPageParam: (_last, pages) =>
      nextIssuesOffset(pages, issuesRangeStart(range, Date.now()), cap),
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => anyLive(page)) ? PAGED_POLL_MS : false,
  });
