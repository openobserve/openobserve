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

import { onScopeDispose, type VNode } from "vue";
import type { Router } from "vue-router";
import { ENTER_FADE } from "@/lib/styles/motion";

/** Picks the route view's entrance class: a fade on a fresh navigation, none on a kept-alive return or a Back/Forward restore. */
export function useRouteEnterFade(router: Router, keptViews: readonly string[]) {
  let popPending = false;
  let lastNavWasPop = false;
  let keptReturn = false;
  const cachedViews = new Set<string>();
  let shownType: unknown = undefined;
  let shownClass = ENTER_FADE;
  let pathNavs = 0;
  let decidedAt = -1;

  // History listeners fire only for Back/Forward, synchronously and before that navigation's afterEach.
  const stopListening = router.options.history.listen(() => {
    popPending = true;
  });
  // A query-only navigation (often a page's own replace right after a Back) remounts nothing, so it keeps the decision.
  const stopAfterEach = router.afterEach((to, from) => {
    const samePath = to.path === from.path;
    lastNavWasPop = popPending || (samePath && lastNavWasPop);
    if (!samePath) {
      keptReturn = false;
      pathNavs += 1;
    }
    popPending = false;
  });
  onScopeDispose(() => {
    stopListening();
    stopAfterEach();
  });

  // Decided once per view type, so a later query-only navigation never re-adds the class and replays the fade.
  const enterClass = (view: VNode | undefined): string => {
    const type = view?.type;
    if (type === shownType) {
      // A path change under the same view swaps its nested child, which mounts with this class, so it follows that navigation.
      if (decidedAt !== pathNavs) shownClass = lastNavWasPop ? "" : ENTER_FADE;
      decidedAt = pathNavs;
      return shownClass;
    }
    shownType = type;
    decidedAt = pathNavs;
    const name = (type as { name?: string } | undefined)?.name ?? "";
    const kept = keptViews.includes(name);
    keptReturn = kept && cachedViews.has(name);
    const returning = lastNavWasPop || keptReturn;
    if (kept) cachedViews.add(name);
    shownClass = returning ? "" : ENTER_FADE;
    return shownClass;
  };

  // The keep-alive cache dies with its container (org switch), so the next visit is fresh again.
  const forgetKeptViews = () => {
    cachedViews.clear();
    shownType = undefined;
  };

  // Per navigation, not per top-level view, so a child route remounted by Back under the same parent stays still too.
  const entering = () => !lastNavWasPop && !keptReturn;

  return { enterClass, forgetKeptViews, entering };
}
