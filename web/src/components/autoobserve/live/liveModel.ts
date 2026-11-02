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
  shallowRef,
  watch,
  type Ref,
  type WatchSource,
} from "vue";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useNow } from "@/composables/useNow";
import {
  autoobserveCoverageQuery,
  autoobserveSuggestionsPageQuery,
} from "@/services/autoobserve.queries";
import type { Request } from "../v2/fixtures";
import {
  toCoverageSource,
  toRequests,
  type CoverageSource,
  type SourceState,
  type SourceStatus,
  type Zone,
} from "./liveAdapter";
import { RAIL_CAP, liveErrorDetail, liveFailureOf, userTimeZone, type LivePhase } from "./liveCopy";

export interface RailSource extends Required<SourceState> {
  requests: Request[];
  total: number;
}

interface QueryLike {
  data: Ref<unknown>;
  isError: Ref<boolean>;
  error: Ref<unknown>;
  errorUpdatedAt: Ref<number>;
  dataUpdatedAt: Ref<number>;
  isFetching: Ref<boolean>;
}

export const SKELETON_DELAY_MS = 300;

export const SKELETON_HOLD_MS = 300;

export const useLiveMode = () => {
  const route = useRoute();
  return computed(() => route.query.live === "1");
};

// A wait under the delay never shows a skeleton; once shown it stays for the hold, so it never flashes.
export const useHeldSkeleton = (busy: WatchSource<boolean>): Readonly<Ref<boolean>> => {
  const shown = ref(false);
  let shownAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    busy,
    (on) => {
      clearTimeout(timer);
      if (on) {
        if (!shown.value)
          timer = setTimeout(() => {
            shown.value = true;
            shownAt = Date.now();
          }, SKELETON_DELAY_MS);
        return;
      }
      const left = SKELETON_HOLD_MS - (Date.now() - shownAt);
      if (!shown.value || left <= 0) shown.value = false;
      else timer = setTimeout(() => (shown.value = false), left);
    },
    { immediate: true },
  );
  onScopeDispose(() => clearTimeout(timer));
  return readonly(shown);
};

// "Loaded" follows a load that ends in content, never a failure or a cache hit painted at once.
export const useLoadPhase = (
  status: () => SourceStatus,
  skeleton: Readonly<Ref<boolean>>,
): Readonly<Ref<LivePhase>> => {
  const loaded = ref(false);
  watch(status, (now) => {
    loaded.value = now === "ready";
  });
  return computed(() => (skeleton.value ? "loading" : loaded.value ? "loaded" : "idle"));
};

// A retry shows loading or another page's placeholder rows, so the failure stays up, busy, never a blank.
export const useKeptFailure = (
  state: () => Required<SourceState>,
  key: () => unknown,
  placeholder: () => boolean = () => false,
): Readonly<Ref<Required<SourceState>>> => {
  const last = shallowRef<Pick<Required<SourceState>, "failure" | "detail"> | null>(null);
  watch(key, () => {
    last.value = null;
  });
  watch(
    state,
    (s) => {
      if (s.status === "error") last.value = { failure: s.failure, detail: s.detail };
      else if (s.status === "ready" && !placeholder()) last.value = null;
    },
    { immediate: true },
  );
  return computed<Required<SourceState>>(() => {
    const s = state();
    return (s.status === "loading" || placeholder()) && last.value
      ? { ...s, ...last.value, status: "error", busy: true }
      : s;
  });
};

// Paging keeps the last page on screen, but never another org's: the org is queryKey[1].
export const keepSameOrg =
  (org: string) =>
  <T>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[1] === org ? previous : undefined;

// A refetch that fails over kept data is stale, not an error, so the old content stays on screen.
export const stateOf = (query: QueryLike, retry: () => void): Required<SourceState> => {
  const hasData = query.data.value !== undefined;
  const failed = query.isError.value;
  return {
    status: hasData ? "ready" : failed ? "error" : "loading",
    retry,
    busy: query.isFetching.value,
    failure: failed ? liveFailureOf(query.error.value) : null,
    detail: liveErrorDetail(query.error.value),
    stale:
      hasData && failed
        ? { failedAt: query.errorUpdatedAt.value, dataAt: query.dataUpdatedAt.value }
        : null,
  };
};

export const useLiveZone = () => {
  const store = useStore();
  const { locale } = useI18nTyped();
  return computed<Zone>(() => ({
    locale: locale.value,
    timeZone: userTimeZone(store.state.timezone),
  }));
};

// The fixture views mount this too, so nothing is fetched until the page is in live mode.
export const useLiveAutoObserve = () => {
  const store = useStore();
  const live = useLiveMode();
  const { t } = useI18nTyped();
  const zone = useLiveZone();
  const now = useNow();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const enabled = computed(() => live.value && !!org.value);
  const coverage = useQuery(() =>
    Object.assign(autoobserveCoverageQuery(org.value, "strict"), { enabled: enabled.value }),
  );
  const suggestions = useQuery(() =>
    Object.assign(autoobserveSuggestionsPageQuery(org.value, RAIL_CAP, 0), {
      enabled: enabled.value,
    }),
  );
  const retry = () => void Promise.all([coverage.refetch(), suggestions.refetch()]);
  const coverageState = useKeptFailure(
    () => stateOf(coverage, retry),
    () => org.value,
  );
  const railState = useKeptFailure(
    () => stateOf(suggestions, retry),
    () => org.value,
  );
  // Ages are whole minutes, so the rows rebuild once a minute, not on every clock tick.
  const minute = computed(() => Math.floor(now.value / 60_000));
  const source = computed<CoverageSource>(() =>
    toCoverageSource(
      t,
      coverage.data.value,
      coverageState.value,
      zone.value.locale,
      minute.value * 60_000,
    ),
  );
  const rail = computed<RailSource>(() => ({
    ...railState.value,
    requests: toRequests(
      t,
      zone.value,
      (suggestions.data.value?.suggestions ?? []).filter((s) => s.status === "proposed"),
    ),
    total: suggestions.data.value?.total ?? 0,
  }));
  const coverageSkeleton = useHeldSkeleton(
    () => enabled.value && source.value.status === "loading",
  );
  const railSkeleton = useHeldSkeleton(() => enabled.value && rail.value.status === "loading");
  return {
    source,
    rail,
    requests: computed(() => rail.value.requests),
    coverageSkeleton,
    railSkeleton,
  };
};
