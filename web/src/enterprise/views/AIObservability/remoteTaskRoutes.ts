// Copyright 2026 OpenObserve Inc.

import type { RouteLocationRaw } from "vue-router";

/** The registry list. */
export function aiRemoteTasksRoute(orgIdentifier: string): RouteLocationRaw {
  return { name: "aiRemoteTasks", query: { org_identifier: orgIdentifier } };
}

/** One head, addressed by its stable `entityId` rather than a version row id,
 *  so the page survives every publish. */
export function aiRemoteTaskDetailRoute(orgIdentifier: string, entityId: string): RouteLocationRaw {
  return {
    name: "aiRemoteTaskDetail",
    params: { id: entityId },
    query: { org_identifier: orgIdentifier },
  };
}

/** The register form. */
export function aiRemoteTaskCreateRoute(orgIdentifier: string): RouteLocationRaw {
  return { name: "aiRemoteTaskCreate", query: { org_identifier: orgIdentifier } };
}

/** The edit form. Only reachable for a task the platform can round-trip — see
 *  `canEditRemoteTask`. */
export function aiRemoteTaskEditRoute(orgIdentifier: string, entityId: string): RouteLocationRaw {
  return {
    name: "aiRemoteTaskEdit",
    params: { id: entityId },
    query: { org_identifier: orgIdentifier },
  };
}
