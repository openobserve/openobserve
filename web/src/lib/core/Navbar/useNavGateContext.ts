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

import { GATE_PREDICATES } from "./navGroups";
import type { NavGateContext } from "./ONavbar.types";

/**
 * The flags every subnav `gate` predicate reads, mirroring EXACTLY what the
 * target pages compute — that is what guarantees the flyout never offers a
 * section the page itself would hide.
 *
 * Shared by `ONavbar` (which needs it to decide whether a group is worth
 * collapsing at all) and `ONavGroup` (which needs it to decide what the flyout
 * lists). One reader would leave the two disagreeing: a group whose only
 * surviving child is gated off would render as an empty flyout.
 */
/**
 * The context a storeless mount evaluates against: EVERY gate open.
 *
 * `lib/core` must render without app state, and the safe direction is the same
 * one `isGateOpen` already takes for an unknown gate — open. A missing store
 * then can only ever ADD entries, never silently delete one, so it cannot
 * disguise a real integration failure as a smaller nav.
 */
const ALL_GATES_OPEN: NavGateContext = {
  isEnterprise: true,
  isCloud: true,
  isMeta: true,
  rbac: true,
  serviceAccount: true,
  orgStorage: true,
  modelPricing: true,
  serviceStreams: true,
  onlineEvals: true,
  oncallEnabled: true,
  hiddenMenus: new Set<string>(),
};

export function useNavGateContext(): ComputedRef<NavGateContext> {
  // `useStore()` is an inject() — it returns undefined outside the app shell.
  const store = useStore() as { state?: Record<string, any> } | undefined;
  return computed<NavGateContext>(() => {
    if (!store?.state) return ALL_GATES_OPEN;
    const z = store.state.zoConfig ?? {};
    const orgSettings = store.state.organizationData?.organizationSettings ?? {};
    return {
      isEnterprise: config.isEnterprise == "true",
      isCloud: config.isCloud == "true",
      // useIsMetaOrg's logic, made null-safe for early renders.
      isMeta: store.state.selectedOrganization?.identifier === z.meta_org,
      rbac: !!z.rbac_enabled,
      serviceAccount: z.service_account_enabled ?? true,
      orgStorage: orgSettings.org_storage_enabled === true,
      modelPricing: !!z.model_pricing_enabled,
      serviceStreams: z.service_streams_enabled !== false,
      onlineEvals: !!z.online_evals_enabled,
      oncallEnabled: z.oncall_enabled !== false,
      // Raw split (no trim) to match how pages test custom_hide_menus.
      hiddenMenus: new Set((z.custom_hide_menus ?? "").split(",")),
    };
  });
}

/** An unknown gate key opens: a typo must not silently delete a nav entry. */
export function isGateOpen(context: NavGateContext, gate: string): boolean {
  const predicate = GATE_PREDICATES[gate];
  return predicate ? predicate(context) : true;
}
