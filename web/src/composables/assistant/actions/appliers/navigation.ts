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

import { isNavigationFailure } from "vue-router";

import {
  encodeHomeReturn,
  HOME_RETURN_QUERY_KEY,
  homeReturnFor,
  type HomeReturnState,
} from "@/composables/goto/homeReturn";
import { AI_CHAT_QUERY, EXPLORER_ROUTE_NAMES } from "@/utils/assistant/explorerRoutes";

import {
  ASSISTANT_SET_QUERY_KEY,
  encodeAssistantSet,
  type AssistantSetField,
} from "../../assistantSet";
import type { Sid } from "../../assistantStore.types";
import { MARKDOWN_LINK_ROUTES } from "../../navigationRoutes";
import { registerApplier, type ActionEnv, type Applier } from "../registry";
import type { ActionResult, AssistantAction, RouteTarget } from "../types";

// Every route a link card may open; anything else is refused before the router sees it.
const LINK_ROUTE_NAMES: ReadonlySet<string> = new Set([
  ...MARKDOWN_LINK_ROUTES,
  EXPLORER_ROUTE_NAMES.logs,
  EXPLORER_ROUTE_NAMES.metrics,
  EXPLORER_ROUTE_NAMES.traces,
]);

/** A link card's Open: an allowlisted route with the session's org, pushed only on this click. */
export const navigationApplier: Applier<Extract<AssistantAction, { kind: "navigate" }>> = (
  sid,
  action,
  env,
) => {
  if (!LINK_ROUTE_NAMES.has(action.target.name)) return { ok: false, reason: "failed" };
  return openTarget(sid, action.target, env, { newTab: action.newTab === true });
};

/** Opens a typed target: a new tab from a docked or dirty container, else a push through the leave guards. */
export async function openTarget(
  sid: Sid,
  target: RouteTarget,
  env: ActionEnv,
  opts: { newTab: boolean },
): Promise<ActionResult> {
  const router = env.router();
  const session = env.store().state.sessions[sid];
  if (!router || !session) return { ok: false, reason: "failed" };
  const { org_identifier: _org, ...query }: Record<string, string> = { ...(target.query ?? {}) };
  const traces = target.name === EXPLORER_ROUTE_NAMES.traces;
  // An open Traces page re-applies a link only on a new nonce, and a repeated service link is otherwise the same URL.
  if (query.type === AI_CHAT_QUERY || (traces && query.service)) query.t = String(env.now());
  const set = traces ? assistantSetOf(query) : "";
  if (set) query[ASSISTANT_SET_QUERY_KEY] = set;
  const home = homeReturnFor(sid);
  // Home reads the return state from its own keys and ignores `home_return`, as the bar's Back does.
  if (target.name === "home") Object.assign(query, overviewQuery(home));
  else if (home) query[HOME_RETURN_QUERY_KEY] = encodeHomeReturn(home);
  // Set last, so neither the agent nor a link can point the session at another org.
  query.org_identifier = session.org;
  const location = { name: target.name, params: { ...(target.params ?? {}) }, query };
  if (opts.newTab || mustOpenElsewhere(env)) {
    const href = router.resolve(location).href;
    return env.openTab(href)
      ? { ok: true, detail: { newTab: true } }
      : { ok: false, reason: "failed" };
  }
  const failure = await router.push(location);
  if (isNavigationFailure(failure)) return { ok: false, reason: "guard_declined" };
  return { ok: true, detail: { newTab: false } };
}

export function registerNavigationAppliers(): void {
  registerApplier("navigate", navigationApplier);
}

function overviewQuery(state: HomeReturnState | null): Record<string, string> {
  const query: Record<string, string> = { home_tab: "overview" };
  if (state?.row) query.row = state.row;
  if (state?.period) query.period = state.period;
  if (state?.from !== undefined) query.from = String(state.from);
  if (state?.to !== undefined) query.to = String(state.to);
  if (state?.focus) query.focus = state.focus;
  return query;
}

function assistantSetOf(query: Record<string, string>): string {
  const fields: AssistantSetField[] = [];
  if (query.query) fields.push("query");
  if (query.stream) fields.push("stream");
  if (query.from || query.to || query.period) fields.push("time");
  return encodeAssistantSet(fields);
}

// A docked container or a host with unsaved changes never navigates its own page.
function mustOpenElsewhere(env: ActionEnv): boolean {
  if (env.store().state.shell.placement.kind === "docked") return true;
  return env.hosts.mounted.value.some((id) => env.hosts.get(id)?.isDirty() === true);
}
