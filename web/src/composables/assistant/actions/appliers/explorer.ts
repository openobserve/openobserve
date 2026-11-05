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

import { explorerTarget } from "@/utils/assistant/explorerRoutes";

import { registerApplier, type Applier } from "../registry";
import type { AssistantAction } from "../types";
import { openTarget } from "./navigation";

/** Open in {explorer}: the typed route with stream, absolute range and query; the page applies it and never runs it. */
export const explorerApplier: Applier<Extract<AssistantAction, { kind: "open_in_explorer" }>> = (
  sid,
  action,
  env,
) => {
  const session = env.store().state.sessions[sid];
  if (!session) return { ok: false, reason: "failed" };
  const target = explorerTarget({ ...action.query, org: session.org }, action.explorer, "");
  return openTarget(sid, target, env, { newTab: false });
};

export function registerExplorerAppliers(): void {
  registerApplier("open_in_explorer", explorerApplier);
}
