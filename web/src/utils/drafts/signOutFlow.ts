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
import { useLocalCurrentUser, useLocalUserInfo, invalidateLoginData } from "@/utils/zincutils";
import { forgetLinkRequest } from "@/utils/slackLink";
import { beginDraftSignOut, cancelDraftSignOut } from "@/utils/drafts/draftSession";
import { endEditorDraftSession } from "@/utils/drafts/editorDraftStore";

interface SignOutStore {
  dispatch: (type: "logout") => unknown;
}

interface SignOutOptions {
  beforeLogout?: () => void;
  /** The session can no longer save (forced password reset), so the leave dialogs offer only Discard. */
  discardOnly?: boolean;
}

/** Signs out through the open editors' leave guards, so their Save still has a session; resolves false when one of them keeps the user. */
export const signOutThroughLeaveGuards = (
  router: Router,
  store: SignOutStore,
  { beforeLogout = () => {}, discardOnly = false }: SignOutOptions = {},
): Promise<boolean> => {
  beginDraftSignOut(discardOnly);
  // Global guards run after the leave guards; redirecting in place keeps the page, so no native unload prompt fires.
  const removeGuard = router.beforeEach((to) => {
    removeGuard();
    if (to.path !== "/logout") return true;
    beforeLogout();
    invalidateLoginData();
    store.dispatch("logout");
    endEditorDraftSession();
    useLocalCurrentUser("", true);
    useLocalUserInfo("", true);
    forgetLinkRequest();
    return { path: "/login", replace: true };
  });
  return router.push("/logout").then((failure) => {
    if (!failure) return true;
    removeGuard();
    cancelDraftSignOut();
    return false;
  });
};
