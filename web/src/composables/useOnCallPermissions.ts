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

export interface OnCallPermissions {
  /** May change on-call configuration (`oncall` write). */
  canConfigure: ComputedRef<boolean>;
  /** Call from the catch block of a configuration write — the only authoritative denial the frontend gets. */
  noteConfigurationDenied: (err: unknown) => void;
}

// The API has no "what may I do" endpoint and role strings vary by provisioning
// path (native vs SSO/SCIM), so controls render optimistically and the server
// is the real gate: an observed 403 on an actual write is what latches a
// control closed, never a client-side role guess.
const state = reactive({
  deniedOrgs: [] as string[],
});

/** Tests only — the cache outlives a component, so it has to be resettable. */
export function resetOnCallPermissions(): void {
  state.deniedOrgs = [];
}

function isDenied(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 || status === 401;
}

export function useOnCallPermissions(): OnCallPermissions {
  const store = useStore();
  const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");

  const canConfigure = computed<boolean>(() => !state.deniedOrgs.includes(orgId.value));

  function noteConfigurationDenied(err: unknown): void {
    if (isDenied(err) && orgId.value && !state.deniedOrgs.includes(orgId.value)) {
      state.deniedOrgs.push(orgId.value);
    }
  }

  return { canConfigure, noteConfigurationDenied };
}
