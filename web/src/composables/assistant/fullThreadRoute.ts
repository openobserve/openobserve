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

import type { LocationQuery, LocationQueryRaw, RouteLocationRaw } from "vue-router";

/** Home shows a thread at Full density while this query key is present; an empty value is the active or a new chat. */
export const THREAD_QUERY_KEY = "thread";

/** Picks Home's tab for this visit; the thread lives in the AI Assistant tab. */
export const HOME_TAB_QUERY_KEY = "tab";

export const AI_HOME_TAB = "ai";

interface RouteLike {
  name?: unknown;
  query?: LocationQuery | Record<string, unknown>;
}

/** The thread id `?thread=` names: a string (possibly empty), or null when Home shows its briefing. */
export function threadParam(
  query: LocationQuery | Record<string, unknown> | undefined,
): string | null {
  const value = query?.[THREAD_QUERY_KEY];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return value === null ? "" : null;
}

/** True on the Full density view, which is Home's AI tab with `?thread=`. */
export function isFullThreadRoute(route: RouteLike | null | undefined): boolean {
  return route?.name === "home" && threadParam(route.query) !== null;
}

/** Home's AI tab at Full density on `sid`, keeping the other query keys. */
export function fullThreadLocation(
  sid: string | null,
  query: LocationQuery | LocationQueryRaw = {},
): RouteLocationRaw {
  return {
    name: "home",
    query: { ...query, [HOME_TAB_QUERY_KEY]: AI_HOME_TAB, [THREAD_QUERY_KEY]: sid ?? "" },
  };
}

/** The same query without the thread key, so the AI tab goes back to its briefing. */
export function withoutThread(query: LocationQuery): LocationQuery {
  const next = { ...query };
  delete next[THREAD_QUERY_KEY];
  return next;
}

/** Home's AI tab back on its Ask box, focused: where a chat on Home starts over. */
export function homeAskLocation(query: LocationQuery): RouteLocationRaw {
  return { name: "home", query: { ...withoutThread(query), focus: "ask" } };
}
