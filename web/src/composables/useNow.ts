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

const TICK_MS = 10_000;

const now = ref(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** The current time in epoch ms, ticking every 10 seconds while any component uses it. */
export function useNow(): Readonly<Ref<number>> {
  if (subscribers === 0) {
    now.value = Date.now();
    timer = setInterval(() => {
      now.value = Date.now();
    }, TICK_MS);
  }
  subscribers += 1;
  onScopeDispose(() => {
    subscribers -= 1;
    if (subscribers === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return readonly(now);
}
