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

import { computed } from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import { isFullConfigLoaded } from "@/services/config.queries";

type ZoConfig = Record<string, unknown> | undefined;

/**
 * Hide an evaluation entry from a menu: the edition offers evaluations but the
 * server has not reported them on. Hidden while `/config` is in flight, so an
 * entry never flashes in on a server that turns out to have them off. An OSS
 * build is excluded: its edition gate already shows these entries locked.
 */
export const hidesOnlineEvalEntries = (zoConfig: ZoConfig): boolean =>
  (config.isEnterprise == "true" || config.isCloud == "true") &&
  zoConfig?.online_evals_enabled !== true;

/** Off only once `/config` has loaded, so a load still in flight never replaces the page. */
export const isOnlineEvalsOff = (zoConfig: ZoConfig): boolean =>
  isFullConfigLoaded(zoConfig) && hidesOnlineEvalEntries(zoConfig);

/**
 * True while the current route needs online evaluations (`meta.requiresOnlineEvals`:
 * its API is registered only with `O2_EVAL_ENABLED`) and the server reports them
 * off. A computed over the store, not a route guard: a cold deep link passes the
 * guards before `/config` arrives, and this flips the moment it does.
 */
export function useOnlineEvalsRouteOff() {
  const store = useStore();
  const route = useRoute();
  return computed(
    () => route.meta?.requiresOnlineEvals === true && isOnlineEvalsOff(store.state.zoConfig),
  );
}
