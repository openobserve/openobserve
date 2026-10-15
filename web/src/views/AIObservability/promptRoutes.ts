// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import type { LocationQueryRaw, RouteLocationRaw, RouteRecordRaw } from "vue-router";

export interface AiPromptsRouteOptions {
  entityId?: string;
  version?: number;
  query?: LocationQueryRaw;
}

export const promptRoutes: RouteRecordRaw[] = [
  {
    path: "prompts",
    name: "aiPrompts",
    component: () => import("@/views/AIObservability/PromptsPage.vue"),
    meta: { titleKey: "aiObservability.nav.prompts", keepAlive: false },
  },
  {
    path: "prompts/new",
    name: "aiPromptCreate",
    component: () => import("@/views/AIObservability/PromptEditorPage.vue"),
    meta: { titleKey: "routeTitles.aiPromptCreate", keepAlive: false },
  },
  {
    path: "prompts/:entityId/versions/new",
    name: "aiPromptVersionCreate",
    component: () => import("@/views/AIObservability/PromptEditorPage.vue"),
    meta: { titleKey: "routeTitles.aiPromptVersionCreate", keepAlive: false },
  },
];

export function aiPromptsRoute(
  orgIdentifier: string,
  options: AiPromptsRouteOptions = {},
): RouteLocationRaw {
  return {
    name: "aiPrompts",
    query: {
      ...options.query,
      org_identifier: orgIdentifier,
      ...(options.entityId ? { selected: options.entityId } : {}),
      ...(options.version == null ? {} : { version: String(options.version) }),
    },
  };
}

/** New prompt page, or a new version of `entityId` based on `baseVersion` (default: latest). */
export function aiPromptEditorRoute(
  orgIdentifier: string,
  options: { entityId?: string; baseVersion?: number; folder?: string } = {},
): RouteLocationRaw {
  const query: LocationQueryRaw = { org_identifier: orgIdentifier };
  if (options.folder) query.folder = options.folder;
  if (options.baseVersion != null) query.base_version = String(options.baseVersion);
  return options.entityId
    ? { name: "aiPromptVersionCreate", params: { entityId: options.entityId }, query }
    : { name: "aiPromptCreate", query };
}
