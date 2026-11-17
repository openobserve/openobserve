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

import { keepPreviousData, mutationOptions, queryOptions } from "@tanstack/vue-query";
import { orgKey } from "@/composables/query/keys";
import { LIVE_STALE_TIME, MEDIUM_STALE_TIME } from "@/composables/query/cachePolicy";
import securityCases, {
  type BulkCaseUpdate,
  type CaseMerge,
  type CaseRef,
  type CaseSearchFilters,
  type CaseSearchParams,
  type CaseRow,
  type CaseSettings,
  type PromoteEvent,
  type PromoteEventOptions,
  type SuppressFromCase,
  type Suppression,
} from "./securityCases";
import incidents, { type Incident } from "./incidents";

export const securityCaseKeys = {
  all: (org: string) => orgKey(org, "security", "cases"),
  byAlert: (org: string, alertIds: string[]) =>
    orgKey(org, "security", "cases", "by_alert", [...alertIds].sort().join(",")),
  settings: (org: string) => orgKey(org, "security", "cases", "settings"),
  open: (org: string) => orgKey(org, "security", "cases", "open"),
  search: (org: string, params: CaseSearchParams) =>
    orgKey(org, "security", "cases", "search", params),
  matchIds: (org: string, filters: CaseSearchFilters) =>
    orgKey(org, "security", "cases", "match_ids", filters),
  suppressions: (org: string) => orgKey(org, "security", "suppressions"),
  onEntities: (org: string, values: string[]) =>
    orgKey(org, "security", "cases", "on_entities", [...values].sort().join(",")),
};

/** Most open cases offered per entity when opening a case from an event. */
export const MAX_ENTITY_CASES = 5;

/** Open and investigating cases on any of `values`, so an event can join the case already on it. */
export const entityCasesQuery = (org: string, values: string[]) =>
  queryOptions({
    queryKey: securityCaseKeys.onEntities(org, values),
    queryFn: async (): Promise<CaseRow[]> => {
      const pages = await Promise.all(
        values.map((entity) =>
          securityCases.searchCases(org, {
            entity,
            status: ["open", "acknowledged"],
            limit: MAX_ENTITY_CASES,
          }),
        ),
      );
      const out = new Map<string, CaseRow>();
      for (const page of pages) for (const c of page.data?.incidents ?? []) out.set(c.id, c);
      return [...out.values()].sort((a, b) => b.last_alert_at - a.last_alert_at);
    },
    staleTime: LIVE_STALE_TIME,
  });

/** Most open cases offered when adding evidence; newer ones come first. */
export const MAX_ATTACHABLE_CASES = 100;

/** Unresolved security cases, newest activity first, for "add to case". */
export const openCasesQuery = (org: string) =>
  queryOptions({
    queryKey: securityCaseKeys.open(org),
    queryFn: async (): Promise<Incident[]> => {
      const res = await incidents.list(org, undefined, MAX_ATTACHABLE_CASES, 0, undefined, true);
      return (res.data?.incidents ?? []).filter((c) => c.status !== "resolved");
    },
    staleTime: LIVE_STALE_TIME,
  });

/** Opens a case from an event, or adds the event to `caseId`. */
export const promoteEventMutation = (org: string) =>
  mutationOptions({
    mutationFn: async ({ event, ...options }: { event: PromoteEvent } & PromoteEventOptions) =>
      (await securityCases.promoteEvent(org, event, options)).data,
    meta: { invalidates: [securityCaseKeys.all(org)], silentError: true },
  });

/** The open case each detection fires into; detections without one are absent. */
export const caseLookupQuery = (org: string, alertIds: string[]) =>
  queryOptions({
    queryKey: securityCaseKeys.byAlert(org, alertIds),
    queryFn: async (): Promise<Record<string, CaseRef>> =>
      alertIds.length ? ((await securityCases.lookup(org, alertIds)).data?.cases ?? {}) : {},
    staleTime: LIVE_STALE_TIME,
  });

/** How long a quiet case stays open and how firings group into cases. */
export const caseSettingsQuery = (org: string) =>
  queryOptions({
    queryKey: securityCaseKeys.settings(org),
    queryFn: async (): Promise<CaseSettings> => (await securityCases.getSettings(org)).data,
    staleTime: MEDIUM_STALE_TIME,
  });

/** The dialog shows the server's refusal itself, so the default error toast stays quiet. */
export const saveCaseSettingsMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (settings: CaseSettings) =>
      (await securityCases.updateSettings(org, settings)).data,
    meta: { invalidates: [securityCaseKeys.settings(org)], silentError: true },
  });

/** One page of the case queue, filtered on the server; the previous page stays shown while the next loads. */
export const caseSearchQuery = (org: string, params: CaseSearchParams) =>
  queryOptions({
    queryKey: securityCaseKeys.search(org, params),
    queryFn: async () => (await securityCases.searchCases(org, params)).data,
    staleTime: LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
  });

/** Every case id matching the filters, for "select all matching". */
export const caseMatchIdsQuery = (org: string, filters: CaseSearchFilters) =>
  queryOptions({
    queryKey: securityCaseKeys.matchIds(org, filters),
    queryFn: async () => {
      const res = await securityCases.searchCases(org, { ...filters, limit: 1, select_all: true });
      return { ids: res.data?.ids ?? [], capped: !!res.data?.capped };
    },
    staleTime: 0,
  });

/** The page summarises per-case failures itself, so the default error toast stays quiet. */
export const bulkUpdateCasesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: BulkCaseUpdate) => (await securityCases.bulkUpdate(org, body)).data,
    meta: { invalidates: [securityCaseKeys.all(org)], silentError: true },
  });

export const mergeCasesMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: CaseMerge) => (await securityCases.mergeCases(org, body)).data,
    meta: { invalidates: [securityCaseKeys.all(org)], silentError: true },
  });

/** Closing the case is optional, so the case list refetches too. */
export const suppressFromCaseMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: SuppressFromCase) => (await securityCases.suppress(org, body)).data,
    meta: {
      invalidates: [securityCaseKeys.suppressions(org), securityCaseKeys.all(org)],
      silentError: true,
    },
  });

/** Active suppressions; the server drops expired ones. */
export const suppressionsQuery = (org: string) =>
  queryOptions({
    queryKey: securityCaseKeys.suppressions(org),
    queryFn: async (): Promise<Suppression[]> =>
      (await securityCases.listSuppressions(org)).data?.suppressions ?? [],
    staleTime: LIVE_STALE_TIME,
  });

export const endSuppressionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (id: string) => {
      await securityCases.deleteSuppression(org, id);
    },
    meta: { invalidates: [securityCaseKeys.suppressions(org)], silentError: true },
  });
