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

import aiToolsets, { type ToolsetCreateRequest, type ToolsetUpdateRequest } from "./ai_toolsets";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";

/** One record for the edit form; never cached across opens, since its secrets are masked anyway. */
export const toolsetQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: [...aiToolsetKeys.all(org), "one", id] as const,
    queryFn: async (): Promise<unknown> => (await aiToolsets.get(org, id)).data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: !!org && !!id,
  });

/** Removal waits for the server; the list drops the row only when the refetch lands. */
export const deleteToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => aiToolsets.delete(org, id),
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const createToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (body: ToolsetCreateRequest) => aiToolsets.create(org, body),
    // The variables hold plaintext secrets, so a finished mutation is dropped at once.
    gcTime: 0,
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });

export const updateToolsetMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; body: ToolsetUpdateRequest }) =>
      aiToolsets.update(org, vars.id, vars.body),
    // The variables hold plaintext secrets, so a finished mutation is dropped at once.
    gcTime: 0,
    meta: { invalidates: [aiToolsetKeys.all(org)], silentError: true },
  });
