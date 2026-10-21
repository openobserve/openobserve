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

import { AI_CHAT_QUERY, EXPLORER_ROUTE_NAMES } from "@/utils/assistant/explorerRoutes";

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
  const query: Record<string, string> = { ...(target.query ?? {}) };
  if (query.type === AI_CHAT_QUERY) query.t = String(env.now());
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

// A docked container or a host with unsaved changes never navigates its own page.
function mustOpenElsewhere(env: ActionEnv): boolean {
  if (env.store().state.shell.placement.kind === "docked") return true;
  return env.hosts.mounted.value.some((id) => env.hosts.get(id)?.isDirty() === true);
}
