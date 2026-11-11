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

import { computed, reactive, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { useStore } from "vuex";

// Shared across mounts, so reviewing from the banner ticks the step on Pages too.
const reviewed = reactive<Record<string, boolean>>({});

function read(key: string): boolean {
  if (key in reviewed) return reviewed[key];
  try {
    reviewed[key] = window.localStorage.getItem(key) === "1";
  } catch {
    reviewed[key] = false;
  }
  return reviewed[key];
}

/** Whether the escalation of this team was reviewed (or marked done) from the setup checklist, and the call that records it. */
export function useOnCallPolicyReviewed(teamId: MaybeRefOrGetter<string | null | undefined>): {
  reviewed: ComputedRef<boolean>;
  markReviewed: () => void;
} {
  const store = useStore();
  const key = computed(() => {
    const team = toValue(teamId);
    if (!team) return null;
    return `oncall-setup-policy-reviewed:${store.state.selectedOrganization?.identifier ?? ""}:${team}`;
  });

  function markReviewed() {
    if (!key.value) return;
    reviewed[key.value] = true;
    try {
      window.localStorage.setItem(key.value, "1");
    } catch {
      // Storage refused the write (private mode): done for this visit only.
    }
  }

  return { reviewed: computed(() => (key.value ? read(key.value) : false)), markReviewed };
}

/** Tests only: the cache outlives a component. */
export function resetOnCallPolicyReviewed(): void {
  Object.keys(reviewed).forEach((key) => delete reviewed[key]);
}
