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

import { onScopeDispose, readonly, ref, watch, type Ref } from "vue";

import { openingDurationMs } from "@/components/ai-assistant/common/assistantMotion";

/** Greeting, three starters and the composer: the items the opening staggers. */
export const OPENING_ITEMS = 5;

/** True from the moment `shown` turns on until the opening sequence has played once. */
export function useOpeningMotion(shown: () => boolean): { opening: Readonly<Ref<boolean>> } {
  const opening = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  // The classes come off after the run, so a later re-render or remount never replays it.
  watch(shown, (now, before) => {
    stop();
    opening.value = now && !before;
    if (!opening.value) return;
    timer = setTimeout(() => {
      timer = null;
      opening.value = false;
    }, openingDurationMs(OPENING_ITEMS));
  });

  onScopeDispose(stop);
  return { opening: readonly(opening) };
}
