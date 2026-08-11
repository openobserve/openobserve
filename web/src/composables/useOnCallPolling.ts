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

import { onUnmounted, readonly, ref, type Ref } from "vue";

/** 20s: fast enough that a page arriving mid-triage is visible, slow enough
 *  that a busy org is not re-listing its whole open set every few seconds. */
export const ONCALL_POLL_INTERVAL_MS = 20_000;

export interface OnCallPolling {
  /** True while a silent refresh is in flight — drives `#loading-banner`. */
  polling: Readonly<Ref<boolean>>;
  /** Run one tick now, subject to the same gate. Used on tab re-focus. */
  pollNow: () => Promise<void>;
}

/**
 * A visibility-aware refresh for an on-call list.
 *
 * The triage list is the one screen where a record arriving while you look at
 * it must not be invisible until you press refresh. Three gates keep that from
 * being hostile:
 *
 *  - a hidden tab does not poll at all (nobody is reading it, and a laptop
 *    lid closed overnight should not have issued 1,800 requests),
 *  - a poll never runs while `isPaused()` — which the call site wires to
 *    "rows are selected" and "a manual fetch is already running", so the list
 *    cannot reshuffle under a selection somebody is about to act on,
 *  - `polling` is separate from the view's own `loading`, so a silent refresh
 *    renders a banner rather than blanking the table.
 *
 * @param poll      the refresh itself; it owns its own error handling
 * @param isPaused  true while a tick must be skipped
 */
export function useOnCallPolling(
  poll: () => void | Promise<void>,
  isPaused: () => boolean,
  intervalMs: number = ONCALL_POLL_INTERVAL_MS,
): OnCallPolling {
  const polling = ref(false);

  const isVisible = () =>
    typeof document === "undefined" || document.visibilityState === "visible";

  async function pollNow(): Promise<void> {
    if (polling.value || !isVisible() || isPaused()) return;
    polling.value = true;
    try {
      await poll();
    } finally {
      polling.value = false;
    }
  }

  const timer = setInterval(() => {
    void pollNow();
  }, intervalMs);

  // A tab that has been hidden for ten minutes is stale the instant it comes
  // back; waiting up to another 20s for the next tick is the same bug again.
  const onVisibility = () => {
    if (isVisible()) void pollNow();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  onUnmounted(() => {
    clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  });

  return { polling: readonly(polling), pollNow };
}
