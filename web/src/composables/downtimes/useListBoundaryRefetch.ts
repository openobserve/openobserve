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

import { onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { DowntimeListItem } from "@/services/downtimes";
import { nextListBoundary } from "@/services/downtimes.queries";
import {
  bannerBoundaryTick,
  serverClockSkewMs,
  serverNowMs,
} from "@/composables/useAnnouncementBanners";

/** Lands the refetch just past the boundary, so the server already reports the new status. */
const SLACK_MS = 1000;

/** Past this a timer is clamped or throttled, so a farther boundary is reached in capped steps. */
const MAX_TIMER_MS = 60 * 60 * 1000;

/** Refetches the list when a loaded row's window opens or closes, or the org banner passes a boundary. */
export function useListBoundaryRefetch(
  items: MaybeRefOrGetter<readonly DowntimeListItem[] | undefined>,
  updatedAt: MaybeRefOrGetter<number>,
  refetch: () => unknown,
  nowMs: () => number = serverNowMs,
  clockSkew: MaybeRefOrGetter<number> = serverClockSkewMs,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armedBoundary: number | undefined;

  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    armedBoundary = undefined;
  };

  const arm = () => {
    clear();
    const at = nextListBoundary(toValue(items) ?? [], nowMs() * 1000);
    if (at == null) return;
    const delayMs = at / 1000 - nowMs();
    // Recorded before either branch, so a clock correction can see this boundary has passed.
    armedBoundary = at;
    // A far boundary gets a capped wake-up that recomputes the delay, since nothing else polls the list.
    if (delayMs > MAX_TIMER_MS) {
      timer = setTimeout(arm, MAX_TIMER_MS);
      return;
    }
    timer = setTimeout(
      () => {
        clear();
        void refetch();
      },
      Math.max(0, delayMs) + SLACK_MS,
    );
  };

  // A corrected clock can show the armed boundary already passed; otherwise it only moves the timer.
  const onSkewChange = () => {
    if (armedBoundary != null && armedBoundary <= nowMs() * 1000) {
      clear();
      void refetch();
      return;
    }
    arm();
  };

  // A refetch that returns equal rows keeps the same array, so the fetch time re-arms too.
  watch([() => toValue(items), () => toValue(updatedAt)], arm, { immediate: true });
  watch(() => toValue(clockSkew), onSkewChange);
  watch(bannerBoundaryTick, () => void refetch());
  onScopeDispose(clear);
}
