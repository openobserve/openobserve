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

// Whether the signed-in user owes the instance a new password. Written by the
// http interceptor (a service, not a component), read by the dialog App.vue
// mounts — so the state lives here rather than in either of them, the same way
// useConfirmDialog does.

import { ref } from "vue";

import { gt } from "@/types/i18n";

import { useConfirmDialog } from "@/composables/useConfirmDialog";

// The two server reasons, plus the advisory one the expiry banner opens the dialog with.
export type PasswordResetReason = "policy_tightened" | "rotation_expired" | "rotation_warning";

type OrgStore = { state?: { selectedOrganization?: { identifier?: string } } };

/** Mirrors the server's DEFAULT_ORG — the one organization guaranteed to exist. */
const DEFAULT_ORG = "default";

/**
 * The org identifier to use on the two routes a blocked user may still call.
 *
 * It cannot come from `selectedOrganization`: listing organizations is itself one of the requests
 * the middleware refuses, so a blocked user never has one selected and the identifier is
 * `undefined`. That produced `/api/undefined/...`, which 401s — and the global 401 handler then
 * signs the user out, making a failed password change look like a successful one.
 */
export const remediationOrg = (store: OrgStore | undefined): string =>
  store?.state?.selectedOrganization?.identifier || DEFAULT_ORG;

// Module scope, not per-call: every consumer must see the same flag.
const isOpen = ref(false);
const reason = ref<PasswordResetReason | null>(null);
// Only the blocked state is a trap; a user who opened the dialog voluntarily may close it.
const dismissible = ref(false);
// Module scope: N refused writes → one prompt.
let restrictedPromptPending = false;

const serverReason = (nextReason?: string): PasswordResetReason =>
  nextReason === "rotation_expired" || nextReason === "policy_tightened"
    ? nextReason
    : "policy_tightened";

export function usePasswordReset() {
  /**
   * Enter the blocked state.
   *
   * The already-open guard is what stops a page firing several requests at once from stacking one
   * dialog per rejected request.
   */
  const open = (nextReason?: string) => {
    if (isOpen.value) return;
    reason.value = serverReason(nextReason);
    dismissible.value = false;
    isOpen.value = true;
  };

  /** Open the same dialog with a way back out — ahead of expiry, or from the read-only prompt. */
  const openVoluntarily = (nextReason: PasswordResetReason = "rotation_warning") => {
    if (isOpen.value) return;
    reason.value = nextReason;
    dismissible.value = true;
    isOpen.value = true;
  };

  const close = () => {
    isOpen.value = false;
    reason.value = null;
    dismissible.value = false;
  };

  /** A write was refused under restrict_writes: explain once, and offer the way out. */
  const promptRestricted = async (nextReason?: string) => {
    if (restrictedPromptPending) return;
    restrictedPromptPending = true;
    const why = serverReason(nextReason);
    try {
      const go = await useConfirmDialog().confirm({
        title: gt("passwordReset.restrictedTitle"),
        message: gt("passwordReset.restrictedMessage"),
        confirmLabel: gt("passwordReset.submit"),
        cancelLabel: gt("passwordReset.restrictedLater"),
        persistent: false,
      });
      if (go) openVoluntarily(why);
    } finally {
      restrictedPromptPending = false;
    }
  };

  return {
    isOpen,
    reason,
    dismissible,
    open,
    openVoluntarily,
    close,
    promptRestricted,
  };
}
