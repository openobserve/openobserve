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
 * The hop from a list row to the query detail page.
 *
 * Four lists make it — activity, the two server-vantage lists, and top queries
 * — and all four had the same two halves copied out longhand. Getting either
 * half slightly wrong is invisible until a reader is already on the detail
 * page, which is why they belong in one place:
 *
 *   • The SEED. The clicked row already holds what the detail header paints, so
 *     it travels as a one-shot hand-off and the detail page's first paint does
 *     not wait on a fetch. The range is COPIED, because these pages are kept
 *     alive and their scope can move out from under a seed that referenced it.
 *
 *   • The PUSH. `...route.query` first so the org and the section's own params
 *     survive, then `org_identifier` defended (a deep link that arrived without
 *     one must not lose it), then the scope, then the row's identity, then the
 *     origin marker — which is what the detail page's back affordance and tab
 *     strip read to send the reader back where they came from rather than to
 *     Top queries.
 *
 * Deliberately NOT covering the deadlocks "which service ran this" hop: it
 * pushes from a participant inside an expanded row and sends no seed at all,
 * because a deadlock event knows a fingerprint but not the statement's stats.
 */

import type { LocationQueryRaw, RouteLocationNormalizedLoaded, Router } from "vue-router";
import type { ComputedRef, Ref } from "vue";

import { setDbmQueryDetailSeed } from "@/composables/dbm/dbmQueryDetailSeed";
import type { DbmRange } from "@/composables/dbm/useDbmScope";
import type { QueryStatsRow } from "@/services/db_monitoring";

/** What a page hands over per hop. */
export interface DbmQueryDetailHopOptions {
  /**
   * The row, in the shape the detail page's header reads. A list that knows no
   * statement passes nothing and the detail page falls back to its own fetch —
   * a seed carrying a blank statement would paint the bare hash as if it were
   * the query.
   */
  seed?: QueryStatsRow | null;
  /**
   * The row's identity as URL params — fingerprint, system, and any dimensions
   * it knows. Typed as a plain object rather than `LocationQueryRaw` because
   * pages hand over a NAMED interface here (`ActivityQueryDetailTarget`), and a
   * TypeScript interface never satisfies an index signature however well its
   * fields match. Every value that reaches it is already a route-query scalar.
   */
  target: object;
  /**
   * Where the reader came from. The detail page's back affordance honours it,
   * so an activity reader is not handed back to Top queries.
   */
  from?: string;
}

export interface DbmQueryDetailHopContext {
  router: Router;
  route: RouteLocationNormalizedLoaded;
  org: Ref<string> | ComputedRef<string>;
  range: Ref<DbmRange> | ComputedRef<DbmRange>;
  /** The page's scope as URL params, so "back" returns to the same filtered table. */
  queryParams: Ref<LocationQueryRaw> | ComputedRef<LocationQueryRaw>;
}

/** Returns the one function a page calls from its row handlers. */
export const useDbmQueryDetailHop = (context: DbmQueryDetailHopContext) => {
  const openDbmQueryDetail = ({ seed, target, from }: DbmQueryDetailHopOptions) => {
    if (seed) {
      setDbmQueryDetailSeed({
        row: seed,
        org: context.org.value,
        // Copied: this page is kept alive and its scope outlives the hop.
        range: { ...context.range.value },
      });
    }
    context.router
      .push({
        name: "dbmQueryDetail",
        query: {
          ...context.route.query,
          org_identifier: context.route.query.org_identifier ?? context.org.value,
          ...context.queryParams.value,
          ...target,
          ...(from ? { from } : {}),
        },
      })
      .catch(() => {});
  };

  return { openDbmQueryDetail };
};
