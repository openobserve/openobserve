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

import { computed, shallowRef } from "vue";

const overviewFocusHandlers = new Set<() => void>();
// The Set is not reactive, so its size is mirrored for callers that gate on a listener.
const overviewFocusCount = shallowRef(0);

/** True while a Home Ask box listens for `/`, so the key is only captured when something answers it. */
export const overviewFocusListening = computed(() => overviewFocusCount.value > 0);

/** Focuses the Home Ask box (the `/` key); false when none is mounted. */
export function requestOverviewFocus(): boolean {
  if (overviewFocusHandlers.size === 0) return false;
  for (const handler of [...overviewFocusHandlers]) handler();
  return true;
}

export function onOverviewFocusRequest(handler: () => void): () => void {
  overviewFocusHandlers.add(handler);
  overviewFocusCount.value = overviewFocusHandlers.size;
  return () => {
    overviewFocusHandlers.delete(handler);
    overviewFocusCount.value = overviewFocusHandlers.size;
  };
}
