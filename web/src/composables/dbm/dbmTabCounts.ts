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
 * The seam between `DbmShell` (which fetches the tab badges) and the pages
 * (which render them).
 *
 * `provide`/`inject` rather than a Pinia store, for two reasons. The dependency
 * is structural — a DBM page is only ever mounted inside `DbmShell`'s
 * `<router-view>`, so the provider is guaranteed to be an ancestor — and that
 * is exactly what inject expresses and a global store does not. And a store
 * would outlive the section: leave DBM, come back, and the badges would paint
 * the previous visit's numbers for a beat before the new fan-out landed.
 *
 * ## The tab strip stays on the page
 *
 * Only the FETCH moved to the shell, not the markup. Each page renders the
 * strip into its own `OPageLayout`'s `#header-tabs` slot, which is inside that
 * page's header — the shell has no header and deliberately contributes no DOM
 * (see the comment at the top of `DbmShell.vue`, and the `OPageLayout`-nesting
 * trap it cites). Hoisting the strip's markup would move it ABOVE each page's
 * title bar and change what the reader sees; hoisting only the data changes
 * nothing on screen and removes the duplicated requests, which was the point.
 */

import {
  inject,
  provide,
  shallowReadonly,
  shallowRef,
  type InjectionKey,
  type ShallowRef,
} from "vue";

import {
  emptyDbmTabCounts,
  type BadgeCount,
  type DbmTabCountKey,
  type DbmTabCounts,
  type DbmTabCountsLoadOptions,
} from "@/composables/dbm/useDbmTabCounts";

/**
 * What a page needs from the shell: the numbers, and a way to say "these may
 * have moved".
 */
export interface DbmTabCountsContext {
  /** The shared snapshot. Always fully shaped — see `DbmTabCounts`. */
  counts: Readonly<ShallowRef<DbmTabCounts>>;
  /**
   * Refetch the badges under the CURRENT scope.
   *
   * This is what each page's refresh button calls. The shell owns the window
   * and the filters, so the page says only whether to force past the cache —
   * it cannot accidentally request a window other than the one on screen.
   */
  refresh: (options?: DbmTabCountsLoadOptions) => void;
  /**
   * Publish a count THIS page measured better than the shared fan-out could,
   * so every tab paints it.
   *
   * Each page used to substitute its own badge into its own copy of the
   * snapshot, which made a refined count visible only while standing on the
   * page that produced it — Overview's exact fleet union read `6` on Overview
   * and the fan-out's rawer number on every sibling. Publishing puts it in the
   * shared snapshot instead, so the same badge reads the same everywhere.
   *
   * `undefined` means "no better number yet" and is ignored, so a page can
   * call this from a watcher without guarding the not-yet-loaded case.
   */
  publishOwnCount: (key: DbmTabCountKey, value: BadgeCount | undefined) => void;
}

const DBM_TAB_COUNTS: InjectionKey<DbmTabCountsContext> = Symbol("dbmTabCounts");

export const provideDbmTabCounts = (context: DbmTabCountsContext): void => {
  provide(DBM_TAB_COUNTS, context);
};

/**
 * The shared badge counts, for a page rendering the tab strip.
 *
 * Falls back to an inert empty context when no shell provided one. That is not
 * defensive padding: the pages are also mounted directly in unit tests, and a
 * page that threw on a missing provider would be untestable in isolation. A
 * page rendered outside the shell shows blank badges — honest, since nothing
 * fetched them — rather than crashing.
 */
export const useDbmTabCountsContext = (): DbmTabCountsContext =>
  inject(DBM_TAB_COUNTS, {
    counts: shallowReadonly(shallowRef(emptyDbmTabCounts())),
    refresh: () => {},
    publishOwnCount: () => {},
  });
