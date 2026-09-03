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
import savedViews from "./saved_views";
import { savedViewKeys } from "./saved_views.querykeys";

export const savedViewsQuery = (org: string) =>
  queryOptions({
    queryKey: savedViewKeys.list(org),
    queryFn: async (): Promise<any[]> => (await savedViews.get(org)).data?.views ?? [],
    refetchOnWindowFocus: true,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

export const createSavedViewMutation = (org: string) =>
  mutationOptions({
    mutationFn: (view: unknown) => savedViews.post(org, view),
    meta: { invalidates: [savedViewKeys.all(org)], silentError: true },
  });

export const updateSavedViewMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { viewId: string; view: unknown }) =>
      savedViews.put(org, vars.viewId, vars.view),
    meta: { invalidates: [savedViewKeys.all(org)], silentError: true },
  });

export const deleteSavedViewMutation = (org: string) =>
  mutationOptions({
    mutationFn: (viewId: string) => savedViews.delete(org, viewId),
    meta: { invalidates: [savedViewKeys.all(org)], silentError: true },
  });
