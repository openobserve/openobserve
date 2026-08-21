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
import actions from "./action_scripts";
import { actionKeys } from "./action_scripts.querykeys";
import { CONFIG_STALE_TIME, LONG_GC_TIME } from "@/composables/query/cachePolicy";
import { localStoragePersister } from "@/composables/query/persisters";

/** Read on every Logs entry alongside the functions list. */
export const actionsQuery = (org: string) =>
  queryOptions({
    queryKey: actionKeys.list(org),
    queryFn: async () => (await actions.list(org)).data,
    staleTime: CONFIG_STALE_TIME,
    gcTime: LONG_GC_TIME,
    persister: localStoragePersister,
  });

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Create or update. `isUpdate` travels with the variables rather than the
 * factory because the caller only knows it per submission — an edit that ships
 * a new code zip is still a create.
 */
export const saveActionMutation = (org: string) =>
  mutationOptions({
    mutationFn: (vars: { actionId: string; form: any; isUpdate: boolean }) =>
      vars.isUpdate
        ? actions.update(org, vars.actionId, vars.form)
        : actions.create(org, vars.actionId, vars.form),
    meta: { invalidates: [actionKeys.all(org)], silentError: true },
  });
