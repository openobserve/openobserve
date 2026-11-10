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

import type { LocationQueryRaw, RouteLocationNormalizedLoaded, Router } from "vue-router";

// Where the last replace issued here is headed, until it settles.
let pending: { path: string; query: LocationQueryRaw } | null = null;

/** Builds on the in-flight replace's target query, since a new replace cancels it and the route still shows the old query. */
export function replaceRouteQuery(
  router: Router,
  route: RouteLocationNormalizedLoaded,
  update: (query: LocationQueryRaw) => LocationQueryRaw,
): Promise<void> {
  const base = pending && pending.path === route.path ? pending.query : route.query;
  const query = update({ ...base });
  if (queryKey(query) === queryKey(base)) return Promise.resolve();
  const entry = { path: route.path, query };
  pending = entry;
  return router
    .replace({ query: entry.query })
    .then(
      () => {},
      () => {},
    )
    .finally(() => {
      if (pending === entry) pending = null;
    });
}

/** Order-insensitive identity of a query; an undefined value is no param. */
function queryKey(query: LocationQueryRaw): string {
  return JSON.stringify(
    Object.keys(query)
      .filter((key) => query[key] !== undefined)
      .sort()
      .map((key) => [key, query[key]]),
  );
}
