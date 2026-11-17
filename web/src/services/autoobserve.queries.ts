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

import { infiniteQueryOptions, mutationOptions, queryOptions } from "@tanstack/vue-query";
import autoobserve, {
  type AutoObserveIncidentItem,
  type AutoObserveCoverage,
  type AutoObserveCoverageView,
  type AutoObserveIncidentList,
  type AutoObservePagingSettings,
  type AutoObserveSuggestionList,
} from "./autoobserve";
import { autoobserveKeys } from "./autoobserve.querykeys";
import autoobserveDecisions, { type StepJudgementRequest } from "./autoobserveDecisions";
import { LIVE_STALE_TIME } from "@/composables/query/cachePolicy";
import type { IssuesRange } from "@/components/autoobserve/v2/autoobserveRoute";
import {
  PAGED_POLL_MS,
  issuesRangeStart,
  itemPolls,
  listPolls,
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

// Polls while a listed analysis is live or a listed context still owes a write; otherwise the stale time decides.
export const autoobserveIncidentsPageQuery = (org: string, limit: number, offset: number) =>
  queryOptions({
    queryKey: autoobserveKeys.incidentsPage(org, limit, offset),
    queryFn: async (): Promise<AutoObserveIncidentList> =>
      (await autoobserve.incidents(org, { limit, offset })).data,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => (listPolls(query.state.data, Date.now()) ? PAGED_POLL_MS : false),
  });

const LOCATE_INCIDENT_PAGE = 100;
export const LOCATE_INCIDENT_CAP = 1_000;

// One incident's item; `capped` when the cap was reached with more pages left, so it may still exist.
export interface IncidentLookup {
  item: AutoObserveIncidentItem | null;
  capped: boolean;
}

// The list route has no id filter and no route serves one incident, so it is found page by page, newest first.
export const autoobserveIncidentItemQuery = (org: string, incidentId: string) =>
  queryOptions({
    queryKey: autoobserveKeys.incidentItem(org, incidentId),
    queryFn: async (): Promise<IncidentLookup> => {
      for (let offset = 0; offset < LOCATE_INCIDENT_CAP; offset += LOCATE_INCIDENT_PAGE) {
        const page = (await autoobserve.incidents(org, { limit: LOCATE_INCIDENT_PAGE, offset }))
          .data;
        const found = page.items.find((i) => i.incident.id === incidentId);
        if (found) return { item: found, capped: false };
        if (!page.has_more) return { item: null, capped: false };
      }
      return { item: null, capped: true };
    },
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => {
      const item = query.state.data?.item;
      return item && itemPolls(item, Date.now()) ? PAGED_POLL_MS : false;
    },
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
      query.state.data?.pages.some((page) => listPolls(page, Date.now())) ? PAGED_POLL_MS : false,
  });

// The drawers read the step's judgement from the incident lists, so those refetch after it.
export const stepJudgementMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: StepJudgementRequest) =>
      (await autoobserveDecisions.decide(org, body)).data,
    meta: { invalidates: [autoobserveKeys.incidents(org)], silentError: true },
  });
