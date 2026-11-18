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
import { annotationService } from "./dashboard_annotations";
import { annotationKeys } from "./dashboard_annotations.querykeys";
import { EMPTY_LIST_STALE_TIME, NORMAL_STALE_TIME } from "@/composables/query/cachePolicy";
import { queryClient } from "@/composables/query/queryClient";

// One counter per dashboard, moved after each annotation write. Every panel of
// a dashboard shares one read, so the reload after a write needs a new key: on
// the old key it would join a read that another panel started before the write.
const revisions = new Map<string, number>();
const revisionKey = (org: string, dashboardId: string) => `${org}/${dashboardId}`;
const revisionOf = (org: string, dashboardId: string) =>
  revisions.get(revisionKey(org, dashboardId)) ?? 0;
// Older revisions can never be read again, so the idle ones leave the cache
// now. A read still in flight stays, because a panel waits on it.
const bumpRevision = (org: string, dashboardId: string) => {
  revisions.set(revisionKey(org, dashboardId), revisionOf(org, dashboardId) + 1);
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey: annotationKeys.dashboard(org, dashboardId) })) {
    if (query.state.fetchStatus === "idle") cache.remove(query);
  }
};

export const dashboardAnnotationsQuery = (org: string, dashboardId: string, params: object) =>
  queryOptions({
    queryKey: annotationKeys.list(org, dashboardId, {
      ...params,
      revision: revisionOf(org, dashboardId),
    }),
    queryFn: async () => {
      try {
        return (
          (await annotationService.get_timed_annotations(org, dashboardId, params as any)).data ??
          null
        );
      } catch (err: any) {
        // A 503 means the permission service is overloaded. Annotations are an
        // optional overlay, so the panels draw without them: no retry, and the
        // empty answer is kept for a short time so that the other panels do not
        // send the same request again.
        if (err?.response?.status === 503) return null;
        throw err;
      }
    },
    staleTime: (query) => (query.state.data === null ? EMPTY_LIST_STALE_TIME : NORMAL_STALE_TIME),
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createAnnotationMutation = (org: string, dashboardId: string) =>
  mutationOptions({
    mutationFn: (annotations: Record<string, unknown>[]) =>
      annotationService.create_timed_annotations(org, dashboardId, annotations),
    onSuccess: () => {
      bumpRevision(org, dashboardId);
    },
    meta: { invalidates: [annotationKeys.dashboard(org, dashboardId)], silentError: true },
  });

export const updateAnnotationMutation = (org: string, dashboardId: string) =>
  mutationOptions({
    mutationFn: (vars: { annotationId: string; annotation: Record<string, unknown> }) =>
      annotationService.update_timed_annotations(
        org,
        dashboardId,
        vars.annotationId,
        vars.annotation,
      ),
    onSuccess: () => {
      bumpRevision(org, dashboardId);
    },
    meta: { invalidates: [annotationKeys.dashboard(org, dashboardId)], silentError: true },
  });

export const deleteAnnotationMutation = (org: string, dashboardId: string) =>
  mutationOptions({
    mutationFn: (annotationIds: string[]) =>
      annotationService.delete_timed_annotations(org, dashboardId, annotationIds),
    onSuccess: () => {
      bumpRevision(org, dashboardId);
    },
    meta: { invalidates: [annotationKeys.dashboard(org, dashboardId)], silentError: true },
  });
