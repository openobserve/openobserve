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

export const dashboardAnnotationsQuery = (org: string, dashboardId: string, params: unknown) =>
  queryOptions({
    queryKey: annotationKeys.list(org, dashboardId, params),
    queryFn: async () =>
      (await annotationService.get_timed_annotations(org, dashboardId, params as any)).data ?? null,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createAnnotationMutation = (org: string, dashboardId: string) =>
  mutationOptions({
    mutationFn: (annotations: Record<string, unknown>[]) =>
      annotationService.create_timed_annotations(org, dashboardId, annotations),
    meta: { invalidates: [annotationKeys.all(org)], silentError: true },
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
    meta: { invalidates: [annotationKeys.all(org)], silentError: true },
  });

export const deleteAnnotationMutation = (org: string, dashboardId: string) =>
  mutationOptions({
    mutationFn: (annotationIds: string[]) =>
      annotationService.delete_timed_annotations(org, dashboardId, annotationIds),
    meta: { invalidates: [annotationKeys.all(org)], silentError: true },
  });
