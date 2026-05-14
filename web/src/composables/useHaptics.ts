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

/**
 * Lightweight tactile-feedback helper for destructive / confirmatory touch
 * actions. Uses the Vibration API, which Android Chrome + Firefox support and
 * iOS Safari silently ignores (no harm, no throw).
 *
 * Keep durations short (5–30ms). Longer pulses feel broken, not intentional.
 */
import { computed } from "vue";

export type HapticKind = "selection" | "impact" | "warning";

const durations: Record<HapticKind, number | number[]> = {
  // Quick tick for discrete selections (swipe reveal, toggle).
  selection: 8,
  // Slightly firmer pulse for completed destructive/committed actions.
  impact: 14,
  // Double-tick for warnings that need noticing without alarming.
  warning: [8, 40, 8],
};

const hasVibrate = () =>
  typeof globalThis !== "undefined" &&
  typeof (globalThis.navigator as Navigator | undefined)?.vibrate === "function";

export function useHaptics() {
  const vibrate = (kind: HapticKind = "selection") => {
    // Re-check at call time rather than capturing at setup so SSR hydration
    // and test environments that stub `navigator` after import still work.
    if (!hasVibrate()) return;
    try {
      globalThis.navigator.vibrate(durations[kind]);
    } catch {
      // Vibration API can throw in locked-down browser contexts; swallow
      // silently — haptics are a progressive enhancement.
    }
  };

  // Evaluated lazily so test stubs that replace `navigator` after import and
  // environments where `navigator` becomes available post-hydration still
  // report accurately.
  const supportsVibrate = computed(() => hasVibrate());

  return { vibrate, supportsVibrate };
}
