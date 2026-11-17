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

// Shared across mounts, so hiding the bar on one page hides it on every On-Call page at once.
const hidden = reactive<Record<string, boolean>>({});

function read(key: string): boolean {
  if (key in hidden) return hidden[key];
  try {
    hidden[key] = window.localStorage.getItem(key) === "1";
  } catch {
    hidden[key] = false;
  }
  return hidden[key];
}

/** Whether this person hid the setup bar in this org, and the call that hides it. */
export function useOnCallSetupDismissed(): {
  dismissed: ComputedRef<boolean>;
  dismiss: () => void;
} {
  const store = useStore();
  const key = computed(
    () =>
      `oncall-setup-dismissed:${store.state.selectedOrganization?.identifier ?? ""}:${String(
        store.state.userInfo?.email ?? "",
      ).toLowerCase()}`,
  );
  const dismissed = computed(() => read(key.value));

  function dismiss() {
    hidden[key.value] = true;
    try {
      window.localStorage.setItem(key.value, "1");
    } catch {
      // Storage refused the write (private mode): hidden for this visit only.
    }
  }

  return { dismissed, dismiss };
}

/** Tests only: the cache outlives a component. */
export function resetOnCallSetupDismissed(): void {
  Object.keys(hidden).forEach((key) => delete hidden[key]);
}
