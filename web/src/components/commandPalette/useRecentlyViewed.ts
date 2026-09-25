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

import type { RouteLocationNormalized } from "vue-router";
import { useFrecency } from "./useFrecency";

const THROTTLE_MS = 5000;
const IGNORED_ROUTES = new Set(["login", "logout", "cb", "callback", "home"]);

let lastId = "";
let lastAt = 0;

function firstString(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Maps a visited route to the palette item id that would open it, or null if none. */
export function routeToPaletteItemId(
  to: Pick<RouteLocationNormalized, "name" | "params" | "query">,
): string | null {
  const name = typeof to.name === "string" ? to.name : "";
  if (!name || IGNORED_ROUTES.has(name)) return null;
  const q = to.query ?? {};
  const p = to.params ?? {};
  if (name === "viewDashboard" && firstString(q.dashboard)) {
    return `dashboard:${firstString(q.folder) ?? "default"}/${firstString(q.dashboard)}`;
  }
  if (name === "alertDetail" && firstString(p.alert_id)) return `alert:${firstString(p.alert_id)}`;
  if (name === "pipelineEditor" && firstString(q.id)) return `pipeline:${firstString(q.id)}`;
  if (name === "functionList" && q.action === "update" && firstString(q.name)) {
    return `function:${firstString(q.name)}`;
  }
  const tab = firstString(q.tab);
  return tab ? `page:${name}:${tab}` : `page:${name}`;
}

export function useRecentlyViewed() {
  const { record } = useFrecency();

  /** Records a navigation; repeats of the same target within THROTTLE_MS count once. */
  const recordRouteVisit = (
    to: Pick<RouteLocationNormalized, "name" | "params" | "query">,
    now: number = Date.now(),
  ): void => {
    const id = routeToPaletteItemId(to);
    if (!id) return;
    if (id === lastId && now - lastAt < THROTTLE_MS) return;
    lastId = id;
    lastAt = now;
    record("palette_item", id, now, false);
  };

  const resetThrottle = (): void => {
    lastId = "";
    lastAt = 0;
  };

  return { recordRouteVisit, resetThrottle };
}
