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
import { raw, useI18nTyped } from "@/types/i18n";
import config from "@/aws-exports";
import { useNow } from "@/composables/useNow";
import {
  autoobserveCoverageQuery,
  autoobserveIncidentsPageQuery,
  autoobserveGapSuggestionsQuery,
  autoobserveSuggestionsPageQuery,
} from "@/services/autoobserve.queries";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import {
  toCoverageSource,
  toRequests,
  type CoverageSource,
  type LiveRequest,
  type SourceState,
  type SourceStatus,
  type Zone,
} from "./liveAdapter";
import {
  GAP_PAGE_SIZE,
  checkedView,
  learningLine,
  liveErrorDetail,
  liveFailureOf,
  statusOf,
  todayText,
  userTimeZone,
  type LivePhase,
} from "./liveCopy";
import { PAGED_CAP, failedDetail } from "./incidentsCopy";
import { useRecentlyCreated } from "../insight/bulk/useRecentlyCreated";
import { gapDraftScopes } from "../insight/kindCopy";
import { readStreamFields } from "../insight/bulk/useBulkReview";
import { cancelProbes, probeScopes } from "../insight/targets/scopeMatch";

export interface RailSource extends Required<SourceState> {
  requests: LiveRequest[];
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

const COVERAGE_POLL_MS = 5 * 60_000;
const ADDED_POLL_MS = 60_000;
export const SKELETON_DELAY_MS = 300;

export const SKELETON_HOLD_MS = 300;

// A production bundle can never show sample data, whatever the URL says.
export const fixtureAllowed = (): boolean => import.meta.env.DEV || import.meta.env.MODE === "test";

export const useFixtureMode = () => {
  const route = useRoute();
  return computed(() => fixtureAllowed() && route.query.fixture === "1");
};

export const useLiveMode = () => {
  const fixture = useFixtureMode();
  return computed(() => !fixture.value);
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
// Gaps fold into one card, so the rail reads well past its cap to still fill it with other kinds.
const RAIL_FETCH = 100;

/** `active` is off on a sub-page that shows none of it, so a reader is never refused a read the page does not use. */
export const useLiveAutoObserve = (options: { active?: () => boolean } = {}) => {
  const store = useStore();
  const live = useLiveMode();
  const { t } = useI18nTyped();
  const zone = useLiveZone();
  const now = useNow();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const enabled = computed(() => live.value && !!org.value && (options.active?.() ?? true));
  const recently = useRecentlyCreated();
  // A pass runs about every 5 minutes; while an alert added here waits for one, read every minute.
  const coverage = useQuery(() =>
    Object.assign(autoobserveCoverageQuery(org.value, "strict"), {
      enabled: enabled.value,
      refetchInterval: (query: { state: { data?: { pass_at?: number | null } } }) =>
        recently.waiting(org.value, (query.state.data?.pass_at ?? 0) / 1000)
          ? ADDED_POLL_MS
          : COVERAGE_POLL_MS,
    }),
  );
  watch(
    () => coverage.data.value?.pass_at,
    (passAt) => {
      if (passAt) recently.clearOnPass(org.value, passAt / 1000);
    },
    { immediate: true },
  );
  const suggestions = useQuery(() =>
    Object.assign(autoobserveSuggestionsPageQuery(org.value, RAIL_FETCH, 0), {
      enabled: enabled.value,
    }),
  );
  const gaps = useQuery(() =>
    Object.assign(autoobserveGapSuggestionsQuery(org.value, GAP_PAGE_SIZE), {
      enabled: enabled.value,
    }),
  );
  const retry = () => void Promise.all([coverage.refetch(), suggestions.refetch(), gaps.refetch()]);
  // A draft whose filter keeps none of its stream's rows could never fire, so the cards stop counting it once checked.
  watch(
    () =>
      [
        org.value,
        enabled.value,
        coverage.data.value?.rows,
        suggestions.data.value,
        gaps.data.value,
      ] as const,
    ([orgId, on, rows, page, all]) => {
      // An org switch or a hidden page leaves nothing of the last run asking.
      if (config.isEnterprise !== "true" || !orgId || !on || !rows) return cancelProbes();
      const listed = [...(page?.suggestions ?? []), ...(all?.suggestions ?? [])].filter(
        (s) => s.kind === "coverage_gap" && s.status === "proposed",
      );
      void probeScopes(orgId, gapDraftScopes(t, listed, { rows }), readStreamFields);
    },
    { immediate: true },
  );
  onScopeDispose(cancelProbes);
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
  // The gap card is built from coverage rows and every gap, so the rail's first paint waits for both, or their failure.
  const railInputsPending = computed(
    () =>
      (coverage.data.value === undefined && !coverage.isError.value) ||
      (gaps.data.value === undefined && !gaps.isError.value),
  );
  const rail = computed<RailSource>(() => ({
    ...railState.value,
    status:
      railState.value.status === "ready" && railInputsPending.value
        ? "loading"
        : railState.value.status,
    requests: toRequests(
      t,
      zone.value,
      (suggestions.data.value?.suggestions ?? []).filter((s) => s.status === "proposed"),
      minute.value * 60_000,
      { rows: coverage.data.value?.rows, allGaps: gaps.data.value },
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
    today: computed(() => todayText(zone.value.locale, zone.value.timeZone, minute.value * 60_000)),
    checked: computed(() => checkedView(t, zone.value.locale, source.value)),
    learning: computed(() => learningLine(t, zone.value, source.value.learning)),
  };
};

// Rows shown at the last latch: a refetch updates them in place and new ids wait behind Show.
interface PagedLatch {
  ids: string[];
  hasMore: boolean;
}

// Each latched id keeps its newest copy and nothing else is held, so retention never outgrows the shown rows.
export const keepLatched = (
  ids: readonly string[],
  items: readonly AutoObserveIncidentItem[],
  kept: readonly AutoObserveIncidentItem[],
): AutoObserveIncidentItem[] =>
  ids.flatMap((id) => {
    const item = items.find((i) => i.finding.id === id) ?? kept.find((i) => i.finding.id === id);
    return item ? [item] : [];
  });

export const useLivePaged = (cap = PAGED_CAP) => {
  const store = useStore();
  const live = useLiveMode();
  const now = useNow();
  const { t } = useI18nTyped();
  const zone = useLiveZone();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const enabled = computed(() => live.value && !!org.value);
  const query = useQuery(() =>
    Object.assign(autoobserveIncidentsPageQuery(org.value, cap, 0), {
      enabled: enabled.value,
    }),
  );
  // The home already loads this coverage, so the learning line shares its cache.
  const coverage = useQuery(() =>
    Object.assign(autoobserveCoverageQuery(org.value, "strict"), { enabled: enabled.value }),
  );
  const retry = () => void query.refetch();
  const state = useKeptFailure(
    () => ({
      ...stateOf(query, retry),
      detail: query.isError.value
        ? failedDetail(
            t,
            zone.value.locale,
            zone.value.timeZone,
            statusOf(query.error.value),
            query.errorUpdatedAt.value,
          )
        : raw(""),
    }),
    () => org.value,
  );
  const skeleton = useHeldSkeleton(() => enabled.value && state.value.status === "loading");
  const rcaEnabled = computed(() => store.state.zoConfig?.incidents_rca_enabled === true);
  const minute = computed(() => Math.floor(now.value / 60_000));
  const latch = shallowRef<PagedLatch | null>(null);
  // A row that left the response keeps its last copy until Show, so nothing moves under the reader.
  const rows = shallowRef<AutoObserveIncidentItem[]>([]);
  const items = computed(() => (query.data.value?.items ?? []).slice(0, cap));
  const relatch = () => {
    latch.value = {
      ids: items.value.map((item) => item.finding.id),
      hasMore: query.data.value?.has_more ?? false,
    };
    rows.value = keepLatched(latch.value.ids, items.value, rows.value);
  };
  watch(org, () => {
    latch.value = null;
    rows.value = [];
  });
  watch(
    items,
    (list) => {
      if (!latch.value && query.data.value) relatch();
      else if (latch.value) rows.value = keepLatched(latch.value.ids, list, rows.value);
    },
    { immediate: true },
  );
  const newCount = computed(() => {
    const shown = new Set(latch.value?.ids ?? []);
    return latch.value ? items.value.filter((i) => !shown.has(i.finding.id)).length : 0;
  });
  return {
    org,
    state,
    skeleton,
    rcaEnabled,
    zone,
    now: computed(() => minute.value * 60_000),
    paging: computed(() => query.data.value?.paging ?? true),
    learning: computed(() => coverage.data.value?.learning ?? null),
    rows: computed(() => rows.value),
    hasMore: computed(() => latch.value?.hasMore ?? false),
    newCount,
    showNew: relatch,
  };
};
