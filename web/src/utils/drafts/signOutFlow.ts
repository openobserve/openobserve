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

import type { Router } from "vue-router";
import {
  getPath,
  useLocalCurrentUser,
  useLocalUserInfo,
  invalidateLoginData,
} from "@/utils/zincutils";
import { forgetLinkRequest } from "@/utils/slackLink";
import {
  beginDraftSignOut,
  cancelDraftSignOut,
  signOutLeaveWillAsk,
} from "@/utils/drafts/draftSession";
import { countAllDraftsFor, endEditorDraftSession } from "@/utils/drafts/editorDraftStore";
import {
  silenceUnloadPrompts,
  stopSessionServices,
  type SessionServicesStore,
} from "@/utils/sessionServices";

interface SignOutStore extends SessionServicesStore {
  state: SessionServicesStore["state"] & { userInfo?: { email?: string } };
  dispatch: (type: "logout", payload?: { draftsOf?: string }) => unknown;
}

interface SignOutOptions {
  /** The session can no longer save (forced password reset), so the leave dialogs offer only Discard. */
  discardOnly?: boolean;
  /** The old session is already dead (the user's own password changed): no guard can keep the user in it, and the drafts stay as after an expired session. */
  forced?: boolean;
}

/** A full load, as the /logout route does, so nothing of the previous user's session stays in memory. */
export const reloadToLogin = (): void => {
  // The guards have already been answered, so no editor's own "leave site?" prompt may ask again on the way out.
  silenceUnloadPrompts();
  window.location.assign(`${getPath()}login`);
};

/** Ends the signed-in session here: services stopped, login data gone and, unless kept, this user's drafts gone with no draft written after. */
export const endSignedInSession = (
  store: SignOutStore,
  { keepDrafts = false }: { keepDrafts?: boolean } = {},
): void => {
  const userEmail = String(store.state.userInfo?.email ?? "");
  stopSessionServices(store);
  invalidateLoginData();
  if (keepDrafts) store.dispatch("logout");
  else {
    store.dispatch("logout", { draftsOf: userEmail });
    endEditorDraftSession(userEmail);
  }
  useLocalCurrentUser("", true);
  useLocalUserInfo("", true);
  forgetLinkRequest();
};

/** How many of the user's drafts a sign-out must confirm before it runs: 0 when there are none, or when an open editor's leave dialog tells about them itself. */
export const signOutDraftsToConfirm = (store: SignOutStore): number => {
  const count = countAllDraftsFor(String(store.state.userInfo?.email ?? ""));
  return count > 0 && !signOutLeaveWillAsk() ? count : 0;
};

/** Signs out through the open editors' leave guards, so their Save still has a session, then reloads to login; resolves false when one of them keeps the user. */
export const signOutThroughLeaveGuards = (
  router: Router,
  store: SignOutStore,
  { discardOnly = false, forced = false }: SignOutOptions = {},
): Promise<boolean> => {
  beginDraftSignOut({ discardOnly, forced });
  let signedOut = false;
  const endSession = () => {
    if (signedOut) return;
    signedOut = true;
    endSignedInSession(store, { keepDrafts: forced });
  };
  // Global guards run after the leave guards; a redirect would run every leave guard again, so the reload ends the navigation.
  const removeGuard = router.beforeEach((to) => {
    removeGuard();
    if (to.path !== "/logout") return true;
    endSession();
    return false;
  });
  const finish = (refused: boolean) => {
    removeGuard();
    if (refused && !forced && !signedOut) {
      cancelDraftSignOut();
      return false;
    }
    endSession();
    reloadToLogin();
    return true;
  };
  // A guard that throws refuses like one that returns false, so the sign-out never hangs half-done.
  return router.push("/logout").then(
    (failure) => finish(!!failure),
    () => finish(true),
  );
};
