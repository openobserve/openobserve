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

// Written by the http interceptor and read by the dialog App.vue mounts, so the state lives in neither.

import { ref } from "vue";

// The two server reasons, plus the advisory one the expiry banner opens the dialog with.
export type PasswordResetReason = "policy_tightened" | "rotation_expired" | "rotation_warning";

type OrgStore = { state?: { selectedOrganization?: { identifier?: string } } };

/** Mirrors the server's DEFAULT_ORG — the one organization guaranteed to exist. */
const DEFAULT_ORG = "default";

/** A blocked user's org list is refused too, so `selectedOrganization` alone would yield `/api/undefined/...`. */
export const remediationOrg = (store: OrgStore | undefined): string =>
  store?.state?.selectedOrganization?.identifier || DEFAULT_ORG;

// Module scope, not per-call: every consumer must see the same flag.
const isOpen = ref(false);
const reason = ref<PasswordResetReason | null>(null);
// Only the blocked state is a trap; a user who opened the dialog voluntarily may close it.
const dismissible = ref(false);

const serverReason = (nextReason?: string): PasswordResetReason =>
  nextReason === "rotation_expired" || nextReason === "policy_tightened"
    ? nextReason
    : "policy_tightened";

export function usePasswordReset() {
  /** Enter the blocked state; the already-open guard stops parallel rejections stacking dialogs. */
  const open = (nextReason?: string) => {
    if (isOpen.value) return;
    reason.value = serverReason(nextReason);
    dismissible.value = false;
    isOpen.value = true;
  };

  /** Open the same dialog with a way back out, ahead of expiry. */
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

  return {
    isOpen,
    reason,
    dismissible,
    open,
    openVoluntarily,
    close,
  };
}
