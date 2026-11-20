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

import { onActivated, onBeforeUnmount, onDeactivated, onMounted, watch } from "vue";

/** Calls `tick` every `seconds()` while the calling component is mounted and shown; 0 stops it. */
export function useAutoRefreshTimer(seconds: () => number, tick: () => void): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let shown = false;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const restart = () => {
    stop();
    const every = Number(seconds()) || 0;
    if (shown && every > 0) timer = setInterval(tick, every * 1000);
  };
  const show = () => {
    shown = true;
    restart();
  };
  const hide = () => {
    shown = false;
    stop();
  };

  watch(seconds, restart);
  onMounted(show);
  // A kept-alive view keeps its state while away, so its timer pauses with it.
  onActivated(show);
  onDeactivated(hide);
  onBeforeUnmount(hide);
}
