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

// ─────────────────────────────────────────────────────────────────────────────
// useAppBreadcrumb — a tiny module-scoped singleton that lets a page PUBLISH its
// breadcrumb crumbs to the global chrome bar (Header.vue → ChromeBreadcrumb),
// which is a SIBLING of <router-view> (so provide/inject can't reach it).
//
// Two hazards, both handled here:
//   1. STALENESS (keep-alive pages): every publish() stamps the CURRENT route
//      key; the chrome reader only shows the crumbs while that key still matches
//      the live route, so navigating away falls back to the route title.
//   2. TEARDOWN RACE: `useRoute()` is a GLOBAL reactive — by the time a leaving
//      page's clear() runs, `route` already points at the NEXT page. A naive
//      "clear if routeKey === keyOf(route)" guard therefore wipes the crumbs the
//      incoming page just published. We instead give each publish() a monotonic
//      token; clear() only nulls the state if OUR publish is still the latest
//      (i.e. no newer page has published since), so a stale teardown is a no-op.
// ─────────────────────────────────────────────────────────────────────────────

import { reactive } from "vue";
import { useRoute, type RouteLocationNormalizedLoaded } from "vue-router";
import type { Crumb } from "@/components/common/OCrumbTrail.vue";

export type { Crumb } from "@/components/common/OCrumbTrail.vue";

interface AppCrumbState {
  routeKey: string;
  crumbs: Crumb[] | null;
  /** Monotonic id of the most recent publish — used for safe clearing. */
  token: number;
}

// Module-level singleton — shared across every importer.
const state = reactive<AppCrumbState>({ routeKey: "", crumbs: null, token: 0 });
let seq = 0;

const keyOf = (route: RouteLocationNormalizedLoaded): string =>
  String(route.name ?? route.path);

/** Page-side: publish/clear this page's crumbs into the chrome. */
export function useAppBreadcrumb() {
  const route = useRoute();
  // The token of THIS composable instance's most recent publish.
  let myToken = 0;
  const publish = (crumbs: Crumb[]) => {
    myToken = ++seq;
    state.routeKey = keyOf(route);
    state.crumbs = crumbs;
    state.token = myToken;
  };
  // Clear only if we're still the latest publisher. If a newer page already
  // published (state.token moved past ours), this teardown is a stale no-op.
  const clear = () => {
    if (state.token === myToken) state.crumbs = null;
  };
  return { publish, clear };
}

/** Chrome-side reader (no useRoute needed; the consumer gates on routeKey). */
export function useAppBreadcrumbState(): AppCrumbState {
  return state;
}
