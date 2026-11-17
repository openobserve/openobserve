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
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  type WatchSource,
} from "vue";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { LOADER_DELAY_MS, LONG_WAIT_MS, STILL_LOADING_REPEAT_MS } from "@/lib/styles/motion";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { announceAlert, announcePolite } from "./announcer";
import { loadingText, nounText, type Partitions, type RegionNoun } from "./regionText";

export interface RegionLoadingOptions {
  /** A request for this region is running. */
  busy: WatchSource<boolean>;
  /** What the region loads, from the shared noun list. */
  noun: MaybeRefOrGetter<RegionNoun>;
  /** Partitions searched so far, when the server reports them. */
  partitions?: () => Partitions | null | undefined;
  /** The failure sentence of the run that just ended, read when `busy` turns off; set it no later than that. */
  error?: () => I18nText | null | undefined;
  /** What a successful run found ("18,402 traces found"), read when `busy` turns off. */
  result?: () => I18nText | null | undefined;
  /** Replaces "Loading {noun}…" when the run has its own words, e.g. a range change. */
  loading?: () => I18nText | null | undefined;
}

export interface RegionLoading {
  /** Busy for longer than the shared loader delay, so region loaders may show. */
  delayed: Readonly<Ref<boolean>>;
  /** Whole seconds since the current run started; 0 when idle. */
  elapsedSeconds: Readonly<Ref<number>>;
  /** The run has passed the long-wait threshold and should show words and elapsed time. */
  longWait: ComputedRef<boolean>;
  /** The latest partition progress, or null when the server reports none. */
  partitions: ComputedRef<Partitions | null>;
  /** Bind on the region being refreshed. */
  regionAttrs: ComputedRef<{ "aria-busy": "true" | undefined }>;
}

/** One helper per region: `aria-busy`, polite loading and loaded text, long-wait words, and failures as alerts; never moves focus. */
export function useRegionLoading(options: RegionLoadingOptions): RegionLoading {
  const { t } = useI18nTyped();
  const busy = ref(false);
  const elapsedSeconds = ref(0);
  let startedAt = 0;
  let nextSpeakMs = LONG_WAIT_MS;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let withdrawAlert: (() => void) | null = null;
  let withdrawSpoken: (() => void) | null = null;

  const tick = () => {
    const ms = Date.now() - startedAt;
    elapsedSeconds.value = Math.floor(ms / 1000);
    if (ms < nextSpeakMs) return;
    nextSpeakMs += STILL_LOADING_REPEAT_MS;
    withdrawSpoken = announcePolite(
      t("regionStatus.stillLoading", {
        noun: nounText(t, toValue(options.noun)),
        seconds: elapsedSeconds.value,
      }),
    );
  };

  const withdrawAll = () => {
    withdrawSpoken?.();
    withdrawSpoken = null;
    withdrawAlert?.();
    withdrawAlert = null;
  };

  const start = () => {
    clearInterval(ticker);
    withdrawAll();
    startedAt = Date.now();
    nextSpeakMs = LONG_WAIT_MS;
    elapsedSeconds.value = 0;
    ticker = setInterval(tick, 1000);
  };

  const finish = () => {
    clearInterval(ticker);
    elapsedSeconds.value = 0;
    // A finished run must not leave "Loading…" readable in the region.
    withdrawSpoken?.();
    withdrawSpoken = null;
    const failure = options.error?.();
    if (failure) {
      withdrawAlert = announceAlert(failure);
      return;
    }
    const found = options.result?.();
    if (found) withdrawSpoken = announcePolite(found);
  };

  watch(
    options.busy,
    (on, was) => {
      busy.value = on;
      if (on) start();
      else if (was) finish();
    },
    { immediate: true },
  );

  const delayed = useDelayedFlag(() => busy.value, LOADER_DELAY_MS);
  watch(delayed, (on) => {
    if (on)
      withdrawSpoken = announcePolite(options.loading?.() || loadingText(t, toValue(options.noun)));
  });

  onScopeDispose(() => {
    clearInterval(ticker);
    withdrawAll();
  });

  return {
    delayed,
    elapsedSeconds: readonly(elapsedSeconds),
    longWait: computed(() => elapsedSeconds.value * 1000 >= LONG_WAIT_MS),
    partitions: computed(() => options.partitions?.() ?? null),
    regionAttrs: computed(() => ({ "aria-busy": busy.value ? "true" : undefined })),
  };
}
