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

import resourcesService from "@/services/resources";
import type { EntityProvider } from "../usePaletteEntities";
import type { PaletteItem, PaletteScope } from "../types";
import { alertToItem } from "./alerts";
import { resolveGroup, type EntityProviderContext } from "./context";
import { dashboardToItem } from "./dashboards";
import { functionToItem } from "./functions";
import { pipelineToItem } from "./pipelines";
import { savedViewToItem } from "./savedViews";
import { STREAM_TYPES, streamToItem, type SearchableStreamType } from "./streams";
import { syntheticToItem } from "./synthetics";
import { roleLabel, serviceAccountToItem, userToItem } from "./users";

export type ResourceType =
  | "dashboard"
  | "alert"
  | "stream"
  | "saved_view"
  | "function"
  | "pipeline"
  | "user"
  | "service_account"
  | "synthetic";

/** One row of `GET /api/{org}/resources/_search`. */
export interface ResourceHit {
  type: ResourceType;
  id: string;
  name: string;
  score: number;
  folder_id?: string;
  folder_name?: string;
  stream_type?: string;
  enabled?: boolean;
  email?: string;
  role?: string;
  description?: string;
}

export interface ResourceTypeSpec {
  type: ResourceType;
  /** Rail tiles whose chips should request this type. */
  groups: PaletteScope[];
  enabled: boolean;
}

const QUERY_LIMIT = 20;
const SCOPED_LIMIT = 50;

const streamGroup = (ctx: EntityProviderContext, type: SearchableStreamType) =>
  resolveGroup(ctx.railKeys, type, "data");

const people = (ctx: EntityProviderContext, route: string) =>
  ctx.hasRoute(route) && ctx.navNames.has("iam");

/** Which types this build can open, and the rail tile each one lives under. */
export function resourceTypeSpecs(ctx: EntityProviderContext): ResourceTypeSpec[] {
  const one = (group: string | undefined) => (group ? [group] : []);
  const data = resolveGroup(ctx.railKeys, "data", "pipeline");
  const iam = resolveGroup(ctx.railKeys, "iam");
  return [
    {
      type: "dashboard",
      groups: one(resolveGroup(ctx.railKeys, "dashboards")),
      enabled: ctx.hasRoute("dashboards"),
    },
    {
      type: "alert",
      groups: one(resolveGroup(ctx.railKeys, "reliability", "alertList")),
      enabled: ctx.hasRoute("alertDetail"),
    },
    {
      type: "stream",
      groups: [...new Set(STREAM_TYPES.map((t) => streamGroup(ctx, t)))].filter(
        (g): g is string => !!g,
      ),
      enabled: ctx.hasRoute("logs"),
    },
    {
      type: "saved_view",
      groups: one(resolveGroup(ctx.railKeys, "logs")),
      enabled: ctx.hasRoute("logs"),
    },
    { type: "function", groups: one(data), enabled: ctx.hasRoute("functionList") },
    { type: "pipeline", groups: one(data), enabled: ctx.hasRoute("pipelineEditor") },
    { type: "user", groups: one(iam), enabled: people(ctx, "users") },
    { type: "service_account", groups: one(iam), enabled: people(ctx, "serviceAccounts") },
    {
      type: "synthetic",
      groups: one(resolveGroup(ctx.railKeys, "experience", "synthetics")),
      enabled: ctx.hasRoute("synthetic-monitor-results"),
    },
  ];
}

/** Enabled types, narrowed to the selected rail tiles when any are selected. */
export function typesForScopes(specs: ResourceTypeSpec[], scopes: PaletteScope[]): ResourceType[] {
  return specs
    .filter((s) => s.enabled && (scopes.length === 0 || s.groups.some((g) => scopes.includes(g))))
    .map((s) => s.type);
}

function personName(hit: ResourceHit): string | undefined {
  return hit.name !== hit.id ? hit.name : undefined;
}

export function hitToItem(
  hit: ResourceHit,
  ctx: EntityProviderContext,
  specs: ResourceTypeSpec[],
): PaletteItem | null {
  const group = specs.find((s) => s.type === hit.type)?.groups[0];
  const paused = String(ctx.t("palette.state.paused"));
  switch (hit.type) {
    case "dashboard":
      return dashboardToItem(
        {
          dashboard_id: hit.id,
          title: hit.name,
          folder_id: hit.folder_id,
          folder_name: hit.folder_name,
          description: hit.description,
        },
        group,
      );
    case "alert":
      return alertToItem(
        {
          alert_id: hit.id,
          name: hit.name,
          folder_id: hit.folder_id,
          folder_name: hit.folder_name,
          enabled: hit.enabled,
          description: hit.description,
        },
        group,
        paused,
      );
    case "stream": {
      const type = hit.stream_type as SearchableStreamType;
      if (!STREAM_TYPES.includes(type)) return null;
      return streamToItem(
        { name: hit.name, stream_type: type },
        String(ctx.t(`palette.streamTypes.${type}`)),
        streamGroup(ctx, type),
      );
    }
    case "saved_view":
      return savedViewToItem(
        { view_id: hit.id, view_name: hit.name },
        String(ctx.t("palette.scopes.savedView")),
        group,
      );
    case "function":
      return functionToItem({ name: hit.name }, String(ctx.t("palette.scopes.function")), group);
    case "pipeline":
      return pipelineToItem(
        { pipeline_id: hit.id, name: hit.name, enabled: hit.enabled },
        group,
        paused,
      );
    case "user":
      return userToItem(
        { email: hit.id, first_name: personName(hit), role: hit.role },
        roleLabel(ctx, hit.role),
        group,
      );
    case "service_account":
      return serviceAccountToItem(
        { email: hit.id, first_name: personName(hit) },
        roleLabel(ctx, "serviceaccount"),
        group,
      );
    case "synthetic":
      return syntheticToItem(
        { id: hit.id, name: hit.name, folder_id: hit.folder_id, enabled: hit.enabled },
        ctx.org,
        group,
        paused,
      );
    default:
      return null;
  }
}

/** One call per query: the server scores and cuts each type; the palette re-ranks locally. */
export function createResourcesProvider(ctx: EntityProviderContext): EntityProvider {
  const specs = resourceTypeSpecs(ctx);
  return {
    id: "resources",
    groups: [...new Set(specs.filter((s) => s.enabled).flatMap((s) => s.groups))],
    enabled: () => specs.some((s) => s.enabled),
    search: async (query, scopes, signal) => {
      const types = typesForScopes(specs, scopes);
      if (types.length === 0) return [];
      const res = await resourcesService.search(
        ctx.org,
        { q: query, types: types.join(","), limit: query ? QUERY_LIMIT : SCOPED_LIMIT },
        signal,
      );
      const hits: ResourceHit[] = res?.data?.hits ?? [];
      return hits
        .filter((h) => h.id && h.name)
        .map((h) => hitToItem(h, ctx, specs))
        .filter((i): i is PaletteItem => !!i);
    },
  };
}
