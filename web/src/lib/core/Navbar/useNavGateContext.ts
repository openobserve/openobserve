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

import { computed, type ComputedRef } from "vue";
import { useStore } from "vuex";
import config from "@/aws-exports";
import type { NavGateContext } from "./ONavbar.types";

/** The slice of Vuex state the nav gates read; typed loosely because the store is untyped. */
export interface NavGateState {
  zoConfig?: Record<string, any> | null;
  organizationData?: { organizationSettings?: Record<string, any> | null } | null;
  selectedOrganization?: { identifier?: string } | null;
}

export interface NavGateBuildFlags {
  isEnterprise: boolean;
  isCloud: boolean;
}

/** Pure builder so the rail, flyouts and command palette gate from one definition. */
export function buildNavGateContext(state: NavGateState, build: NavGateBuildFlags): NavGateContext {
  const z = state.zoConfig ?? {};
  const orgSettings = state.organizationData?.organizationSettings ?? {};
  return {
    isEnterprise: build.isEnterprise,
    isCloud: build.isCloud,
    // useIsMetaOrg's logic, made null-safe for early renders.
    isMeta: state.selectedOrganization?.identifier === z.meta_org,
    rbac: !!z.rbac_enabled,
    serviceAccount: z.service_account_enabled ?? true,
    orgStorage: orgSettings.org_storage_enabled === true,
    modelPricing: !!z.model_pricing_enabled,
    serviceStreams: z.service_streams_enabled !== false,
    onlineEvals: !!z.online_evals_enabled,
    databaseMonitoring: !!z.database_monitoring_enabled,
    // Raw split (no trim) to match how pages test custom_hide_menus.
    hiddenMenus: new Set((z.custom_hide_menus ?? "").split(",")),
  };
}

export function useNavGateContext(): ComputedRef<NavGateContext> {
  const store = useStore();
  return computed(() =>
    buildNavGateContext(store.state, {
      isEnterprise: config.isEnterprise == "true",
      isCloud: config.isCloud == "true",
    }),
  );
}
