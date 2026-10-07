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
import {
  buildFeatureGateContext,
  checkFeatureAccess,
  type FeatureAccess,
  type FeatureKey,
} from "@/utils/enterpriseFeatures";

/**
 * One-line replacement for the `buildFeatureGateContext` + `checkFeatureAccess`
 * pair every locked in-page control (a disabled button/tab/toggle/menu item +
 * `LockedFeatureTooltip`) was hand-deriving separately. Reactive to
 * `store.state.zoConfig` so a key like `rbac`, whose predicate depends on a
 * runtime flag rather than just the build edition, updates correctly if
 * `zoConfig` resolves after mount — plain non-reactive callers of
 * `checkFeatureAccess` computed once at setup don't get that for free.
 *
 * Template usage: `v-if="!workflowsLock.allowed"` + `:message="workflowsLock.message"`
 * (a `ComputedRef` auto-unwraps in templates; use `.value` in script).
 */
export function useLockedAffordance(key: FeatureKey): ComputedRef<FeatureAccess> {
  const store = useStore();
  return computed(() => checkFeatureAccess(key, buildFeatureGateContext(store.state.zoConfig)));
}
