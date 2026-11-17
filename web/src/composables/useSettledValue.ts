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

import { ref, shallowRef, watch, type Ref } from "vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { STALE_DIM_DELAY_MS } from "@/lib/styles/motion";

export interface SettledInput<T> {
  /** This run's value, or null when it has none. */
  value: T | null;
  /** A fetch is running and `value` is not final yet. */
  busy: boolean;
  /** What the value describes (query, streams, window); a change drops the previous value. */
  key?: string;
  /** Live mode refreshes in place, so its kept value is never dimmed. */
  live?: boolean;
}

export interface SettledSnapshot<T> {
  key: string | undefined;
  value: T;
}

export interface SettledState<T> {
  /** What to render: the settled value, or the previous one while `stale`. */
  value: T | null;
  /** `value` is the previous settle's, kept while a refetch under the same key runs. */
  stale: boolean;
  /** Busy with nothing to keep, so the caller shows its loading marker. */
  loading: boolean;
}

export interface SettledValue<T> {
  state: Readonly<Ref<SettledState<T>>>;
  /** True once `stale` has lasted the shared dim delay, never in live mode. */
  dimmed: Readonly<Ref<boolean>>;
}

/** Decides what to show for one input: values are written only when not busy, and kept while busy under the same key. */
export const resolveSettled = <T>(
  input: SettledInput<T>,
  snapshot: SettledSnapshot<T> | null,
): { state: SettledState<T>; snapshot: SettledSnapshot<T> | null } => {
  if (!input.busy) {
    return {
      state: { value: input.value, stale: false, loading: false },
      snapshot: input.value === null ? null : { key: input.key, value: input.value },
    };
  }
  if (snapshot && snapshot.key === input.key) {
    return { state: { value: snapshot.value, stale: true, loading: false }, snapshot };
  }
  return { state: { value: null, stale: false, loading: true }, snapshot: null };
};

/** Holds the last settled value of `read()` and what to render for the live input. */
export function useSettledValue<T>(read: () => SettledInput<T>): SettledValue<T> {
  let snapshot: SettledSnapshot<T> | null = null;
  const state = shallowRef<SettledState<T>>({ value: null, stale: false, loading: false });
  const live = ref(false);
  watch(
    read,
    (input) => {
      const next = resolveSettled(input, snapshot);
      snapshot = next.snapshot;
      state.value = next.state;
      live.value = !!input.live;
    },
    { immediate: true },
  );
  const dimmed = useDelayedFlag(() => state.value.stale && !live.value, STALE_DIM_DELAY_MS);
  // Not readonly(): a deep readonly proxy would wrap the kept rows and break their identity.
  return { state, dimmed };
}
