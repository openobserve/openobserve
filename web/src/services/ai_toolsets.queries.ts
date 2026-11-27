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

import { queryOptions } from "@tanstack/vue-query";
import aiToolsets, { type ToolsetPermission } from "./ai_toolsets";
import { aiToolsetKeys } from "./ai_toolsets.querykeys";
import { NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import type { Preset } from "@/components/ai_toolsets/presets";
import type { AutoResolveConnectionRef } from "./autoresolve";

/** The toolsets the caller may list, and whether they may create one (`can_create`; absent means yes). */
export const aiToolsetsQuery = (org: string) =>
  queryOptions({
    queryKey: aiToolsetKeys.list(org),
    queryFn: async (): Promise<{ toolsets: any[]; canCreate: boolean }> => {
      const data = (await aiToolsets.list(org, { limit: 100000 })).data;
      return { toolsets: data?.toolsets ?? [], canCreate: data?.can_create !== false };
    },
    staleTime: NORMAL_STALE_TIME,
  });

/** The MCPs the caller holds `permission` on, filtered by the server (RBAC off lists every one),
 * and whether they may add one: the same `can_create` Settings reads. */
export const mcpToolsetsQuery = (org: string, permission: ToolsetPermission = "list") =>
  queryOptions({
    queryKey: aiToolsetKeys.mcps(org, permission),
    queryFn: async (): Promise<{ mcps: AutoResolveConnectionRef[]; canCreate: boolean }> => {
      const params = {
        kind: "mcp",
        limit: 100000,
        ...(permission === "list" ? {} : { permission }),
      };
      const data = (await aiToolsets.list(org, params)).data;
      const rows: { id: string; name: string }[] = data?.toolsets ?? [];
      return {
        mcps: rows.map((ts) => ({ id: ts.id, name: ts.name })),
        canCreate: data?.can_create !== false,
      };
    },
    staleTime: NORMAL_STALE_TIME,
  });

/** The shipped presets; they change only with a server release. */
export const aiToolsetPresetsQuery = (org: string) =>
  queryOptions({
    queryKey: aiToolsetKeys.prebuilt(org),
    queryFn: async (): Promise<Preset[]> => (await aiToolsets.prebuilt(org)).data?.presets ?? [],
    staleTime: NORMAL_STALE_TIME,
  });
