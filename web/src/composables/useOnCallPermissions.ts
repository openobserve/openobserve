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

import { computed, reactive, type ComputedRef } from "vue";
import { useStore } from "vuex";

import usersService from "@/services/users";

/**
 * The on-call RBAC split, expressed once for the whole module.
 *
 * There are two openfga resources, and they are deliberately not the same
 * permission:
 *
 *  - `oncall` — CONFIGURATION: teams, members, rotations, escalation policy,
 *    ownership rules. An admin/editor write.
 *  - `oncall_response` — WORKING A PAGE: acknowledge, note, snooze, hand off,
 *    resolve. Every member of the org may do this, a viewer included. Being
 *    woken at 3am and not being allowed to say "I have it" is the failure this
 *    split exists to prevent.
 *
 * The API has no "what may I do" endpoint, so `canConfigure` is answered from
 * the org member list and is OPTIMISTIC until that answer arrives — a missing
 * control is worse than one that 403s, and the server is the real gate either
 * way. An observed 403 on a configuration write is authoritative and latches
 * the answer closed for the rest of the session.
 */
export interface OnCallPermissions {
  /** May change on-call configuration (`oncall` write). */
  canConfigure: ComputedRef<boolean>;
  /** May work a page (`oncall_response` write). True for every org member. */
  canRespond: ComputedRef<boolean>;
  /** True once the role probe has answered, so a caller can defer a hard gate. */
  permissionsResolved: ComputedRef<boolean>;
  /**
   * Call from the catch block of a configuration write. A 403 is the only
   * authoritative answer the frontend ever gets.
   */
  noteConfigurationDenied: (err: unknown) => void;
}

/** Roles that carry `oncall` writes without a custom grant (see access-fixes §3). */
const CONFIGURING_ROLES = new Set(["root", "admin", "editor"]);

interface OrgMember {
  email?: string;
  role?: string;
}

/// Module-scoped so four on-call screens mounted in one session share one
/// probe rather than each asking the same question.
const state = reactive({
  /** org identifier → may configure, once known. */
  byOrg: {} as Record<string, boolean>,
  /** Orgs whose probe is in flight or finished, so it runs at most once. */
  probed: [] as string[],
});

/** Tests only — the cache outlives a component, so it has to be resettable. */
export function resetOnCallPermissions(): void {
  state.byOrg = {};
  state.probed = [];
}

function isDenied(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 || status === 401;
}

async function probeRole(orgId: string, email: string): Promise<void> {
  if (!orgId || state.probed.includes(orgId)) return;
  state.probed.push(orgId);
  try {
    const res = await usersService.orgUsers(orgId);
    const members: OrgMember[] = res?.data?.data ?? [];
    const mine = members.find((m) => (m.email ?? "").toLowerCase() === email);
    // No row for me means the list is not a view of my membership; that is not
    // a denial, so stay optimistic.
    if (!mine?.role) return;
    state.byOrg[orgId] = CONFIGURING_ROLES.has(mine.role.toLowerCase());
  } catch {
    // A 403 on the member list is not a 403 on on-call — only an on-call write
    // answers that — and anything else is transient. Either way: optimistic.
  }
}

export function useOnCallPermissions(): OnCallPermissions {
  const store = useStore();
  const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const email = String(store.state.userInfo?.email ?? "").toLowerCase();

  // Fire-and-forget: the screen renders on the optimistic answer and tightens
  // when the real one lands.
  void probeRole(orgId.value, email);

  const canConfigure = computed<boolean>(() => state.byOrg[orgId.value] ?? true);
  const canRespond = computed<boolean>(() => true);
  const permissionsResolved = computed<boolean>(() => orgId.value in state.byOrg);

  function noteConfigurationDenied(err: unknown): void {
    if (isDenied(err) && orgId.value) state.byOrg[orgId.value] = false;
  }

  return { canConfigure, canRespond, permissionsResolved, noteConfigurationDenied };
}
