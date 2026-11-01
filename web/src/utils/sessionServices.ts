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

import { openobserveRum } from "@openobserve/browser-rum";
import { closeSearchSocket } from "@/composables/useSearchWebSocket";
import { dismissAll } from "@/lib/feedback/Toast/useToast";
import { resetAccess } from "@/composables/useAccessStore";
import { PANEL_DRAFT_PREFIX } from "@/composables/dashboard/usePanelDraft";
import { EDITOR_DRAFT_INDEX_KEY, EDITOR_DRAFT_PREFIX } from "@/utils/drafts/editorDraftStore";
import { DRAFT_SIGNED_OUT_KEY } from "@/utils/drafts/draftSession";
import { getPath, useLocalCurrentUser, useLocalUserInfo } from "@/utils/zincutils";

const DRAFT_KEY_PREFIXES = [
  EDITOR_DRAFT_PREFIX,
  EDITOR_DRAFT_INDEX_KEY,
  PANEL_DRAFT_PREFIX,
  DRAFT_SIGNED_OUT_KEY,
];

export interface SessionServicesStore {
  state: { zoConfig?: { rum?: { enabled?: boolean } } };
}

interface ExpiringStore extends SessionServicesStore {
  dispatch: (type: "logout") => unknown;
}

/** Stops what outlives a page change: the search socket, AI chat streams, open toasts, access denials and the RUM user. */
export const stopSessionServices = (store: SessionServicesStore): void => {
  closeSearchSocket();
  // AI chat streams outlive their component by design, so sign-out stops them explicitly.
  window.dispatchEvent(new Event("o2:abort-ai-streams"));
  dismissAll();
  resetAccess();
  if (store.state.zoConfig?.rum?.enabled) {
    openobserveRum.stopSessionReplayRecording();
    openobserveRum.clearUser();
    openobserveRum.clearAccount();
  }
};

/** Stops every "leave site?" prompt for the rest of this page, for a reload the user can no longer stay out of. */
export const silenceUnloadPrompts = (): void => {
  window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), {
    capture: true,
  });
};

/** Empties localStorage except the drafts, which belong to their user and outlive any one session. */
export const clearLocalStorageKeepingDrafts = (): void => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && !DRAFT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
      keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
};

/** Ends a session the server rejected and reloads: the user's drafts stay, so the work survives the next login. */
export const expireSession = (
  store: ExpiringStore,
  {
    clearLocalStorage = false,
    toLogin = false,
  }: {
    clearLocalStorage?: boolean;
    /** Goes to the login page instead of reloading, for a page whose reload would sign in again (the login callback). */
    toLogin?: boolean;
  } = {},
): void => {
  stopSessionServices(store);
  store.dispatch("logout");
  useLocalCurrentUser("", true);
  useLocalUserInfo("", true);
  if (clearLocalStorage) clearLocalStorageKeepingDrafts();
  sessionStorage.clear();
  sessionStorage.setItem('o2:session-expired-notice', '1');
  // The session is gone, so an editor's "leave site?" prompt could only keep the user on a dead page.
  silenceUnloadPrompts();
  if (toLogin) window.location.assign(`${getPath()}login`);
  else window.location.reload();
};
