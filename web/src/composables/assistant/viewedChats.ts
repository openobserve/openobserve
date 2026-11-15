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

import { onScopeDispose, shallowReactive, watch } from "vue";

import type { Sid } from "./assistantStore.types";

const displayed = /* @__PURE__ */ shallowReactive(new Map<symbol, Sid>());

/** The chats some mounted container has on screen with its transcript showing. */
export function viewedChatSids(): ReadonlySet<Sid> {
  return new Set(displayed.values());
}

/** Registers what one container displays; `null` while its chat is covered, peeked or listed over. */
export function useViewedChat(sid: () => Sid | null): void {
  const id = Symbol("viewedChat");
  watch(
    sid,
    (value) => {
      if (value) displayed.set(id, value);
      else displayed.delete(id);
    },
    { immediate: true },
  );
  onScopeDispose(() => displayed.delete(id));
}
