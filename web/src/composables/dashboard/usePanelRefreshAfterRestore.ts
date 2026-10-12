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

import {
  computed,
  hasInjectionContext,
  inject,
  ref,
  watch,
  type Ref,
  type WritableComputedRef,
} from "vue";
import { DASHBOARD_FRESH_ON_OPEN } from "./dashboardFreshOnOpen";

// Result fields a refresh after a cache restore keeps showing from the cache until its run settles.
const HELD_RESULT_KEYS = [
  "data",
  "metadata",
  "resultMetaData",
  "annotations",
  "errorDetail",
  "sparklineData",
  "sparklineWarning",
  "lastTriggeredAt",
  "isCachedDataDifferWithCurrentTimeRange",
  "isPartialData",
] as const;

type HeldKey = (typeof HELD_RESULT_KEYS)[number];

type PanelLoaderState = Record<HeldKey, any> & {
  loading: boolean;
  isOperationCancelled: boolean;
};

/** Re-queries a dashboard panel restored from cache while the restored result stays on screen. */
export const usePanelRefreshAfterRestore = <S extends PanelLoaderState>({
  state,
  panelSchema,
  dashboardId,
}: {
  state: S;
  panelSchema: Ref<any>;
  dashboardId?: Ref<any>;
}) => {
  const freshOnOpen = hasInjectionContext() ? inject(DASHBOARD_FRESH_ON_OPEN, null) : null;
  const panelKey = () => `${dashboardId?.value}/${panelSchema.value?.id}`;

  let queued = false;
  // The executors keep writing to state; this is what the panel shows until the run settles.
  const heldResult = ref<Pick<S, HeldKey> | null>(null);

  // A restore from another window length is not fresh, even for a panel already refreshed this visit.
  const queueRefresh = () => {
    queued =
      !!freshOnOpen?.appliesTo(panelSchema.value) &&
      (!freshOnOpen.wasRefreshed(panelKey()) || !!state.isCachedDataDifferWithCurrentTimeRange);
    return queued;
  };

  // Held at query start, not at restore, so a run superseded while waiting for variables still holds.
  const holdIfQueued = () => {
    if (!queued) return;
    queued = false;
    const restored = Object.fromEntries(HELD_RESULT_KEYS.map((key) => [key, state[key]]));
    heldResult.value = restored as Pick<S, HeldKey>;
    state.lastTriggeredAt = new Date().getTime();
  };

  const release = (keepRestored: boolean) => {
    queued = false;
    const held = heldResult.value;
    if (!held) return false;
    heldResult.value = null;
    if (keepRestored) Object.assign(state, held);
    return true;
  };

  // Sync, so the settled result replaces the restored one before any consumer sees the gap.
  watch(
    () => state.loading,
    (loading) => {
      if (!loading) release(false);
    },
    { flush: "sync" },
  );

  const isHolding = () => heldResult.value !== null;

  // "Refresh cache & reload" stays set for the visit, but this refresh must read the server cache.
  const clearCacheUnlessHolding = (shouldRefreshWithoutCache?: Ref<any>) =>
    computed(() => !isHolding() && !!shouldRefreshWithoutCache?.value);

  // Any complete result cached this visit is fresh, whichever run produced it.
  const markIfComplete = () => {
    const isComplete =
      !state.loading &&
      !state.isPartialData &&
      !state.isOperationCancelled &&
      !state.errorDetail?.message;
    if (isComplete) freshOnOpen?.markRefreshed(panelKey());
  };

  const shownResult = Object.fromEntries(
    HELD_RESULT_KEYS.map((key) => [
      key,
      computed({
        get: () => (heldResult.value ?? state)[key],
        set: (value: any) => {
          ((heldResult.value ?? state) as Record<HeldKey, any>)[key] = value;
        },
      }),
    ]),
  ) as { [K in HeldKey]: WritableComputedRef<S[K]> };

  return {
    queueRefresh,
    holdIfQueued,
    release,
    isHolding,
    clearCacheUnlessHolding,
    markIfComplete,
    shownResult,
    isRefreshingInBackground: computed(() => heldResult.value !== null),
  };
};
