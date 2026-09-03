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
import syntheticsService from "./synthetics";
import { syntheticsKeys } from "./synthetics.querykeys";

export const syntheticsMonitorsQuery = (org: string, folderId?: string) =>
  queryOptions({
    queryKey: syntheticsKeys.monitors(org, folderId),
    // The list endpoint returns `checks`; `monitors` is the older name kept as a fallback.
    queryFn: async (): Promise<any[]> => {
      const data = (await syntheticsService.listByFolderId(org, folderId)).data as any;
      return data?.checks ?? data?.monitors ?? [];
    },
    refetchOnWindowFocus: true,
  });

export const monitorDetailQuery = (org: string, id: string, folderId?: string) =>
  queryOptions({
    queryKey: syntheticsKeys.detail(org, id, folderId),
    queryFn: async () => (await syntheticsService.get(org, id, folderId)).data,
  });

export const agentTokensQuery = (org: string) =>
  queryOptions({
    queryKey: syntheticsKeys.agentTokens(org),
    queryFn: async () => (await syntheticsService.listAgentTokens(org)).data,
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createAgentTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name: string) => syntheticsService.createAgentToken(org, name),
    meta: { invalidates: [syntheticsKeys.agentTokensAll(org)], silentError: true },
  });

export const rotateAgentTokenMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name?: string) => syntheticsService.rotateAgentToken(org, name),
    meta: { invalidates: [syntheticsKeys.agentTokensAll(org)], silentError: true },
  });

export const setAgentTokenEnabledMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { name: string; enabled: boolean }) =>
      syntheticsService.setAgentTokenEnabled(org, vars.name, vars.enabled),
    meta: { invalidates: [syntheticsKeys.agentTokensAll(org)], silentError: true },
  });

/**
 * Create or update a monitor. Invalidates the whole synthetics scope: the list
 * is cache-first, so returning to it after a save must refetch rather than
 * repaint the pre-save rows.
 */
export const saveMonitorMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id?: string; payload: unknown; folderId?: string }) =>
      vars.id
        ? syntheticsService.update(org, vars.id, vars.payload, vars.folderId)
        : syntheticsService.create(org, vars.payload, vars.folderId),
    meta: { invalidates: [syntheticsKeys.all(org)], silentError: true },
  });
