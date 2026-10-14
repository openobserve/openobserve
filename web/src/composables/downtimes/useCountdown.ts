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

import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { msUntilCountdownChanges } from "@/utils/downtimes/banner";

/** Lands each wake-up just past the minute boundary rather than racing it. */
const SLACK_MS = 50;

/**
 * Seconds left until `endsAtMicros`, refreshed only when the countdown text would change
 * (once a minute, and at the end), so a host re-renders nothing in between.
 */
export function useCountdown(
  endsAtMicros: MaybeRefOrGetter<number | null | undefined>,
  nowMs: () => number = Date.now,
) {
  const remainingSecs = ref<number | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = () => {
    clearTimeout(timer);
    timer = undefined;
    const end = toValue(endsAtMicros);
    if (end == null) {
      remainingSecs.value = null;
      return;
    }
    const remainingMs = end / 1000 - nowMs();
    remainingSecs.value = Math.floor(remainingMs / 1000);
    const delay = msUntilCountdownChanges(remainingMs);
    if (delay !== null) timer = setTimeout(update, delay + SLACK_MS);
  };

  watch(() => toValue(endsAtMicros), update, { immediate: true });
  onScopeDispose(() => clearTimeout(timer));

  return { remainingSecs };
}
