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
import slos from "./slos";
import { sloKeys } from "./slos.querykeys";

export const slosQuery = (org: string, folder?: string) =>
  queryOptions({
    queryKey: sloKeys.list(org, folder),
    queryFn: async (): Promise<any[]> => (await slos.list(org, folder)).data?.list ?? [],
    refetchOnWindowFocus: true,
  });

export const sloDetailQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: sloKeys.detail(org, id),
    queryFn: async () => (await slos.get(org, id)).data,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const moveSlosMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { ids: string[]; dstFolderId: string }) =>
      slos.move(org, vars.ids, vars.dstFolderId),
    meta: { invalidates: [sloKeys.all(org)], silentError: true },
  });

export const setSloEnabledMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { id: string; enabled: boolean }) =>
      slos.setEnabled(org, vars.id, vars.enabled),
    meta: { invalidates: [sloKeys.all(org)], silentError: true },
  });

export const deleteSloMutation = (org: string) =>
  mutationOptions({
    mutationFn: (id: string) => slos.delete(org, id),
    meta: { invalidates: [sloKeys.all(org)], silentError: true },
  });
