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

/**
 * Cache bindings for the functions endpoints.
 *
 * Plain TanStack option objects — there is no wrapper. What `queryOptions()`
 * returns is accepted as-is by `useQuery` inside a component and by
 * `queryClient.fetchQuery` / `prefetchQuery` outside one, so one declaration
 * serves both.
 *
 * Separate from `jstransform.ts` so the reference to the transport is a normal
 * module import: `vi.mock("@/services/jstransform")` then reaches the queryFn,
 * which it cannot do when the two live in one file.
 */

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import jstransform from "./jstransform";
import { functionKeys } from "./jstransform.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

// The endpoint paginates but every consumer wants the whole list.
const ALL_FUNCTIONS = 100000;

/** Read on every Logs entry, alert-form open and panel-editor open. */
export const functionsQuery = (org: string) =>
  queryOptions({
    queryKey: functionKeys.list(org),
    queryFn: async (): Promise<any[]> =>
      (await jstransform.list(1, ALL_FUNCTIONS, "name", false, "", org)).data.list ?? [],
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

/** Create or update, chosen by the caller — both invalidate the same scope. */
export const saveFunctionMutation = (org: string, isUpdate: () => boolean) =>
  mutationOptions({
    mutationFn: (payload: any) =>
      isUpdate() ? jstransform.update(org, payload) : jstransform.create(org, payload),
    // The form surfaces a VRL/JS compilation error inline against the editor, so
    // it composes that failure itself.
    meta: { invalidates: [functionKeys.all(org)], silentError: true },
  });

export const deleteFunctionMutation = (org: string) =>
  mutationOptions({
    mutationFn: (name: string) => jstransform.delete(org, name),
    // A 409 means the function is wired into pipelines; the list renders that as
    // a toast with a "view" action, so the default error toast would double up.
    meta: { invalidates: [functionKeys.all(org)], silentError: true },
  });

export const bulkDeleteFunctionsMutation = (org: string) =>
  mutationOptions({
    mutationFn: (names: string[]) => jstransform.bulkDelete(org, { ids: names }),
    // The response is per-item (successful / unsuccessful), so the outcome toast
    // is the caller's to compose.
    meta: { invalidates: [functionKeys.all(org)], silentError: true },
  });
