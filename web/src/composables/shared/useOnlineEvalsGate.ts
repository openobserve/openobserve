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
import { buildFeatureGateContext } from "@/utils/enterpriseFeatures";
import { isFullConfigLoaded } from "@/services/config.queries";

type ZoConfig = Record<string, unknown> | undefined;

/** Hide evaluation entries on enterprise/cloud until `/config` reports them on; OSS locks them. */
export const hidesOnlineEvalEntries = (zoConfig: ZoConfig): boolean => {
  const { isEnterprise, isCloud } = buildFeatureGateContext();
  return (isEnterprise || isCloud) && zoConfig?.online_evals_enabled !== true;
};

/** Off only once `/config` has loaded, so a load still in flight never replaces the page. */
export const isOnlineEvalsOff = (zoConfig: ZoConfig): boolean =>
  isFullConfigLoaded(zoConfig) && hidesOnlineEvalEntries(zoConfig);

/** Whether the route needs online evaluations that `/config` reports off, reactively. */
export function useOnlineEvalsRouteOff() {
  const store = useStore();
  const route = useRoute();
  return computed(
    () => route.meta?.requiresOnlineEvals === true && isOnlineEvalsOff(store.state.zoConfig),
  );
}
