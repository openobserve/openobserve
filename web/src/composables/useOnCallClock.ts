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

import { getCurrentScope, onScopeDispose, readonly, ref, type Ref } from "vue";

/**
 * ONE shared 1 s ticker, so every countdown on every on-call screen moves
 * together.
 *
 * The bug this exists to kill: `Date.now()` read inside a `computed` is not a
 * reactive dependency, so the value is captured at first render and never
 * updates. "Escalates in 4m" then stays "4m" while the ladder actually fires —
 * the one number a responder is deciding against, frozen. Depend on this ref
 * instead and the countdown recomputes:
 *
 *     const nowMicros = useOnCallClock();
 *     const escalatesIn = computed(() => next_at - nowMicros.value);
 *
 * Shared and reference-counted rather than one interval per component: a page
 * detail can hold half a dozen countdowns, and six intervals drifting against
 * each other means two tiles on one screen showing different seconds.
 *
 * MICROSECONDS, matching every timestamp the on-call API returns.
 */

/** 1 s: the finest granularity any on-call countdown renders. */
const TICK_MS = 1_000;

const nowMicros = ref(Date.now() * 1000);
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  nowMicros.value = Date.now() * 1000;
}

function start(): void {
  if (timer !== null) return;
  timer = setInterval(tick, TICK_MS);
}

function stop(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/**
 * A reactive "now" in microseconds that ticks once a second.
 *
 * The interval is released when the LAST consumer's scope is disposed (a
 * component unmount), so navigating away from the on-call module leaves nothing
 * running. Called from OUTSIDE an effect scope it returns a freshly-read ref but
 * starts nothing — there would be no unmount to stop it, and a timer nobody can
 * clear is worse than a static value.
 */
export function useOnCallClock(): Readonly<Ref<number>> {
  // Re-read on subscribe: a component mounting after the app has been
  // backgrounded must not render one tick's worth of stale countdown.
  tick();

  if (getCurrentScope()) {
    subscribers += 1;
    start();
    onScopeDispose(() => {
      subscribers = Math.max(0, subscribers - 1);
      if (subscribers === 0) stop();
    });
  }

  return readonly(nowMicros);
}

/** Current subscriber count. Exported for tests, not for feature code. */
export function onCallClockSubscribers(): number {
  return subscribers;
}

/** Whether the shared interval is running. Exported for tests. */
export function onCallClockRunning(): boolean {
  return timer !== null;
}
