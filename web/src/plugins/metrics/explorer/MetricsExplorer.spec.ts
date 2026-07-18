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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { ref, computed } from "vue";

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
    requestPreview: vi.fn(async () => {}),
    refreshCard: vi.fn(),
    cancelPreview: vi.fn(),
    invalidateAll: vi.fn(),
    clearPreviewCache: vi.fn(),
    sweepSlice: vi.fn().mockResolvedValue(undefined),
    effectiveVariant: vi.fn(() => ({ defaults: { variants: [] }, resolved: { queries: [] } })),
    runDialogQuery: vi.fn(),
    cancelDialogQueries: vi.fn(),
    loadStreams: vi.fn(async () => {}),
    setTimeRange: vi.fn(),
    setRefreshInterval: vi.fn(),
    onOrgChange: vi.fn(),
    showMore: vi.fn(),
  };
  return g;
});

vi.mock("@/composables/metrics/useMetricsExplorerGrid", () => ({
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
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
  }),
  useRoute: () => ({ query: {} }),
}));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: () => computed(() => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
  })),
}));

import MetricsExplorer from "./MetricsExplorer.vue";

const CARD = { name: "http_requests_total", unsupported: false, cardKind: "counterRate" };

/** The Visualize pane's runQuery — the toolbar refresh must drive this in
 *  visualize mode instead of sweeping the Explore grid. */
const visualizeRunQuery = vi.fn();

const mountExplorer = (stubOverrides: Record<string, any> = {}) =>
  mount(MetricsExplorer, {
    global: {
      stubs: {
        AppPageHeader: true,
        DateTimePickerDashboard: true,
        AutoRefreshInterval: true,
        MetricCard: true,
        PrefixFilterPanel: true,
        LabelFilterBar: true,
        FunctionConfigDialog: true,
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
          template: '<div><slot /></div>',
        },
        OToggleGroupItem: {
          template: '<button type="button"><slot /></button>',
        },
        OTag: {
          template: '<span><slot /></span>',
        },
        // Pulls in the dashboard PanelEditor (ECharts + useDashboardPanelData),
        // which needs far more context than this wiring test provides. The
        // explorer test only cares that it renders in visualize mode; its own
        // behaviour is covered by MetricsVisualize.spec. Keep the data-test so the
        // mode-switch assertions still find it.
        MetricsVisualize: {
          // Exposes runQuery like the real pane — the toolbar refresh drives it
          // in visualize mode.
          setup: () => ({ runQuery: visualizeRunQuery }),
          template:
            '<div data-test="metrics-explorer-visualize">visualize</div>',
        },
        ...stubOverrides,
      },
    },
  });

describe("MetricsExplorer wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grid.pagedCards.value = [CARD];
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

      expect(
        wrapper.find('[data-test="metrics-explorer-sort-a-z"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-sort-z-a"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-sort-recent"]').exists(),
      ).toBe(false);
    });
  });

  describe("the no-data filter is a segmented choice, not a checkbox", () => {
    it("shows BOTH options, so the way out of an empty grid is on screen", async () => {
      // A checkbox states one option and leaves the other implicit. The implicit
      // one is exactly what a user needs when the filter has hidden everything.
      const wrapper = mountExplorer();

      expect(
        wrapper.find('[data-test="metrics-explorer-hide-empty"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-show-all"]').exists(),
      ).toBe(true);
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
  });

  describe("the facet selector lives on the search row, over an always-open panel", () => {
    it("renders Prefix/Suffix/Type as a segmented toggle on the search row", () => {
      // The facet selector moved out of the left column onto the search row (it
      // scopes which metrics you are searching). The left column is now just the
      // panel body for whichever facet is selected.
      const wrapper = mountExplorer();

      expect(
        wrapper.find('[data-test="metrics-explorer-rail-prefix"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-rail-suffix"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-rail-type"]').exists(),
      ).toBe(true);
    });

    it("does not show the old Saved Views dialog on Explore (it moved to Workspace)", () => {
      // The mystery dialog is gone: saved views now live in the Workspace rail.
      const wrapper = mountExplorer();
      expect(
        wrapper.find('[data-test="metrics-saved-views"]').exists(),
      ).toBe(false);
      // The Workspace rail is not shown in Explore mode either.
      expect(
        wrapper.find('[data-test="metrics-workspace-rail"]').exists(),
      ).toBe(false);
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

      expect(wrapper.findComponent({ name: "PrefixFilterPanel" }).exists()).toBe(
        true,
      );
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
      expect(
        wrapper.find('[data-test="metrics-explorer-mode-explore"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-mode-visualize"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="metrics-explorer-visualize"]').exists(),
      ).toBe(false);
    });

    it("switches the body to the Visualize pane when the mode flips", async () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).setMode("visualize");
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).mode).toBe("visualize");
      expect(
        wrapper.find('[data-test="metrics-explorer-visualize"]').exists(),
      ).toBe(true);
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
      expect(
        wrapper.find('[data-test="metrics-explorer-visualize"]').exists(),
      ).toBe(false);
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
      expect((wrapper.vm as any).mode).toBe("visualize");
      expect((wrapper.vm as any).visualizeSeed).toBeTruthy();
    });
  });

  describe("the type facet uses OCheckboxGroup over a Set<->array boundary", () => {
    it("exposes selectedTypes as an array for the group, and writes back a Set", () => {
      // The composable keeps selectedTypes as a Set (URL state + filtering depend
      // on it); OCheckboxGroup speaks arrays. The two adapters must round-trip.
      grid.selectedTypes.value = new Set(["counter", "gauge"]);
      const wrapper = mountExplorer();

      // Set -> array, for the group's model-value.
      expect((wrapper.vm as any).selectedTypesArray).toEqual([
        "counter",
        "gauge",
      ]);

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
});
