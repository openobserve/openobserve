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

import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { reactive, computed, ref } from "vue";
import {
  getMetricsConfig,
  encodeMetricsConfig,
  decodeMetricsConfig,
} from "@/composables/metrics/metricsUrlState";

/**
 * These test the EXPLORER'S WIRING, not the grid's logic.
 *
 * Both bugs here were invisible to the composable's own tests: the grid did exactly
 * what it was told, and MetricsExplorer simply never told it. That seam had no spec
 * at all, which is why the two lived.
 */
const grid = vi.hoisted(() => {
  const g: any = {
    cards: { value: [] },
    sortedCards: { value: [] },
    pagedCards: { value: [] },
    pageSlice: { value: [] },
    previews: { value: {} },
    hasMore: { value: false },
    remainingCount: { value: 0 },
    loading: { value: false },
    loadError: { value: "" },
    searchTerm: { value: "" },
    selectedPrefixes: { value: new Set() },
    selectedSuffixes: { value: new Set() },
    selectedTypes: { value: new Set() },
    labelFilters: { value: [] },
    sortBy: { value: "a-z" },
    viewMode: { value: "grid" },
    activeRail: { value: "prefix" },
    showFavoritesOnly: { value: false },
    paused: { value: false },
    hideEmptyPanels: { value: true },
    emptyHiddenCount: { value: 0 },
    activeFilterCount: { value: 0 },
    prefixFacets: { value: [] },
    suffixFacets: { value: [] },
    typeFacets: { value: [] },
    labelNames: { value: [] },
    labelNamesLoading: { value: false },
    schemaLoading: { value: false },
    schemaLoaded: { value: false },
    overrides: { value: {} },
    favorites: { value: [] },
    timeRange: { value: { start_time: 0, end_time: 1 } },
    rangeSeconds: { value: 900 },
    clearFilters: vi.fn(),
    loadLabelNames: vi.fn(),
    loadLabelValues: vi.fn(),
    addLabelFilter: vi.fn(async () => {}),
    removeLabelFilter: vi.fn(),
    ensureSchemas: vi.fn(),
    setOverride: vi.fn(),
    toggleFavorite: vi.fn(),
    exemplarEligible: vi.fn(() => false),
    exemplarsEnabled: vi.fn(() => false),
    exemplarSwapsVariant: vi.fn(() => false),
    exemplarStateOf: vi.fn(() => undefined),
    toggleExemplars: vi.fn(),
    retryExemplars: vi.fn(),
    ensureExemplars: vi.fn(),
    requestPreview: vi.fn(async () => {}),
    refreshCard: vi.fn(),
    cancelPreview: vi.fn(),
    invalidateAll: vi.fn(),
    clearPreviewCache: vi.fn(),
    sweepSlice: vi.fn().mockResolvedValue(undefined),
    effectiveVariant: vi.fn(() => ({ defaults: { variants: [] }, resolved: { queries: [] } })),
    runDialogQuery: vi.fn(),
    cancelDialogQueries: vi.fn(),
    runDetailQuery: vi.fn(),
    detailStepFor: vi.fn(() => 30),
    rateWindowFor: vi.fn(() => "4m"),
    labelsByStream: { value: {} },
    prefixAssignment: { value: { groupOf: new Map() } },
    prefixOf: vi.fn(() => "misc"),
    familyOf: vi.fn((name: string) => name),
    loadStreams: vi.fn(async () => {}),
    isLabelEligible: vi.fn(() => true),
    inapplicableLabelFilters: vi.fn(() => []),
    setTimeRange: vi.fn(),
    setRefreshInterval: vi.fn(),
    onOrgChange: vi.fn(),
    showMore: vi.fn(),
  };
  return g;
});

vi.mock("@/composables/metrics/useMetricsExplorerGrid", async (importOriginal) => ({
  // The real helpers (`hasSamples`) for the detail view's charts; only the grid is faked.
  ...(await importOriginal<any>()),
  default: () => grid,
  INITIAL_PAGE_SIZE: 8,
  PAGE_SIZE_INCREMENT: 6,
}));

// Keep the real vuex (src/stores/index.ts calls createStore at import time);
// override only the hook the component uses.
vi.mock("vuex", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useStore: () => ({
    state: { selectedOrganization: { identifier: "org1" }, theme: "light" },
  }),
}));
// Controllable route/router so the URL-state tests can seed `route.query` before
// mount (hydration) and inspect `router.replace` (sync). `name` must be "metrics"
// or syncVisualizeUrl and the route.query watcher short-circuit.
// Both verbs resolve a promise, as the real router does — syncUrlState chains
// `.catch()` on whichever it picks.
const routerState = vi.hoisted(() => ({
  replace: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  query: {} as Record<string, any>,
}));
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerState.push, replace: routerState.replace }),
  useRoute: () => ({
    get query() {
      return routerState.query;
    },
    name: "metrics",
    fullPath: "/metrics",
  }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: () =>
    computed(() => ({
      getTotalSize: () => 0,
      getVirtualItems: () => [],
    })),
}));

// Captures the registered handlers so a test can fire a shortcut directly.
const shortcuts = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }));
vi.mock("@/lib/vue-shortcut-manager", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  useShortcuts: (list: Array<{ id: string; handler: () => void }>) =>
    list.forEach((s) => (shortcuts.handlers[s.id] = s.handler)),
}));

import MetricsExplorer from "./MetricsExplorer.vue";
import analytics from "@/services/product_analytics";
import { isCancelled } from "@/composables/metrics/useMetricsPreviewQueue";
import { cardColorForIndex } from "@/utils/metrics/metricPalette";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";

const CARD = { name: "http_requests_total", unsupported: false, cardKind: "counterRate" };

/** The Visualize pane's runQuery — the toolbar refresh must drive this in
 *  visualize mode instead of sweeping the Explore grid. */
const visualizeRunQuery = vi.fn();
/** The pane's explicit-run (records history) and live-apply entry points. */
const visualizeOnUserRun = vi.fn();
const visualizeApplyPanelData = vi.fn();

/** The panel state the stubbed Visualize pane exposes to its parent — the parent
 *  reads it to build the `metrics_data` blob. Set per test before entering
 *  Visualize; null/query-less means "blank canvas, nothing to share". */
let visualizePanel: any = null;

const mountExplorer = (stubOverrides: Record<string, any> = {}) =>
  mount(MetricsExplorer, {
    global: {
      stubs: {
        OPageHeader: true,
        DateTimePickerDashboard: true,
        AutoRefreshInterval: true,
        MetricCard: true,
        PrefixFilterPanel: true,
        LabelFilterBar: true,
        FunctionConfigDialog: true,
        MetricDetailView: true,
        OButton: true,
        OIcon: true,
        OCheckbox: true,
        // Renders its icon-right slot: the no-data scope toggle lives INSIDE the
        // search field (as the dashboard list's folder scope does), so a stub that
        // drops slots hides the control under test entirely.
        OSearchInput: {
          template: '<div><slot name="icon-right" /></div>',
        },
        OSpinner: true,
        OTooltip: true,
        // Rendered rather than stubbed away: a toggle group's CHILDREN are the
        // options, and `stubs: true` drops the default slot — so a group with no
        // items at all, or with the wrong ones, looked identical to a correct one.
        // The facet segmented control AND its items are the control under test
        // (Prefix/Suffix/Type + the sort/view/scope toggles) — a `stubs: true`
        // would drop the item children and the group would look empty regardless
        // of correctness. Render-through so the items' data-test attrs exist.
        OToggleGroup: {
          template: "<div><slot /></div>",
        },
        OToggleGroupItem: {
          template: '<button type="button"><slot /></button>',
        },
        OTag: {
          template: "<span><slot /></span>",
        },
        // Pulls in the dashboard PanelEditor (ECharts + useDashboardPanelData),
        // which needs far more context than this wiring test provides. The
        // explorer test only cares that it renders in visualize mode; its own
        // behaviour is covered by MetricsVisualize.spec. Keep the data-test so the
        // mode-switch assertions still find it.
        MetricsVisualize: {
          // Exposes runQuery + dashboardPanelData like the real pane — the toolbar
          // refresh drives runQuery, and the parent reads dashboardPanelData to
          // encode the shareable blob.
          setup: () => ({
            runQuery: visualizeRunQuery,
            onUserRun: visualizeOnUserRun,
            applyPanelData: visualizeApplyPanelData,
            dashboardPanelData: visualizePanel,
          }),
          emits: ["run"],
          template: '<div data-test="metrics-explorer-visualize">visualize</div>',
        },
        ExplorerSavedViews: {
          props: ["state", "activeViewId"],
          emits: ["apply", "saved", "clear", "update:activeViewId"],
          template: '<div data-test="metrics-explorer-views" />',
        },
        QueryHistoryDrawer: {
          emits: ["load"],
          template: '<div data-test="metrics-history" />',
        },
        ...stubOverrides,
      },
    },
  });

describe("MetricsExplorer wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grid.pagedCards.value = [CARD];
    routerState.query = {};
    visualizePanel = null;
  });

  describe("a label filter must not leave the visible cards on skeletons", () => {
    /**
     * Adding a filter invalidates every preview (the query text changes), and the
     * IntersectionObserver only fires when a card CROSSES the viewport edge. So the
     * cards already on screen have nothing to re-trigger them: they sat on their
     * skeletons until the user scrolled. The rule is written above `onScreen` in the
     * component — and this path was the one quietly breaking it.
     */
    it("re-requests the on-screen cards after ADDING a filter", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).onCardVisible(CARD); // the observer fires on mount
      grid.requestPreview.mockClear();

      await (wrapper.vm as any).onAddLabelFilter({ label: "pod", value: "a" });
      await flushPromises();

      expect(grid.addLabelFilter).toHaveBeenCalled();
      expect(grid.requestPreview).toHaveBeenCalledWith(CARD, { skipCache: true });
    });

    it("re-requests the on-screen cards after REMOVING a filter", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).onCardVisible(CARD);
      grid.requestPreview.mockClear();

      await (wrapper.vm as any).onRemoveLabelFilter({ label: "pod", value: "a" });
      await flushPromises();

      expect(grid.removeLabelFilter).toHaveBeenCalled();
      expect(grid.requestPreview).toHaveBeenCalledWith(CARD, { skipCache: true });
    });
  });

  describe("sort", () => {
    it("offers A–Z and Z–A, and no longer offers Recent", async () => {
      // "Recent" ranked by what you had opened — a handful of metrics out of
      // thousands — so it mostly reordered nothing while making the sort a
      // three-way choice to say so.
      const wrapper = mountExplorer();

      expect(wrapper.find('[data-test="metrics-explorer-sort-a-z"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-sort-z-a"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-sort-recent"]').exists()).toBe(false);
    });
  });

  describe("the no-data filter is a segmented choice, not a checkbox", () => {
    it("shows BOTH options, so the way out of an empty grid is on screen", async () => {
      // A checkbox states one option and leaves the other implicit. The implicit
      // one is exactly what a user needs when the filter has hidden everything.
      const wrapper = mountExplorer();

      expect(wrapper.find('[data-test="metrics-explorer-hide-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-show-all"]').exists()).toBe(true);
    });

    it("maps 'All' to showing no-data panels and 'With data' to hiding them", async () => {
      const wrapper = mountExplorer();

      (wrapper.vm as any).onDataScope("all");
      expect(grid.hideEmptyPanels.value).toBe(false);

      (wrapper.vm as any).onDataScope("with-data");
      expect(grid.hideEmptyPanels.value).toBe(true);
    });

    it("keeps the current choice when the active option is clicked again", async () => {
      // OToggleGroup emits `undefined` on a re-click — it models a deselect. There
      // is no third state here: the list is either filtered to what has data or it
      // is not, and a click that turns BOTH options off would strand the user.
      const wrapper = mountExplorer();
      grid.hideEmptyPanels.value = true;

      (wrapper.vm as any).onDataScope(undefined);

      expect(grid.hideEmptyPanels.value).toBe(true);
    });
  });

  describe("the toolbar refresh control", () => {
    it("is a labeled 'Refresh' button, not an icon-only control", () => {
      // Icon-only refresh was easy to miss next to the date picker; the control
      // now carries its label like the other toolbar actions.
      const wrapper = mountExplorer({
        OButton: {
          template: '<button v-bind="$attrs"><slot /></button>',
        },
      });

      const btn = wrapper.find('[data-test="metrics-explorer-refresh"]');
      expect(btn.exists()).toBe(true);
      // t() is mocked to echo the key — the label must come from i18n.
      expect(btn.text()).toContain("metrics.explorer.refresh");
      expect(btn.attributes("size")).toBe("sm-toolbar");
      // Same treatment as the logs/traces Run Query button.
      expect(btn.attributes("variant")).toBe("primary");
    });
  });

  describe("refresh and the no-data set", () => {
    it("a MANUAL refresh re-asks the hidden no-data metrics, WITHOUT un-hiding them", async () => {
      // Hidden => not rendered => not queried => still hidden. A metric that has
      // started emitting can only come back if something asks again, and
      // "refresh" is the user asking to look again.
      //
      // It used to ask by CLEARING the set — which un-hid every no-data card in
      // the slice, then re-hid only the ones that happened to land on screen and
      // re-query. With the filter on, refresh visibly filled the grid with the
      // panels the filter exists to remove. The sweep re-queries them where they
      // are; `markEmptiness` lets one back in only once it has samples.
      const wrapper = mountExplorer();

      await (wrapper.vm as any).onRefresh();
      await flushPromises();

      expect(grid.sweepSlice).toHaveBeenCalledWith({ skipCache: true });
    });

    it("an AUTO-refresh tick sweeps, but does not re-ask what is already known empty", async () => {
      // It still picks up cards the user has not reached yet. Re-running the
      // known-empty ones on every tick would triple a tick's cost to report a
      // result that almost never changes.
      const wrapper = mountExplorer();

      await (wrapper.vm as any).onRefreshTick();
      await flushPromises();

      expect(grid.sweepSlice).toHaveBeenCalledWith({ skipCache: false });
    });

    /// The route remounts on every visit, so a force here is one request per visit for nothing.
    it("reads the stream list from the cache on mount, leaving the force to Refresh", async () => {
      mountExplorer();
      await flushPromises();

      expect(grid.loadStreams).toHaveBeenCalledTimes(1);
      expect(grid.loadStreams).not.toHaveBeenCalledWith(true);
    });

    it("a MANUAL refresh keeps the grid mounted while the stream list reloads", async () => {
      const wrapper = mountExplorer();
      let spinnerDuringReload: boolean | undefined;
      grid.loadStreams.mockImplementationOnce(async () => {
        grid.loading.value = true;
        spinnerDuringReload = (wrapper.vm as any).showLoading;
        grid.loading.value = false;
      });

      await (wrapper.vm as any).onRefresh();
      await flushPromises();

      expect(grid.loadStreams).toHaveBeenCalledWith(true);
      expect(spinnerDuringReload).toBe(false);
    });

    it("still shows the loading spinner for a load that is not a refresh", () => {
      grid.loading.value = true;
      const wrapper = mountExplorer();

      expect((wrapper.vm as any).showLoading).toBe(true);
      grid.loading.value = false;
    });

    it("a MANUAL refresh re-queries the on-screen cards with the cards the reload rebuilt", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).onCardVisible(CARD);
      const rebuilt = { ...CARD, help: "from the reloaded stream list" };
      grid.loadStreams.mockImplementationOnce(async () => {
        // In place: the mock is not reactive, so the explorer's `visibleCards` computed keeps this array.
        grid.pagedCards.value.splice(0, 1, rebuilt);
      });
      grid.requestPreview.mockClear();

      await (wrapper.vm as any).onRefresh();
      await flushPromises();

      expect(grid.requestPreview).toHaveBeenCalledWith(rebuilt, { skipCache: true });
    });
  });

  describe("the facet selector lives on the search row, over an always-open panel", () => {
    it("renders Prefix/Suffix/Type as a segmented toggle on the search row", () => {
      // The facet selector moved out of the left column onto the search row (it
      // scopes which metrics you are searching). The left column is now just the
      // panel body for whichever facet is selected.
      const wrapper = mountExplorer();

      expect(wrapper.find('[data-test="metrics-explorer-rail-prefix"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-rail-suffix"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-rail-type"]').exists()).toBe(true);
    });

    it("does not show the old Saved Views dialog on Explore (it moved to Workspace)", () => {
      // The mystery dialog is gone: saved views now live in the Workspace rail.
      const wrapper = mountExplorer();
      expect(wrapper.find('[data-test="metrics-saved-views"]').exists()).toBe(false);
      // The Workspace rail is not shown in Explore mode either.
      expect(wrapper.find('[data-test="metrics-workspace-rail"]').exists()).toBe(false);
    });
  });

  describe("Convert to dashboard", () => {
    it("builds one panel per pinned metric and opens the dialog", () => {
      // Each pinned metric becomes its own panel, built from the card's type-based
      // variant (effectiveVariant + buildPanelDataForCard, as the drill-in does).
      const wrapper = mountExplorer();
      grid.cards.value = [
        { name: "http_requests_total", unsupported: false, cardKind: "counterRate" },
        { name: "node_memory", unsupported: false, cardKind: "gauge" },
      ];
      // Convert acts on the scratchpad's pinned metrics.
      grid.favorites.value = ["http_requests_total", "node_memory"];

      (wrapper.vm as any).openConvertToDashboard();

      expect(grid.effectiveVariant).toHaveBeenCalledTimes(2);
      expect((wrapper.vm as any).convertPanels).toHaveLength(2);
      expect((wrapper.vm as any).convertPanels[0].title).toBe("http_requests_total");
      expect((wrapper.vm as any).convertDialogOpen).toBe(true);
    });

    it("does nothing when nothing is pinned", () => {
      const wrapper = mountExplorer();
      grid.favorites.value = [];
      (wrapper.vm as any).openConvertToDashboard();
      expect((wrapper.vm as any).convertDialogOpen).toBe(false);
    });

    it("shows the active facet panel without a click — the panel is always open", () => {
      // Regression guard for the redesign: the panel used to be gated behind
      // clicking a rail icon (showRailPanel = !!activeRail). Now prefix is the
      // default and the panel is on screen at mount.
      const wrapper = mountExplorer();

      expect(wrapper.findComponent({ name: "PrefixFilterPanel" }).exists()).toBe(true);
    });

    it("selecting a facet switches it — and a re-click deselect never collapses the panel", async () => {
      const wrapper = mountExplorer();

      (wrapper.vm as any).selectRail("type");
      expect(grid.activeRail.value).toBe("type");

      // OToggleGroup emits `undefined` when the active item is clicked again
      // (a deselect). selectRail must IGNORE it so the panel never blanks.
      (wrapper.vm as any).selectRail(undefined);
      expect(grid.activeRail.value).toBe("type");
    });
  });

  describe("Explore / Visualize mode toggle", () => {
    it("defaults to Explore — the browse grid, not the Visualize pane", () => {
      const wrapper = mountExplorer();
      expect((wrapper.vm as any).isExplore).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-mode-explore"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-mode-visualize"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-visualize"]').exists()).toBe(false);
    });

    it("switches the body to the Visualize pane when the mode flips", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).mode).toBe("visualize");
      expect(wrapper.find('[data-test="metrics-explorer-visualize"]').exists()).toBe(true);
    });

    it("ignores the OToggleGroup deselect so mode never goes blank", () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("visualize");
      (wrapper.vm as any).setMode(undefined);
      expect((wrapper.vm as any).mode).toBe("visualize");
    });

    it("Workspace (the Scratchpad) shares the grid body, not the Visualize pane", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("workspace");
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).isGridMode).toBe(true); // shares the grid body
      expect((wrapper.vm as any).isWorkspace).toBe(true);
      expect(wrapper.find('[data-test="metrics-explorer-visualize"]').exists()).toBe(false);
    });

    it("Workspace shows only pinned metrics (the scratchpad); Explore browses all", async () => {
      // Workspace = the Scratchpad = your pinned set. It drives the pinned-only
      // narrowing; switching back to Explore restores browse-all.
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("workspace");
      await wrapper.vm.$nextTick();
      expect(grid.showFavoritesOnly.value).toBe(true);

      (wrapper.vm as any).setMode("explore");
      await wrapper.vm.$nextTick();
      expect(grid.showFavoritesOnly.value).toBe(false);
    });

    it("refresh in Visualize fires ONE chart query — no grid sweep, no card re-queries", async () => {
      // Regression: refresh in Visualize used to call the DateTimePicker's
      // refresh(), which RE-EMITS a date-change; onDateChange answered it by
      // re-querying every on-screen card — ~50 requests for a single chart.
      const wrapper = mountExplorer();
      (wrapper.vm as any).onCardVisible(CARD); // a card is on screen
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      grid.sweepSlice.mockClear();
      grid.requestPreview.mockClear();
      grid.clearPreviewCache.mockClear();
      visualizeRunQuery.mockClear();

      await (wrapper.vm as any).onRefresh();

      // Exactly one chart re-run…
      expect(visualizeRunQuery).toHaveBeenCalledTimes(1);
      // …and the grid is left completely alone.
      expect(grid.sweepSlice).not.toHaveBeenCalled();
      expect(grid.requestPreview).not.toHaveBeenCalled();
      expect(grid.clearPreviewCache).not.toHaveBeenCalled();
    });

    it("the auto-refresh tick also leaves the grid alone in Visualize", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).onCardVisible(CARD);
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      grid.sweepSlice.mockClear();
      grid.requestPreview.mockClear();

      await (wrapper.vm as any).onRefreshTick();

      expect(grid.sweepSlice).not.toHaveBeenCalled();
      expect(grid.requestPreview).not.toHaveBeenCalled();
    });

    it("pauses the grid while off screen (Visualize) so it cannot re-query", async () => {
      // The grid sweeps its slice whenever the slice changes; switching modes
      // changes it (the pinned-only narrowing flips). Unpaused, that swept ~40
      // card queries for a grid the user had just left.
      const wrapper = mountExplorer();
      expect(grid.paused.value).toBe(false); // explore: live

      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect(grid.paused.value).toBe(true); // off screen: paused

      (wrapper.vm as any).setMode("workspace");
      await wrapper.vm.$nextTick();
      expect(grid.paused.value).toBe(false); // workspace shows the grid again
    });

    it("card 'Open' opens in-page Visualize, seeded with the card's type-based query", () => {
      // Open no longer navigates to the separate metrics editor route: it seeds
      // Visualize with the card's own panel data (effectiveVariant +
      // buildPanelDataForCard) so the type-based operation carries over.
      const wrapper = mountExplorer();
      expect((wrapper.vm as any).mode).toBe("explore");

      (wrapper.vm as any).onSelect(CARD);

      expect(grid.effectiveVariant).toHaveBeenCalled();
      // The default handoff: `$__rate_interval`, for the editor to re-derive
      // against its own range and width.
      expect(grid.effectiveVariant).toHaveBeenCalledWith(
        CARD,
        undefined,
        expect.objectContaining({ rateWindow: "$__rate_interval" }),
      );
      expect((wrapper.vm as any).mode).toBe("visualize");
      expect((wrapper.vm as any).visualizeSeed).toBeTruthy();
    });

    it("a card that charted through a WIDENED window hands the editor that window", () => {
      // The editor resolves `$__rate_interval` from the org's scrape interval —
      // the very value whose overstatement forced the card to widen — so the
      // variable would resolve straight back to the window that returned
      // nothing, and the drill-in would open on an empty chart of a metric the
      // card is visibly charting.
      grid.previews.value[CARD.name] = { widenedRateWindow: "4m" };
      const wrapper = mountExplorer();

      (wrapper.vm as any).onSelect(CARD);

      expect(grid.effectiveVariant).toHaveBeenCalledWith(
        CARD,
        undefined,
        expect.objectContaining({ rateWindow: "4m" }),
      );
      expect((wrapper.vm as any).mode).toBe("visualize");
      delete grid.previews.value[CARD.name];
    });
  });

  describe("the type facet uses OCheckboxGroup over a Set<->array boundary", () => {
    it("exposes selectedTypes as an array for the group, and writes back a Set", () => {
      // The composable keeps selectedTypes as a Set (URL state + filtering depend
      // on it); OCheckboxGroup speaks arrays. The two adapters must round-trip.
      grid.selectedTypes.value = new Set(["counter", "gauge"]);
      const wrapper = mountExplorer();

      // Set -> array, for the group's model-value.
      expect((wrapper.vm as any).selectedTypesArray).toEqual(["counter", "gauge"]);

      // array -> Set, on the group's update. A NEW Set (not a mutation) so the
      // composable's watchers fire.
      (wrapper.vm as any).onSelectedTypesChange(["histogram"]);
      expect(grid.selectedTypes.value).toBeInstanceOf(Set);
      expect([...grid.selectedTypes.value]).toEqual(["histogram"]);
    });
  });

  /**
   * The filter row.
   *
   * Filters are the one control whose width is unbounded, so they get their own
   * line rather than competing with the fixed-width mode toggle and time
   * cluster. These pin the two decisions that make the row safe to live with —
   * without them, moving the bar back into the toolbar passes silently.
   */
  describe("the filter control owns a row of its own", () => {
    const filterRow = (w: any) => w.find('[data-test="metrics-explorer-filter-row"]');
    const toolbar = (w: any) => w.find('[data-test="metrics-explorer-filter-bar"]');

    it("renders the filter bar in the filter row, NOT in the toolbar", () => {
      const wrapper = mountExplorer();

      expect(filterRow(wrapper).exists()).toBe(true);
      expect(filterRow(wrapper).findComponent({ name: "LabelFilterBar" }).exists()).toBe(true);
      // The toolbar keeps only the mode toggle + time cluster.
      expect(toolbar(wrapper).findComponent({ name: "LabelFilterBar" }).exists()).toBe(false);
    });

    it("keeps the row present with ZERO filters, so adding one cannot shift the grid", async () => {
      grid.labelFilters.value = [];
      const wrapper = mountExplorer();
      expect(filterRow(wrapper).exists()).toBe(true);

      // The row must not be conditional on having filters — a row that appears
      // with the first filter pushes the grid down as the user reads it.
      grid.labelFilters.value = [{ label: "pod", operator: "=", value: "api-1" }];
      await flushPromises();
      expect(filterRow(wrapper).exists()).toBe(true);
    });

    it("is hidden in Visualize, where the PromQL query carries its own matchers", async () => {
      const wrapper = mountExplorer();
      expect(filterRow(wrapper).exists()).toBe(true);

      (wrapper.vm as any).setMode("visualize");
      await flushPromises();

      // Two ways to say the same thing would conflict; Logs' visualize splits
      // the same way.
      expect(filterRow(wrapper).exists()).toBe(false);
    });
  });

  /**
   * Drag-to-zoom on a card.
   *
   * The gesture was already live — the converter builds the dataZoom toolbox and
   * ChartRenderer arms the drag cursor — but nothing listened, so a drag zoomed
   * and then silently restored. These pin the wiring that makes it do something.
   */
  describe("a drag-select on a card's chart re-ranges the grid", () => {
    const zoomOn = (wrapper: any, event: any) => {
      (wrapper.vm as any).onCardZoom(event);
      return (wrapper.vm as any).dateTimePickerRef;
    };

    it("drives the PICKER (absolute), so the toolbar shows the window being viewed", () => {
      const wrapper = mountExplorer();
      const setCustomDate = vi.fn();
      (wrapper.vm as any).dateTimePickerRef = { setCustomDate };

      const start = new Date("2026-07-16T10:00:00.000Z").getTime();
      const end = new Date("2026-07-16T10:30:00.000Z").getTime();
      zoomOn(wrapper, { start, end });

      // Not grid.setTimeRange: going through the picker is what keeps the
      // toolbar honest (it must not still say "Past 15 Minutes") and what makes
      // the zoom undoable — and its @on:date-change runs the skipCache + sweep.
      expect(setCustomDate).toHaveBeenCalledTimes(1);
      const [type, range] = setCustomDate.mock.calls[0];
      expect(type).toBe("absolute");
      expect(range.start.getTime()).toBe(start);
      expect(range.end.getTime()).toBe(end);
    });

    it("also calls refresh() — setCustomDate alone never reaches the grid", () => {
      const wrapper = mountExplorer();
      const setCustomDate = vi.fn();
      const refresh = vi.fn();
      (wrapper.vm as any).dateTimePickerRef = { setCustomDate, refresh };

      zoomOn(wrapper, {
        start: new Date("2026-07-16T10:00:00.000Z").getTime(),
        end: new Date("2026-07-16T10:30:00.000Z").getTime(),
      });

      // setCustomDate only mutates the picker's refs and leaves the emit to
      // DateTime's auto-apply watcher, which is gated on `autoApply` —
      // DateTimePickerDashboard defaults it to FALSE. Without refresh() the
      // toolbar would show the zoomed range while every card kept old data.
      // ViewDashboard.onDataZoom calls the same pair.
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("widens a click-without-drag (start === end) into a real window", () => {
      const wrapper = mountExplorer();
      const setCustomDate = vi.fn();
      (wrapper.vm as any).dateTimePickerRef = { setCustomDate };

      // An empty window would return no data at all; ViewDashboard's zoom has
      // the same guard.
      const t = new Date("2026-07-16T10:00:00.000Z").getTime();
      zoomOn(wrapper, { start: t, end: t });

      const [, range] = setCustomDate.mock.calls[0];
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
      expect(range.end.getTime() - range.start.getTime()).toBe(60_000);
    });

    it("ignores a zoom with no range rather than blanking the grid", () => {
      const wrapper = mountExplorer();
      const setCustomDate = vi.fn();
      (wrapper.vm as any).dateTimePickerRef = { setCustomDate };

      zoomOn(wrapper, { start: 0, end: 0 });
      zoomOn(wrapper, {});

      expect(setCustomDate).not.toHaveBeenCalled();
    });
  });

  /**
   * Visualize is URL-driven: the built chart serializes to `metrics_data` so a
   * refresh / a shared link restores it IN-PAGE (the router keeps mode=visualize
   * in the explorer). Grid modes already live in the URL, so they just share the
   * current address. These pin the three seams — encode (share), decode
   * (hydrate), and the continuous write (sync).
   */
  describe("Visualize URL state — share, hydrate, sync", () => {
    const paramBlob = (href: string) => {
      const raw = new URL(href).searchParams.get("metrics_data");
      return raw ? decodeMetricsConfig(raw) : null;
    };

    const enterVisualizeWith = async (wrapper: any, query = "up") => {
      visualizePanel = reactive({
        data: { type: "line", queries: [{ query, fields: {} }] },
        layout: {},
      });
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
    };

    describe("shareUrl", () => {
      it("is the plain current URL in grid modes — state already lives there", () => {
        const wrapper = mountExplorer();
        expect((wrapper.vm as any).mode).toBe("explore");
        expect((wrapper.vm as any).shareUrl).toBe(window.location.href);
        expect((wrapper.vm as any).shareUrl).not.toContain("metrics_data");
      });

      it("carries the encoded chart as metrics_data in Visualize", async () => {
        const wrapper = mountExplorer();
        await enterVisualizeWith(wrapper, "sum(rate(http_requests_total[5m]))");

        const blob = paramBlob((wrapper.vm as any).shareUrl);
        expect(blob?.data?.queries?.[0]?.query).toBe("sum(rate(http_requests_total[5m]))");
      });

      it("drops volatile keys (id/title) from the shared blob", async () => {
        const wrapper = mountExplorer();
        visualizePanel = reactive({
          data: {
            id: "panel-1",
            title: "My Chart",
            type: "line",
            queries: [{ query: "up", fields: {} }],
          },
          layout: {},
        });
        (wrapper.vm as any).setMode("visualize");
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();

        const blob = paramBlob((wrapper.vm as any).shareUrl);
        expect(blob?.data).not.toHaveProperty("id");
        expect(blob?.data).not.toHaveProperty("title");
        expect(blob?.data?.type).toBe("line");
      });

      it("omits metrics_data on a blank Visualize (no query yet)", async () => {
        const wrapper = mountExplorer();
        visualizePanel = reactive({
          data: { queries: [{ query: "" }] },
          layout: {},
        });
        (wrapper.vm as any).setMode("visualize");
        await wrapper.vm.$nextTick();

        expect((wrapper.vm as any).shareUrl).not.toContain("metrics_data");
      });
    });

    describe("hydrate on load", () => {
      const blobFor = (data: any) => encodeMetricsConfig(getMetricsConfig({ data }));

      it("seeds Visualize from a metrics_data URL on mount", () => {
        routerState.query = {
          mode: "visualize",
          metrics_data: blobFor({
            type: "bar",
            queries: [{ query: "up", fields: {} }],
          }),
        };

        const wrapper = mountExplorer();

        expect((wrapper.vm as any).mode).toBe("visualize");
        expect((wrapper.vm as any).visualizeSeed).toEqual({
          type: "bar",
          queries: [{ query: "up", fields: {} }],
        });
      });

      it("ignores metrics_data when the mode is not Visualize", () => {
        routerState.query = {
          mode: "explore",
          metrics_data: blobFor({ type: "bar", queries: [{ query: "up" }] }),
        };

        const wrapper = mountExplorer();

        expect((wrapper.vm as any).visualizeSeed).toBeNull();
      });

      it("leaves the seed untouched when there is no metrics_data", () => {
        routerState.query = { mode: "visualize" };
        const wrapper = mountExplorer();
        expect((wrapper.vm as any).visualizeSeed).toBeNull();
      });

      it("ignores a malformed blob rather than throwing", () => {
        routerState.query = { mode: "visualize", metrics_data: "not-base64!!" };
        expect(() => mountExplorer()).not.toThrow();
        // no seed built from garbage
      });
    });

    describe("sync to URL", () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      const blobWrites = () =>
        routerState.replace.mock.calls.map((c: any) => c[0]?.query?.metrics_data).filter(Boolean);

      it("writes the blob to the URL when a chart is built in Visualize", async () => {
        const wrapper = mountExplorer();
        await enterVisualizeWith(wrapper, "node_load1");
        vi.advanceTimersByTime(300);

        const wrote = blobWrites().at(-1);
        expect(wrote).toBeTruthy();
        expect(decodeMetricsConfig(wrote)?.data?.queries?.[0]?.query).toBe("node_load1");
      });

      it("strips a stale blob from the URL when leaving Visualize", async () => {
        routerState.query = { metrics_data: "stale", org_identifier: "org1" };
        const wrapper = mountExplorer();
        await enterVisualizeWith(wrapper, "up");
        vi.advanceTimersByTime(300);
        routerState.replace.mockClear();

        (wrapper.vm as any).setMode("explore");
        await wrapper.vm.$nextTick();
        vi.advanceTimersByTime(300);

        const stripped = routerState.replace.mock.calls.some(
          (c: any) => c[0]?.query && !("metrics_data" in c[0].query),
        );
        expect(stripped).toBe(true);
      });

      // Explore -> Visualize never changes ROUTE (mode is a query param on
      // `metrics`), so a `replace` here overwrote the Explore entry outright and
      // Back jumped clean over the page to whatever preceded it — /logs, in
      // practice, since useLogs pushes an entry per search. The mode transition
      // has to push; nothing else may.
      it("pushes a history entry when switching to Visualize, so Back returns here", async () => {
        routerState.query = { org_identifier: "org1" };
        const wrapper = mountExplorer();
        routerState.push.mockClear();
        routerState.replace.mockClear();

        await enterVisualizeWith(wrapper, "up");

        const pushedModes = routerState.push.mock.calls.map((c: any) => c[0]?.query?.mode);
        expect(pushedModes).toContain("visualize");
        expect(routerState.replace.mock.calls.map((c: any) => c[0]?.query?.mode)).not.toContain(
          "visualize",
        );
      });

      it("pushes on the way back out of Visualize too", async () => {
        const wrapper = mountExplorer();
        await enterVisualizeWith(wrapper, "up");
        // The mock's route.query does not follow navigations, so stand it up by
        // hand: this is the URL the push above just produced.
        routerState.query = { mode: "visualize" };
        routerState.push.mockClear();

        (wrapper.vm as any).setMode("explore");
        await wrapper.vm.$nextTick();

        // `explore` serializes to an absent key, so the pushed query has no mode.
        expect(routerState.push).toHaveBeenCalled();
        expect(routerState.push.mock.calls.at(-1)[0].query.mode).toBeUndefined();
      });

      it("still REPLACES a same-mode edit — those must not stack history", async () => {
        const wrapper = mountExplorer();
        routerState.push.mockClear();
        routerState.replace.mockClear();

        // refreshInterval is a real component ref (the grid mock's fields are
        // plain objects and drive nothing), so this exercises syncUrlState with
        // mode held constant.
        (wrapper.vm as any).refreshInterval = 60;
        await wrapper.vm.$nextTick();

        expect(routerState.replace).toHaveBeenCalled();
        expect(routerState.push).not.toHaveBeenCalled();
      });

      it("does not touch metrics_data while in a grid mode", async () => {
        const wrapper = mountExplorer();
        // A pure grid interaction (sort change) fires syncUrlState, never the
        // visualize writer.
        grid.sortBy.value = "z-a";
        await wrapper.vm.$nextTick();
        vi.advanceTimersByTime(300);

        expect(blobWrites()).toHaveLength(0);
      });
    });
  });

  describe("the metric detail view", () => {
    const DETAIL = '[data-test="metrics-explorer-scroll"]';
    const detailView = (wrapper: any) => wrapper.findComponent({ name: "MetricDetailView" });

    beforeEach(() => {
      grid.cards.value = [CARD];
      grid.paused.value = false;
      // Fast-path tests need a URL differing from leftover grid state ONLY in the detail keys.
      grid.searchTerm.value = "";
      grid.selectedPrefixes.value = new Set();
      grid.selectedSuffixes.value = new Set();
      grid.selectedTypes.value = new Set();
      grid.labelFilters.value = [];
      grid.hideEmptyPanels.value = true;
      grid.sortBy.value = "a-z";
      grid.viewMode.value = "grid";
    });
    afterEach(() => {
      grid.cards.value = [];
      grid.exemplarEligible.mockReturnValue(false);
      grid.exemplarsEnabled.mockReturnValue(false);
      grid.exemplarSwapsVariant.mockReturnValue(false);
      grid.exemplarStateOf.mockReturnValue(undefined);
      grid.runDetailQuery.mockReset();
      grid.effectiveVariant.mockImplementation(() => ({
        defaults: { variants: [] },
        resolved: { queries: [] },
      }));
    });

    it("opens from a card: pushes a history entry, pauses the grid, loads the schemas", async () => {
      const wrapper = mountExplorer();
      routerState.push.mockClear();

      (wrapper.vm as any).openDetail(CARD);
      // Paused synchronously, before the grid unmounts and its cards report in.
      expect(grid.paused.value).toBe(true);
      await wrapper.vm.$nextTick();

      expect(routerState.push).toHaveBeenCalled();
      expect(routerState.push.mock.calls.at(-1)[0].query.metric).toBe(CARD.name);
      expect(grid.ensureSchemas).toHaveBeenCalled();
      expect(wrapper.find(DETAIL).exists()).toBe(false);
      expect(detailView(wrapper).exists()).toBe(true);
      // The mode is untouched — closing returns to whichever grid was showing.
      expect((wrapper.vm as any).mode).toBe("explore");
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_detail_opened",
        expect.objectContaining({ card_kind: CARD.cardKind }),
      );
    });

    it("wires the actions moved off the card to what the card's icons did", async () => {
      grid.exemplarEligible.mockReturnValue(true);
      grid.exemplarsEnabled.mockReturnValue(true);
      grid.exemplarSwapsVariant.mockReturnValue(true);
      const state = { status: "ready", markers: [], errorMessage: "" };
      grid.exemplarStateOf.mockReturnValue(state);
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      const view = detailView(wrapper);
      expect(view.props()).toMatchObject({
        exemplarsEligible: true,
        exemplarsOn: true,
        exemplarsSwapsVariant: true,
        exemplars: state,
      });

      view.vm.$emit("toggle-exemplars");
      view.vm.$emit("retry-exemplars");
      view.vm.$emit("toggle-favorite");
      view.vm.$emit("configure");
      await wrapper.vm.$nextTick();
      expect(grid.toggleExemplars).toHaveBeenCalledWith(CARD);
      expect(grid.retryExemplars).toHaveBeenCalledWith(CARD);
      expect(grid.toggleFavorite).toHaveBeenCalledWith(CARD.name);
      // The ⚙ dialog opens on this metric, over the detail view.
      expect((wrapper.vm as any).dialogOpen).toBe(true);
      expect((wrapper.vm as any).dialogCard).toEqual(CARD);
    });

    it("asks for the metric's exemplars again once its overview settles, even with a preview already in", async () => {
      // Hiding the card on the way in cancels an exemplar fetch in flight and drops its
      // state; a preview already exists, so the preview path never re-asks for them.
      grid.previews.value[CARD.name] = { status: "done" };
      grid.runDetailQuery.mockResolvedValueOnce({ result: [] });
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      grid.ensureExemplars.mockClear();
      grid.requestPreview.mockClear();

      await (wrapper.vm as any).runDetailPreview("rate(x[4m])", new AbortController().signal);
      expect(grid.requestPreview).not.toHaveBeenCalled();
      expect(grid.ensureExemplars).toHaveBeenCalledWith(CARD);

      // Not for a Related metric's tile, whose chart draws no exemplars.
      grid.ensureExemplars.mockClear();
      const other = { ...CARD, name: "other_metric" };
      grid.previews.value[other.name] = { status: "done" };
      await (wrapper.vm as any).runDetailPreview(
        "rate(y[4m])",
        new AbortController().signal,
        other,
      );
      expect(grid.ensureExemplars).not.toHaveBeenCalled();
      delete grid.previews.value[CARD.name];
      delete grid.previews.value[other.name];
    });

    it("still asks for the exemplars when a refresh rebuilds the cards mid-query", async () => {
      grid.previews.value[CARD.name] = { status: "done" };
      let answer!: (value: any) => void;
      grid.runDetailQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      // Reactive here, as the real grid's is, so the view sees the rebuilt card.
      const plainCards = grid.cards;
      grid.cards = ref([CARD]);
      onTestFinished(() => {
        grid.cards = plainCards;
      });
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      grid.ensureExemplars.mockClear();

      const pending = (wrapper.vm as any).runDetailPreview(
        "rate(x[4m])",
        new AbortController().signal,
      );
      // `loadStreams(true)` rebuilds every card as a new object.
      grid.cards.value = [{ ...CARD }];
      answer({ result: [] });
      await pending;
      expect(grid.ensureExemplars).toHaveBeenCalledTimes(1);
      expect(grid.ensureExemplars.mock.calls[0][0].name).toBe(CARD.name);
      delete grid.previews.value[CARD.name];
    });

    it("hands the detail view the function in effect and its queries for a dashboard panel", async () => {
      grid.effectiveVariant.mockImplementation((_card: any, _points: any, opts: any) => ({
        defaults: { variants: [], bucketUnit: null },
        resolved: {
          queries: [{ expr: `avg(rate(x[${opts?.rateWindow ?? "4m"}]))` }],
          chartType: "line",
          unit: "count-per-sec",
          footerLabel: "avg(rate)",
        },
      }));
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      const view = detailView(wrapper);
      expect(view.props("overview")).toMatchObject({
        queries: [{ expr: "avg(rate(x[4m]))" }],
        footerLabel: "avg(rate)",
      });
      expect(view.props("panelQueries")).toEqual([{ expr: "avg(rate(x[$__rate_interval]))" }]);
    });

    it("hands the view the panel rate window Convert to dashboard would use", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("panelRateWindow")).toBe("$__rate_interval");

      grid.previews.value[CARD.name] = { widenedRateWindow: "30m" };
      await wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("panelRateWindow")).toBe("30m");
      delete grid.previews.value[CARD.name];
    });

    it("keeps the grid paused when the mode changes underneath an open view", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();

      (wrapper.vm as any).setMode("workspace");
      await wrapper.vm.$nextTick();
      expect(grid.paused.value).toBe(true);
    });

    it("keeps the Used in tab in the URL", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      routerState.replace.mockClear();

      (wrapper.vm as any).onDetailTab("used_in");
      await wrapper.vm.$nextTick();
      expect(routerState.replace.mock.calls.at(-1)[0].query).toMatchObject({
        metric: CARD.name,
        tab: "used_in",
      });
    });

    it("REPLACES the entry on a tab or breakdown-label change", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      routerState.push.mockClear();
      routerState.replace.mockClear();

      (wrapper.vm as any).onDetailTab("related");
      await wrapper.vm.$nextTick();
      expect(routerState.replace.mock.calls.at(-1)[0].query).toMatchObject({
        metric: CARD.name,
        tab: "related",
      });

      routerState.query = { metric: CARD.name, tab: "related" };
      (wrapper.vm as any).onDetailTab("breakdown");
      (wrapper.vm as any).onBreakdownLabel("route");
      await wrapper.vm.$nextTick();
      expect(routerState.replace.mock.calls.at(-1)[0].query).toMatchObject({
        metric: CARD.name,
        tab: "breakdown",
        breakdown_label: "route",
      });
      expect(routerState.push).not.toHaveBeenCalled();
    });

    it("restores a deep link: metric, tab and breakdown label", () => {
      routerState.query = {
        metric: "http_requests_total",
        tab: "breakdown",
        breakdown_label: "route",
      };
      const wrapper = mountExplorer();

      const view = detailView(wrapper);
      expect(view.exists()).toBe(true);
      expect(view.props("metricName")).toBe("http_requests_total");
      expect(view.props("tab")).toBe("breakdown");
      expect(view.props("breakdownLabel")).toBe("route");
      expect(grid.paused.value).toBe(true);
    });

    it("a metric-only URL change takes the fast path — no filter re-apply, no grid re-query", async () => {
      const wrapper = mountExplorer();
      const prefixes = grid.selectedPrefixes.value;
      const labels = grid.labelFilters.value;
      grid.requestPreview.mockClear();

      routerState.query = { metric: CARD.name, tab: "related" };
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();

      expect(detailView(wrapper).props("tab")).toBe("related");
      // Identical identities: the grid's watchers never saw a "new" filter.
      expect(grid.selectedPrefixes.value).toBe(prefixes);
      expect(grid.labelFilters.value).toBe(labels);
      expect(grid.requestPreview).not.toHaveBeenCalled();
      expect(grid.sweepSlice).not.toHaveBeenCalled();
    });

    it("Back closes the view on the fast path, so returning re-queries no card", async () => {
      routerState.query = { metric: CARD.name, tab: "related" };
      const wrapper = mountExplorer();
      const prefixes = grid.selectedPrefixes.value;
      grid.requestPreview.mockClear();

      routerState.query = {};
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();

      expect(detailView(wrapper).exists()).toBe(false);
      expect(wrapper.find(DETAIL).exists()).toBe(true);
      expect(grid.selectedPrefixes.value).toBe(prefixes);
      expect(grid.sweepSlice).not.toHaveBeenCalled();
      expect(grid.paused.value).toBe(false);
    });

    it("Detail -> Visualize -> Back -> Forward reopens Visualize on the URL's chart", async () => {
      const chart = { type: "bar", queries: [{ query: "up", fields: {} }] };
      const visualizeUrl = {
        mode: "visualize",
        metrics_data: encodeMetricsConfig(getMetricsConfig({ data: chart })),
      };
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();

      routerState.query = visualizeUrl;
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();
      (wrapper.vm as any).visualizeSeed = null;

      routerState.query = { metric: CARD.name };
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).exists()).toBe(true);

      routerState.query = visualizeUrl;
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).mode).toBe("visualize");
      expect((wrapper.vm as any).visualizeSeed).toEqual(chart);
    });

    it("opening a related metric pushes, and Back returns to the first metric's Related tab", async () => {
      routerState.query = { metric: CARD.name, tab: "related" };
      const wrapper = mountExplorer();
      routerState.push.mockClear();

      (wrapper.vm as any).onOpenRelated("http_responses_total");
      await wrapper.vm.$nextTick();
      expect(routerState.push.mock.calls.at(-1)[0].query).toMatchObject({
        metric: "http_responses_total",
      });
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_related_opened",
        expect.any(Object),
      );

      // Back: the router restores the first metric's entry.
      routerState.query = { metric: "http_responses_total" };
      routerState.query = { metric: CARD.name, tab: "related" };
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("metricName")).toBe(CARD.name);
      expect(detailView(wrapper).props("tab")).toBe("related");
    });

    it("closing pushes the bare grid URL and unpauses the grid", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      routerState.push.mockClear();

      (wrapper.vm as any).closeDetail();
      await wrapper.vm.$nextTick();

      expect(routerState.push.mock.calls.at(-1)[0].query.metric).toBeUndefined();
      expect(grid.paused.value).toBe(false);
    });

    it("a filter added from Breakdown goes through onAddLabelFilter and is tracked", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();

      await (wrapper.vm as any).onBreakdownAddFilter({
        label: "status",
        operator: "=",
        value: "500",
      });
      expect(grid.addLabelFilter).toHaveBeenCalledWith({
        label: "status",
        operator: "=",
        value: "500",
      });
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_breakdown_filter_added",
        expect.objectContaining({ operator: "=" }),
      );
    });

    it("hands the detail view the filters its metric cannot apply, and the eligibility rule", () => {
      const JOB = { label: "job", operator: "=", value: "api" };
      grid.inapplicableLabelFilters.mockReturnValue([JOB]);
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      const view = detailView(wrapper);

      expect(grid.inapplicableLabelFilters).toHaveBeenCalledWith(CARD);
      expect(view.props("inapplicableFilters")).toEqual([JOB]);
      expect(view.props("isLabelEligible")).toBe(grid.isLabelEligible);
      grid.inapplicableLabelFilters.mockReturnValue([]);
    });

    it("a manual refresh's stream reload does not put the open view back on a spinner", async () => {
      // loadStreams(true) flips grid.loading while the cards are still there.
      grid.loading.value = true;
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      await flushPromises();
      expect((wrapper.vm as any).detailLoading).toBe(false);
      grid.loading.value = false;
    });

    it("waits on the first stream load, when there are no cards yet", async () => {
      grid.loading.value = true;
      grid.cards.value = [];
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      await flushPromises();
      expect((wrapper.vm as any).detailLoading).toBe(true);
      grid.loading.value = false;
    });

    it("a Visualize URL carries no detail view into a later switch to Explore", async () => {
      routerState.query = { mode: "visualize", metric: CARD.name, tab: "related" };
      const wrapper = mountExplorer();
      expect((wrapper.vm as any).detailMetric).toBeNull();
      expect((wrapper.vm as any).viewState).not.toHaveProperty("metric");

      (wrapper.vm as any).setMode("explore");
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).exists()).toBe(false);
    });

    it("entering Visualize from an open view clears it, in state and in the URL", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).viewState).not.toHaveProperty("metric");

      (wrapper.vm as any).setMode("explore");
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).exists()).toBe(false);
    });

    it("hands the detail view the grid's detail-query plumbing, cancellable by the caller's signal", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      const { signal } = new AbortController();

      await detailView(wrapper).props("runQuery")("sum(up)", signal);
      expect(grid.runDetailQuery).toHaveBeenCalledWith("sum(up)", CARD, signal, undefined);

      await detailView(wrapper).props("runQuery")("sum(le)", signal, undefined, {
        maxSeries: Infinity,
      });
      expect(grid.runDetailQuery).toHaveBeenLastCalledWith("sum(le)", CARD, signal, {
        maxSeries: Infinity,
      });
    });

    it("runs a related metric's chart as that metric, not the open one", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      const OTHER = { ...CARD, name: "http_responses_total" };
      const { signal } = new AbortController();

      await detailView(wrapper).props("runQuery")("sum(other)", signal, OTHER);
      expect(grid.runDetailQuery).toHaveBeenCalledWith("sum(other)", OTHER, signal, undefined);
    });

    it("never starts the query of a chart abandoned while its metric's preview settled", async () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      const OTHER = { ...CARD, name: "http_responses_total" };
      let settle!: () => void;
      grid.requestPreview.mockImplementationOnce(
        () => new Promise<void>((resolve) => (settle = resolve)),
      );
      const controller = new AbortController();

      const pending = detailView(wrapper).props("runQuery")("sum(other)", controller.signal, OTHER);
      controller.abort();
      settle();
      await expect(pending).rejects.toSatisfy(isCancelled);
      expect(grid.runDetailQuery).not.toHaveBeenCalled();
    });

    it("charts an unpreviewed sparse related metric with the window its preview widened to", async () => {
      const OTHER = { ...CARD, name: "http_responses_total", typeFilterBucket: "counter" };
      const SERIES = { resultType: "matrix", result: [{ metric: {}, values: [[1, "1"]] }] };
      const EMPTY = { resultType: "matrix", result: [] };
      const previews = grid.previews;
      grid.previews = ref<Record<string, any>>({});
      grid.cards.value = [CARD, OTHER];
      grid.prefixOf.mockImplementation(() => "http");
      grid.effectiveVariant.mockImplementation((card: any, _points: any, opts: any) => ({
        defaults: { variants: [] },
        resolved: {
          queries: [{ expr: `sum(rate(${card.name}[${opts?.rateWindow ?? "4m"}]))` }],
          chartType: "line",
          unit: "count",
        },
      }));
      // The grid's own preview finds the counter too sparse for 4m and widens it.
      grid.requestPreview.mockImplementation(async (card: any) => {
        grid.previews.value[card.name] = {
          status: "done",
          widenedRateWindow: card.name === OTHER.name ? "30m" : null,
        };
      });
      grid.runDetailQuery.mockImplementation(async (expr: string) =>
        expr.includes("[30m]") ? SERIES : EMPTY,
      );
      const io = installFakeIntersectionObserver({ autoVisible: true });
      try {
        routerState.query = { metric: CARD.name, tab: "related" };
        const wrapper = mountExplorer({
          MetricDetailView: false,
          MetricCardChart: {
            name: "MetricCardChart",
            props: ["results", "queries", "timeRange"],
            template: "<div />",
          },
        });
        await flushPromises();

        const exprs = grid.runDetailQuery.mock.calls.map(([expr]: any[]) => expr);
        expect(exprs).toContain("sum(rate(http_responses_total[30m]))");
        expect(exprs).not.toContain("sum(rate(http_responses_total[4m]))");
        const tile = wrapper.find(`[data-test="metrics-detail-related-card-${OTHER.name}"]`);
        expect(tile.findComponent({ name: "MetricCardChart" }).props("results")).toEqual([SERIES]);
      } finally {
        io.restore();
        grid.previews = previews;
        grid.prefixOf.mockImplementation(() => "misc");
        grid.effectiveVariant.mockImplementation(() => ({
          defaults: { variants: [] },
          resolved: { queries: [] },
        }));
        grid.requestPreview.mockImplementation(async () => {});
        grid.runDetailQuery.mockImplementation(() => undefined);
      }
    });

    it("colours a related metric past the first page as its grid card will be", () => {
      routerState.query = { metric: CARD.name };
      const OTHER = { ...CARD, name: "http_responses_total" };
      grid.sortedCards.value = [CARD, { ...CARD, name: "b" }, OTHER];
      try {
        const wrapper = mountExplorer();
        const colorOf = detailView(wrapper).props("colorOf");
        expect([cardColorForIndex(2, false), cardColorForIndex(2, true)]).toContain(
          colorOf(OTHER.name),
        );
        expect(colorOf(OTHER.name)).not.toBe(colorOf(CARD.name));
      } finally {
        grid.sortedCards.value = [];
      }
    });

    it("charts a related metric with the query its explorer card would run", () => {
      routerState.query = { metric: CARD.name };
      const wrapper = mountExplorer();
      const OTHER = { ...CARD, name: "http_responses_total", chartType: "line", unit: "count" };
      grid.effectiveVariant.mockReturnValueOnce({
        defaults: { variants: [] },
        resolved: { queries: [{ expr: "sum(rate(http_responses_total[4m]))" }], unit: "count" },
      } as any);

      const chart = detailView(wrapper).props("chartOf")(OTHER);
      expect(grid.effectiveVariant).toHaveBeenLastCalledWith(OTHER, undefined, expect.any(Object));
      expect(chart.queries).toEqual([{ expr: "sum(rate(http_responses_total[4m]))" }]);
      expect(chart.chartType).toBe("line");
    });

    it("restores compare from a deep link and writes a change to the URL without re-querying the grid", async () => {
      routerState.query = { metric: CARD.name, compare: "1d" };
      const wrapper = mountExplorer();
      expect(detailView(wrapper).props("compare")).toBe("1d");
      expect(detailView(wrapper).props("stepSeconds")).toBe(30);
      routerState.push.mockClear();
      routerState.replace.mockClear();
      grid.requestPreview.mockClear();

      detailView(wrapper).vm.$emit("update:compare", "1w");
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("compare")).toBe("1w");
      expect(routerState.replace.mock.calls.at(-1)[0].query).toMatchObject({
        metric: CARD.name,
        compare: "1w",
      });
      expect(routerState.push).not.toHaveBeenCalled();

      routerState.query = { metric: CARD.name, compare: "1h" };
      (wrapper.vm as any).onRouteQueryChange();
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("compare")).toBe("1h");
      expect(grid.requestPreview).not.toHaveBeenCalled();
      expect(grid.sweepSlice).not.toHaveBeenCalled();
    });

    it("Back to the label grid clears the breakdown label, replacing the entry", async () => {
      routerState.query = { metric: CARD.name, tab: "breakdown", breakdown_label: "route" };
      const wrapper = mountExplorer();
      routerState.push.mockClear();
      routerState.replace.mockClear();

      (wrapper.vm as any).onBreakdownLabel(null);
      await wrapper.vm.$nextTick();
      expect(detailView(wrapper).props("breakdownLabel")).toBeNull();
      expect(routerState.replace.mock.calls.at(-1)[0].query.breakdown_label).toBeUndefined();
      expect(routerState.push).not.toHaveBeenCalled();
    });
  });

  /**
   * The "No metrics match" empty state offers one action card per remedy, gated
   * on that remedy actually being able to change the result. Favorites ignores
   * prefix/suffix/type, so "Clear prefix/suffix/type" must not appear there.
   */
  describe("empty-state remedies gate on what would actually help", () => {
    const actionIds = (wrapper: any) => (wrapper.vm as any).noMatchActions.map((a: any) => a.id);

    it("offers Clear prefix/suffix/type in Explore when a facet is selected", () => {
      const wrapper = mountExplorer();
      grid.showFavoritesOnly.value = false;
      grid.selectedPrefixes.value = new Set(["envoy_cluster"]);

      expect(actionIds(wrapper)).toContain("clear-facets");

      grid.selectedPrefixes.value = new Set(); // reset shared mock
    });

    it("hides Clear prefix/suffix/type in Favorites — those facets are ignored there", () => {
      const wrapper = mountExplorer();
      grid.showFavoritesOnly.value = true;
      grid.selectedPrefixes.value = new Set(["envoy_cluster"]);

      const ids = actionIds(wrapper);
      expect(ids).not.toContain("clear-facets");
      // The favorites-specific remedy is still offered.
      expect(ids).toContain("clear-favorites");

      grid.showFavoritesOnly.value = false; // reset shared mock
      grid.selectedPrefixes.value = new Set();
    });
  });

  describe("saved views", () => {
    const VIEWS = '[data-test="metrics-explorer-views"]';

    it("offers the Views menu on the grid, never in Visualize or the detail view", async () => {
      const wrapper = mountExplorer();
      expect(wrapper.find(VIEWS).exists()).toBe(true);

      (wrapper.vm as any).setMode("workspace");
      await wrapper.vm.$nextTick();
      expect(wrapper.find(VIEWS).exists()).toBe(true);

      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect(wrapper.find(VIEWS).exists()).toBe(false);

      (wrapper.vm as any).setMode("explore");
      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(VIEWS).exists()).toBe(false);
    });

    it("hands the menu the grid's URL slice", () => {
      routerState.query = { sort: "z-a", period: "1h" };
      grid.sortBy.value = "z-a";
      const wrapper = mountExplorer();
      const state = wrapper.findComponent(VIEWS).props("state");
      expect(state).toMatchObject({ sort: "z-a", period: "1h" });
      grid.sortBy.value = "a-z";
    });

    it("applying a view navigates to /metrics with its query and is tracked", async () => {
      const wrapper = mountExplorer();
      wrapper.findComponent(VIEWS).vm.$emit("apply", { sort: "z-a", prefix: "node" });
      await flushPromises();

      expect(routerState.push).toHaveBeenCalledWith({
        name: "metrics",
        query: { org_identifier: "org1", sort: "z-a", prefix: "node" },
      });
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_view_applied",
        expect.any(Object),
      );
    });

    it("clearing a view lands on the default grid: no search, facets, labels, sort or period, but auto-refresh kept", async () => {
      // A view that both searches and facets: clearing the search alone leaves its prefix narrowing the grid.
      routerState.query = {
        search: "cache",
        prefix: "cache",
        sort: "z-a",
        period: "1h",
        refresh: "30s",
      };
      grid.searchTerm.value = "cache";
      grid.selectedPrefixes.value = new Set(["cache"]);
      grid.labelFilters.value = [{ label: "job", operator: "=", value: "api" }];
      grid.sortBy.value = "z-a";
      const wrapper = mountExplorer();

      wrapper.findComponent(VIEWS).vm.$emit("clear");
      await flushPromises();
      expect(routerState.push).toHaveBeenCalledWith({
        name: "metrics",
        query: { org_identifier: "org1", refresh: "30s" },
      });

      routerState.query = routerState.push.mock.calls.at(-1)[0].query;
      (wrapper.vm as any).onRouteQueryChange();
      await flushPromises();
      expect(grid.searchTerm.value).toBe("");
      expect(grid.selectedPrefixes.value.size).toBe(0);
      expect(grid.labelFilters.value).toEqual([]);
      expect(grid.sortBy.value).toBe("a-z");
      expect((wrapper.vm as any).viewState).toEqual({ refresh: "30s" });
    });

    it("keeps the applied view across the detail view, so Update/Delete still target it", async () => {
      const wrapper = mountExplorer();
      wrapper.findComponent(VIEWS).vm.$emit("update:activeViewId", "m1");
      await wrapper.vm.$nextTick();

      (wrapper.vm as any).openDetail(CARD);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(VIEWS).exists()).toBe(false);
      (wrapper.vm as any).closeDetail();
      await wrapper.vm.$nextTick();

      expect(wrapper.findComponent(VIEWS).props("activeViewId")).toBe("m1");
    });

    it("tracks a saved view", async () => {
      const wrapper = mountExplorer();
      wrapper.findComponent(VIEWS).vm.$emit("saved", "created");
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_view_saved",
        expect.objectContaining({ action: "created" }),
      );
    });

    it("a URL change with a new range sets the picker, not just the model", async () => {
      const setSavedDate = vi.fn();
      const wrapper = mountExplorer({
        DateTimePickerDashboard: {
          setup: (_: any, { expose }: any) => {
            expose({ setSavedDate, getConsumableDateTime: () => ({ startTime: 1, endTime: 2 }) });
            return {};
          },
          template: "<div />",
        },
      });
      routerState.query = { sort: "z-a", period: "6h" };
      (wrapper.vm as any).onRouteQueryChange();
      await flushPromises();

      expect(setSavedDate).toHaveBeenCalledWith({ type: "relative", relativeTimePeriod: "6h" });
      expect(grid.setTimeRange).toHaveBeenCalled();
    });
  });

  describe("query history in Visualize", () => {
    const RUN = '[data-test="metrics-explorer-run"]';
    const withButtons = () =>
      mountExplorer({ OButton: { template: '<button v-bind="$attrs"><slot /></button>' } });

    beforeEach(() => {
      shortcuts.handlers = {};
    });

    it("Visualize has a Run button and History; the grid modes do not", async () => {
      const wrapper = withButtons();
      expect(wrapper.find(RUN).exists()).toBe(false);
      expect(wrapper.find('[data-test="metrics-history"]').exists()).toBe(false);

      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect(wrapper.find(RUN).exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-history"]').exists()).toBe(true);
    });

    it("Run and the run shortcut are explicit runs; refresh and auto-refresh are not", async () => {
      const wrapper = withButtons();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();

      await wrapper.find(RUN).trigger("click");
      shortcuts.handlers.metricsRunQuery();
      expect(visualizeOnUserRun).toHaveBeenCalledTimes(2);
      expect(visualizeOnUserRun).toHaveBeenCalledWith(
        expect.objectContaining({ relativeTimePeriod: "15m" }),
      );

      shortcuts.handlers.metricsRefresh();
      (wrapper.vm as any).onRefreshTick();
      expect(visualizeOnUserRun).toHaveBeenCalledTimes(2);
      expect(visualizeRunQuery).toHaveBeenCalledTimes(2);
    });

    it("a Run from inside the Visualize editor is the same explicit run as the button", async () => {
      const wrapper = withButtons();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();

      wrapper.findComponent('[data-test="metrics-explorer-visualize"]').vm.$emit("run");
      expect(visualizeOnUserRun).toHaveBeenCalledTimes(1);
      expect(visualizeOnUserRun).toHaveBeenCalledWith(
        expect.objectContaining({ relativeTimePeriod: "15m" }),
      );
    });

    it("Visualize keeps the Refresh button beside Run; Refresh re-runs without recording", async () => {
      const wrapper = withButtons();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();

      expect(wrapper.find(RUN).exists()).toBe(true);
      const refresh = wrapper.find('[data-test="metrics-explorer-refresh"]');
      expect(refresh.exists()).toBe(true);
      await refresh.trigger("click");
      expect(visualizeRunQuery).toHaveBeenCalledTimes(1);
      expect(visualizeOnUserRun).not.toHaveBeenCalled();
    });

    it("the run shortcut in Explore refreshes the grid and records nothing", async () => {
      mountExplorer();
      shortcuts.handlers.metricsRunQuery();
      await flushPromises();
      expect(visualizeOnUserRun).not.toHaveBeenCalled();
      expect(grid.loadStreams).toHaveBeenCalled();
    });

    it("loading an entry applies it to the pane and is tracked", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();

      const timeRange = { valueType: "relative", relativeTimePeriod: "6h" };
      wrapper
        .findComponent('[data-test="metrics-history"]')
        .vm.$emit("load", { metricsData: "blob", timeRange });
      expect(visualizeApplyPanelData).toHaveBeenCalledWith("blob", timeRange);
      expect(analytics.track).toHaveBeenCalledWith(
        "metrics_explorer_history_loaded",
        expect.any(Object),
      );
    });

    it("the pane's range change sets the toolbar picker", async () => {
      const setSavedDate = vi.fn();
      const wrapper = mountExplorer({
        DateTimePickerDashboard: {
          setup: (_: any, { expose }: any) => {
            expose({ setSavedDate, getConsumableDateTime: () => ({ startTime: 1, endTime: 2 }) });
            return {};
          },
          template: "<div />",
        },
      });
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();

      wrapper
        .findComponent('[data-test="metrics-explorer-visualize"]')
        .vm.$emit("update:time-range", { valueType: "absolute", startTime: 5, endTime: 9 });
      expect(setSavedDate).toHaveBeenCalledWith({ type: "absolute", startTime: 5, endTime: 9 });
      expect((wrapper.vm as any).selectedDate).toMatchObject({ startTime: 5, endTime: 9 });
    });
  });
});
