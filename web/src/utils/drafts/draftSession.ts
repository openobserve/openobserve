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
import type { ConfirmDialogOptions } from "@/composables/useConfirmDialog";
import type { TranslateFn } from "@/types/i18n";

/** True from an explicit sign-out until the next login: editor and panel draft writes are all refused. */
export const draftSessionEnded = ref(false);

/** True while a sign-out runs the editors' leave guards: a leave then offers no draft to keep. */
export const draftSigningOut = ref(false);

/** True while a sign-out runs with a session that can no longer save (a forced password reset): only Discard is offered. */
export const draftSignOutDiscardOnly = ref(false);

/** True while a sign-out cannot be cancelled (the user's own password changed): the editors keep their work as drafts and go. */
export const draftSignOutForced = ref(false);

/** Users signed out in this browser, so a tab still open in the old session never writes their deleted drafts back. */
export const DRAFT_SIGNED_OUT_KEY = "o2_draft_signed_out";

// Each open editor's "would my leave guard ask?", so a sign-out can let that dialog speak for the drafts.
const signOutLeaveAskers = new Set<() => boolean>();

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

/** A leave guard with no draft to keep, during a forced sign-out: it offers only Discard, as staying cannot stop the sign-out. */
export const confirmForcedSignOutDiscard = (
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>,
  t: TranslateFn,
): Promise<boolean> =>
  confirm({
    title: t("common.editorDraft.leaveTitle"),
    message: t("common.editorDraft.leaveMessageForcedUnnamed"),
    confirmLabel: t("common.editorDraft.discard"),
    confirmVariant: "destructive",
    confirmOnly: true,
  });

const readSignedOut = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFT_SIGNED_OUT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((email): email is string => typeof email === "string")
      : [];
  } catch {
    return [];
  }
};

const writeSignedOut = (emails: string[]) => {
  try {
    if (emails.length) localStorage.setItem(DRAFT_SIGNED_OUT_KEY, JSON.stringify(emails));
    else localStorage.removeItem(DRAFT_SIGNED_OUT_KEY);
  } catch {
    /* storage blocked: no draft can be written either */
  }
};

/** Whether this user signed out in some tab of this browser since their last login here. */
export const draftUserSignedOut = (userEmail: string): boolean =>
  readSignedOut().includes(userEmail);

export const markDraftSessionEnded = (userEmail?: string): void => {
  clearSignOutFlags();
  draftSessionEnded.value = true;
  if (userEmail) writeSignedOut([...new Set([...readSignedOut(), userEmail])]);
};

/** Runs on login: this tab writes drafts again, and so does every tab of this user; a no-op while a sign-out runs. */
export const resumeDraftSession = (userEmail?: string): void => {
  if (draftSigningOut.value) return;
  draftSessionEnded.value = false;
  // An unknown user must not lift the sign-out of every other user signed out in this browser.
  if (userEmail) writeSignedOut(readSignedOut().filter((email) => email !== userEmail));
};

/** Registers an open editor's leave-guard check; returns the unregister call. */
export const registerSignOutLeaveAsker = (asks: () => boolean): (() => void) => {
  signOutLeaveAskers.add(asks);
  return () => {
    signOutLeaveAskers.delete(asks);
  };
};

/** Whether an open editor's leave dialog will ask on sign-out, and can tell about the other drafts itself. */
export const signOutLeaveWillAsk = (): boolean => [...signOutLeaveAskers].some((asks) => asks());
