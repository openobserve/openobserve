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
 * useDbmListPage — the shared spine of every DBM list page.
 *
 * The seven list tabs (Overview, Top queries, Slowest calls, Activity,
 * Deadlocks, Blocked queries, Table health) each opened with the same
 * byte-identical preamble — scope from the URL, request-sequence guard, the
 * shell's badge snapshot, `loading`/`error`/`search`, the org and feature-flag
 * computeds — and the same three behaviours: a refresh that also forces the
 * shared badges, a date change that adopts the pick, republishes the URL and
 * fetches only on a genuine pick, and the keep-alive URL re-sync. Seven copies
 * of that is seven chances for one to drift; this owns each of them ONCE.
 *
 * The page keeps what is genuinely its own: the `load()` body (as the fetcher
 * handed to `run`), its rows and page-specific refs, its `tabCounts` override,
 * and `defineOptions` (which must stay in the SFC for `<keep-alive :include>`).
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";

import {
  contextRegistry,
  DBM_CONTEXT_KEY,
  type ContextProvider,
} from "@/composables/contextProviders";
import { useDbmRequestSeq, type DbmRequestSeq } from "@/composables/dbm/useDbmRequestSeq";
import { useDbmScope, type DbmDateChange } from "@/composables/dbm/useDbmScope";
import { useDbmScopeSyncScope } from "@/composables/dbm/useDbmScopeSync";
import { useDbmTabCountsContext, type DbmTabCountsContext } from "@/composables/dbm/dbmTabCounts";
import type { BadgeCount, DbmTabCountKey } from "@/composables/dbm/useDbmTabCounts";
import { claimedCount, dbmHttpError } from "@/utils/dbm/format";

export interface DbmListPageOptions {
  /**
   * The page's own read. Called on mount, on refresh, on a genuine date pick
   * and on keep-alive reactivation when the URL scope moved. Pass a thunk
   * (`() => load()`) — the page defines `load` further down its script.
   */
  load: () => void | Promise<void>;
  /**
   * How the page mirrors its scope into the URL after a date pick.
   *
   * Omitted: the default writes the range params over the existing query —
   * what the pages with no filters of their own always did. A page with its
   * own filter refs passes its `syncUrl` (as a thunk) so the filters ride
   * along. `null` opts out entirely — Table health deliberately never writes
   * the URL, though it still reads it on activation.
   */
  syncUrl?: (() => void) | null;
  /**
   * The page's AI-chat context provider, registered on mount and torn down on
   * unmount. A getter, because the provider closes over state the page defines
   * after this composable runs. Opt-in: only the pages with a chat-relevant
   * focus carry one.
   */
  context?: () => ContextProvider;
  /** Runs once on mount, after context registration and before the first
   *  load — where Top queries restores its filters from the URL. */
  beforeMount?: () => void;
}

/** What a page may hang on the shared load envelope. See `run`. */
export interface DbmRunOptions {
  /**
   * Clear page-held caches for the new load. Runs AFTER the token is claimed,
   * so anything still in flight against those caches is already stale by the
   * time it tries to write back.
   */
  before?: () => void;
  /**
   * Clear the page's rows after a non-stale failure. Whatever went wrong, the
   * previous window's rows are no longer an answer to the question on screen —
   * leaving them would put stale data under an error banner.
   */
  reset?: (err: unknown) => void;
  /**
   * 404/501: the endpoint is not on this build yet, or nothing has ever
   * written the stream — "not collecting", not a failure the reader can act
   * on. Without this handler those statuses fall through to the error banner.
   */
  onNotCollecting?: () => void;
  /** 403: a permission diagnosis the empty state names, not an error banner. */
  onForbidden?: () => void;
  /**
   * Own the error banner for everything else. Receives the server's verbatim
   * message when it sent one. The default prints it, falling back to the
   * error's own text.
   */
  onError?: (serverMessage: string | undefined, err: unknown) => void;
  /** Runs after a non-stale load settles, on success and failure alike —
   *  empty-state probes, scroll restoration. */
  settled?: () => void | Promise<void>;
  /**
   * The badges this page counts better than the shared fan-out can.
   *
   * Declared here rather than substituted into the page's own `tabCounts`
   * copy, because a substitution is only visible while the reader is STANDING
   * on the page that made it: Overview's exact fleet union read `6` on
   * Overview and the fan-out's rawer number on every sibling tab. The same
   * badge reading two different ways depending on where you stand is the bug
   * this exists to close.
   *
   * Publishing it to the shared snapshot instead means every tab paints the
   * best number anyone has measured. The getter returns `undefined` for "no
   * better number yet" (typically while loading, or before the first read
   * lands), which leaves the shared value alone — the same convention
   * `withOwnCount` used, so the pages' existing expressions move over
   * unchanged.
   */
  ownCounts?: readonly { key: DbmTabCountKey; value: () => BadgeCount | undefined }[];
}

export function useDbmListPage(options: DbmListPageOptions) {
  const store = useStore();
  const route = useRoute();
  const router = useRouter();

  // Seeded from the URL so the window survives a tab switch and a shared link.
  const scope = useDbmScope(route.query);

  // Search, filters, the picker and refresh can all be in flight at once; this
  // keeps the last request the reader made the one that paints.
  const requestSeq: DbmRequestSeq = useDbmRequestSeq();

  // The sibling-tab badges are the same numbers on every tab, so DbmShell
  // fetches them ONCE per window for every route and this page reads the
  // snapshot. See useDbmTabCounts.
  const tabCountsContext: DbmTabCountsContext = useDbmTabCountsContext();

  const loading = ref(false);
  const error = ref<string | null>(null);
  const search = ref("");

  /**
   * When this page's data last landed, epoch milliseconds — what the refresh
   * control reports as "last refreshed".
   *
   * Set from the load envelope rather than by each page, so every tab gets the
   * timestamp without nine copies of the same assignment, and none can forget
   * it. Written on SUCCESS only: a failed load replaced nothing, and stamping
   * it would age-reset the reading over rows from the previous window while the
   * error banner says the refresh did not happen.
   *
   * `null` until the first successful load, which the control renders as no
   * staleness verdict at all rather than as a stale one.
   */
  const lastRunAt = ref<number | null>(null);

  const org = computed(() => (store.state?.selectedOrganization?.identifier as string) ?? "");
  const dbmEnabled = computed(() => Boolean(store.state?.zoConfig?.database_monitoring_enabled));
  /**
   * `ZO_DB_MONITORING_ACTIVITY_ENABLED`, the per-feed knob for session
   * sampling. Defaults OFF, so it is the ordinary reason the Activity page is
   * empty on a fresh install — and until it reached `zoConfig` the page could
   * not tell that apart from a collector that is not reporting, so it printed
   * the collector diagnosis for a server setting.
   *
   * `undefined` (an older server that does not send the field) stays
   * `undefined` rather than collapsing to `false`: the checklist must not
   * assert a knob is off on the strength of a field nobody sent.
   */
  const activityIngestEnabled = computed(
    () => store.state?.zoConfig?.database_monitoring_activity_enabled as boolean | undefined,
  );

  /** Read by the empty states to say what else in DBM is answering. */
  const queryCount = computed(() => claimedCount(tabCountsContext.counts.value.queryCount));
  const databaseCount = computed(() => tabCountsContext.counts.value.databaseCount);

  /**
   * The shared load envelope: guard, spinner, error slate, anchor re-pin, and
   * the one reading of what a failure means. The page's fetcher keeps its own
   * request and assignments — including the `requestSeq.isStale(token)` check
   * after every await, because only the page knows where its writes are.
   */
  const run = async (
    fetcher: (token: number) => Promise<void>,
    runOptions: DbmRunOptions = {},
  ): Promise<void> => {
    if (!org.value) return;
    const token = requestSeq.begin();
    loading.value = true;
    error.value = null;
    scope.refresh();
    runOptions.before?.();

    try {
      await fetcher(token);
      // Only the load that still owns the page may stamp the clock. A
      // superseded fetch finishing late would otherwise report ITS completion
      // as the age of rows the newer load is about to replace.
      if (!requestSeq.isStale(token)) lastRunAt.value = Date.now();
    } catch (err: unknown) {
      // A superseded request's failure is not this page's failure — surfacing
      // it would blank a table the newer load is about to fill.
      if (requestSeq.isStale(token)) return;
      runOptions.reset?.(err);
      const { status, serverMessage, message } = dbmHttpError(err);
      if ((status === 404 || status === 501) && runOptions.onNotCollecting) {
        runOptions.onNotCollecting();
      } else if (status === 403 && runOptions.onForbidden) {
        runOptions.onForbidden();
      } else if (runOptions.onError) {
        runOptions.onError(serverMessage, err);
      } else {
        error.value = message;
      }
    } finally {
      // Only the load that still owns the page may clear the spinner; an older
      // one doing it would report "done" while the current fetch is in flight.
      if (!requestSeq.isStale(token)) {
        loading.value = false;
        await runOptions.settled?.();
      }
    }
  };

  // Named handler, not `@click="load"`: a refresh must ALSO force the shell's
  // badge cache alongside the page's own load — the URL does not change on a
  // refresh, so the shell cannot see one on its own.
  const onRefresh = () => {
    void options.load();
    tabCountsContext.refresh({ force: true });
  };

  /** Mirror the scope into the URL so it survives a tab switch and a reload. */
  const defaultSyncUrl = () => {
    router.replace({ query: { ...route.query, ...scope.queryParams.value } }).catch(() => {});
  };

  const syncUrl = options.syncUrl === null ? null : (options.syncUrl ?? defaultSyncUrl);

  const onDateChange = (value: DbmDateChange) => {
    // The window is adopted either way — it is the picker's resolved state.
    scope.setRange(value);
    syncUrl?.();
    // Fetch only on a genuine pick — `onMounted` already loads, and the
    // picker's mount replay would otherwise double every request. See
    // `DbmDateChange.userChangedValue`.
    if (value?.userChangedValue !== false) void options.load();
  };

  onMounted(() => {
    const context = options.context?.();
    if (context) {
      contextRegistry.register(DBM_CONTEXT_KEY, context);
      contextRegistry.setActive(DBM_CONTEXT_KEY);
    }
    options.beforeMount?.();
    // Only this page's OWN read. The badges are DbmShell's, fetched once for
    // every tab — a call here would put the fan-out back on every mount.
    void options.load();
  });

  onBeforeUnmount(() => {
    if (!options.context) return;
    contextRegistry.unregister(DBM_CONTEXT_KEY);
    contextRegistry.setActive("");
  });

  // Kept alive by DbmShell.vue, so `onMounted` above runs once for the whole
  // session on this tab. The URL is how the tabs agree on a window, so re-read
  // it on return and reload ONLY if it actually moved.
  useDbmScopeSyncScope({ route, scope, reload: () => void options.load() });

  // Publish this page's own badge into the SHARED snapshot whenever it
  // changes, so the number is on the strip from every tab and not only from
  // here. A `watch` rather than a call inside the page's `tabCounts` computed:
  // a computed must not have side effects, and the page stays mounted (its
  // refs live) under keep-alive, so the value is published exactly when it is
  // learned.
  //
  // Both the watcher AND its first read are set up in `onMounted`, never during
  // setup. These getters close over refs the PAGE declares, and every page
  // calls this composable in the same `const { … } = useDbmListPage({…})` whose
  // destructuring binds several of them — so ANY read during setup happens
  // while those bindings are still in their temporal dead zone and throws
  // `Cannot access 'loading' before initialization`. That includes `watch`
  // itself: it evaluates a getter source once, immediately, to collect the
  // dependencies it must track, so even without `immediate` it is an eager
  // read.
  //
  // Registering inside `onMounted` costs nothing — the page has not loaded
  // yet, so the first value would have been `undefined` regardless — and it
  // frees every page from having to order its declarations around this call.
  onMounted(() => {
    for (const { key, value } of options.ownCounts ?? []) {
      watch(value, (next) => tabCountsContext.publishOwnCount(key, next), { immediate: true });
    }
  });

  return {
    scope,
    requestSeq,
    tabCountsContext,
    loading,
    error,
    search,
    lastRunAt,
    org,
    dbmEnabled,
    activityIngestEnabled,
    queryCount,
    databaseCount,
    run,
    onRefresh,
    onDateChange,
  };
}
