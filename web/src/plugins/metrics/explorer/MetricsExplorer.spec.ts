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
import { computed } from "vue";

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
    activeRail: { value: "" },
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
        OToggleGroup: {
          template: '<div><slot /></div>',
        },
        OToggleGroupItem: {
          template: '<button type="button"><slot /></button>',
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
});
