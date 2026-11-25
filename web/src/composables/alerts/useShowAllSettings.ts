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

import { computed, ref, watch, type Ref } from "vue";

const keyOf = (s: { user: string; org: string }) => `o2.alerts.showAllSettings:${s.user}:${s.org}`;

const read = (key: string): boolean => {
  try {
    return globalThis.localStorage?.getItem(key) === "true";
  } catch {
    return false;
  }
};

/** "Show all settings", remembered per user and org on this device; blocked storage just forgets. */
export function useShowAllSettings(scope: () => { user: string; org: string }): {
  showAll: Ref<boolean>;
  setShowAll(on: boolean): void;
} {
  const key = computed(() => keyOf(scope()));
  const showAll = ref(read(key.value));
  watch(key, (next) => {
    showAll.value = read(next);
  });
  const setShowAll = (on: boolean) => {
    showAll.value = on;
    try {
      if (on) globalThis.localStorage?.setItem(key.value, "true");
      else globalThis.localStorage?.removeItem(key.value);
    } catch {
      // Private mode or blocked storage: the choice lasts for this page only.
    }
  };
  return { showAll, setShowAll };
}
