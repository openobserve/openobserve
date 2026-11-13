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
import { useRoute, type RouteLocationNormalized, type RouteLocationRaw } from "vue-router";

export type IssuesRange = "7d" | "30d" | "90d";
export const ISSUES_RANGES: IssuesRange[] = ["7d", "30d", "90d"];

/** The drawers the AutoObserve page opens from its `drawer` query value. */
export const AUTOOBSERVE_DRAWERS = ["history", "settings", "howItWorks", "suggestions"] as const;
export type AutoObserveDrawer = (typeof AUTOOBSERVE_DRAWERS)[number];

// Query keys only a live record or a server-built link sets; any of them opens the live page.
const LIVE_LINK_KEYS = ["incident", "suggestion", "suggestions"] as const;

type QueryLike = Record<string, unknown>;

/** Sample data is the default page; `live=1` or a link to a live record asks for the live one. */
export const isLiveQuery = (query: QueryLike): boolean =>
  query.live === "1" ||
  LIVE_LINK_KEYS.some((key) => typeof query[key] === "string" && query[key] !== "");

/** The query of a link that must open the live page. */
export const liveQuery = <T extends QueryLike>(query: T): T & { live: string } => ({
  ...query,
  live: "1",
});

export const useLiveMode = () => {
  const route = useRoute();
  return computed(() => isLiveQuery(route.query));
};

export const useFixtureMode = () => {
  const live = useLiveMode();
  return computed(() => !live.value);
};

/** Route-update guard: a move inside the live page keeps the switch, so it never drops to sample data. */
export const keepLiveMode = (
  to: RouteLocationNormalized,
  from: RouteLocationNormalized,
): RouteLocationRaw | undefined =>
  isLiveQuery(from.query) && to.query.live !== "1"
    ? { path: to.path, hash: to.hash, query: liveQuery(to.query) }
    : undefined;
