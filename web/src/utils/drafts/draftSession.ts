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

import { ref } from "vue";

/** True from an explicit sign-out until the next login: editor and panel draft writes are all refused. */
export const draftSessionEnded = ref(false);

/** True while a sign-out runs the editors' leave guards: a leave then offers no draft to keep. */
export const draftSigningOut = ref(false);

/** True while a sign-out runs with a session that can no longer save (a forced password reset): only Discard is offered. */
export const draftSignOutDiscardOnly = ref(false);

/** True while a sign-out cannot be cancelled (password or own role changed): closing the leave dialog discards. */
export const draftSignOutForced = ref(false);

export const beginDraftSignOut = ({
  discardOnly = false,
  forced = false,
}: { discardOnly?: boolean; forced?: boolean } = {}): void => {
  draftSigningOut.value = true;
  draftSignOutDiscardOnly.value = discardOnly || forced;
  draftSignOutForced.value = forced;
};

const clearSignOutFlags = () => {
  draftSigningOut.value = false;
  draftSignOutDiscardOnly.value = false;
  draftSignOutForced.value = false;
};

export const cancelDraftSignOut = (): void => {
  clearSignOutFlags();
};

export const markDraftSessionEnded = (): void => {
  clearSignOutFlags();
  draftSessionEnded.value = true;
};

export const resumeDraftSession = (): void => {
  clearSignOutFlags();
  draftSessionEnded.value = false;
};
