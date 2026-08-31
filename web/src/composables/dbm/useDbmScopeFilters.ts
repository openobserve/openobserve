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
 * useDbmScopeFilters — the engine/database/schema scope the event tabs share.
 *
 * Activity, Deadlocks, Blocked queries and Table health each take the SAME
 * three dimensions off the wire (`system`, `instance`, `namespace` — Table
 * health takes only the first two, see `dimensions` below), and each needed the
 * same four things around them: refs seeded from the URL, a `DbmScopeFilter`
 * list for the toolbar control, a request-param object, and a `clearScope`.
 * Four hand-written copies of that is four chances for one to drop the URL
 * write, or to send a dimension it never shows a chip for.
 *
 * WHY THIS EXISTS AT ALL, given `createDbmFilterEntry` already deduplicates the
 * per-entry handler: that factory owns ONE entry's `onChange`. It says nothing
 * about where the value comes from (the URL), where it goes (the request), or
 * how it is dropped. Those three were still open-coded per page, and they are
 * exactly where the "applied but invisible" class of defect lives — a filter
 * read from the URL and spread into a request, with no chip rendered, is
 * precisely the bug `dbmFallbackScopeVisible.spec.ts` pins on the trace pages.
 *
 * The rule this composable makes structural: `requestParams` and `filters` are
 * derived from the SAME refs, so a dimension cannot be sent without also being
 * offered as a (clearable, chip-rendering) filter. There is no path here that
 * narrows a request invisibly.
 *
 * Deliberately NOT retrofitted onto Queries/Samples/Databases. Those three
 * carry five dimensions plus page-specific refinements in their `syncUrl`
 * (search, statement class, sort, the active insight), so their URL write is
 * genuinely their own; folding it in here would mean a parameterised `syncUrl`
 * that is longer than the four lines it replaced. They keep sharing the layer
 * that IS common — `createDbmFilterEntry` and `optionsFrom` — which this
 * composable builds on rather than replaces.
 */

import { computed, onActivated, ref, type ComputedRef, type Ref } from "vue";

import type { DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import { createDbmFilterEntry, optionsFrom, type DbmFilterEntrySpec } from "@/utils/dbm/filters";
import { useDbmFleetInstances } from "@/composables/dbm/useDbmFleetInstances";
import { useI18nTyped } from "@/types/i18n";

/**
 * The three dimensions the event endpoints accept.
 *
 * Table health is the one exception and takes only `system`/`instance`: its
 * feed carries no database at all (the recipe reads per-database catalogs and
 * never names one), so a `namespace` select there would silently return nothing
 * for every value a reader could pick. That is the DatabasesPage rule — only
 * the dimensions the endpoint ACTUALLY accepts are offered — and it is enforced
 * by the `dimensions` option rather than left to each page to remember.
 */
export type DbmScopeDimension = "system" | "instance" | "namespace";

/** All three, in the order the toolbar renders them. */
export const DBM_SCOPE_DIMENSIONS: readonly DbmScopeDimension[] = [
  "instance",
  "system",
  "namespace",
] as const;

/** The i18n suffixes each dimension uses, so no page spells them by hand. */
const DIMENSION_COPY: Record<
  DbmScopeDimension,
  { dimension: "system" | "instance" | "namespace"; placeholder: string }
> = {
  system: { dimension: "system", placeholder: "allEngines" },
  instance: { dimension: "instance", placeholder: "allInstances" },
  namespace: { dimension: "namespace", placeholder: "allNamespaces" },
};

/** The values a page offers for one dimension, gathered from its loaded rows. */
export type DbmScopeOptionSource = Partial<
  Record<DbmScopeDimension, (string | null | undefined)[]>
>;

export interface DbmScopeFiltersOptions {
  /** The page's live route query, read ONCE at setup to seed the refs. */
  query: Record<string, unknown>;
  /**
   * The route query as it is NOW, for the activation re-seed.
   *
   * A getter rather than the object above, because that one is a snapshot
   * taken during setup and a kept-alive page needs to know what the URL says
   * when the reader RETURNS to it. Optional so a page mounted outside the
   * shell (or in a unit test) simply keeps its seeded values; passing
   * `() => route.query` is all a real page does.
   */
  liveQuery?: () => Record<string, unknown>;
  /**
   * Refetch, because the scope adopted on activation differs from the one the
   * page's rows were loaded under.
   *
   * Distinct from `apply`: that is the user-gesture path and writes the URL,
   * which here is the thing that already changed. This only reloads.
   */
  onScopeAdopted?: () => void;
  /**
   * Which dimensions this endpoint accepts. Defaults to all three; Table
   * health passes `["instance", "system"]` because its feed carries no
   * database.
   */
  dimensions?: readonly DbmScopeDimension[];
  /**
   * The dropdown values, derived from whatever the page currently holds. A
   * getter, because the rows arrive after this composable runs.
   */
  options: () => DbmScopeOptionSource;
  /**
   * The window the identity picker should describe, as the page currently
   * holds it. A getter because the range moves with the picker.
   *
   * When omitted the picker falls back to the page's own rows — the old
   * behaviour, kept only so a caller that has no range still renders something
   * rather than an empty select.
   */
  fleetWindow?: () => { org: string; startTime?: number; endTime?: number };
  /**
   * What a filter change triggers — the page's `syncUrl(); load();` pair,
   * passed once. `createDbmFilterEntry` owns the handler, so no entry can
   * forget the URL half.
   */
  apply: () => void;
}

export interface DbmScopeFiltersReturn {
  /** The live refs, for the page's own `syncUrl` and any page-specific reads. */
  models: Record<DbmScopeDimension, Ref<string | null>>;
  /** Ready for `<DbmScopeFilters :filters>`. Only the accepted dimensions. */
  filters: ComputedRef<DbmScopeFilter[]>;
  /**
   * The scope as request params — `undefined` for an unset dimension, which is
   * what the service layer's `put` drops. Spread straight into the options
   * object of the page's `getActivity`/`getDeadlocks`/… call.
   *
   * Withheld dimensions are absent here BY CONSTRUCTION: they are keyed off the
   * same `dimensions` list that decides which selects render, so a page cannot
   * send a filter it does not show.
   */
  requestParams: ComputedRef<Partial<Record<DbmScopeDimension, string>>>;
  /** The scope as URL query params, for the page's `syncUrl`. */
  queryParams: ComputedRef<Partial<Record<DbmScopeDimension, string | undefined>>>;
  /** True when any accepted dimension is set — for empty-state copy. */
  isScoped: ComputedRef<boolean>;
  /** Drop every dimension. The page still owns calling `syncUrl`/`load`. */
  clear: () => void;
}

/**
 * Seed one dimension from the URL. A query value arrives as `string |
 * string[]`; a repeated param is ambiguous scope, and taking the first would
 * apply half of what the URL said, so anything non-string reads as unset.
 */
const seed = (query: Record<string, unknown>, key: string): string | null => {
  const value = query[key];
  return typeof value === "string" && value ? value : null;
};

/**
 * Re-seed a page's OWN filter refs from the URL when it is looked at again.
 *
 * The three list pages that predate `useDbmScopeFilters` (Overview, Top
 * queries, Slowest calls) carry five dimensions plus page-specific refinements
 * and keep their own refs — see the note at the top of this file for why they
 * were deliberately not folded in. They still have the kept-alive staleness
 * this composable's `onActivated` fixes for the other four, so the re-seed is
 * exported on its own rather than reimplemented three times.
 *
 * Takes the refs keyed by the QUERY PARAM they mirror, so a page cannot
 * re-seed a ref from the wrong param — the mapping is the argument.
 */
export const useDbmOwnFilterSync = (
  liveQuery: () => Record<string, unknown>,
  models: Record<string, Ref<string | null>>,
  onScopeAdopted?: () => void,
): void => {
  onActivated(() => {
    const query = liveQuery();
    let adopted = false;
    for (const [key, model] of Object.entries(models)) {
      const next = seed(query, key);
      if (model.value !== next) {
        model.value = next;
        adopted = true;
      }
    }
    // Adopting the scope changes the CHIP; only a refetch changes the ROWS.
    // Without this the page keeps whatever its last load produced under the
    // old scope — a chip reading `engine postgresql` above a table listing
    // MySQL and MariaDB, and a row count that flips between visits depending
    // on which scope the last load ran under.
    //
    // Fired ONLY when something actually moved, so an unchanged tab switch
    // still costs nothing — which is the whole reason the pages are kept alive.
    if (adopted) onScopeAdopted?.();
  });
};

export function useDbmScopeFilters(options: DbmScopeFiltersOptions): DbmScopeFiltersReturn {
  const { t } = useI18nTyped();
  const dimensions = options.dimensions ?? DBM_SCOPE_DIMENSIONS;

  const models: Record<DbmScopeDimension, Ref<string | null>> = {
    system: ref(seed(options.query, "system")),
    instance: ref(seed(options.query, "instance")),
    namespace: ref(seed(options.query, "namespace")),
  };

  /**
   * Re-seed from the URL when a kept-alive page is looked at again.
   *
   * The seeding above runs in SETUP, and `DbmShell`'s `<keep-alive>` means
   * setup runs once per session per tab — not once per visit. So a tab first
   * opened before a filter was set kept its stale refs forever: its chips
   * showed nothing while the URL said otherwise, and its next load sent the
   * stale scope. That is the reported "filter display is inconsistent across
   * tabs, and sometimes applied and sometimes not" — the SAME url renders
   * different filters depending on which tabs the reader happened to open
   * first, and a tab not yet visited looks correct because its first mount
   * seeds properly, which is what made the bug look intermittent.
   *
   * `useDbmScopeSync` already does exactly this for the time range and
   * documents why activation is the right moment: an inactive kept-alive page
   * still has live watchers, so watching `route.query` would make every tab
   * react to one tab's change and fire background reads nobody asked for.
   * Activation is when the answer is about to be looked at, and the only
   * moment it needs to be right.
   *
   * Only ADOPTED here, never reloaded: `options.apply` is the user-gesture
   * path (it writes the URL, which is already what changed) and calling it
   * would republish the URL the page just read. The page's own range sync owns
   * the reload decision.
   */
  onActivated(() => {
    const live = options.liveQuery?.();
    if (!live) return;
    let adopted = false;
    for (const key of DBM_SCOPE_DIMENSIONS) {
      const next = seed(live, key);
      if (models[key].value !== next) {
        models[key].value = next;
        adopted = true;
      }
    }
    // Adopting the scope changes the CHIP; only a refetch changes the ROWS.
    // Fired ONLY when something moved, so an unchanged tab switch still costs
    // nothing. This is deliberately NOT `options.apply` — that is the
    // user-gesture path and republishes the URL this activation just read.
    if (adopted) options.onScopeAdopted?.();
  });

  /**
   * The fleet, refetched when the page's window moves.
   *
   * Kept out of the `filters` computed on purpose: a computed must not have
   * side effects, and a fetch inside one would re-fire on every unrelated
   * dependency change. The picker renders the rows-derived list until this
   * lands, so it is never empty while the read is in flight.
   */
  const fleet = useDbmFleetInstances();
  let lastFleetKey = "";
  /**
   * Fetch the fleet when the window actually moves.
   *
   * Called from the `fleetOptions` computed below rather than from a `watch`,
   * which is the shape you would expect. A watcher was tried and REVERTED: its
   * source getter reads `options.fleetWindow()`, which closes over refs the
   * PAGE declares in the same `const { … } = useDbmListPage({…})`
   * destructuring — so evaluating it during setup (which `watch` does eagerly,
   * with or without `immediate`) throws "Cannot access before initialization".
   * That is the same TDZ hazard `useDbmListPage` documents for its own
   * `ownCounts` watchers, and it broke a real test.
   *
   * Calling it from the computed is safe because it is IDEMPOTENT and
   * key-guarded: a window that has not moved does nothing, and
   * `useDbmFleetInstances` additionally de-duplicates per (org, window) across
   * every tab, so the six DBM routes share one request.
   */
  const refreshFleet = () => {
    const window = options.fleetWindow?.();
    if (!window?.org) return;
    const key = `${window.org}|${window.startTime ?? ""}|${window.endTime ?? ""}`;
    if (key === lastFleetKey) return;
    lastFleetKey = key;
    void fleet.load(window);
  };

  /**
   * The identity dimensions, as the fleet names them. `namespace` is absent
   * by design: a database genuinely belongs to a feed, not to the fleet, and
   * claiming otherwise would offer databases that no row on this tab can
   * match.
   */
  const fleetOptions = computed<Partial<Record<DbmScopeDimension, string[]>>>(() => {
    refreshFleet();
    const hits = fleet.hits.value;
    if (!hits.length) return {};
    const system: string[] = [];
    const instance: string[] = [];
    for (const hit of hits) {
      if (hit.db_system) system.push(hit.db_system);
      if (hit.db_instance) instance.push(hit.db_instance);
    }
    return { system, instance };
  });

  /**
   * Prefer the fleet, but never render an EMPTY picker when the page holds
   * values the fleet has not answered for yet — an in-flight read must not
   * look like "this org has one instance".
   *
   * The page's own values are unioned in rather than discarded: they are
   * evidence too, and a value the reader can see in a row must always be
   * selectable.
   */
  const mergeIdentityOptions = (
    fleetValues: string[] | undefined,
    rowValues: (string | null | undefined)[] | undefined,
  ): (string | null | undefined)[] => {
    if (!fleetValues?.length) return rowValues ?? [];
    return [...fleetValues, ...(rowValues ?? [])];
  };

  const filterEntry = createDbmFilterEntry(options.apply);

  const filters = computed<DbmScopeFilter[]>(() => {
    const sources = options.options();
    // The page's own rows are the WRONG source for the identity dimensions,
    // and were the cause of a filter that could not filter. A tab shows one
    // feed; the org has a fleet. Deriving `system`/`instance` from the rows on
    // screen meant:
    //   * an engine with no rows on THIS tab was unselectable — SQL Server has
    //     no session sampler, so Activity's picker omitted `mssql-prod-1`
    //     while a chip set from Deadlocks still displayed it, leaving a scope
    //     the reader could neither choose nor clear;
    //   * a feed naming no instance produced an EMPTY picker (deadlocks);
    //   * a capped read (activity stops at 100 sampled sessions) made the list
    //     first-page-local rather than window-local.
    // `/instances` answers the whole window across every feed, so these two
    // dimensions come from the fleet and only `namespace` — which is genuinely
    // per-feed — still comes from the rows.
    const fleet = fleetOptions.value;
    return dimensions.map((key) => {
      const source =
        key === "namespace" ? (sources[key] ?? []) : mergeIdentityOptions(fleet[key], sources[key]);
      const copy = DIMENSION_COPY[key];
      const spec: DbmFilterEntrySpec = {
        key,
        dimension: t(`dbm.filters.dimension.${copy.dimension}`),
        placeholder: t(`dbm.filters.${copy.placeholder}` as "dbm.filters.allEngines"),
        options: optionsFrom(source),
        model: models[key],
      };
      return filterEntry(spec);
    });
  });

  /**
   * Only the ACCEPTED dimensions reach the wire. A `namespace` left over in
   * the URL from a sibling tab must not be sent to Table health, whose feed
   * would answer nothing for it — the same reason the select is withheld.
   */
  const requestParams = computed(() => {
    const params: Partial<Record<DbmScopeDimension, string>> = {};
    for (const key of dimensions) {
      const value = models[key].value;
      if (value) params[key] = value;
    }
    return params;
  });

  /**
   * The URL half. Unlike `requestParams` this covers ALL THREE dimensions, not
   * just the accepted ones: a `namespace` carried in from Blocked queries has
   * to survive a visit to Table health, or stepping through the tabs would
   * silently strip the reader's scope from the shared link.
   */
  const queryParams = computed(() => ({
    system: models.system.value ?? undefined,
    instance: models.instance.value ?? undefined,
    namespace: models.namespace.value ?? undefined,
  }));

  const isScoped = computed(() => dimensions.some((key) => !!models[key].value));

  const clear = () => {
    models.system.value = null;
    models.instance.value = null;
    models.namespace.value = null;
  };

  return { models, filters, requestParams, queryParams, isScoped, clear };
}
