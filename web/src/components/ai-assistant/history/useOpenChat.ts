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

import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import { useAssistantStore, type Sid } from "@/composables/assistant";
import { homeQueryFrom } from "@/composables/assistant/pure";

export interface OpenChatTarget {
  /** `rail` routes to the full view; `panel` opens in its own container. */
  mode: "panel" | "rail";
  /** The window a panel list sits in: the chat opens there, never in the primary container. */
  windowSid?: Sid | null;
}

/** Opens a listed chat where its list lives; `opened` runs once the chat is on its way. */
export function useOpenChat() {
  const router = useRouter();
  const route = useRoute();
  const store = useAssistantStore();
  const vuex = useStore();

  return async (sid: Sid, target: OpenChatTarget, opened?: (sid: Sid) => void): Promise<void> => {
    if (target.mode === "rail") {
      await router.push({
        name: "assistant",
        params: { chatId: sid },
        query: {
          ...homeQueryFrom(route),
          org_identifier: vuex.state.selectedOrganization?.identifier ?? "",
        },
      });
      opened?.(sid);
      return;
    }
    // The panel leaves its list first, so the chat opens into the container's own view.
    opened?.(sid);
    const opening = target.windowSid
      ? store.openInWindow(target.windowSid, { sid })
      : store.openSession({ sid }, { focus: true });
    await opening.catch(() => undefined);
  };
}
