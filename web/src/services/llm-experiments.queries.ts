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
import llmExperimentsService, { type LlmExperiment } from "./llm-experiments.service";
import remoteTasksService, { type RemoteTask } from "./remote-tasks.service";
import { experimentKeys, remoteTaskKeys } from "./llm-experiments.querykeys";

/** Shared by six surfaces; left on default freshness because run status changes as experiments complete. */
export const experimentsListQuery = (org: string, datasetId?: string) =>
  queryOptions({
    queryKey: experimentKeys.list(org, datasetId),
    // `includeSummary` puts the per-row score summary in the list call, so the pages need no per-experiment detail reads.
    queryFn: (): Promise<LlmExperiment[]> =>
      llmExperimentsService.list(org, {
        includeSummary: true,
        ...(datasetId ? { datasetId } : {}),
      }),
  });

export const remoteTasksListQuery = (org: string) =>
  queryOptions({
    queryKey: remoteTaskKeys.list(org),
    queryFn: (): Promise<RemoteTask[]> => remoteTasksService.list(org),
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/** Create or clone — both put a new row in the experiments list. */
export const createExperimentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (payload: any) => llmExperimentsService.create(org, payload),
    // The form surfaces the server's validation reason against its own banner.
    meta: { invalidates: [experimentKeys.all(org)], silentError: true },
  });

export const cloneExperimentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { experimentId: string; overrides?: any }) =>
      llmExperimentsService.clone(org, vars.experimentId, vars.overrides ?? {}),
    meta: { invalidates: [experimentKeys.all(org)], silentError: true },
  });

/** Cancel, retry and per-slot retry all change run status, which the list shows. */
export const cancelExperimentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (experimentId: string) => llmExperimentsService.cancel(org, experimentId),
    meta: { invalidates: [experimentKeys.all(org)], silentError: true },
  });

export const retryExperimentMutation = (org: string) =>
  mutationOptions({
    mutationFn: (experimentId: string) => llmExperimentsService.retry(org, experimentId),
    meta: { invalidates: [experimentKeys.all(org)], silentError: true },
  });

export const retryExperimentSlotMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: {
      experimentId: string;
      rowId: string;
      trialIndex: number;
      idempotencyKey: string;
    }) =>
      llmExperimentsService.retrySlot(
        org,
        vars.experimentId,
        vars.rowId,
        vars.trialIndex,
        vars.idempotencyKey,
      ),
    meta: { invalidates: [experimentKeys.all(org)], silentError: true },
  });

export const createRemoteTaskMutation = (org: string) =>
  mutationOptions({
    mutationFn: (payload: any) => remoteTasksService.create(org, payload),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

export const saveRemoteTaskDraftMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { entityId: string; payload: any }) =>
      remoteTasksService.saveDraft(org, vars.entityId, vars.payload),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

/** A passing test publishes a version, so the task's state changes on success. */
export const testRemoteTaskConnectionMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { entityId: string; sample: any }) =>
      remoteTasksService.testConnection(org, vars.entityId, vars.sample),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

export const discardRemoteTaskDraftMutation = (org: string) =>
  mutationOptions({
    mutationFn: (entityId: string) => remoteTasksService.discardDraft(org, entityId),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

/** Signing state is rendered on the task's row as well as in its panel. */
export const rotateRemoteTaskSigningMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { entityId: string; payload: any }) =>
      remoteTasksService.rotateSigning(org, vars.entityId, vars.payload),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

export const activateRemoteTaskSigningMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { entityId: string; graceMs: number }) =>
      remoteTasksService.activateSigning(org, vars.entityId, vars.graceMs),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });

export const endRemoteTaskSigningGraceMutation = (org: string) =>
  mutationOptions({
    mutationFn: (entityId: string) => remoteTasksService.endSigningGrace(org, entityId),
    meta: { invalidates: [remoteTaskKeys.all(org)], silentError: true },
  });
