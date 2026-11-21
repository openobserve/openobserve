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

import { onActivated, onDeactivated, onScopeDispose, watch } from "vue";

/** Home's briefing re-reads its sources this often while it is on screen. */
export const HOME_REFRESH_MS = 60_000;

/** Runs `tick` every interval only while `enabled` holds and the browser tab is visible; a return after a full interval ticks at once. */
export function useHomeRefresh(
  enabled: () => boolean,
  tick: () => void,
  intervalMs = HOME_REFRESH_MS,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTick = Date.now();
  let active = true;

  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

  function run(): void {
    lastTick = Date.now();
    tick();
  }

  function sync(): void {
    const on = active && enabled() && visible();
    if (on && !timer) {
      if (Date.now() - lastTick >= intervalMs) run();
      timer = setInterval(run, intervalMs);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  const stop = watch(enabled, sync, { immediate: true });
  document.addEventListener("visibilitychange", sync);
  // Home is kept alive, so a hidden Home tab must not keep reading.
  onActivated(() => {
    active = true;
    sync();
  });
  onDeactivated(() => {
    active = false;
    sync();
  });
  onScopeDispose(() => {
    stop();
    document.removeEventListener("visibilitychange", sync);
    if (timer) clearInterval(timer);
    timer = null;
  });
}
