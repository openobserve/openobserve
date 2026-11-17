//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { onScopeDispose, readonly, ref, watch, type Ref, type WatchSource } from "vue";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";

/** Follows `source`, but turns on only after it has stayed true for `delayMs`; it turns off at once. */
export function useDelayedFlag(
  source: WatchSource<boolean>,
  delayMs = LOADER_DELAY_MS,
): Readonly<Ref<boolean>> {
  const shown = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    source,
    (on) => {
      clearTimeout(timer);
      if (!on) {
        shown.value = false;
        return;
      }
      timer = setTimeout(() => {
        shown.value = true;
      }, delayMs);
    },
    { immediate: true },
  );
  onScopeDispose(() => clearTimeout(timer));
  return readonly(shown);
}
