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
import onlineEvalsService from "./online-evals.service";
import { onlineEvalKeys } from "./online-evals.service.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

export const providersQuery = (org: string) =>
  queryOptions({
    queryKey: onlineEvalKeys.providers(org),
    queryFn: (): Promise<any[]> => onlineEvalsService.providers.list(org),
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

export const scoreConfigsQuery = (org: string) =>
  queryOptions({
    queryKey: onlineEvalKeys.scoreConfigs(org),
    queryFn: (): Promise<any[]> => onlineEvalsService.scoreConfigs.list(org),
    refetchOnWindowFocus: true,
  });

export const scorersQuery = (org: string) =>
  queryOptions({
    queryKey: onlineEvalKeys.scorers(org),
    queryFn: (): Promise<any[]> => onlineEvalsService.scorers.list(org),
    refetchOnWindowFocus: true,
  });

export const evalJobsQuery = (org: string) =>
  queryOptions({
    queryKey: onlineEvalKeys.jobs(org),
    queryFn: (): Promise<any[]> => onlineEvalsService.jobs.list(org),
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────
//
// Every write drops the whole onlineEvals scope: the four lists share entity
// state, so a job change can move a scorer's usage counts too.

export const setJobActiveMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; active: boolean }) =>
      vars.active
        ? onlineEvalsService.jobs.activate(org, vars.id)
        : onlineEvalsService.jobs.pause(org, vars.id),
    meta: { invalidates: [onlineEvalKeys.all(org)], silentError: true },
  });

export const deleteEvalEntityMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { tab: string; id: string }) => {
      if (vars.tab === "scoreConfigs") return onlineEvalsService.scoreConfigs.delete(org, vars.id);
      if (vars.tab === "scorers") return onlineEvalsService.scorers.delete(org, vars.id);
      return onlineEvalsService.jobs.delete(org, vars.id);
    },
    meta: { invalidates: [onlineEvalKeys.all(org)], silentError: true },
  });
