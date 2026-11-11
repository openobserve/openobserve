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

import { shallowRef, type ShallowRef } from "vue";

import type { AssistantStoreInternal } from "../assistantStore";
import type { Sid } from "../assistantStore.types";
import { timeWindowOf } from "./contextChips";
import type { PageContext } from "./types";

/** The page context every tray shares; one reader per tab keeps it current. */
export const pageContext: ShallowRef<PageContext | null> = /* @__PURE__ */ shallowRef(null);

/** Pins the chat's shown window before one of its own links moves the page to the link's range. */
export function holdChatWindow(
  store: Pick<AssistantStoreInternal, "state" | "setTimeOverride">,
  sid: Sid,
): void {
  const session = store.state.sessions[sid];
  if (!session || session.composer.timeOverride) return;
  const { from, to, period } = timeWindowOf(pageContext.value, null);
  store.setTimeOverride(sid, period ? { from, to, period } : { from, to });
}
