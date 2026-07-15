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
  INITIAL_PAGE_SIZE: 30,
  PAGE_SIZE_INCREMENT: 12,
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

const mountExplorer = () =>
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
          template:
            '<div data-test="metrics-explorer-visualize">visualize</div>',
        },
        // Owns the /savedviews CRUD + dialogs; its own behaviour is covered by
        // MetricsSavedViews.spec. The explorer test only cares that it is wired
        // in (present, receives a buildSnapshot, emits apply).
        MetricsSavedViews: {
          props: ["buildSnapshot"],
          emits: ["apply"],
          template: '<div data-test="metrics-saved-views">saved-views</div>',
        },
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

    it("mounts the Saved Views control, wired to build/apply the explorer snapshot", () => {
      // Saved Views is its own component (list + dialogs over /savedviews). The
      // explorer only wires it: hands it a buildSnapshot and listens for apply.
      const wrapper = mountExplorer();

      // The control is mounted; its snapshot build/apply wiring is exercised by
      // the two tests below (buildSavedViewSnapshot / applySavedViewSnapshot).
      expect(
        wrapper.find('[data-test="metrics-saved-views"]').exists(),
      ).toBe(true);
      // The rail heart is gone.
      expect(
        wrapper.find('[data-test="metrics-explorer-rail-favorite"]').exists(),
      ).toBe(false);
    });

    it("builds a snapshot of filters + pinned metrics (no time range)", () => {
      // The snapshot a Saved View stores: serialized filters + pinned names, and
      // deliberately NOT the time range (a view opens against live now).
      const wrapper = mountExplorer();
      grid.selectedTypes.value = new Set(["counter"]);
      grid.favorites.value = ["http_requests_total"];

      const snap = (wrapper.vm as any).buildSavedViewSnapshot();
      expect(snap.kind).toBe("metrics");
      expect(snap.filters.type).toBe("counter");
      expect(snap.pinned).toEqual(["http_requests_total"]);
      expect(snap.filters.period).toBeUndefined();
      expect(snap.filters.from).toBeUndefined();
    });

    it("applies a snapshot back onto the grid (filters + pins)", () => {
      const wrapper = mountExplorer();
      (wrapper.vm as any).applySavedViewSnapshot({
        filters: { type: "gauge", search: "cpu" },
        pinned: ["node_memory"],
      });
      expect([...grid.selectedTypes.value]).toEqual(["gauge"]);
      expect(grid.searchTerm.value).toBe("cpu");
      expect(grid.favorites.value).toEqual(["node_memory"]);
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
});
