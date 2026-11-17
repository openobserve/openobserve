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

import { shallowRef } from "vue";
import {
  isNavigationFailure,
  type LocationQuery,
  type LocationQueryRaw,
  type NavigationFailure,
  type RouteLocationRaw,
  type Router,
} from "vue-router";

import { overviewFocusListening } from "@/composables/goto/goToRequests";

import type { AssistantStoreInternal } from "./assistantStore";
import { runtimeHandle } from "./runtimeHandle";

/** Home shows a thread at Full density while this query key is present; an empty value is the active or a new chat. */
export const THREAD_QUERY_KEY = "thread";

/** Picks Home's tab for this visit; the thread lives in the AI Assistant tab. */
export const HOME_TAB_QUERY_KEY = "tab";

export const AI_HOME_TAB = "ai";

/** Routes that draw a thread at Full density on their own page; `/assistant` redirects to the one mounted. */
const THREAD_HOSTS: ReadonlySet<unknown> = new Set(["home", "autobotInvestigate"]);

/** The route a Full density thread opens on: Home, unless a page that hosts its own is mounted. */
export const threadHost = /* @__PURE__ */ shallowRef<string>("home");

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
  return THREAD_HOSTS.has(route?.name) && threadParam(route?.query) !== null;
}

/** True while Home's Ask box is on screen; Home keeps its tab in state, not always in `?tab=`, so the mounted box is the signal. */
export function isHomeAskShown(route: RouteLike | null | undefined): boolean {
  return (
    THREAD_HOSTS.has(route?.name) &&
    threadParam(route?.query) === null &&
    overviewFocusListening.value
  );
}

/** Home's AI tab at Full density on `sid`, keeping the other query keys. */
export function fullThreadLocation(
  sid: string | null,
  query: LocationQuery | LocationQueryRaw = {},
  host: string = threadHost.value,
): RouteLocationRaw {
  const tab = host === "home" ? { [HOME_TAB_QUERY_KEY]: AI_HOME_TAB } : {};
  return { name: host, query: { ...query, ...tab, [THREAD_QUERY_KEY]: sid ?? "" } };
}

/** The same query without the thread key, so the AI tab goes back to its briefing. */
export function withoutThread(query: LocationQuery): LocationQuery {
  const next = { ...query };
  delete next[THREAD_QUERY_KEY];
  return next;
}

/** The query a push to Home's full view carries: Home keeps its own keys; any other page passes only its org, so its own filters never leak into Home. */
export function homeQueryFrom(route: RouteLike | null | undefined): LocationQuery {
  const query = (route?.query ?? {}) as LocationQuery;
  if (THREAD_HOSTS.has(route?.name)) return withoutThread(query);
  return query.org_identifier === undefined ? {} : { org_identifier: query.org_identifier };
}

/** The chat a link out of the full view is moving; the full view closes before the chat floats. */
export const leavingThread = /* @__PURE__ */ shallowRef<string | null>(null);

/** A link out of the full view: the page opens with the same chat floating over it; below lg or at the window cap it only navigates. */
export async function pushFromThread(
  router: Pick<Router, "push">,
  to: RouteLocationRaw,
  store?: Pick<AssistantStoreInternal, "state" | "floatChat">,
): Promise<NavigationFailure | void | undefined> {
  const live = store ?? runtimeHandle().value?.store;
  const shell = live?.state.shell;
  const sid = shell?.placement.kind === "full" ? shell.activeSid : null;
  if (sid) leavingThread.value = sid;
  try {
    const failure = await router.push(to);
    // Leaving closes the full view; one that went back to its side panel keeps the chat there.
    if (sid && !isNavigationFailure(failure) && live?.state.shell.placement.kind === "hidden")
      live.floatChat(sid, { focus: "none" });
    return failure;
  } finally {
    if (sid && leavingThread.value === sid) leavingThread.value = null;
  }
}

/** Home's AI tab back on its Ask box, focused: where a chat on Home starts over. */
export function homeAskLocation(
  query: LocationQuery,
  host: string = threadHost.value,
): RouteLocationRaw {
  return { name: host, query: { ...withoutThread(query), focus: "ask" } };
}
