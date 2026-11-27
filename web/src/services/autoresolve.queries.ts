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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import autoresolve, {
  type AutoResolveCorrectionList,
  type AutoResolveIncident,
  type AutoResolveReplanInput,
  type AutoResolveRun,
  type AutoResolveSaved,
  type AutoResolveSavedInput,
  type AutoResolveStartInput,
  type AutoResolveRunList,
  type AutoResolveRunQuery,
  type AutoResolveSummary,
} from "./autoresolve";
import { autoresolveKeys } from "./autoresolve.querykeys";
import { LIVE_STALE_TIME, NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange, stableFilters } from "@/composables/query/queryClient";

export const autoresolveSummaryQuery = (org: string) =>
  queryOptions({
    queryKey: autoresolveKeys.summary(org),
    queryFn: async (): Promise<AutoResolveSummary> => (await autoresolve.getSummary(org)).data,
    staleTime: LIVE_STALE_TIME,
  });

// The key rounds the window so a range built from Date.now() still hits. An open-ended
// window also sends its rounded start, so the cached rows match the key that holds them.
export const autoresolveRunsQuery = (org: string, query: AutoResolveRunQuery) => {
  const { from_us, to_us, ...rest } = query;
  const openStart =
    from_us !== undefined && to_us === undefined ? quantizeRange(from_us, from_us).start : from_us;
  const window =
    from_us !== undefined && to_us !== undefined
      ? quantizeRange(from_us, to_us)
      : { start: openStart, end: to_us };
  const request = to_us === undefined ? { ...query, from_us: openStart } : query;
  return queryOptions({
    queryKey: autoresolveKeys.runs(org, stableFilters({ ...rest, ...window })),
    queryFn: async (): Promise<AutoResolveRunList> => {
      const data = (await autoresolve.listRuns(org, request)).data;
      return { runs: data?.runs ?? [], total: data?.total ?? 0 };
    },
    staleTime: LIVE_STALE_TIME,
  });
};

/** One read of a run, for pages that only prefill from it; the run page streams instead. */
export const autoresolveRunDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: autoresolveKeys.run(org, id),
    queryFn: async (): Promise<AutoResolveRun> => (await autoresolve.getRun(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

export const autoresolveCorrectionsQuery = (org: string, autoresolveId: string) =>
  queryOptions({
    queryKey: autoresolveKeys.corrections(org, autoresolveId),
    queryFn: async (): Promise<AutoResolveCorrectionList> => {
      const data = (await autoresolve.listCorrections(org, autoresolveId)).data;
      return {
        corrections: data?.corrections ?? [],
        total: data?.total ?? 0,
        can_remove: data?.can_remove === true,
      };
    },
    staleTime: NORMAL_STALE_TIME,
  });

export const autoresolveSavedListQuery = (org: string) =>
  queryOptions({
    queryKey: autoresolveKeys.saved(org),
    queryFn: async (): Promise<AutoResolveSaved[]> =>
      (await autoresolve.listSaved(org)).data?.autoresolve ?? [],
    staleTime: NORMAL_STALE_TIME,
  });

export const autoresolveSavedQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: autoresolveKeys.savedOne(org, id),
    queryFn: async (): Promise<AutoResolveSaved> => (await autoresolve.getSaved(org, id)).data,
    staleTime: NORMAL_STALE_TIME,
  });

// A live run's state moves on its own, so it is read again until the run ends.
export const autoresolveIncidentQuery = (org: string, incidentId: string) =>
  queryOptions({
    queryKey: autoresolveKeys.incident(org, incidentId),
    queryFn: async (): Promise<AutoResolveIncident> => {
      const data = (await autoresolve.getIncident(org, incidentId)).data;
      return {
        incident_id: data?.incident_id ?? incidentId,
        run: data?.run ?? null,
        related: data?.related ?? [],
        suggested_goal: data?.suggested_goal ?? null,
      };
    },
    staleTime: LIVE_STALE_TIME,
    refetchInterval: (query) => (query.state.data?.run?.live ? 15_000 : false),
  });

export const startAutoResolveRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: AutoResolveStartInput) => (await autoresolve.startRun(org, body)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const approveAutoResolveRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; optionId: string; fingerprint: string }) =>
      (await autoresolve.approveRun(org, v.id, v.optionId, v.fingerprint)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const declineAutoResolveRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; fingerprint: string | null }) =>
      (await autoresolve.declineRun(org, v.id, v.fingerprint)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const replanAutoResolveRunMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; body: AutoResolveReplanInput }) =>
      (await autoresolve.replanRun(org, v.id, v.body)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const postAutoResolveVerdictMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (id: string) => (await autoresolve.postVerdict(org, id)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const addAutoResolveConnectionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; connectionId: string }) =>
      (await autoresolve.addConnection(org, v.id, v.connectionId)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const removeAutoResolveCorrectionMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { autoresolveId: string; correctionId: string }) =>
      (await autoresolve.removeCorrection(org, v.autoresolveId, v.correctionId)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const createAutoResolveSavedMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (body: AutoResolveSavedInput) =>
      (await autoresolve.createSaved(org, body)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });

export const updateAutoResolveSavedMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; body: AutoResolveSavedInput }) =>
      (await autoresolve.updateSaved(org, v.id, v.body)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], awaitInvalidation: true, silentError: true },
  });

export const deleteAutoResolveSavedMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (id: string) => (await autoresolve.deleteSaved(org, id)).data,
    meta: {
      invalidates: [autoresolveKeys.all(org)],
      removes: [autoresolveKeys.saved(org)],
      silentError: true,
    },
  });

export const setAutoResolveTriggerMutation = (org: string) =>
  mutationOptions({
    mutationFn: async (v: { id: string; enabled: boolean }) =>
      (await autoresolve.setTrigger(org, v.id, v.enabled)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], awaitInvalidation: true, silentError: true },
  });

/** With `incidentId` every run it starts is that incident's run. */
export const runAutoResolveSavedMutation = (org: string, incidentId?: string) =>
  mutationOptions({
    mutationFn: async (id: string) => (await autoresolve.runSaved(org, id, incidentId)).data,
    meta: { invalidates: [autoresolveKeys.all(org)], silentError: true },
  });
