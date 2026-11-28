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

import { inject, provide, type InjectionKey, type Ref } from "vue";
import { useRouter, type RouteLocationRaw, type Router } from "vue-router";

/** Leaves a trace view for another page. */
export type TraceNavigate = (to: RouteLocationRaw) => unknown;

const NEW_TAB: InjectionKey<Ref<boolean>> = Symbol("traceLinksInNewTab");

/** A navigator that opens `to` in a new tab while `newTab()` holds, so the host page stays. */
export const traceNavigator =
  (router: Router, newTab: () => boolean): TraceNavigate =>
  (to) => {
    if (!newTab()) return router.push(to);
    window.open(router.resolve(to).href, "_blank", "noopener,noreferrer");
    return undefined;
  };

/** Makes every trace view below this one open its links in a new tab while `newTab` holds. */
export function provideTraceLinksInNewTab(newTab: Ref<boolean>) {
  provide(NEW_TAB, newTab);
}

/** The navigator for a view inside a trace: a new tab when an embedding host asked for one. */
export function useTraceNavigate(): TraceNavigate {
  const newTab = inject(NEW_TAB, null);
  return traceNavigator(useRouter(), () => !!newTab?.value);
}
