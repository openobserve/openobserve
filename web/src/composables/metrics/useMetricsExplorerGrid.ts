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

import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import useStreams from "@/composables/useStreams";
import useHttpStreamingSearch from "@/composables/useStreamingSearch";
import { createPromQLChunkProcessor } from "@/composables/dashboard/promqlChunkProcessor";
import { usePanelCache } from "@/composables/dashboard/usePanelCache";
import { isEqual } from "lodash-es";
import { generateTraceContext } from "@/utils/zincutils";
import { parseSearchError, toSearchErrorObject } from "@/utils/query/searchError";
import StreamService from "@/services/stream";
import metricsService from "@/services/metrics";
import {
  buildMetricCards,
  operandStreamsOf,
  type MetricCard,
  type MetricStream,
} from "@/utils/metrics/metricFamily";
import {
  computePrefixAssignment,
  computeSuffixGroups,
  MISC_GROUP_ID,
  matchesSearch,
  type PrefixGroup,
  type SuffixGroup,
} from "@/utils/metrics/prefixGrouping";
import {
  buildPresenceQuery,
  computeRateWindow,
  computeStepSeconds,
  DEFAULT_SCRAPE_INTERVAL_SECONDS,
  getMetricDefaults,
  isRateBasedKind,
  resolveVariant,
} from "@/utils/metrics/metricDefaults";
import { createPreviewQueue, isCancelled, PRIORITY } from "./useMetricsPreviewQueue";

export interface LabelFilter {
  label: string;
  value: string;
  operator?: string;
}

/**
 * A filter's identity. NOT its label: a label can carry several matchers
 * (`status=~"5.."` and `status!="503"` are two filters, not one overwriting the
 * other), so the whole triple is what distinguishes one chip from another.
 */
export const labelFilterKey = (filter: LabelFilter): string =>
  // `\u0000` as the separator, written as an ESCAPE and never as a raw byte.
  // A NUL cannot appear inside a label name or a matcher value, so the key is
  // collision-proof in a way a space or a pipe would not be. But a literal NUL in
  // the source makes git classify the whole file as BINARY: no line-by-line diff
  // in review, and some editors refuse to open it at all. Same runtime value,
  // plain-text source.
  `${filter.label}\u0000${filter.operator ?? "="}\u0000${filter.value}`;

export type PreviewStatus =
  | "idle"
  | "loading"
  | "done"
  | "error"
  /**
   * The metric is understood, but its effective variant has nothing a card can
   * draw — an info metric's label table renders through a component the card
   * does not use. A STATE, not a silent return: skipping the preview left the
   * card on its loading skeleton forever, which reads as a broken chart.
   */
  | "unavailable";

export interface CardPreview {
  status: PreviewStatus;
  /** One entry per query in the effective variant. */
  results: any[];
  /** A sentence fit to show the user — the envelope is already unwrapped. */
  error: string;
  /** The backend's internal cause. Shown under the message, dimmed. */
  errorDetail?: string;
  /** Correlates with the backend logs; the first thing support asks for. */
  errorTraceId?: string;
  /** The queries that failed. The user never typed them, so only we know them. */
  errorQueries?: string[];
  chartType: string;
  unit: string;
  bucketUnit: string | null;
  /** True when the last refresh failed but a previous result is still shown. */
  stale: boolean;
  /** The first query came back all-NaN; this is the guarded re-query's result. */
  nanGuardApplied: boolean;
  /**
   * The metric HAS samples in the window, but its rate-based default query could
   * not produce a single point from them — `rate()` needs two samples inside its
   * window, and there are not two to be had (a one-off scrape, or a scrape
   * interval longer than the window).
   *
   * Emphatically NOT "no data": the card stays visible and says what is actually
   * wrong, instead of being hidden as empty and taking a real, ingested metric
   * out of the UI with it. Survives the persisted cache, because the restore path
   * decides emptiness too. See `buildPresenceQuery`.
   */
  sparse: boolean;
  /**
   * When the data was actually fetched (ms). Survives the persisted cache, so a
   * card restored from it reports the true age of what it shows — the same
   * contract as a dashboard panel's "Last Refreshed" clock.
   */
  lastTriggeredAt: number | null;
  /** Cached data whose window is a different LENGTH from the selected one. */
  cachedDataDiffersFromTimeRange: boolean;
  /**
   * The window this preview's data was FETCHED for (µs), when it came from the
   * persisted cache — `null` on the live path, where the fetched window IS the
   * selected one.
   *
   * The card's x-axis is pinned to this in preference to the selected window, so
   * cached points are drawn against the time they actually describe.
   */
  cachedTimeRange?: { start_time: number; end_time: number } | null;
  /** The function actually in effect — reflects a ⚙ override, not the default. */
  footerLabel: string;
}

export interface FnOverride {
  variantId: string;
  options?: Record<string, any>;
}

/** True when an (unwrapped) response carries at least one sample. */
export function hasSamples(response: any): boolean {
  const series = response?.result ?? [];
  return series.some((s: any) => (s?.values?.length ?? 0) > 0 || s?.value);
}

/**
 * True when a response has samples but every one of them is NaN.
 *
 * NaN is contagious inside an aggregation: a single NaN sample in the input
 * makes the whole of `avg(metric)` NaN, so a populated metric can come back as
 * nothing but NaN. The card would then show a blank chart, or be hidden as "no
 * data", for a metric that genuinely has data — hence the re-query with the NaN
 * guard. Distinct from genuinely empty: no samples at all is NOT all-NaN.
 */
export function isAllNaN(response: any): boolean {
  const series = response?.result ?? [];
  let sawSample = false;
  for (const s of series) {
    for (const [, raw] of s?.values ?? []) {
      sawSample = true;
      if (!Number.isNaN(parseFloat(raw))) return false;
    }
    if (s?.value && !Number.isNaN(parseFloat(s.value[1]))) return false;
  }
  return sawSample;
}

/**
 * Record fields OpenObserve writes alongside the real Prometheus labels. They
 * come back from the labels endpoint but are not user labels.
 */
const INTERNAL_LABEL_FIELDS = new Set([
  "_timestamp",
  "value",
  "exemplars",
  "aggregation_temporality",
  "is_monotonic",
  "start_time",
  "flag",
]);

/**
 * Namespace for the explorer inside the dashboards' IndexedDB panel cache.
 *
 * Dashboards cache each panel's last result under `folderId:dashboardId:panelId`
 * (see usePanelCache) so a revisited panel paints instantly instead of
 * re-querying. The explorer wants exactly that, so it reuses the same store
 * rather than growing a second one: the "folder" is this reserved id, the
 * "dashboard" is the org, and the "panel" is the metric name. It is therefore
 * also cleared by the existing `window._o2_removeDashboardCache()` hook.
 */
const EXPLORER_CACHE_FOLDER = "__metrics_explorer";

/** Rendered previews retained before the least-recent are evicted. */
const PREVIEW_STATE_LIMIT = 300;

/**
 * Page one holds this many cards; "Show more" reveals another increment.
 *
 * This is an upfront query budget: `hideEmptyPanels` defaults on and emptiness
 * is only knowable by asking, so `sweepSlice` queries the WHOLE slice on load —
 * not just what is on screen. Kept small because the backend already times out
 * on heavy metrics and most answers are thrown away (a typical org hides two
 * thirds as empty).
 *
 * 8 is four rows of the 2-up grid — a bit more than a screenful — and divides
 * evenly by both column counts the grid uses (2, and 1 when narrow).
 */
export const INITIAL_PAGE_SIZE = 8;

/**
 * How long the slice must hold still before we query what is in it. Long enough
 * that typing a search does not fire a slice of queries per keystroke, short
 * enough that it feels like part of the same paint.
 */
export const SWEEP_DEBOUNCE_MS = 250;
/**
 * Cards revealed per "Show more" click — three rows of the 2-up grid.
 *
 * Six lands just past the fold, so the click feels like "a bit more" rather than
 * "a whole new page". The button's label is computed from this constant.
 */
export const PAGE_SIZE_INCREMENT = 6;

/** Cards are ~40-60 points wide; a coarse step keeps preview responses tiny. */
const PREVIEW_POINTS = 50;
/** Card heatmaps use a coarser step still. */
const HEATMAP_POINTS = 40;

/** The label-values picker fans out over at most this many matching streams. */
const LABEL_VALUE_FANOUT = 5;
const LABEL_VALUE_CAP = 100;

const storageKey = (kind: string, org: string) => `o2.metricsExplorer.${kind}.${org}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota. Overrides are a convenience, never a correctness
    // requirement — losing them must not break the grid.
  }
}

export function useMetricsExplorerGrid() {
  const store = useStore();
  const { getStreams } = useStreams();
  const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } =
    useHttpStreamingSearch();

  const org = computed(() => store.state.selectedOrganization?.identifier ?? "");

  /* ---------------------------------------------------------------- state */

  const loading = ref(false);
  const loadError = ref("");
  const streams = shallowRef<MetricStream[]>([]);
  const cards = shallowRef<MetricCard[]>([]);

  const searchTerm = ref("");
  const selectedPrefixes = ref<Set<string>>(new Set());
  const selectedSuffixes = ref<Set<string>>(new Set());
  const selectedTypes = ref<Set<string>>(new Set());
  const labelFilters = ref<LabelFilter[]>([]);
  const sortBy = ref<"a-z" | "z-a">("a-z");
  const viewMode = ref<"grid" | "rows">("grid");
  /**
   * The rail is exactly three filter panels. `""` means every panel is closed —
   * clicking the active rail icon toggles its panel shut.
   */
  const activeRail = ref<"" | "prefix" | "suffix" | "type">("prefix");

  /**
   * Narrows the grid to pinned metrics. Not one of the three selector panels —
   * it is a view toggle that composes with whatever filters are active.
   */
  const showFavoritesOnly = ref(false);

  /**
   * The grid is not on screen (e.g. the page is in Visualize mode). While paused,
   * slice changes do NOT sweep: there is no visible grid to fill, and re-querying
   * every card for a hidden view is pure waste. The caller sets this from its mode.
   */
  const paused = ref(false);

  /**
   * Drop cards whose query came back with no samples. On by default: a grid of
   * hatched "No data" placeholders is noise, and most orgs carry a long tail of
   * metrics that are registered but never written to.
   *
   * Necessarily a POST-query filter — emptiness is not knowable from the stream
   * list, only from the response. So an empty card is fetched, then removed. A
   * card that has not been queried yet (below the fold) is never hidden, since
   * we cannot yet know it is empty.
   */
  const hideEmptyPanels = ref(true);

  /** Microseconds, as the Prometheus services expect. */
  const timeRange = ref<{ start_time: number; end_time: number }>({
    start_time: 0,
    end_time: 0,
  });
  const refreshIntervalSec = ref(0);

  const previews = ref<Record<string, CardPreview>>({});
  const queue = createPreviewQueue();

  /**
   * Bounds the rendered-preview map.
   *
   * Each entry holds a full result set, and browsing a 3,000-metric org would
   * otherwise retain one per card visited for the life of the page. Evicting the
   * least-recently-requested is safe: the response itself stays in the queue's
   * LRU cache, so a card scrolled back into view re-renders from cache rather
   * than re-querying. The cap sits far above the ~20 cards on screen, so a
   * visible card is never the eviction target.
   */
  let previewOrder: string[] = [];

  const rememberPreview = (name: string) => {
    previewOrder = previewOrder.filter((n) => n !== name);
    previewOrder.push(name);
    while (previewOrder.length > PREVIEW_STATE_LIMIT) {
      const oldest = previewOrder.shift();
      if (oldest && oldest !== name) delete previews.value[oldest];
    }
  };

  /* ------------------------------------------------- local (per-browser) */

  const overrides = ref<Record<string, FnOverride>>({});

  // The scratchpad's pinned metrics — a persisted (localStorage, org-keyed)
  // working set of hand-picked metrics. `toggleFavorite` is its writer, and the
  // Workspace tab shows exactly this set (via showFavoritesOnly).
  const favorites = ref<string[]>([]);

  const loadLocalState = () => {
    const id = org.value;
    if (!id) return;
    overrides.value = readJson(storageKey("fnOverrides", id), {});
    favorites.value = readJson<string[]>(storageKey("favorites", id), []);
  };

  /** Entries for since-deleted metrics are dropped once the list is known. */
  const pruneLocalState = () => {
    const known = new Set(cards.value.map((c) => c.name));
    const id = org.value;

    const keptFavorites = favorites.value.filter((n) => known.has(n));
    if (keptFavorites.length !== favorites.value.length) {
      favorites.value = keptFavorites;
      writeJson(storageKey("favorites", id), keptFavorites);
    }

    const keptOverrides: Record<string, FnOverride> = {};
    for (const [name, ov] of Object.entries(overrides.value)) {
      if (known.has(name)) keptOverrides[name] = ov;
    }
    if (Object.keys(keptOverrides).length !== Object.keys(overrides.value).length) {
      overrides.value = keptOverrides;
      writeJson(storageKey("fnOverrides", id), keptOverrides);
    }
  };

  const toggleFavorite = (name: string) => {
    const next = favorites.value.includes(name)
      ? favorites.value.filter((n) => n !== name)
      : [...favorites.value, name];
    favorites.value = next;
    writeJson(storageKey("favorites", org.value), next);
  };

  const setOverride = (name: string, override: FnOverride | null) => {
    // The keys of the override we are REPLACING, captured before the write.
    // `previewKeysOf` derives them from `overrides.value`, so asking after the
    // assignment returns the keys of the new query — which nothing is running
    // yet. The superseded request would then keep its slot, and its result
    // would still land: `requestPreview` is sitting in `await runQueries(...)`
    // on it and writes the OLD variant's results, chartType and footer label
    // into the card when it resolves. It usually resolves last, too, because
    // the new query is typically a cache hit — the ⚙ dialog's own tile just ran
    // it — so the card would flash the new function and then revert to the old.
    const supersededKeys = previewKeysOfName(name);

    const next = { ...overrides.value };
    if (override) next[name] = override;
    else delete next[name];
    overrides.value = next;
    writeJson(storageKey("fnOverrides", org.value), next);

    // The cache is keyed on the generated query string, which the override
    // changes — so simply re-running the card picks up the new query.
    invalidatePreview(name, supersededKeys);
  };

  /* --------------------------------------------------------- stream load */

  /**
   * Bumped on every org switch. Every async load captures it and drops its result
   * if it changed while the request was in flight.
   *
   * Without this, a slow response from the PREVIOUS org installs its cards after
   * the switch: the grid then shows the old org's metrics, queries those names
   * against the new org, and writes the answers into the new org's cache. The
   * requests are indistinguishable once they land — only the generation says which
   * org asked.
   */
  let orgGeneration = 0;

  const loadStreams = async (force = false) => {
    const generation = orgGeneration;
    const requestedOrg = org.value;
    loading.value = true;
    loadError.value = "";
    try {
      const response = (await getStreams("metrics", false, false, force)) as {
        list?: MetricStream[];
      };
      if (generation !== orgGeneration || requestedOrg !== org.value) return;

      streams.value = response?.list ?? [];
      cards.value = buildMetricCards(streams.value);
      loadLocalState();
      pruneLocalState();
    } catch (error: any) {
      if (generation !== orgGeneration || requestedOrg !== org.value) return;
      loadError.value =
        error?.response?.data?.message ?? error?.message ?? "Failed to load metrics";
      streams.value = [];
      cards.value = [];
    } finally {
      if (generation === orgGeneration) loading.value = false;
    }
  };

  /* ------------------------------------------------- deferred schema load */

  /**
   * Label membership is not free: the bulk stream list forces `fetchSchema=false`
   * and the backend then omits field lists. So the first filter interaction —
   * never the landing path — pays for one `fetchSchema=true` load, cached for the
   * session.
   */
  const schemaLoading = ref(false);
  const schemaLoaded = ref(false);
  const labelsByStream = shallowRef<Record<string, string[]>>({});

  /**
   * The load currently in flight, so a second caller AWAITS it instead of
   * returning early — callers like `loadLabelValues` read `labelsByStream`
   * immediately after awaiting, so an early return would hand them an empty map.
   */
  let schemaInFlight: Promise<void> | null = null;

  const ensureSchemas = (): Promise<void> => {
    if (schemaLoaded.value) return Promise.resolve();
    if (schemaInFlight) return schemaInFlight;
    // Self-comparing clear: an org switch nulls the slot and a new load may
    // claim it before THIS one settles — its finally must not evict the
    // successor.
    const self: Promise<void> = doEnsureSchemas().finally(() => {
      if (schemaInFlight === self) schemaInFlight = null;
    });
    schemaInFlight = self;
    return self;
  };

  const doEnsureSchemas = async () => {
    const generation = orgGeneration;
    schemaLoading.value = true;
    try {
      // Called directly: useStreams cannot request schemas on a bulk fetch.
      const response = await StreamService.nameList(org.value, "metrics", true);
      // The org may have changed while this was in flight; its cards are not ours.
      if (generation !== orgGeneration) return;
      const list = (response?.data?.list ?? []) as MetricStream[];

      // An empty list is not an answer, it is a failure that did not throw — and
      // rebuilding the cards from it would replace a working grid with nothing,
      // on a path the user only reached by touching a filter. The `catch` below
      // cannot help here because nothing was thrown. Keep the cards we have; the
      // filter then fails open (see `isLabelEligible`), which is the same
      // outcome as a rejected request.
      if (!list.length) {
        schemaLoaded.value = true;
        return;
      }

      cards.value = buildMetricCards(list);
      const map: Record<string, string[]> = {};
      for (const card of cards.value) {
        if (card.labels) map[card.name] = card.labels;
      }
      labelsByStream.value = map;
      schemaLoaded.value = true;
    } catch {
      // Fail open: without membership data every card stays eligible. The chips
      // still work; we just cannot narrow the grid.
      if (generation === orgGeneration) schemaLoaded.value = true;
    } finally {
      if (generation === orgGeneration) schemaLoading.value = false;
    }
  };

  /* ------------------------------------------------------------ filtering */

  /**
   * Do we KNOW the label membership — not "did we finish trying to find out".
   * `schemaLoaded` is set even when the load FAILS, so it cannot answer this:
   * without membership data we cannot prove a card ineligible, so we do not
   * claim it is (fail open).
   *
   * A `computed`, NOT an `Object.keys` call inside `isLabelEligible`: that runs
   * once per card across five separate passes, so materialising a 3,000-element
   * key array in it cost ~90ms per keystroke on a large org. `labelsByStream` is
   * a shallowRef, so this recomputes only when the map is actually replaced.
   */
  const membershipKnown = computed(() => Object.keys(labelsByStream.value).length > 0);

  /**
   * A card is eligible for a label filter only when EVERY stream its effective
   * variant reads carries that label.
   *
   * The PromQL engine silently ignores a matcher on a stream that lacks the
   * label (`apply_matchers` in src/promql/src/utils.rs), so an ineligible
   * card would quietly render unfiltered data. Narrowing the grid — rather than
   * charting a lie — is what makes the chips safe.
   */
  const isLabelEligible = (card: MetricCard): boolean => {
    if (labelFilters.value.length === 0) return true;
    if (!membershipKnown.value) return true;

    // The streams the EFFECTIVE variant reads — not the card kind's default ones.
    // A ⚙ override changes the operands: a histogram switched to "Rate of count"
    // queries `X_count`, not `X_bucket`. Checking the default operands would clear
    // a card whose real query reads a stream that does not carry the label — and
    // the PromQL engine silently IGNORES a matcher on a stream that lacks it, so
    // the card would chart unfiltered data under an active filter chip. That is
    // the exact lie this whole eligibility rule exists to prevent.
    const operands = operandStreamsOfVariant(card);
    return labelFilters.value.every((filter) =>
      operands.every((stream) => {
        const labels = labelsByStream.value[stream];
        // A stream we have no schema for (e.g. a `_count` sibling that is not in
        // the list) cannot be proven to carry the label.
        return !!labels && labels.includes(filter.label);
      }),
    );
  };

  /**
   * Every stream the card's EFFECTIVE variant actually queries.
   *
   * `operandStreamsOf` answers this for a card's DEFAULT variant. Once a ⚙
   * override is in play the query can read entirely different streams, so the
   * operands are read off the resolved builder state — the only thing that knows
   * what will really be sent.
   */
  const operandStreamsOfVariant = (card: MetricCard): string[] => {
    const override = overrides.value[card.name];
    if (!override) return operandStreamsOf(card);

    const { resolved } = effectiveVariant(card);
    const streamsRead = (resolved?.queries ?? [])
      .map((q: any) => q.builder?.metric)
      .filter(Boolean) as string[];

    // A variant with no builder state (the mean pair divides two vectors) cannot
    // report its operands this way; fall back to the card-kind answer, which for
    // that kind is already both streams.
    return streamsRead.length ? [...new Set(streamsRead)] : operandStreamsOf(card);
  };

  /**
   * Metrics whose completed query carried no samples.
   *
   * Maintained incrementally rather than derived from `previews`. Deriving it
   * would make it — and therefore `passesExcept`, `filteredCards`, `sortedCards`
   * and all three facet computeds — a dependency of every preview response, so a
   * 60-card first screen would re-filter AND re-sort all 3,000+ cards sixty
   * times over.
   */
  const emptyMetrics = ref<Set<string>>(new Set());

  /**
   * Bumped every time the previews map is emptied wholesale — an org switch, a
   * time-range change, any invalidation.
   *
   * `requestPreview` holds a reference to the preview it is REPLACING (`existing`)
   * so a cancelled request can put the old chart back rather than leaving the card
   * wedged on a skeleton. But a bulk clear is exactly what cancels those requests:
   * `invalidateAll` empties the map and then aborts everything in flight, so each
   * abort ran the restore and wrote its stale preview straight back into the map
   * that had just been emptied. Switching org resurrected the previous org's
   * charts; widening the time range put the old window's data back on screen.
   *
   * So a write is only allowed if the map has not been reset out from under it.
   */
  let previewsEpoch = 0;

  const markEmptiness = (name: string, isEmpty: boolean) => {
    if (emptyMetrics.value.has(name) === isEmpty) return;
    const next = new Set(emptyMetrics.value);
    if (isEmpty) next.add(name);
    else next.delete(name);
    emptyMetrics.value = next;
  };

  /** Everything except one facet — for that facet's "how many more" counts. */
  const passesExcept = (card: MetricCard, except: string): boolean => {
    if (except !== "search" && !matchesSearch(card.name, card.help, searchTerm.value)) return false;
    const applyFacets = !showFavoritesOnly.value;
    if (
      applyFacets &&
      except !== "type" &&
      selectedTypes.value.size > 0 &&
      !selectedTypes.value.has(card.typeFilterBucket)
    )
      return false;
    if (
      applyFacets &&
      except !== "prefix" &&
      selectedPrefixes.value.size > 0 &&
      !selectedPrefixes.value.has(prefixOf(card.name))
    )
      return false;
    if (
      applyFacets &&
      except !== "suffix" &&
      selectedSuffixes.value.size > 0 &&
      !selectedSuffixes.value.has(suffixOf(card.name))
    )
      return false;
    if (except !== "label" && !isLabelEligible(card)) return false;
    // The Workspace tab (showFavoritesOnly) narrows to the scratchpad's pins.
    if (showFavoritesOnly.value && !favorites.value.includes(card.name)) return false;
    if (except !== "empty" && hideEmptyPanels.value && emptyMetrics.value.has(card.name))
      return false;
    return true;
  };

  /**
   * How many cards the no-data filter is actually withholding *right now*.
   *
   * Counted against the other active filters, not across the whole org — a
   * global count would claim results are hidden from a search that none of them
   * matched anyway, and would light up the "Show no-data panels" escape button
   * when it cannot help.
   */
  const emptyHiddenCount = computed(() => {
    if (!hideEmptyPanels.value || emptyMetrics.value.size === 0) return 0;
    return cards.value.filter(
      (card) => emptyMetrics.value.has(card.name) && passesExcept(card, "empty"),
    ).length;
  });

  // Derived once per stream list, not per card test. The assignment comes from
  // the grouping module itself — re-deriving it here would let the rail's facet
  // counts drift out of step with what the grid actually filters.
  const prefixAssignment = computed(() => computePrefixAssignment(cards.value.map((c) => c.name)));

  const prefixOf = (name: string) => prefixAssignment.value.groupOf.get(name) ?? MISC_GROUP_ID;
  const suffixOf = (name: string) => {
    const parts = name.split("_");
    return parts.length > 1 ? parts[parts.length - 1] : "";
  };

  const sortCards = (list: MetricCard[]): MetricCard[] => {
    const out = [...list];
    out.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy.value === "z-a") out.reverse();
    return out;
  };

  /**
   * Every card the filters allow, EXCLUDING the no-data filter — the list the page
   * budget is taken from.
   *
   * This is the distinction that stops a query storm. Hiding no-data cards is a
   * POST-query filter: a card has to be queried before we know it is empty. If the
   * page slice were taken from the already-hidden list, then every card removed as
   * empty would pull a fresh one into the window, which would query, which might
   * also be empty... On a sparse org that cascade walks the entire metric list —
   * a "30 card" page quietly firing a thousand queries, which is precisely the
   * cost the page size exists to bound.
   *
   * So the budget is counted BEFORE the no-data filter and the hiding happens
   * WITHIN the slice: at most `pageSize` cards are ever rendered or queried, and
   * hiding empties shrinks the visible grid rather than refilling it. "Show more"
   * is how the user asks to spend more.
   */
  const sortedCandidates = computed(() =>
    sortCards(cards.value.filter((card) => passesExcept(card, "empty"))),
  );

  const isHiddenAsEmpty = (card: MetricCard) =>
    hideEmptyPanels.value && emptyMetrics.value.has(card.name);

  /** Everything the filters allow, no-data filter included. Counts only. */
  const filteredCards = computed(() =>
    sortedCandidates.value.filter((card) => !isHiddenAsEmpty(card)),
  );

  const sortedCards = computed(() => filteredCards.value);

  /**
   * Facet counts answer "how many more would this add", so each is recomputed
   * against every OTHER active filter.
   */
  const prefixFacets = computed<PrefixGroup[]>(() => {
    const eligible = cards.value.filter((c) => passesExcept(c, "prefix"));
    const counts = new Map<string, number>();
    for (const card of eligible) {
      const id = prefixOf(card.name);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return prefixAssignment.value.groups
      .map((g) => ({ ...g, count: counts.get(g.id) ?? 0 }))
      .sort((a, b) =>
        a.id === "misc"
          ? 1
          : b.id === "misc"
            ? -1
            : b.count - a.count || a.label.localeCompare(b.label),
      );
  });

  const suffixFacets = computed<SuffixGroup[]>(() => {
    const eligible = cards.value.filter((c) => passesExcept(c, "suffix"));
    return computeSuffixGroups(eligible.map((c) => c.name));
  });

  const typeFacets = computed(() => {
    const eligible = cards.value.filter((c) => passesExcept(c, "type"));
    const counts = new Map<string, number>();
    for (const card of eligible) {
      counts.set(card.typeFilterBucket, (counts.get(card.typeFilterBucket) ?? 0) + 1);
    }
    return ["counter", "gauge", "histogram", "summary", "other"].map((id) => ({
      id,
      count: counts.get(id) ?? 0,
    }));
  });

  /* ---------------------------------------------------------- pagination */

  const pageSize = ref(INITIAL_PAGE_SIZE);

  /**
   * The page's query budget: at most `pageSize` cards, chosen BEFORE the no-data
   * filter. Nothing outside this slice is ever rendered or queried.
   */
  const pageSlice = computed(() => sortedCandidates.value.slice(0, pageSize.value));

  /** The slice actually rendered. Colour index is position in this same order. */
  const pagedCards = computed(() => pageSlice.value.filter((card) => !isHiddenAsEmpty(card)));

  const hasMore = computed(() => sortedCandidates.value.length > pageSize.value);
  const remainingCount = computed(() =>
    Math.max(0, sortedCandidates.value.length - pageSize.value),
  );

  /**
   * A single "Show more" may pull at most this many budget batches while
   * stepping over no-data cards. A guard, not a target: it stops a long run of
   * empty metrics from walking the whole list in one click. ~8 batches is the
   * same order as a handful of manual clicks, never the query storm an unbounded
   * fill would cost on a sparse org.
   */
  const SHOW_MORE_MAX_BATCHES = 8;
  /** True while a "Show more" click is resolving; drives the button's spinner. */
  const showingMore = ref(false);

  /**
   * Reveal one more page.
   *
   * With no-data panels hidden, the budget is spent on candidates BEFORE they
   * are known to be empty, so a fixed +12 bump can land entirely on rows that
   * are then hidden — the grid does not grow and the click looks dead. So when
   * the filter is on, look ahead: query candidate batches until enough with-data
   * cards are found (or SHOW_MORE_MAX_BATCHES caps the walk), and only THEN
   * commit the budget. One commit per click — committing per batch made the
   * grid grow in visible steps, and rendering cards before their emptiness was
   * known made the count tick back down as they resolved.
   */
  const showMore = async () => {
    if (!hideEmptyPanels.value) {
      pageSize.value += PAGE_SIZE_INCREMENT;
      return;
    }
    if (showingMore.value) return;
    showingMore.value = true;
    try {
      const cands = sortedCandidates.value;
      let cursor = pageSize.value;
      let revealed = 0;
      let batches = 0;
      while (
        batches < SHOW_MORE_MAX_BATCHES &&
        cursor < cands.length &&
        revealed < PAGE_SIZE_INCREMENT
      ) {
        const next = Math.min(cands.length, cursor + PAGE_SIZE_INCREMENT);
        await Promise.all(
          cands
            .slice(cursor, next)
            .map((card) => requestPreview(card, { priority: PRIORITY.PREFETCH }).catch(() => {})),
        );
        revealed += cands.slice(cursor, next).filter((c) => !emptyMetrics.value.has(c.name)).length;
        cursor = next;
        batches++;
      }
      // The list changed while we were querying (filter edit, org switch) — the
      // reset watcher already chose the right page size for the new list.
      if (sortedCandidates.value !== cands) return;
      pageSize.value = cursor;
    } finally {
      showingMore.value = false;
    }
  };

  /**
   * Any change to what the list contains starts over at page one — otherwise a
   * user who paged deep into one filter would land mid-list on the next.
   */
  watch(
    [
      searchTerm,
      selectedPrefixes,
      selectedSuffixes,
      selectedTypes,
      labelFilters,
      sortBy,
      showFavoritesOnly,
    ],
    () => {
      pageSize.value = INITIAL_PAGE_SIZE;
    },
    { deep: true },
  );

  const clearFilters = () => {
    searchTerm.value = "";
    selectedPrefixes.value = new Set();
    selectedSuffixes.value = new Set();
    selectedTypes.value = new Set();
    labelFilters.value = [];
    // Otherwise unpinning your last favorite while this is on strands you on an
    // empty grid with no visible way out.
    showFavoritesOnly.value = false;
  };

  const activeFilterCount = computed(
    () =>
      selectedPrefixes.value.size +
      selectedSuffixes.value.size +
      selectedTypes.value.size +
      labelFilters.value.length +
      (searchTerm.value ? 1 : 0) +
      (showFavoritesOnly.value ? 1 : 0),
  );

  /* -------------------------------------------------------- query context */

  const streamNameSet = computed(() => new Set(streams.value.map((s) => s.name)));

  const rangeSeconds = computed(() =>
    Math.max(0, (timeRange.value.end_time - timeRange.value.start_time) / 1_000_000),
  );

  /**
   * The org's scrape interval — the SAME field the panel substitution resolves
   * `$__rate_interval` against (usePanelVariableSubstitution).
   *
   * The rate window is `max(step + scrape, 4 * scrape)`. One source of truth, so
   * a card charts a metric with the same smoothing as the panel you land on when
   * you click it, rather than two places that disagree.
   */
  const scrapeIntervalSeconds = computed(
    () =>
      store.state.organizationData?.organizationSettings?.scrape_interval ??
      DEFAULT_SCRAPE_INTERVAL_SECONDS,
  );

  const streamByName = computed(() => new Map(streams.value.map((s) => [s.name, s])));

  /**
   * How many points a card's preview asks for. Heatmaps are coarser.
   *
   * EVERY derivation must go through this. The rate window is computed from the
   * point count, and above ~2h of range the 4x-scrape floor stops dominating, so
   * 40 points and 50 points produce genuinely different queries (at 6h, `[10m]`
   * against `[8m12s]`). A caller using a different point count would generate a
   * query the card, editor and dialog tile could not share via the cache.
   */
  const pointsFor = (card: MetricCard) =>
    card.chartType === "heatmap" ? HEATMAP_POINTS : PREVIEW_POINTS;

  /**
   * Everything a resolved variant depends on. When this changes, every memo is
   * stale; while it holds, a card's variant cannot change.
   */
  const variantEpoch = computed(() =>
    JSON.stringify([
      // `org` and the stream list belong here as much as the filters do: another
      // org can carry the same NUMBER of metrics, and a memo keyed only on the
      // count would then answer for the wrong one.
      org.value,
      streams.value.length,
      schemaLoaded.value,
      labelFilters.value,
      overrides.value,
      rangeSeconds.value,
      scrapeIntervalSeconds.value,
    ]),
  );

  /**
   * Bounded, for the same reason `previews` is: each entry holds a metric's
   * whole rule set (every variant, expression and operation chain), and an
   * unbounded memo would retain one for every card visited while browsing a
   * 3,000-metric org. The cap sits far above the ~15 cards on screen (and the
   * handful of extra keys `previewKeysOf` adds per card), so a visible card is
   * never the eviction target.
   */
  const VARIANT_CACHE_LIMIT = 400;
  const variantCache = new Map<string, { defaults: any; resolved: any }>();
  let cachedEpoch: string | null = null;

  /**
   * The effective variant for a card: the user's persisted ⚙ override when it
   * still resolves, else the rule-set default.
   *
   * Memoized because it is not cheap and it is on the render path: the template
   * asks every visible card for its queries on every re-render, and a preview
   * landing on any card in a row re-renders that row. Each call was scanning the
   * whole stream list and rebuilding the metric's entire rule set — on a
   * 3,000-metric org, thousands of elements walked to answer a question whose
   * answer had not changed. `previewKeysOf` calls it twice more per card.
   *
   * The memo also stabilises the identity of the returned `queries` array, which
   * is what stops the card's `:queries` prop from looking new on every render.
   */
  const effectiveVariant = (
    card: MetricCard,
    points = pointsFor(card),
    opts?: { applyNanGuard?: boolean; rateWindow?: string },
  ) => {
    const epoch = variantEpoch.value;
    if (epoch !== cachedEpoch) {
      variantCache.clear();
      cachedEpoch = epoch;
    }
    const cacheKey = `${card.name}|${points}|${opts?.applyNanGuard ? 1 : 0}|${opts?.rateWindow ?? ""}`;
    const hit = variantCache.get(cacheKey);
    if (hit) return hit;

    const family = streamByName.value.get(card.name);
    const defaults = getMetricDefaults(
      card.name,
      family?.metrics_meta?.metric_type,
      // The DECLARED unit the family join resolved — NOT `undefined`, and not the
      // canonical `card.unit`. Passing `undefined` made the preview re-derive the
      // unit from the metric NAME alone, so an OTLP `Cel`, or a byte counter whose
      // name carries no unit segment, silently degraded to "numbers" / "count/s".
      // The card reads `preview.unit` in preference to `card.unit`, so this is the
      // value the user actually sees. (Handing back `card.unit` would be worse than
      // nothing: it is already canonical — and, for a counter, already RATED — so
      // it would either miss the alias table or re-rate a rated unit.)
      card.declaredUnit,
      {
        streamNames: streamNameSet.value,
        familyType: card.familyType,
        filters: labelFilters.value,
        // A concrete window by default — the explorer executes its own previews
        // and nothing substitutes variables for them. The handoff asks for
        // `$__rate_interval` instead, because a PANEL resolves that itself.
        rateWindow:
          opts?.rateWindow ??
          computeRateWindow(rangeSeconds.value, points, scrapeIntervalSeconds.value),
        labels: card.labels ?? labelsByStream.value[card.name],
        applyNanGuard: opts?.applyNanGuard,
      },
    );
    // The card's unit already came from the family-joined rule-set pass; keep it
    // rather than re-deriving from a sub-stream's fallback metadata.
    const override = overrides.value[card.name];
    const resolved = resolveVariant(
      defaults,
      override?.variantId ?? defaults.variants[0]?.id,
      override?.options,
    );

    const result = { defaults, resolved };
    variantCache.set(cacheKey, result);
    while (variantCache.size > VARIANT_CACHE_LIMIT) {
      // Map preserves insertion order, so the first key is the oldest.
      const oldest = variantCache.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === cacheKey) break;
      variantCache.delete(oldest);
    }
    return result;
  };

  /* ------------------------------------------------------------- previews */

  const previewCacheKey = (query: string, step: number) =>
    `${org.value}|${query}|${timeRange.value.start_time}|${timeRange.value.end_time}|${step}`;

  /**
   * Drops a card's rendered preview and abandons whatever it still has running.
   *
   * The queue is keyed on the generated query string, never on the card name, so
   * cancellation must go through the card's query keys.
   *
   * @param alsoCancel keys the card occupied under a state it has since left.
   *   `previewKeysOf` can only describe the CURRENT state, so a caller that
   *   changes what the card queries (see `setOverride`) has to hand over the
   *   keys of the state it is leaving, or that request is never cancelled.
   */
  const invalidatePreview = (name: string, alsoCancel: string[] = []) => {
    const card = cards.value.find((c) => c.name === name);
    const keys = new Set([...alsoCancel, ...(card ? previewKeysOf(card) : [])]);
    for (const key of keys) queue.cancel(key, name);
    delete previews.value[name];
  };

  /**
   * Runs one PromQL query over the streaming endpoint, the same path the
   * dashboards use (`use_streaming=true`).
   *
   * Chunks arrive as `promql_response` events and are merged by the shared
   * chunk processor, which accumulates into the `{ resultType, result }` shape
   * the chart converters already consume — so nothing downstream changes.
   *
   * Cancellation goes through the stream's trace id rather than an HTTP abort:
   * the queue's AbortSignal is what the grid already fires on scroll-away,
   * filter change and refresh, so it is bridged to `cancelStreamQueryBasedOnRequestId`.
   */
  const streamQuery = (query: string, step: number, signal: AbortSignal) =>
    new Promise<any>((resolve, reject) => {
      const { traceId } = generateTraceContext();
      const maxSeries = store.state?.zoConfig?.max_dashboard_series ?? 100;
      const chunkProcessor = createPromQLChunkProcessor({
        maxSeries,
        enableLogging: false,
      });

      let accumulated: any = null;
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
      };

      function onAbort() {
        cancelStreamQueryBasedOnRequestId({
          trace_id: traceId,
          org_id: org.value,
        });
        finish(() => {
          const error = new Error(`stream cancelled: ${traceId}`);
          error.name = "AbortError";
          reject(error);
        });
      }

      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort);

      fetchQueryDataWithHttpStream(
        {
          queryReq: {
            query,
            start_time: timeRange.value.start_time,
            end_time: timeRange.value.end_time,
            step: `${step}s`,
            query_type: "range",
          },
          type: "promql",
          traceId,
          org_id: org.value,
        },
        {
          data: (_payload: any, res: any) => {
            if (res?.type !== "promql_response") return;
            accumulated = chunkProcessor.processChunk(accumulated, res?.content?.results);
          },
          error: (_payload: any, err: any) => {
            // Parsed HERE, not in the catch upstream: rejecting with a plain
            // Error would throw away the payload's code and trace id, leaving
            // only a message string to re-derive them from.
            const parsed = parseSearchError(err);
            // The stream's own trace id, when the payload did not carry one.
            finish(() =>
              reject(
                toSearchErrorObject({
                  ...parsed,
                  traceId: parsed.traceId ?? traceId,
                }),
              ),
            );
          },
          complete: () => finish(() => resolve(accumulated ?? { result: [] })),
          reset: () => {},
        },
      );
    });

  /**
   * Runs one variant's queries through the scheduler, owned by `owner`.
   *
   * The owner is what makes cancellation safe: two cards can generate the same
   * PromQL (an ExponentialHistogram `X_bucket` fallback and its `X_count`
   * sibling both emit `sum(rate(X_count[W]))`), so they share one request. Only
   * the owner that asked for it may drop it.
   */
  const runQueries = (
    queries: any[],
    step: number,
    owner: string,
    priority: number = PRIORITY.VISIBLE,
    refresh = false,
  ) =>
    Promise.all(
      queries.map((q: any) =>
        queue.run(
          previewCacheKey(q.expr, step),
          priority,
          (signal) => streamQuery(q.expr, step, signal),
          // `refresh` makes "skip the cache" mean it all the way down. The
          // persisted panel cache is only half of what answers a card; the
          // queue's own LRU is the other half, and it holds the very result the
          // refresh is trying to replace.
          { owner, refresh },
        ),
      ),
    );

  /**
   * Does the metric carry ANY sample in the window, whatever its card's
   * aggregation made of them?
   *
   * Asked only when a RATE-BASED card came back with nothing. An empty `avg()` is
   * proof the metric is empty; an empty `rate()` is not — `rate()` needs two
   * samples inside its window to compute a delta, so a metric scraped once, or
   * scraped less often than the window is wide, yields nothing from a query whose
   * data is sitting right there in the range. Hiding that card as "no data" is
   * how a fully-ingested Prometheus histogram ends up rendering no card at all
   * (its base is a metadata-only phantom, and `_bucket`/`_sum`/`_count` are each
   * rate-based), which puts real data beyond reach of the UI.
   *
   * Probes the streams the EFFECTIVE variant reads, not the card's own name: a
   * mean pair divides `X_sum` by `X_count`, and an ExponentialHistogram card
   * reads `X_count` rather than itself. Those are the streams whose samples the
   * empty result is a statement about.
   *
   * Costs one extra query per empty rate card, and only for cards the stream list
   * already says have been written to — so the long tail of registered-but-empty
   * metrics the "With data" filter exists to hide is still answered for free, from
   * `doc_num`, and never probed.
   */
  const hasSamplesInWindow = async (
    card: MetricCard,
    step: number,
    opts?: { skipCache?: boolean; priority?: number },
  ): Promise<boolean> => {
    const probes = operandStreamsOfVariant(card).map((stream) => ({
      expr: buildPresenceQuery(stream, labelFilters.value),
    }));
    if (!probes.length) return false;

    try {
      const probed = await runQueries(
        probes,
        step,
        card.name,
        opts?.priority ?? PRIORITY.VISIBLE,
        !!opts?.skipCache,
      );
      return probed.some(hasSamples);
    } catch {
      // A probe that failed proves nothing either way. Fall back to what the
      // card's own query said, which is the behaviour without this check at all.
      return false;
    }
  };

  /* -------------------------------------------------- persistent card cache */

  const cacheFor = (card: MetricCard) => usePanelCache(EXPLORER_CACHE_FOLDER, org.value, card.name);

  /**
   * What the cached result is a result OF. A mismatch means re-query.
   *
   * The generated query strings already fold in the label filters, the ⚙
   * override and the rate window, so they are the whole identity — there is no
   * separate variables/schema object to compare, as there is for a dashboard
   * panel.
   */
  const cacheIdentity = (queries: any[], step: number) => ({
    queries: queries.map((q: any) => q.expr),
    step,
    org: org.value,
  });

  /**
   * Paints a card from the last persisted result, exactly as a dashboard panel
   * does on revisit — no query at all.
   *
   * The cache is accepted whenever its IDENTITY matches (same queries, same
   * step, same org). The window is not part of that identity: as on a dashboard
   * panel, a result fetched for an equally-long window a while ago is still
   * shown rather than blanking the card until a query returns. What the card
   * does NOT do is pass it off as live — `lastTriggeredAt` carries the true
   * fetch time (that is why it is persisted), so the footer's "Last Refreshed"
   * clock reports the real age, and a window of a different LENGTH additionally
   * raises `cachedDataDiffersFromTimeRange`, the same warning a panel raises.
   */
  const restoreFromCache = async (
    card: MetricCard,
    resolved: any,
    defaults: any,
    step: number,
    /** The caller's `previewsEpoch`; see `requestPreview`. */
    epoch: number,
  ): Promise<boolean> => {
    let cached: any = null;
    try {
      cached = await cacheFor(card).getPanelCache();
    } catch {
      return false;
    }
    if (!cached?.value) return false;
    if (!isEqual(cached.key, cacheIdentity(resolved.queries, step))) return false;
    // IndexedDB answered after the grid moved on. Painting now would restore the
    // previous org's — or the previous window's — chart into a map that was
    // deliberately emptied.
    if (epoch !== previewsEpoch) return false;

    const window = timeRange.value;
    const range = cached.cacheTimeRange ?? {};

    // Same rule the dashboards use (usePanelDataLoader.ts:853): compare the
    // DURATION of the window, not its absolute bounds. Cached data fetched for an
    // older window is still shown — the card reports exactly how old it is
    // through `lastTriggeredAt`, the way a panel's "Last Refreshed" clock does —
    // and the ⚠ is raised only when the selected range is a different LENGTH from
    // the one it was fetched for.
    //
    // Bounds drift is NOT flagged here, and must not be: re-opening the grid on a
    // relative range ("Past 15 Minutes") re-stamps the window to `now` on every
    // mount, so every restored card would wear a warning that told the user
    // nothing. The honest answer to drift is to draw the data on ITS OWN axis
    // (`cachedTimeRange` below) and let `lastTriggeredAt` say how old it is.
    const differs = window.end_time - window.start_time !== range.end_time - range.start_time;

    previews.value[card.name] = {
      status: "done",
      results: cached.value.results ?? [],
      error: "",
      chartType: resolved.chartType,
      unit: resolved.unit,
      bucketUnit: defaults.bucketUnit,
      stale: false,
      nanGuardApplied: !!cached.value.nanGuardApplied,
      /**
       * The window this data was actually FETCHED for — not the one currently
       * selected. The card pins its x-axis to this so a relative range that
       * re-stamps `timeRange` to `now` on every mount does not march the axis
       * forward while the cached points underneath stay put. Same idea as the
       * dashboards restoring `metadata` and pinning from the QUERY's window
       * (usePanelDataLoader.ts:841), carried on the preview.
       */
      cachedTimeRange:
        range.start_time && range.end_time
          ? { start_time: range.start_time, end_time: range.end_time }
          : null,
      // Persisted, because this path decides emptiness too — and it fires no
      // query, so it has no way to re-derive it. Without it a sparse card would
      // paint fine on the live path and then vanish from the grid on the next
      // visit, when the cache answered instead.
      sparse: !!cached.value.sparse,
      lastTriggeredAt: cached.value.lastTriggeredAt ?? cached.timestamp ?? null,
      cachedDataDiffersFromTimeRange: differs,
      footerLabel: resolved.footerLabel,
    };
    markEmptiness(
      card.name,
      !(cached.value.results ?? []).some(hasSamples) && !cached.value.sparse,
    );
    rememberPreview(card.name);
    return true;
  };

  const persistToCache = (card: MetricCard, preview: CardPreview, queries: any[], step: number) => {
    void cacheFor(card)
      .savePanelCache(
        cacheIdentity(queries, step),
        {
          results: preview.results,
          nanGuardApplied: preview.nanGuardApplied,
          sparse: preview.sparse,
          lastTriggeredAt: preview.lastTriggeredAt,
        },
        {
          start_time: timeRange.value.start_time,
          end_time: timeRange.value.end_time,
        },
      )
      .catch(() => {
        // A cache write is never worth failing a chart the user can already see.
      });
  };

  const requestPreview = async (
    card: MetricCard,
    opts?: { skipCache?: boolean; priority?: number },
  ) => {
    if (card.unsupported) return;
    if (!timeRange.value.end_time) return;

    // Captured before the first await. Every write into `previews` below happens
    // after one, by which time a bulk clear may have emptied the map and
    // cancelled this request — and a write that lands then resurrects a state the
    // user has already left. See `previewsEpoch`.
    const epoch = previewsEpoch;

    // Through `pointsFor`, never a second copy of its rule: the step derived
    // from it goes into the cache key, so a card that computed its points any
    // other way than `previewKeysOf` / `dialogStepFor` do would occupy keys
    // neither of them can name — cancellation would cancel nothing and the
    // dialog tile would re-fetch what the card already had.
    const points = pointsFor(card);
    const { defaults, resolved } = effectiveVariant(card, points);
    if (!resolved || !resolved.queries.length) return;

    // The RESOLVED variant, not the card's default: a ⚙ override can select a
    // variant that has nothing previewable about it (an info metric's label
    // table), and asking the card's ECharts renderer to draw one produces a
    // blank canvas. Say so instead.
    if (resolved.variant?.previewable === false) {
      previews.value[card.name] = {
        status: "unavailable",
        results: [],
        error: "",
        chartType: resolved.chartType,
        unit: resolved.unit,
        bucketUnit: defaults.bucketUnit,
        stale: false,
        nanGuardApplied: false,
        sparse: false,
        lastTriggeredAt: null,
        cachedDataDiffersFromTimeRange: false,
        footerLabel: resolved.footerLabel,
      };
      rememberPreview(card.name);
      return;
    }

    const step = computeStepSeconds(rangeSeconds.value, points);

    // Already resolved — reuse it, fire NO query. A card that already has a
    // SETTLED preview (done/no-data/unavailable) is just being re-triggered
    // because it scrolled back into view or its body remounted (e.g. flipping
    // Explore↔Visualize). Re-running would flash a loading state and re-hit the
    // backend for a result the card already shows — exactly what a dashboard
    // panel avoids on revisit.
    //
    // This is safe without a per-query validity check because previews are
    // WINDOW-scoped: any time-range change wipes `previews.value` (see
    // `setTimeRange`), and a ⚙ override re-requests with `skipCache`. So an
    // existing settled preview is always valid for the current query+window.
    // `skipCache` (refresh / time-range change / override) still forces a real
    // re-query, and an `error`/`loading` preview falls through to retry.
    const settled = previews.value[card.name];
    if (!opts?.skipCache && settled && settled.status !== "loading" && settled.status !== "error") {
      return;
    }

    // Paint from the persisted result and fire no query at all — the same deal a
    // dashboard panel gets on revisit. Matters more here than there: a first
    // screenful is ~60 queries against a backend that already times out on the
    // heavy metrics.
    if (
      !opts?.skipCache &&
      !previews.value[card.name] &&
      (await restoreFromCache(card, resolved, defaults, step, epoch))
    ) {
      return;
    }
    // The MISS path of the await above: a restore that painted checks the epoch
    // itself, but a cache miss fell through to the loading write below — and if
    // the map was cleared while IndexedDB was answering, that write resurrects
    // an entry into a state the user has already left.
    if (epoch !== previewsEpoch) return;

    const existing = previews.value[card.name];

    previews.value[card.name] = {
      status: "loading",
      results: existing?.results ?? [],
      error: "",
      chartType: resolved.chartType,
      unit: resolved.unit,
      bucketUnit: defaults.bucketUnit,
      stale: false,
      nanGuardApplied: false,
      sparse: false,
      lastTriggeredAt: existing?.lastTriggeredAt ?? null,
      cachedDataDiffersFromTimeRange: false,
      // Carried with `results` above: a re-query keeps the OLD chart on screen
      // while it runs, so the axis must keep describing that old data until the
      // new data lands.
      cachedTimeRange: existing?.cachedTimeRange ?? null,
      footerLabel: resolved.footerLabel,
    };

    try {
      let results = await runQueries(
        resolved.queries,
        step,
        card.name,
        opts?.priority ?? PRIORITY.VISIBLE,
        !!opts?.skipCache,
      );
      let nanGuardApplied = false;

      // All-NaN but not empty: the metric HAS data, the aggregation just
      // underflowed on extremely small values. Re-run once with the selector
      // guarded against NaN samples rather than showing a blank chart (or
      // hiding the card as "no data", which would be a lie).
      if (defaults.supportsNanGuard && results.length > 0 && results.every(isAllNaN)) {
        const guarded = effectiveVariant(card, points, {
          applyNanGuard: true,
        });
        if (guarded.resolved?.queries.length) {
          const retried = await runQueries(
            guarded.resolved.queries,
            step,
            card.name,
            opts?.priority ?? PRIORITY.VISIBLE,
            !!opts?.skipCache,
          );
          if (retried.some((r) => !isAllNaN(r))) {
            results = retried;
            nanGuardApplied = true;
          }
        }
      }

      // Empty, and the card's default query is one `rate()` cannot answer with:
      // ask the metric itself whether it has any samples in the window before
      // calling it empty and hiding it. Gated on `card.hasData` so the long tail
      // of registered-but-never-written metrics — the ones the "With data" filter
      // is FOR — is settled from the stream list without a second query.
      const sparse =
        !results.some(hasSamples) &&
        isRateBasedKind(defaults.cardKind) &&
        card.hasData &&
        (await hasSamplesInWindow(card, step, opts));

      // The response outlived the state that asked for it: a bulk clear empties
      // the map and cancels what is in flight, but a request that had ALREADY
      // resolved is past the point of cancelling and would write the old org's
      // results into the new org's grid.
      if (epoch !== previewsEpoch) return;

      previews.value[card.name] = {
        status: "done",
        results,
        error: "",
        chartType: resolved.chartType,
        unit: resolved.unit,
        bucketUnit: defaults.bucketUnit,
        stale: false,
        nanGuardApplied,
        sparse,
        // Stamped on the real fetch, and persisted — this is what lets a
        // cache-restored card tell the user how old its data actually is.
        lastTriggeredAt: Date.now(),
        cachedDataDiffersFromTimeRange: false,
        // A real fetch just answered for the SELECTED window, so the card's axis
        // must go back to tracking it. Stated rather than left undefined: this
        // object replaces a possibly cache-restored one, and inheriting its
        // window would pin a freshly-queried chart to a stale axis.
        cachedTimeRange: null,
        footerLabel: resolved.footerLabel,
      };
      markEmptiness(card.name, !results.some(hasSamples) && !sparse);
      rememberPreview(card.name);
      persistToCache(card, previews.value[card.name], resolved.queries, step);
    } catch (error: any) {
      // A cancelled request belongs to a state the user has already left; it is
      // not an error the card should show. Restore whatever was on screen before
      // rather than leaving the card wedged on its loading skeleton.
      if (isCancelled(error)) {
        // The cancel came FROM a bulk clear (org switch, range change): the state
        // this preview described is gone, and restoring it would put the old org's
        // chart back into the new org's grid.
        if (epoch !== previewsEpoch) return;
        if (existing) previews.value[card.name] = existing;
        else delete previews.value[card.name];
        return;
      }

      // The backend hands back its internal envelope rather than a sentence
      // ("Error during planning: ErrorCode# {...}"), and drops the trace id on
      // the floor. This digs both out.
      const parsed = parseSearchError(error);

      if (epoch !== previewsEpoch) return;

      const previous = existing?.results ?? [];
      previews.value[card.name] = {
        status: previous.length ? "done" : "error",
        results: previous,
        error: parsed.message,
        errorDetail: parsed.detail,
        errorTraceId: parsed.traceId,
        // The query is the first thing anyone diagnosing this asks for, and the
        // card is the only place that knows it — the user never typed it.
        errorQueries: resolved.queries.map((query: any) => query.expr),
        chartType: resolved.chartType,
        unit: resolved.unit,
        bucketUnit: defaults.bucketUnit,
        // A failed auto-refresh leaves the previous chart up, flagged stale,
        // rather than blanking a chart the user was reading.
        stale: previous.length > 0,
        nanGuardApplied: existing?.nanGuardApplied ?? false,
        sparse: existing?.sparse ?? false,
        lastTriggeredAt: existing?.lastTriggeredAt ?? null,
        cachedDataDiffersFromTimeRange: existing?.cachedDataDiffersFromTimeRange ?? false,
        // Carried with `results`: this path KEEPS the previous chart up, so it
        // must keep the window that chart is true of. Dropping it would pin the
        // surviving points to the selected window — the drift bug again, but only
        // for cards whose refresh failed.
        cachedTimeRange: existing?.cachedTimeRange ?? null,
        footerLabel: resolved.footerLabel,
      };
    }
  };

  /**
   * Every cache key the card's effective variant can occupy.
   *
   * Includes the NaN-guarded rewrite: when the first query comes back all-NaN we
   * re-run a *different* query string, so its result lives under a different
   * key. Omitting it here would let a refresh re-serve the stale guarded
   * response from cache and appear to do nothing.
   */
  const previewKeysOf = (card: MetricCard): string[] => {
    const points = pointsFor(card);
    const step = computeStepSeconds(rangeSeconds.value, points);
    const keys = new Set<string>();

    for (const guarded of [false, true]) {
      const { resolved } = effectiveVariant(card, points, {
        applyNanGuard: guarded,
      });
      for (const q of (resolved?.queries ?? []) as any[]) {
        keys.add(previewCacheKey(q.expr, step));
      }
    }
    return [...keys];
  };

  /** As above, by metric name. Empty for a metric that is not in the list. */
  const previewKeysOfName = (name: string): string[] => {
    const card = cards.value.find((c) => c.name === name);
    return card ? previewKeysOf(card) : [];
  };

  /**
   * Re-runs one card against the backend.
   *
   * Its cached responses are dropped first — the query string and time window
   * are unchanged, so the cache would otherwise answer instantly and the
   * refresh would do nothing. The rendered chart is left in place while the new
   * one loads (`requestPreview` keeps the previous series), so a single-card
   * refresh does not flash a skeleton.
   */
  const refreshCard = (card: MetricCard) => {
    for (const key of previewKeysOf(card)) {
      queue.cancel(key, card.name);
      queue.invalidate(key);
    }
    // `skipCache`: a refresh must reach the backend, not replay the persisted
    // result it wrote last time.
    return requestPreview(card, { skipCache: true });
  };

  const cancelPreview = (card: MetricCard) => {
    for (const key of previewKeysOf(card)) queue.cancel(key, card.name);
  };

  /** Time or filters changed: every in-flight preview is now for the wrong state. */
  const invalidateAll = () => {
    previewsEpoch++;
    queue.cancelAll();
    previews.value = {};
    previewOrder = [];
    emptyMetrics.value = new Set();
  };

  /**
   * Drops cached responses without clearing the rendered previews.
   *
   * A manual refresh (or an auto-refresh tick on an absolute range) reuses the
   * same query string and time window, so without this the cache would answer
   * instantly and "refresh" would be a no-op. Keeping the previews means the
   * card updates in place — `requestPreview` holds the old series while the new
   * one loads, so there is no skeleton flash on a chart the user is reading.
   */
  const clearPreviewCache = () => {
    queue.clearCache();
  };

  /** Distinguishes dialog interest from card interest on the same query. */
  const DIALOG_OWNER = "\u0000dialog";

  /**
   * The step the dialog must use for a given card.
   *
   * It has to match the card's own step exactly, or the two produce different
   * cache keys for the same query — the tile would re-fetch what the grid has
   * already loaded, and `cancelDialogQueries` would compute keys that match
   * nothing and cancel nothing.
   */
  const dialogStepFor = (card: MetricCard) =>
    computeStepSeconds(rangeSeconds.value, pointsFor(card));

  /**
   * Runs one query for a ⚙-dialog tile.
   *
   * Shares the grid's scheduler and cache — dialog tiles outrank background grid
   * work, and a tile whose query the grid already ran is a cache hit rather than
   * a second request. It registers under its OWN owner, so closing the dialog
   * cannot abort the card's in-flight preview, whose default variant is the very
   * same query.
   */
  const runDialogQuery = (expr: string, card: MetricCard) => {
    const step = dialogStepFor(card);
    return queue.run(
      previewCacheKey(expr, step),
      PRIORITY.DIALOG,
      (signal) => streamQuery(expr, step, signal),
      DIALOG_OWNER,
    );
  };

  /** Dialog closed: its tiles are no longer worth finishing. */
  const cancelDialogQueries = (exprs: string[], card: MetricCard) => {
    const step = dialogStepFor(card);
    for (const expr of exprs) {
      queue.cancel(previewCacheKey(expr, step), DIALOG_OWNER);
    }
  };

  /* ------------------------------------------------------ label filtering */

  const labelNames = ref<string[]>([]);
  const labelNamesLoading = ref(false);

  /**
   * Bumped whenever the answer to "what labels exist?" changes underneath us —
   * an org switch, or a new window.
   *
   * The names are WINDOW-SCOPED: `labels` is asked over `start_time`/`end_time`,
   * so a label that only exists on a job that ran last week is absent from a
   * 15-minute window and present in a 30-day one — the picker must re-ask when
   * the window changes.
   *
   * A plain `labelNames.value = []` is not enough: a request already in flight
   * for the OLD window would land afterwards and repopulate the list with the
   * stale answer. The generation lets that late response identify itself as
   * obsolete and do nothing.
   */
  let labelNamesGeneration = 0;

  const loadLabelNames = async () => {
    if (labelNames.value.length || labelNamesLoading.value) return;
    const generation = labelNamesGeneration;
    labelNamesLoading.value = true;
    try {
      const { start_time, end_time } = timeRange.value;
      const DAY_US = 24 * 3600 * 1_000_000;
      // Walked only while the answer is empty; a rung that ERRORS is walked
      // past too. Always BOUNDED: an unbounded ask (`start=0` or an omitted
      // range) makes the backend scan the whole file list, which it rejects
      // as an invalid time range or 502s. Thirty days covers any realistic
      // index lag at a cost the backend actually serves.
      const windows = [
        { start_time, end_time },
        { start_time: Math.min(start_time, end_time - DAY_US), end_time },
        { start_time: Math.min(start_time, end_time - 30 * DAY_US), end_time },
      ];
      for (let attempt = 0; attempt < windows.length; attempt++) {
        let names: string[] = [];
        try {
          const response = await metricsService.labels({
            org_identifier: org.value,
            ...windows[attempt],
          });
          // Another org's labels, or another window's.
          if (generation !== labelNamesGeneration) return;
          // The endpoint returns every record field, which includes OpenObserve's
          // internal columns (`aggregation_temporality`, `_timestamp`, `value`, …).
          // Those are not labels and filtering on them is meaningless, so they are
          // kept out of the picker.
          names = (response?.data?.data ?? []).filter(
            (l: string) => l && !l.startsWith("__") && !INTERNAL_LABEL_FIELDS.has(l),
          );
        } catch {
          if (generation !== labelNamesGeneration) return;
        }
        if (names.length || attempt === windows.length - 1) {
          labelNames.value = names;
          return;
        }
      }
    } finally {
      if (generation === labelNamesGeneration) labelNamesLoading.value = false;
    }
  };

  /**
   * Suggested values per label, for the CURRENT org and window.
   *
   * Keyed by the label ALONE, and emptied whenever the org or the window changes.
   *
   * It used to key the org and the time range into the string and never drop
   * anything but on an org switch. That grew without bound — one permanent entry
   * per label per window, for the life of the page — and it grew for a cache that
   * could never serve those entries again: a stale window's key is a key nothing
   * will ask for. Bounding it by clearing is what makes the rest of the key
   * redundant, and dropping the key is what makes the bound impossible to forget.
   *
   * The values really are per-window: `job` has the values it had IN the window
   * that was queried, which is not what it had over the last 30 days.
   */
  const labelValueCache = new Map<string, string[]>();

  /**
   * Best-effort value suggestions.
   *
   * `label/{label}/values` returns nothing without a `match[]`, and accepts only
   * one selector per request — so this is a bounded fan-out over a deterministic
   * (alphabetical) sample of matching streams, unioned and capped. Failure is
   * fail-open: the chip stays usable as free text. Safety comes from the grid
   * narrowing above, not from these suggestions.
   */
  const loadLabelValues = async (label: string): Promise<string[]> => {
    const cached = labelValueCache.get(label);
    if (cached) return cached;

    await ensureSchemas();

    const matching = Object.entries(labelsByStream.value)
      .filter(([, labels]) => labels.includes(label))
      .map(([name]) => name)
      .sort()
      .slice(0, LABEL_VALUE_FANOUT);

    // The same widening ladder as the label names, for the same reason: the
    // label index lags ingestion, so a short recent window answers empty while
    // a wider ask over the same streams has the values. Without it, the empty
    // blink got CACHED and suppressed this label's suggestions all session.
    // Bounded like the names ladder — an unbounded ask makes the backend scan
    // the whole file list, which it rejects or 502s. A rung whose fan-out
    // fails is walked past (allSettled), same as an empty one.
    const { start_time, end_time } = timeRange.value;
    const DAY_US = 24 * 3600 * 1_000_000;
    const windows = [
      { start_time, end_time },
      { start_time: Math.min(start_time, end_time - DAY_US), end_time },
      { start_time: Math.min(start_time, end_time - 30 * DAY_US), end_time },
    ];

    let values: string[] = [];
    let anyFulfilled = false;
    for (let attempt = 0; attempt < windows.length; attempt++) {
      const win = windows[attempt];
      // The QUEUE's key, which is a different thing from the cache's. It
      // identifies an in-flight request, so it has to name the exact question
      // being asked — org, label, window, stream — or a request issued for one
      // window would be deduplicated against, and answered by, a request for
      // another.
      const requestKey = `${org.value}|${label}|${win.start_time}|${win.end_time}`;

      const responses = await Promise.allSettled(
        matching.map((stream) =>
          queue.run(
            `labelvalues:${requestKey}:${stream}`,
            PRIORITY.DIALOG,
            (signal) =>
              metricsService
                .labelValues({
                  org_identifier: org.value,
                  label,
                  match: stream,
                  start_time: win.start_time,
                  end_time: win.end_time,
                  signal,
                })
                .then((r: any) => r.data?.data ?? []),
            // These are label strings, not chart data. Letting them into the preview
            // LRU meant a 5-way fan-out per label evicted five cards' worth of query
            // results from a cache sized for charts — and they have their own cache
            // (`labelValueCache`) anyway. Use the queue for its concurrency limit and
            // cancellation, not for its cache.
            { cache: false },
          ),
        ),
      );

      const union = new Set<string>();
      anyFulfilled = false;
      for (const response of responses) {
        if (response.status !== "fulfilled") continue;
        anyFulfilled = true;
        for (const value of response.value as string[]) union.add(value);
      }
      values = [...union].sort().slice(0, LABEL_VALUE_CAP);

      if (values.length || matching.length === 0) break;
    }

    // Only cache an ANSWER. If every request failed, `values` is empty because we
    // learned nothing — not because the label has no values — and caching that
    // would suppress this label's suggestions for the rest of the session on the
    // strength of one transient error. A fan-out with nothing to ask (no matching
    // stream) is a real, cacheable "none".
    if (anyFulfilled || matching.length === 0) {
      labelValueCache.set(label, values);
    }
    return values;
  };

  /**
   * Several matchers on ONE label are allowed, because PromQL allows them and
   * they are how you say the useful things: `status=~"5.."` AND `status!="503"`,
   * or `pod=~"api-.*"` AND `pod!~".*-canary"`. Replacing on label — as this used
   * to — meant the second chip silently swallowed the first, and the grid then
   * filtered on something narrower than what the user could see on screen.
   *
   * Only an EXACT repeat is dropped: same label, same operator, same value. That
   * matcher is already in the selector, so adding it again would change nothing
   * but the chip count.
   */
  const addLabelFilter = async (filter: LabelFilter) => {
    await ensureSchemas();

    // Already applied: leave the bar exactly as it is. Removing and re-appending
    // would shuffle the chip to the far right and slide the others along, for a
    // click that changed nothing.
    const key = labelFilterKey(filter);
    if (labelFilters.value.some((f) => labelFilterKey(f) === key)) return;

    labelFilters.value = [...labelFilters.value, filter];
    invalidateAll();
  };

  /** By identity, not by label — several filters can share a label. */
  const removeLabelFilter = (filter: LabelFilter) => {
    const key = labelFilterKey(filter);
    labelFilters.value = labelFilters.value.filter((f) => labelFilterKey(f) !== key);
    invalidateAll();
  };

  /* ------------------------------------------------------------- lifecycle */

  /**
   * @param keepPreviews retain the rendered charts while the new ones load.
   *
   * A refresh advances the window by a few seconds and re-runs the same charts,
   * so blanking them to skeletons every tick would make a chart you are reading
   * flicker. In-flight requests are still cancelled — they are for the previous
   * window — but `requestPreview` holds the old series until the new one lands.
   * A deliberate time-range *change* is different: that really is different
   * data, so it wipes.
   */
  /* ------------------------------------------------------- the slice sweep */

  /**
   * Cards we asked for that the user never scrolled to. Kept so a slice change
   * can cancel the ones that are no longer reachable.
   */
  const prefetching = new Map<string, MetricCard>();
  let sweepTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Resolve emptiness for the WHOLE page slice, not just the cards that happen
   * to be on screen.
   *
   * Hiding no-data cards is a POST-query filter: a card is only known empty once
   * something has queried it. But the only thing that queried a card was its own
   * IntersectionObserver — so a card that had never been scrolled to was, by
   * definition, "not known empty", which renders as SHOWN. Both halves of the
   * bug came from that:
   *
   *   - On a fresh load nothing is known empty, so the full slice renders and the
   *     no-data cards blink out one at a time as the user scrolls past them.
   *   - A manual refresh used to CLEAR the set outright (`forgetEmptiness`), on
   *     the theory that a metric which has started emitting must be able to come
   *     back. It could only come back by being un-hidden first, so every no-data
   *     card in the slice jumped back into the grid — and only the ones that
   *     landed on screen re-queried and re-hid. The rest just sat there. "Hide
   *     no-data panels" visibly stopped hiding no-data panels.
   *
   * So the sweep asks on the card's behalf. A hidden empty card is re-queried
   * WITHOUT being un-hidden, and `markEmptiness` lets it back into the grid only
   * if it now has samples — which is the outcome `forgetEmptiness` was reaching
   * for, minus the flash.
   *
   * Bounded by construction: the slice IS the page's query budget (at most
   * `pageSize` cards), which is the same bound the comment on `sortedCandidates`
   * already promises. It runs at PREFETCH priority, so the cards the user is
   * actually looking at still queue ahead of it.
   *
   * Only while the filter is ON. With it off, emptiness changes nothing about
   * what is displayed, so there is no reason to pay for the answer — the lazy
   * per-card load is right there.
   *
   * @param skipCache a MANUAL refresh: re-ask even for cards already known
   *   empty. An auto-refresh tick passes nothing, so it re-queries only what is
   *   still unresolved; making every tick re-run the whole slice would triple
   *   its cost to tell the user something that almost never changes.
   */
  const sweepSlice = (opts?: { skipCache?: boolean }) => {
    if (!hideEmptyPanels.value) return;

    const slice = pageSlice.value;
    const inSlice = new Set(slice.map((card) => card.name));

    // Anything that fell out of the slice cannot be rendered — `pagedCards` is a
    // subset of it — so a request still in flight for it is work nobody will
    // ever see. A user typing in the search box re-slices on every keystroke.
    for (const [name, card] of prefetching) {
      if (!inSlice.has(name)) {
        cancelPreview(card);
        prefetching.delete(name);
      }
    }

    for (const card of slice) {
      const resolved = !!previews.value[card.name];
      const recheck = !!opts?.skipCache && emptyMetrics.value.has(card.name);
      if (resolved && !recheck) continue;

      prefetching.set(card.name, card);
      void requestPreview(card, {
        skipCache: opts?.skipCache,
        priority: PRIORITY.PREFETCH,
      }).finally(() => {
        // Settled: there is nothing left to cancel.
        prefetching.delete(card.name);
      });
    }
  };

  /**
   * The slice moved. Debounced because it moves on every keystroke of a search,
   * and each one would otherwise fire — then immediately cancel — a slice's worth
   * of queries.
   *
   * Skipped entirely while `paused` — the grid is not on screen (the page is in
   * Visualize), so there is nothing to sweep FOR. Without this, merely switching
   * away re-computes the slice (the pinned-only narrowing flips, filters are
   * re-applied) and the grid answers by re-querying every card — ~40 requests for
   * a view the user just left.
   */
  watch([pageSlice, hideEmptyPanels], () => {
    if (paused.value) return;
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      if (paused.value) return;
      sweepSlice();
    }, SWEEP_DEBOUNCE_MS);
  });

  onScopeDispose(() => {
    if (sweepTimer) clearTimeout(sweepTimer);
  });

  const setTimeRange = (
    range: { start_time: number; end_time: number },
    opts?: { keepPreviews?: boolean },
  ) => {
    timeRange.value = range;
    queue.cancelAll();
    if (opts?.keepPreviews) return;

    previewsEpoch++;
    previews.value = {};
    previewOrder = [];
    // Emptiness is a property of the WINDOW, not of the metric, and this set is
    // self-sealing: a card in it is filtered out of the grid, so it never
    // renders, never re-queries, and can never clear itself. Carried across a
    // range change, a metric with no samples in the last 15 minutes stayed
    // hidden after the user widened the window to 30 days — which is the whole
    // reason anyone widens a window. So a new window starts with nothing known
    // to be empty, and the cards prove it again as they render.
    //
    // Only on a real range CHANGE. A refresh (`keepPreviews`) re-runs the same
    // window, so its answers still hold; clearing there would un-hide every
    // no-data card on each auto-refresh tick just to re-hide it a moment later.
    emptyMetrics.value = new Set();

    // Label VALUES are a property of the window too — `job` has the values it had
    // in the last 15 minutes, which is not what it had over 30 days. Their cache
    // keys the window in, so leaving them behind both serves the wrong window's
    // suggestions back (never, since the key misses) and grows the map forever
    // (always, since nothing else drops them).
    labelValueCache.clear();

    // And so are the label NAMES, for the same reason: the endpoint is asked over
    // the window. Dropping the values but keeping the names left the picker
    // offering the first window's labels for the life of the page.
    labelNamesGeneration++;
    labelNames.value = [];
    labelNamesLoading.value = false;
  };

  const setRefreshInterval = (seconds: number) => {
    refreshIntervalSec.value = seconds;
    queue.setTtl(seconds > 0 ? seconds * 1000 : 60_000);
  };

  const onOrgChange = () => {
    // Anything already in flight belongs to the previous org. Bumping this makes
    // every one of those responses land on the floor instead of in this org.
    orgGeneration++;
    previewsEpoch++;
    queue.cancelAll();
    queue.clearCache();
    previews.value = {};
    // The eviction order for `previews`, and just as org-specific. Left behind,
    // it holds the previous org's metric names and the 300-entry cap stops
    // meaning what it says.
    previewOrder = [];
    emptyMetrics.value = new Set();
    pageSize.value = INITIAL_PAGE_SIZE;
    schemaLoaded.value = false;
    // The in-flight guards, not just the loaded flags.
    //
    // `ensureSchemas` early-returns while `schemaLoading` is true, and its `finally`
    // only clears the flag when the generation still matches — which, after this
    // bump, it never will. So a request in flight across an org switch would strand
    // the flag at `true` and every future call would return early: label membership
    // would never load again for the life of the page, and the filters would fail
    // open forever. The generation check in the `finally` stays (it stops a stale
    // run from clearing a FRESH run's flag); clearing them here is what makes the
    // new org able to start at all.
    schemaLoading.value = false;
    // The memoized in-flight load belongs to the previous org: a caller who
    // awaited it would read the old org's (empty, generation-dropped) map and
    // cache wrong answers for the new org. Dropping the memo makes the next
    // ensureSchemas start a fresh load for THIS org.
    schemaInFlight = null;
    labelNamesLoading.value = false;
    labelNamesGeneration++;
    labelsByStream.value = {};
    labelNames.value = [];
    labelValueCache.clear();
    clearFilters();
  };

  return {
    // data
    loading,
    loadError,
    cards,
    sortedCards,
    filteredCards,
    pagedCards,
    /** The page's query budget — exposed so the cap can be asserted directly. */
    pageSlice,
    hasMore,
    remainingCount,
    showMore,
    showingMore,
    pageSize,
    previews,
    streamNameSet,

    // filter state
    searchTerm,
    selectedPrefixes,
    selectedSuffixes,
    selectedTypes,
    labelFilters,
    sortBy,
    viewMode,
    activeRail,
    showFavoritesOnly,
    paused,
    hideEmptyPanels,
    emptyHiddenCount,
    activeFilterCount,
    clearFilters,

    // facets
    prefixFacets,
    suffixFacets,
    typeFacets,

    // label filtering
    labelNames,
    labelNamesLoading,
    schemaLoading,
    schemaLoaded,
    loadLabelNames,
    loadLabelValues,
    addLabelFilter,
    removeLabelFilter,
    ensureSchemas,

    // local state
    overrides,
    favorites,
    setOverride,
    toggleFavorite,

    // previews
    requestPreview,
    refreshCard,
    cancelPreview,
    invalidateAll,
    clearPreviewCache,
    effectiveVariant,
    runDialogQuery,
    cancelDialogQueries,

    // lifecycle
    loadStreams,
    sweepSlice,
    setTimeRange,
    setRefreshInterval,
    onOrgChange,
    timeRange,
    rangeSeconds,
  };
}

export default useMetricsExplorerGrid;
