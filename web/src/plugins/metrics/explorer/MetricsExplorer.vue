<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  The Metrics Explorer browse grid.

  Landing here runs no user-authored query: every metric renders immediately as
  a card charted with the best default PromQL function for its type, and the
  user searches, filters and drills down from there.
-->
<template>
  <div class="flex flex-col h-full min-h-0 w-full" data-test="metrics-explorer">
    <!-- No page title. Metrics is an EXPLORE surface, like Logs and Traces:
         you arrive to look at data, so the data starts at the top of the frame.
         An H1 saying "Metrics" above a nav item already saying "Metrics" bought
         nothing and cost ~68px of chart. AppPageHeader stays where it earns its
         keep — settings, billing, list and detail pages.

         So the first row IS the toolbar, and it carries both clusters the way
         the Logs toolbar does: scope on the left (what you are looking at),
         time on the right (which window, and how often it reloads). -->
    <!-- items-START, not center: expanding the chips grows the row downward
         while the label and the time controls stay pinned to the first line. -->
    <div
      class="flex items-start gap-2 shrink-0 px-4 py-2 border-b border-border-default"
      data-test="metrics-explorer-filter-bar"
    >
      <!-- One line by default: the bar clips its chips to the first row and
           collapses the rest behind an "n more filters" button, so the time
           controls never get shoved onto a second line as filters accumulate. -->
      <div class="flex flex-1 min-w-0 items-start gap-2">
        <span
          class="text-xs font-medium text-text-secondary shrink-0 leading-7"
        >
          {{ t("metrics.explorer.filterLabel") }}
        </span>
        <LabelFilterBar
          :filters="grid.labelFilters.value"
          :label-names="grid.labelNames.value"
          :label-names-loading="grid.labelNamesLoading.value"
          :schema-loading="grid.schemaLoading.value"
          :load-values="grid.loadLabelValues"
          @focus-picker="grid.loadLabelNames"
          @add="onAddLabelFilter"
          @remove="onRemoveLabelFilter"
          @clear-all="onClearLabelFilters"
        />
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <DateTimePickerDashboard
          ref="dateTimePickerRef"
          v-model="selectedDate"
          @on:date-change="onDateChange"
        />
        <AutoRefreshInterval
          v-model="refreshInterval"
          trigger
          @trigger="onRefreshTick"
        />
        <!-- Same refresh control as the dashboard toolbar. -->
        <OButton
          variant="outline"
          size="icon-toolbar"
          icon-left="refresh"
          :disabled="refreshing || grid.loading.value"
          :loading="refreshing"
          data-test="metrics-explorer-refresh"
          @click="onRefresh"
        >
          <OTooltip :content="t('metrics.explorer.refresh')" />
        </OButton>
      </div>
    </div>

    <div
      class="flex items-center gap-2 px-4 py-2 border-b border-border-default"
    >
      <!-- The scope toggle lives INSIDE the field, the way the dashboard list's
           folder scope does: it is a property of the search — which metrics you
           are looking through — not another control sitting beside it. The field
           grows to fill the bar so the toggle sits at its right edge. -->
      <OSearchInput
        v-model="grid.searchTerm.value"
        size="sm"
        clearable
        :debounce="200"
        :placeholder="t('metrics.explorer.searchPlaceholder')"
        data-test="metrics-explorer-search"
        class="flex-1 min-w-0"
      >
        <template #icon-right>
          <OToggleGroup
            :model-value="grid.hideEmptyPanels.value ? 'with-data' : 'all'"
            type="single"
            class="self-center"
            data-test="metrics-explorer-data-scope"
            @update:model-value="onDataScope"
          >
            <OToggleGroupItem
              value="with-data"
              size="xs"
              icon-left="show-chart"
              :title="t('metrics.explorer.withDataTitle')"
              data-test="metrics-explorer-hide-empty"
              >{{ t("metrics.explorer.withData") }}</OToggleGroupItem
            >
            <OToggleGroupItem
              value="all"
              size="xs"
              icon-left="all-inclusive"
              :title="t('metrics.explorer.allTitle')"
              data-test="metrics-explorer-show-all"
              >{{ t("metrics.explorer.all") }}</OToggleGroupItem
            >
          </OToggleGroup>
        </template>
      </OSearchInput>

      <!-- Announced, so a screen reader hears the count change as the user types.
           `shrink-0` + `nowrap`: the search field grows to fill the bar and was
           squeezing both of these until "60 of 3,315" broke across two lines. -->
      <span
        aria-live="polite"
        data-test="metrics-explorer-count"
        class="shrink-0 whitespace-nowrap text-xs text-text-secondary tabular-nums"
        >{{ resultCountLabel }}</span
      >

      <!-- OToggleGroup takes OToggleGroupItem children; it has no `items` prop.
           Passing one renders an empty group. -->
      <OToggleGroup
        v-model="sortModel"
        type="single"
        data-test="metrics-explorer-sort"
      >
        <OToggleGroupItem
          v-for="opt in sortOptions"
          :key="opt.value"
          :value="opt.value"
          size="sm"
          :data-test="`metrics-explorer-sort-${opt.value}`"
          >{{ opt.label }}</OToggleGroupItem
        >
      </OToggleGroup>

      <OToggleGroup
        v-model="viewModel"
        type="single"
        data-test="metrics-explorer-view"
      >
        <OToggleGroupItem
          v-for="opt in viewOptions"
          :key="opt.value"
          :value="opt.value"
          size="sm"
          :icon-left="opt.icon"
          :tooltip="opt.label"
          :data-test="`metrics-explorer-view-${opt.value}`"
        />
      </OToggleGroup>
    </div>

    <div class="flex flex-1 min-h-0">
      <nav
        class="flex flex-col gap-1 p-2 border-r border-border-default"
        :aria-label="t('metrics.explorer.railsAriaLabel')"
      >
        <!-- OTooltip nests INSIDE the button and attaches to it — the pattern
             the rest of the app uses. (Pass the label via the `content` prop,
             not a default slot: a default slot would make this wrapper mode and
             render the label as the button's own text.) -->
        <!-- Prefix and suffix are `A_` / `_Z` glyphs rather than icons: no icon
             in the registry says "matches the START of the name" as plainly as
             the underscore's position does. The OTooltip comes FIRST so that,
             having no preceding sibling, it attaches to the whole button rather
             than to the glyph span. -->
        <OButton
          v-for="rail in rails"
          :key="rail.id"
          :variant="grid.activeRail.value === rail.id ? 'primary' : 'ghost'"
          size="icon"
          :icon-left="rail.icon"
          :aria-label="rail.label"
          :aria-pressed="String(grid.activeRail.value === rail.id)"
          :data-test="`metrics-explorer-rail-${rail.id}`"
          @click="toggleRail(rail.id)"
        >
          <OTooltip :content="rail.label" side="right" />
          <span
            v-if="rail.glyph"
            class="font-mono text-[11px] font-semibold leading-none tracking-tight"
            aria-hidden="true"
            >{{ rail.glyph }}</span
          >
        </OButton>

        <!-- Favorites is not a fourth selector: it narrows the grid to pinned
             metrics and composes with whatever the three panels have selected.
             Hence the divider. -->
        <div class="my-1 border-t border-border-default" />

        <OButton
          :variant="grid.showFavoritesOnly.value ? 'primary' : 'ghost'"
          size="icon"
          :icon-left="
            grid.showFavoritesOnly.value ? 'favorite' : 'favorite-border'
          "
          :aria-label="favoritesTooltip"
          :aria-pressed="String(grid.showFavoritesOnly.value)"
          data-test="metrics-explorer-rail-favorite"
          @click="grid.showFavoritesOnly.value = !grid.showFavoritesOnly.value"
        >
          <OTooltip :content="favoritesTooltip" side="right" />
        </OButton>
      </nav>

      <aside
        v-if="showRailPanel"
        class="w-60 flex-none flex flex-col min-h-0 py-2 border-r border-border-default"
      >
        <!-- The title row owns Clear: it clears the ACTIVE panel's selection,
             whichever tab that is, and only shows while there is one. min-h
             pins the row at the button's height so it does not jump when the
             button appears. -->
        <div
          class="flex items-center justify-between gap-2 px-3 pb-2 min-h-[36px]"
        >
          <p class="text-xs font-semibold text-text-primary">
            {{ railHint }}
          </p>
          <OButton
            v-if="railHasSelection"
            variant="ghost-primary"
            size="xs"
            data-test="metrics-explorer-rail-clear"
            @click="clearActiveRail"
          >
            {{ t("metrics.explorer.facets.clear") }}
          </OButton>
        </div>

        <PrefixFilterPanel
          v-if="grid.activeRail.value === 'prefix'"
          mode="prefix"
          class="flex-1"
          :facets="grid.prefixFacets.value"
          :selected="grid.selectedPrefixes.value"
          @update:selected="onPrefixChange"
        />
        <PrefixFilterPanel
          v-else-if="grid.activeRail.value === 'suffix'"
          mode="suffix"
          class="flex-1"
          :facets="grid.suffixFacets.value"
          :selected="grid.selectedSuffixes.value"
          @update:selected="onSuffixChange"
        />

        <div
          v-else-if="grid.activeRail.value === 'type'"
          class="flex flex-col gap-1 px-3 overflow-y-auto"
        >
          <OCheckbox
            v-for="facet in grid.typeFacets.value"
            :key="facet.id"
            size="xs"
            :model-value="grid.selectedTypes.value.has(facet.id)"
            :label="`${badgeLabels[facet.id]} (${facet.count})`"
            :data-test="`metrics-explorer-type-${facet.id}`"
            @update:model-value="toggleType(facet.id)"
          />
        </div>
      </aside>

      <section
        ref="scrollRef"
        class="flex-1 min-w-0 overflow-y-auto p-3"
        data-test="metrics-explorer-scroll"
      >
        <div v-if="grid.loading.value" class="explorer-state">
          <OSpinner size="lg" />
          <span>{{ t("metrics.explorer.loading") }}</span>
        </div>

        <div v-else-if="grid.loadError.value" class="explorer-state">
          <OIcon name="error-outline" size="lg" class="text-error-600" />
          <span>{{ grid.loadError.value }}</span>
          <OButton
            variant="primary"
            size="sm"
            data-test="metrics-explorer-reload"
            @click="grid.loadStreams(true)"
            >{{ t("metrics.explorer.retry") }}</OButton
          >
        </div>

        <div v-else-if="!grid.cards.value.length" class="explorer-state">
          <OIcon name="show-chart" size="lg" />
          <span>{{ t("metrics.explorer.noMetrics") }}</span>
          <a
            class="text-primary underline"
            href="https://openobserve.ai/docs/user-guide/metrics/"
            target="_blank"
            rel="noopener"
            >{{ t("metrics.explorer.learnIngest") }}</a
          >
        </div>

        <div v-else-if="!visibleCards.length" class="explorer-state">
          <div
            class="w-13 h-13 rounded-xl bg-surface-subtle flex items-center justify-center"
            aria-hidden="true"
          >
            <OIcon name="query-stats" size="lg" class="text-text-secondary" />
          </div>
          <span class="text-[15px] font-bold text-text-primary">
            {{ t("metrics.explorer.noMatch") }}
            <template v-if="grid.emptyHiddenCount.value">
              {{ noDataHiddenLabel }}</template
            >
          </span>
          <span class="text-sm text-text-secondary max-w-90 text-center">
            {{ t("metrics.explorer.noMatchHint") }}
          </span>
          <!-- One button, per the redesign: it clears every filter AND flips to
               "All", so it always brings the grid back — including when the
               no-data toggle was what emptied it. -->
          <OButton
            variant="primary"
            size="sm"
            data-test="metrics-explorer-clear"
            @click="onClearAllFilters"
            >{{ t("metrics.explorer.clearAllFilters") }}</OButton
          >
        </div>

        <!-- Virtualized by ROW: only visible rows exist in the DOM, so ECharts
             instances are created and disposed along with them. -->
        <div
          v-else
          class="relative w-full"
          :style="{ height: `${virtualizer.getTotalSize()}px` }"
        >
          <!-- The row box owns the vertical rhythm: its height is exactly the
               virtualizer's estimate, and `pb-3` carves the gap out of it (the
               box is border-box). Cards stretch to fill what's left, so a row is
               always the height the virtualizer positioned it at — otherwise
               rows sit closer together than the cards are tall and visibly
               collide. -->
          <div
            v-for="row in virtualizer.getVirtualItems()"
            :key="row.key"
            class="absolute top-0 left-0 w-full pb-3"
            :class="isGrid ? 'grid gap-3' : 'flex flex-col gap-3'"
            :style="{
              transform: `translateY(${row.start}px)`,
              height: `${row.size}px`,
              gridTemplateColumns: isGrid
                ? `repeat(${columns}, minmax(0, 1fr))`
                : undefined,
            }"
          >
            <MetricCard
              v-for="(card, offset) in rowsOfCards[row.index]"
              :key="card.name"
              :card="card"
              :preview="grid.previews.value[card.name]"
              :queries="queriesFor(card)"
              :index="row.index * columns + offset"
              :is-favorite="grid.favorites.value.includes(card.name)"
              :time-range="grid.timeRange.value"
              @visible="onCardVisible"
              @hidden="onCardHidden"
              @refresh="grid.refreshCard"
              @select="onSelect"
              @configure="onConfigure"
              @toggle-favorite="grid.toggleFavorite($event.name)"
            />
          </div>
        </div>

        <div
          v-if="grid.hasMore.value && visibleCards.length"
          class="flex justify-center py-4"
        >
          <OButton
            variant="outline"
            size="sm"
            :loading="grid.showingMore.value"
            :disabled="grid.showingMore.value"
            data-test="metrics-explorer-show-more"
            @click="grid.showMore"
          >
            <!-- From the constant, not a literal: a hardcoded 9 here would go on
                 promising 9 after the increment changed, and reveal a different
                 number. -->
            {{ showMoreLabel }}
          </OButton>
        </div>
      </section>
    </div>

    <FunctionConfigDialog
      v-if="dialogCard && dialogDefaults"
      v-model="dialogOpen"
      :card="dialogCard"
      :defaults="dialogDefaults"
      :override="grid.overrides.value[dialogCard.name] ?? null"
      :color="dialogColor"
      :run-preview="runDialogPreview"
      @apply="onApplyOverride"
      @restore="onRestoreOverride"
    />
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useVirtualizer } from "@tanstack/vue-virtual";

import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

import MetricCard from "./MetricCard.vue";
import PrefixFilterPanel from "./PrefixFilterPanel.vue";
import LabelFilterBar from "./LabelFilterBar.vue";
import FunctionConfigDialog from "./FunctionConfigDialog.vue";

import useMetricsExplorerGrid, {
  PAGE_SIZE_INCREMENT,
  type LabelFilter,
} from "@/composables/metrics/useMetricsExplorerGrid";
import { buildPanelDataForCard } from "@/utils/metrics/metricsHandoff";
import { PANEL_RATE_WINDOW } from "@/utils/metrics/metricDefaults";
import { BADGE_LABELS, cardColorForIndex } from "@/utils/metrics/metricPalette";
import {
  encodeMetricsConfig,
  METRICS_BLOB_VERSION,
} from "@/composables/metrics/metricsUrlState";
import {
  EXPLORER_FILTER_PARAM_KEYS,
  explorerFiltersToQuery,
  queryToExplorerFilters,
} from "@/utils/metrics/explorerUrlState";
import {
  queryParamsToSelectedDate,
  selectedDateToQueryParams,
  refreshLabelToInterval,
  refreshIntervalToLabel,
} from "@/utils/dashboard/urlTimeParams";
import type { MetricCard as MetricCardModel } from "@/utils/metrics/metricFamily";
import segment from "@/services/segment_analytics";

/**
 * Card min width; drives the responsive column count.
 *
 * 400 rather than 300 so a row holds one fewer, wider card: at 1200/1600/2000px
 * of grid this yields 3/4/5 columns instead of 4/5/6. Wider cards give the
 * sparkline more horizontal room and let more of the metric name show before it
 * ellipsizes.
 */
const CARD_MIN_WIDTH = 400;

/** Vertical gap between rows, carved out of the row box by `pb-3`. */
const ROW_GAP = 12;
/** How tall one card is, in both views. */
const CARD_HEIGHT = 224;
/**
 * Card height + the gap. The row box is sized to exactly this.
 *
 * The same in both views: rows view used to squeeze the card into 76px, which
 * left the chart a 56px strip — too short to read, which defeats the point of
 * the wider layout. One constant rather than two, so they cannot drift.
 */
const ROW_HEIGHT = CARD_HEIGHT + ROW_GAP;

export default defineComponent({
  name: "MetricsExplorer",
  components: {
    DateTimePickerDashboard,
    AutoRefreshInterval,
    OButton,
    OIcon,
    OCheckbox,
    OSearchInput,
    OSpinner,
    OTooltip,
    OToggleGroup,
    OToggleGroupItem,
    MetricCard,
    PrefixFilterPanel,
    LabelFilterBar,
    FunctionConfigDialog,
  },
  setup() {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const grid = useMetricsExplorerGrid();

    const scrollRef = ref<HTMLElement | null>(null);
    const dateTimePickerRef = ref<any>(null);
    const refreshInterval = ref(0);
    const selectedDate = ref<any>({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });

    const isDark = computed(() => store.state.theme === "dark");
    const isGrid = computed(() => grid.viewMode.value === "grid");
    // The rendered slice. Colour index is a card's position here, which is a
    // prefix of the full sorted set, so colours stay stable as pages are added.
    const visibleCards = computed(() => grid.pagedCards.value);

    // Just the count. It used to append "· N no-data hidden", but the checkbox
    // sitting right beside it already says the no-data cards are hidden — the
    // suffix restated the control next to it and wrapped onto two lines doing
    // it. The exact number still appears where it is actually needed: the empty
    // state, where it explains why the grid has nothing in it.
    const resultCountLabel = computed(() => {
      const shown = visibleCards.value.length;
      const total = grid.cards.value.length;
      return shown === total
        ? total.toLocaleString()
        : `${shown.toLocaleString()} of ${total.toLocaleString()}`;
    });

    /* ---------------------------------------------------------- toolbar */

    // No "Recent". It ranked by what you had opened, which in practice is a
    // handful of metrics out of thousands — so the option mostly reordered
    // nothing, and it made the sort control a three-way choice to say it.
    const sortOptions = computed(() => [
      { value: "a-z", label: t("metrics.explorer.sortAsc") },
      { value: "z-a", label: t("metrics.explorer.sortDesc") },
    ]);
    const viewOptions = computed(() => [
      { value: "grid", label: t("metrics.explorer.viewGrid"), icon: "grid-on" },
      { value: "rows", label: t("metrics.explorer.viewRows"), icon: "list" },
    ]);

    /**
     * The no-data suffix on the empty state. Two keys rather than an
     * interpolated verb: "is"/"are" is not a value a translator can be handed.
     */
    const noDataHiddenLabel = computed(() =>
      t(
        grid.emptyHiddenCount.value === 1
          ? "metrics.explorer.noDataHiddenOne"
          : "metrics.explorer.noDataHiddenMany",
        { count: grid.emptyHiddenCount.value },
      ),
    );

    const showMoreLabel = computed(() =>
      t("metrics.explorer.showMore", {
        count: Math.min(PAGE_SIZE_INCREMENT, grid.remainingCount.value),
        remaining: grid.remainingCount.value.toLocaleString(),
      }),
    );

    /**
     * OToggleGroup emits `undefined` when the ACTIVE item is clicked again — it
     * models a deselect. There is no third state here (a metric list is either
     * filtered to what has data or it is not), so an undefined is ignored and the
     * current choice stands.
     */
    const onDataScope = (value: any) => {
      if (value) grid.hideEmptyPanels.value = value === "with-data";
    };

    // Same reason: the explorer always has exactly one sort and one view.
    const sortModel = computed({
      get: () => grid.sortBy.value,
      set: (v: any) => {
        if (v) grid.sortBy.value = v;
      },
    });
    const viewModel = computed({
      get: () => grid.viewMode.value,
      set: (v: any) => {
        if (v) grid.viewMode.value = v;
      },
    });

    /* ---------------------------------------------------------- layout */

    const containerWidth = ref(1200);
    const columns = computed(() =>
      isGrid.value
        ? Math.max(1, Math.floor(containerWidth.value / CARD_MIN_WIDTH))
        : 1,
    );

    const rowsOfCards = computed(() => {
      const size = columns.value;
      const out: MetricCardModel[][] = [];
      for (let i = 0; i < visibleCards.value.length; i += size) {
        out.push(visibleCards.value.slice(i, i + size));
      }
      return out;
    });

    const virtualizer = useVirtualizer(
      computed(() => ({
        count: rowsOfCards.value.length,
        getScrollElement: () => scrollRef.value,
        estimateSize: () => ROW_HEIGHT,
        overscan: 2,
      })),
    );

    let resizeObserver: ResizeObserver | null = null;

    /* ----------------------------------------------------------- rails */

    // Three filter panels, metric type last.
    //
    // Prefix and suffix carry a `glyph` instead of an `icon`: `A_` and `_Z` say
    // "matches the start of the name" / "matches the end" more plainly than any
    // icon in the registry does. Where an `icon` IS given, the name must be a
    // key in OIcon's registry — an unknown name renders nothing, silently.
    const rails = computed<
      Array<{
        id: string;
        label: string;
        icon?: string;
        glyph?: string;
      }>
    >(() => [
      {
        id: "prefix",
        glyph: "A_",
        label: t("metrics.explorer.filterByPrefix"),
      },
      {
        id: "suffix",
        glyph: "_Z",
        label: t("metrics.explorer.filterBySuffix"),
      },
      {
        id: "type",
        icon: "filter-list",
        label: t("metrics.explorer.metricType"),
      },
    ]);

    const showRailPanel = computed(() => !!grid.activeRail.value);

    // Clicking the active rail icon toggles its panel shut.
    const toggleRail = (id: any) => {
      grid.activeRail.value = grid.activeRail.value === id ? "" : id;
    };

    const railHint = computed(() =>
      t(
        grid.activeRail.value === "prefix"
          ? "metrics.explorer.filterByPrefix"
          : grid.activeRail.value === "suffix"
            ? "metrics.explorer.filterBySuffix"
            : "metrics.explorer.metricType",
      ),
    );

    /** The ACTIVE panel's selection — what the title row's Clear acts on. */
    const activeRailSelection = computed(() =>
      grid.activeRail.value === "prefix"
        ? grid.selectedPrefixes
        : grid.activeRail.value === "suffix"
          ? grid.selectedSuffixes
          : grid.selectedTypes,
    );

    const railHasSelection = computed(
      () => activeRailSelection.value.value.size > 0,
    );

    const clearActiveRail = () => {
      activeRailSelection.value.value = new Set();
    };

    const favoritesTooltip = computed(() =>
      grid.showFavoritesOnly.value
        ? t("metrics.explorer.showAllMetrics")
        : t("metrics.explorer.favorites", {
            count: grid.favorites.value.length,
          }),
    );

    /** The empty state's single way out: every filter, including no-data. */
    const onClearAllFilters = () => {
      grid.clearFilters();
      grid.hideEmptyPanels.value = false;
    };

    const toggleType = (id: string) => {
      const next = new Set(grid.selectedTypes.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      grid.selectedTypes.value = next;
      trackFilter("type");
    };

    const onPrefixChange = (next: Set<string>) => {
      grid.selectedPrefixes.value = next;
      trackFilter("prefix");
    };
    const onSuffixChange = (next: Set<string>) => {
      grid.selectedSuffixes.value = next;
      trackFilter("suffix");
    };

    /**
     * Label filters invalidate every preview (the query text changes), and the
     * IntersectionObserver only fires when a card CROSSES the viewport edge — so
     * the cards already on screen would sit on their skeletons forever with
     * nothing to re-trigger them. `requestOnScreen` is the explicit re-trigger
     * that `onScreen` exists for; the rule is written above it and this is the
     * path that was quietly breaking it.
     */
    const onAddLabelFilter = async (filter: LabelFilter) => {
      await grid.addLabelFilter(filter);
      trackFilter("label");
      await requestOnScreen({ skipCache: true });
    };

    const onRemoveLabelFilter = async (filter: LabelFilter) => {
      grid.removeLabelFilter(filter);
      await requestOnScreen({ skipCache: true });
    };

    const onClearLabelFilters = async () => {
      // Over a copy: each removal mutates the source array.
      [...grid.labelFilters.value].forEach((f) => grid.removeLabelFilter(f));
      await requestOnScreen({ skipCache: true });
    };

    /* -------------------------------------------------------- previews */

    const queriesFor = (card: MetricCardModel) =>
      grid.effectiveVariant(card).resolved?.queries ?? [];

    /* ---------------------------------------------------------- dialog */

    const dialogOpen = ref(false);
    const dialogCard = ref<MetricCardModel | null>(null);

    const dialogDefaults = computed(() =>
      dialogCard.value
        ? grid.effectiveVariant(dialogCard.value).defaults
        : null,
    );

    const dialogColor = computed(() => {
      const index = visibleCards.value.findIndex(
        (c) => c.name === dialogCard.value?.name,
      );
      return cardColorForIndex(Math.max(0, index), isDark.value);
    });

    const onConfigure = (card: MetricCardModel) => {
      dialogCard.value = card;
      dialogOpen.value = true;
    };

    /** Dialog tiles share the grid's scheduler, at a priority that outranks it. */
    const runDialogPreview = (expr: string) =>
      dialogCard.value
        ? grid.runDialogQuery(expr, dialogCard.value)
        : Promise.resolve(null);

    // Closing the dialog abandons whatever its tiles were still fetching.
    watch(dialogOpen, (open) => {
      if (open || !dialogDefaults.value) return;
      const exprs = (dialogDefaults.value.variants ?? []).flatMap((v: any) =>
        v.queries.map((q: any) => q.expr),
      );
      if (dialogCard.value) grid.cancelDialogQueries(exprs, dialogCard.value);
    });

    const onApplyOverride = (payload: {
      variantId: string;
      options?: Record<string, any>;
    }) => {
      const card = dialogCard.value;
      if (!card) return;
      grid.setOverride(card.name, payload);
      grid.requestPreview(card);
      track("metrics_explorer_fn_override", {
        action: "applied",
        card_kind: card.cardKind,
        variant_id: payload.variantId,
      });
      dialogOpen.value = false;
    };

    const onRestoreOverride = () => {
      const card = dialogCard.value;
      if (!card) return;
      grid.setOverride(card.name, null);
      grid.requestPreview(card);
      track("metrics_explorer_fn_override", {
        action: "restored",
        card_kind: card.cardKind,
        variant_id: "",
      });
      dialogOpen.value = false;
    };

    /* ---------------------------------------------------- Select handoff */

    const onSelect = (card: MetricCardModel) => {
      // Resolved for a PANEL, not for the card: the rate window goes over as
      // `$__rate_interval` rather than the concrete window the card charted, so
      // the editor re-derives it against its own range and width. Otherwise the
      // panel arrives frozen at whatever the range happened to be on the card —
      // and a 4-minute rate window sampled every 30 minutes on a 7-day view is
      // not a chart of anything.
      const { defaults, resolved } = grid.effectiveVariant(card, undefined, {
        rateWindow: PANEL_RATE_WINDOW,
      });
      if (!resolved) return;

      track("metrics_explorer_card_selected", {
        card_kind: card.cardKind,
        had_override: !!grid.overrides.value[card.name],
      });

      const data = buildPanelDataForCard(card, resolved, defaults.bucketUnit);

      router.push({
        name: "metricsEditor",
        query: {
          org_identifier: store.state.selectedOrganization?.identifier,
          metrics_data: encodeMetricsConfig({ v: METRICS_BLOB_VERSION, data }),
          ...selectedDateToQueryParams(selectedDate.value),
          ...(refreshInterval.value
            ? { refresh: refreshIntervalToLabel(refreshInterval.value) }
            : {}),
        },
      });
    };

    /* --------------------------------------------------------------- URL */

    // Restore synchronously, before children mount: the picker reads
    // selectedDate as its initial model, and the first preview queries must
    // already carry the label matchers.
    const applyUrlState = () => {
      const q = route.query as Record<string, any>;
      const f = queryToExplorerFilters(q);

      if (f.searchTerm !== undefined) grid.searchTerm.value = f.searchTerm;
      if (f.selectedPrefixes) grid.selectedPrefixes.value = f.selectedPrefixes;
      if (f.selectedSuffixes) grid.selectedSuffixes.value = f.selectedSuffixes;
      if (f.selectedTypes) grid.selectedTypes.value = f.selectedTypes;
      if (f.showFavoritesOnly !== undefined)
        grid.showFavoritesOnly.value = f.showFavoritesOnly;
      if (f.hideEmptyPanels !== undefined)
        grid.hideEmptyPanels.value = f.hideEmptyPanels;
      if (f.sortBy) grid.sortBy.value = f.sortBy;
      if (f.viewMode) grid.viewMode.value = f.viewMode;
      if (f.labelFilters) {
        grid.labelFilters.value = f.labelFilters;
        // Without membership data the chips fail open and narrow nothing.
        grid.ensureSchemas();
      }

      if (q.period || (q.from && q.to)) {
        selectedDate.value = queryParamsToSelectedDate(q);
      }
      if (q.refresh != null) {
        refreshInterval.value = refreshLabelToInterval(
          q.refresh,
          store.state?.zoConfig?.min_auto_refresh_interval || 0,
        );
      }
    };
    applyUrlState();

    // State -> URL via replace, so filter changes never stack history entries.
    // Managed keys are wiped first — a cleared filter must leave the URL, and
    // anything else (org_identifier) rides along untouched. Defaults serialize
    // to nothing, so an unfiltered grid keeps a bare /metrics URL.
    const syncUrlState = () => {
      const query: Record<string, any> = { ...route.query };
      for (const key of EXPLORER_FILTER_PARAM_KEYS) delete query[key];
      delete query.period;
      delete query.from;
      delete query.to;
      delete query.refresh;

      Object.assign(
        query,
        explorerFiltersToQuery({
          searchTerm: grid.searchTerm.value,
          selectedPrefixes: grid.selectedPrefixes.value,
          selectedSuffixes: grid.selectedSuffixes.value,
          selectedTypes: grid.selectedTypes.value,
          labelFilters: grid.labelFilters.value,
          showFavoritesOnly: grid.showFavoritesOnly.value,
          hideEmptyPanels: grid.hideEmptyPanels.value,
          sortBy: grid.sortBy.value,
          viewMode: grid.viewMode.value,
        }),
      );
      const time: any = selectedDateToQueryParams(selectedDate.value);
      // The default window is recoverable from its absence, like the filters.
      if (time.period !== "15m") Object.assign(query, time);
      if (refreshInterval.value)
        query.refresh = refreshIntervalToLabel(refreshInterval.value);

      const changed =
        Object.keys(query).some(
          (k) => String(query[k]) !== String(route.query[k] ?? ""),
        ) || Object.keys(route.query).some((k) => !(k in query));
      if (changed) router.replace({ query }).catch(() => {});
    };

    // A getter, not an array of refs: reading `.value` inside it tracks every
    // dependency, and the callback fires on any of them changing.
    watch(
      () => [
        grid.searchTerm.value,
        grid.selectedPrefixes.value,
        grid.selectedSuffixes.value,
        grid.selectedTypes.value,
        grid.labelFilters.value,
        grid.showFavoritesOnly.value,
        grid.hideEmptyPanels.value,
        grid.sortBy.value,
        grid.viewMode.value,
        selectedDate.value,
        refreshInterval.value,
      ],
      syncUrlState,
    );

    /* ------------------------------------------------------------- time */

    /**
     * Which cards are currently on screen.
     *
     * The IntersectionObserver fires only when a card *crosses* the viewport
     * edge. So after any invalidation the cards already on screen would sit
     * there empty forever — nothing re-triggers them. Anything that invalidates
     * must therefore re-request this set explicitly.
     */
    const onScreen = new Map<string, MetricCardModel>();

    const onCardVisible = (card: MetricCardModel) => {
      onScreen.set(card.name, card);
      grid.requestPreview(card);
    };

    const onCardHidden = (card: MetricCardModel) => {
      onScreen.delete(card.name);
      grid.cancelPreview(card);
    };

    /**
     * @param skipCache the persisted card cache is for PAINTING a first visit
     *   instantly. A refresh or a deliberate time-range change must reach the
     *   backend, or the user would ask for new data and get the old result back.
     */
    const requestOnScreen = (opts?: { skipCache?: boolean }) => {
      // Cards unmounted by the virtualizer now emit `hidden`, so `onScreen` is
      // accurate — but a filter change can also drop a card from the result set
      // without unmounting it in the same tick. Intersecting with what is
      // actually rendered keeps a refresh from re-querying metrics nobody can see.
      const rendered = new Set(visibleCards.value.map((c) => c.name));
      const live = [...onScreen.values()].filter((c) => rendered.has(c.name));
      return Promise.all(live.map((card) => grid.requestPreview(card, opts)));
    };

    const syncTimeRange = (opts?: { keepPreviews?: boolean }) => {
      const consumable = dateTimePickerRef.value?.getConsumableDateTime?.();
      if (!consumable) return;
      grid.setTimeRange(
        { start_time: consumable.startTime, end_time: consumable.endTime },
        opts,
      );
    };

    const refreshing = ref(false);

    const onDateChange = async () => {
      // `dateTimePickerRef.refresh()` re-emits a date change, so a manual
      // refresh lands here too. Ignore it: onRefresh is already driving, and
      // this path wipes the previews — which is what was blanking every chart
      // to a skeleton on each refresh.
      if (refreshing.value) return;

      syncTimeRange();
      // A deliberate change of window must reach the backend — repainting the
      // persisted result would hand the user back the data they just moved away
      // from.
      await requestOnScreen({ skipCache: true });
    };

    /**
     * Manual refresh.
     *
     * Advances a relative window to "now", drops cached responses (an absolute
     * range would otherwise reuse the same cache key and refresh nothing), and
     * re-runs the on-screen cards in place — the old chart stays up while the
     * new one loads, so there is no skeleton flash.
     */
    const onRefresh = async (opts?: { manual?: boolean }) => {
      if (refreshing.value) return;
      refreshing.value = true;
      const manual = opts?.manual !== false;
      try {
        dateTimePickerRef.value?.refresh?.();
        // Keep the charts up: a refresh re-runs the same queries a few seconds
        // later, so blanking them to skeletons would just make them flicker.
        syncTimeRange({ keepPreviews: true });
        grid.clearPreviewCache();
        await Promise.all([
          requestOnScreen({ skipCache: true }),
          // A MANUAL refresh is the user asking to look again, so cards hidden as
          // no-data get another chance — a metric that has started emitting since
          // it was hidden can never come back otherwise (hidden ⇒ not rendered ⇒
          // not queried ⇒ still hidden). The sweep re-queries them WHERE THEY ARE,
          // still hidden, and they return to the grid only if they now have
          // samples. Un-hiding them first (which is what this used to do) put
          // every no-data card back on screen and left the ones nobody scrolled
          // to sitting there.
          //
          // An auto-refresh tick sweeps too, but without `skipCache` — it picks
          // up cards the user has not reached yet and leaves the known-empty ones
          // alone, so a tick cannot reshuffle the grid under the cursor.
          grid.sweepSlice({ skipCache: manual }),
        ]);
      } finally {
        refreshing.value = false;
      }
    };

    /** The auto-refresh timer. Keeps the no-data set; see onRefresh. */
    const onRefreshTick = () => onRefresh({ manual: false });

    watch(refreshInterval, (value) => grid.setRefreshInterval(value));

    /* -------------------------------------------------------- telemetry */

    const track = (event: string, properties: Record<string, any> = {}) => {
      try {
        segment.track(event, {
          org_id: store.state.selectedOrganization?.identifier,
          ...properties,
        });
      } catch {
        // Telemetry must never break the page.
      }
    };

    const trackFilter = (kind: string) =>
      track("metrics_explorer_filter_applied", {
        kind,
        active_filter_count: grid.activeFilterCount.value,
      });

    // The search terms themselves are never sent — only how many there were.
    watch(
      () => grid.searchTerm.value,
      (term) => {
        if (!term) return;
        track("metrics_explorer_searched", {
          term_count: String(term)
            .split(/[^a-z0-9_:]+/i)
            .filter(Boolean).length,
        });
      },
    );

    /* ------------------------------------------------------- lifecycle */

    let mountedAt = 0;
    let firstRenderTracked = false;

    watch(
      () => grid.previews.value,
      (map) => {
        if (firstRenderTracked) return;
        if (Object.values(map).some((p: any) => p.status === "done")) {
          firstRenderTracked = true;
          track("metrics_explorer_first_render", {
            ms: Math.round(performance.now() - mountedAt),
          });
        }
      },
      { deep: true },
    );

    onMounted(async () => {
      mountedAt = performance.now();
      syncTimeRange();
      await grid.loadStreams();

      track("metrics_explorer_opened", {
        metric_count: grid.cards.value.length,
        entry: "direct",
      });

      if (scrollRef.value && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver((entries) => {
          containerWidth.value = entries[0]?.contentRect.width ?? 1200;
        });
        resizeObserver.observe(scrollRef.value);
      }
    });

    onBeforeUnmount(() => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      grid.invalidateAll();
    });

    watch(
      () => store.state.selectedOrganization?.identifier,
      () => {
        grid.onOrgChange();
        grid.loadStreams(true);
      },
    );

    return {
      t,
      store,
      grid,
      scrollRef,
      dateTimePickerRef,
      selectedDate,
      refreshInterval,
      isGrid,
      columns,
      rowsOfCards,
      virtualizer,
      onDataScope,
      visibleCards,
      resultCountLabel,
      rails,
      showRailPanel,
      toggleRail,
      railHint,
      railHasSelection,
      clearActiveRail,
      favoritesTooltip,
      onClearAllFilters,
      toggleType,
      onPrefixChange,
      onSuffixChange,
      onAddLabelFilter,
      onRemoveLabelFilter,
      onClearLabelFilters,
      sortOptions,
      PAGE_SIZE_INCREMENT,
      viewOptions,
      sortModel,
      viewModel,
      noDataHiddenLabel,
      showMoreLabel,
      badgeLabels: BADGE_LABELS,
      queriesFor,
      dialogOpen,
      dialogCard,
      dialogDefaults,
      dialogColor,
      onConfigure,
      runDialogPreview,
      onApplyOverride,
      onRestoreOverride,
      onSelect,
      onDateChange,
      onRefreshTick,
      onCardVisible,
      onCardHidden,
      onRefresh,
      refreshing,
    };
  },
});
</script>

<style scoped lang="scss">
.explorer-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 60%;
  opacity: 0.8;
}
</style>
