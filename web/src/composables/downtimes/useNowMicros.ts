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

import { onScopeDispose, readonly, ref, type Ref } from "vue";
import { serverNowMs } from "@/composables/useAnnouncementBanners";

/** Window bars and countdowns read in minutes, so a minute step is the finest they show. */
export const NOW_TICK_MS = 60_000;

const nowMicros = ref(serverNowMs() * 1000);
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const tick = () => {
  nowMicros.value = serverNowMs() * 1000;
};

/** The server clock in microseconds, one ticker shared by every open view. */
export function useNowMicros(): Readonly<Ref<number>> {
  if (subscribers === 0) {
    tick();
    timer = setInterval(tick, NOW_TICK_MS);
  }
  subscribers += 1;
  onScopeDispose(() => {
    subscribers -= 1;
    if (subscribers === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return readonly(nowMicros);
}
