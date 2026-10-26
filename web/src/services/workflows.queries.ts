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
import workflows, {
  type HttpTriggerState,
  type OverlapSeconds,
  type PutHttpTriggerPayload,
} from "./workflows";
import { workflowKeys } from "./workflows.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { quantizeRange } from "@/composables/query/queryClient";

// The list handler returns a bare array; older builds wrapped it in `list`.
const rowsOf = (data: any): any[] => (Array.isArray(data) ? data : (data?.list ?? []));

export const workflowsQuery = (org: string) =>
  queryOptions({
    queryKey: workflowKeys.list(org),
    queryFn: async (): Promise<any[]> => rowsOf((await workflows.listWorkflows(org)).data),
    staleTime: NORMAL_STALE_TIME,
  });

export const workflowFolderQuery = (org: string, folderId: string) =>
  queryOptions({
    queryKey: workflowKeys.folder(org, folderId),
    queryFn: async (): Promise<any[]> =>
      rowsOf((await workflows.listWorkflows(org, folderId)).data),
    staleTime: NORMAL_STALE_TIME,
  });

/** Every folder, matched server-side; `all_folders` overrides any folder, so the term alone keys it. */
export const workflowSearchQuery = (org: string, term: string) =>
  queryOptions({
    queryKey: workflowKeys.search(org, term),
    queryFn: async (): Promise<any[]> =>
      rowsOf((await workflows.listWorkflows(org, undefined, true, term)).data),
    staleTime: NORMAL_STALE_TIME,
  });

/** The key buckets the window to the minute; the request keeps the exact range, so a run from the last minute is still in it. */
export const workflowRunsQuery = (
  org: string,
  workflowId: string,
  startTime: number,
  endTime: number,
) => {
  const { start, end } = quantizeRange(startTime, endTime);
  return queryOptions({
    queryKey: workflowKeys.runs(org, workflowId, start, end),
    queryFn: async (): Promise<any[]> =>
      rowsOf(
        (
          await workflows.getWorkflowHistory({
            org_identifier: org,
            id: workflowId,
            start_time: startTime,
            end_time: endTime,
          })
        ).data,
      ),
    staleTime: NORMAL_STALE_TIME,
  });
};

export const workflowHttpTriggerQuery = (org: string, id: string) =>
  queryOptions<HttpTriggerState>({
    queryKey: workflowKeys.httpTrigger(org, id),
    queryFn: () => workflows.getHttpTrigger({ org_identifier: org, id }),
    staleTime: NORMAL_STALE_TIME,
    // Last call, Last used and rejections change while the panel is closed.
    refetchOnMount: "always",
    enabled: !!org && !!id,
  });

/** Secret-bearing writes share this key, so a reader can drop their settled entries from the MutationCache. */
export const httpTriggerSecretMutationKey = (org: string, id: string) =>
  [...workflowKeys.httpTrigger(org, id), "secret"] as const;

// The list page reads the folder and search lists, not `list`, so all three carry the endpoint flag.
const listScopes = (org: string) => [
  workflowKeys.list(org),
  workflowKeys.folders(org),
  workflowKeys.searches(org),
];

export const putHttpTriggerMutation = (org: string, id: string) =>
  mutationOptions({
    mutationKey: httpTriggerSecretMutationKey(org, id),
    mutationFn: (payload: PutHttpTriggerPayload) =>
      workflows.putHttpTrigger({ org_identifier: org, id, payload }),
    meta: {
      invalidates: [workflowKeys.httpTrigger(org, id), ...listScopes(org)],
      silentError: true,
    },
  });

export const deleteHttpTriggerMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: () => workflows.deleteHttpTrigger({ org_identifier: org, id }),
    meta: {
      invalidates: [workflowKeys.httpTrigger(org, id), ...listScopes(org)],
      silentError: true,
    },
  });

export const rotateHttpCredentialMutation = (org: string, id: string) =>
  mutationOptions({
    mutationKey: httpTriggerSecretMutationKey(org, id),
    mutationFn: (vars: { overlap_seconds: OverlapSeconds }) =>
      workflows.rotateHttpCredential({ org_identifier: org, id, ...vars }),
    meta: { invalidates: [workflowKeys.httpTrigger(org, id)], silentError: true },
  });

export const revokeHttpCredentialMutation = (org: string, id: string) =>
  mutationOptions({
    mutationFn: (vars: { credential_id: string }) =>
      workflows.revokeHttpCredential({ org_identifier: org, id, ...vars }),
    meta: { invalidates: [workflowKeys.httpTrigger(org, id)], silentError: true },
  });

// No meta.invalidates, no persister; the composable reads the value and calls reset() at once (AC-WEB-10).
export const revealHttpCredentialSecretMutation = (org: string, id: string) =>
  mutationOptions({
    mutationKey: httpTriggerSecretMutationKey(org, id),
    mutationFn: (vars: { credential_id: string }) =>
      workflows.revealHttpCredentialSecret({ org_identifier: org, id, ...vars }),
    meta: { silentError: true },
  });
