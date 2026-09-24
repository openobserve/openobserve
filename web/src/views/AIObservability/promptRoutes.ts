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
