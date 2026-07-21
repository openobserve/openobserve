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
    <!-- No page title: Metrics is an EXPLORE surface like Logs and Traces, so the
         first row is the toolbar — scope on the left, time on the right, like the
         Logs toolbar. -->
    <!-- items-center: LabelFilterBar wraps its own chips internally (flex-wrap),
         so the row keeps every control on one centred line rather than items-start. -->
    <!-- `p-1.5`, the SAME padding the Logs and Traces toolbars use
         (SearchBar.vue:23 / traces SearchBar.vue:19), so the toolbars share geometry. -->
    <div
      class="flex items-center gap-2 shrink-0 p-1.5 border-b border-border-default"
      data-test="metrics-explorer-filter-bar"
    >
      <!-- Page mode toggle at the start of the toolbar — Explore (browse grid)
           vs Visualize (query workspace). Same OToggleGroup + icon-left pattern
           the Logs (Search/Visualize) and Traces toolbars use, so the mode
           switch reads identically across the observability pages. -->
      <OToggleGroup
        :model-value="mode"
        type="single"
        class="shrink-0"
        data-test="metrics-explorer-mode"
        @update:model-value="setMode"
      >
        <OToggleGroupItem
          value="explore"
          size="sm"
          data-test="metrics-explorer-mode-explore"
        >
          <template #icon-left>
            <OIcon name="search" size="sm" class="shrink-0" />
          </template>
          {{ t("metrics.explorer.modeExplore") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="visualize"
          size="sm"
          data-test="metrics-explorer-mode-visualize"
        >
          <!-- The wrench (`build`), matching the Logs toolbar's Visualize —
               Visualize is where you BUILD a chart, and the two pages must not
               name the same job with different glyphs. -->
          <template #icon-left>
            <OIcon name="build" size="sm" class="shrink-0" />
          </template>
          {{ t("metrics.explorer.modeVisualize") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="workspace"
          size="sm"
          data-test="metrics-explorer-mode-workspace"
        >
          <!-- `favorite-border` (outline), not the filled `favorite`: a filled
               heart is the card's ON state and on a tab would read as "already
               favourited" rather than "your favourites live here". -->
          <template #icon-left>
            <OIcon name="favorite-border" size="sm" class="shrink-0" />
          </template>
          {{ t("metrics.explorer.modeWorkspace") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <!-- The filter control has its own row below (see `metrics-explorer-
           filter-row`). This spacer is what pins the time cluster right. -->
      <div class="flex-1" />

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
        <!-- Labeled Refresh button. In Visualize it re-runs the chart's query;
             in Explore/Workspace it refreshes the grid — so its
             disabled/loading state follows the grid only there. -->
        <OButton
          variant="primary"
          size="sm-toolbar"
          icon-left="refresh"
          :disabled="isGridMode && (refreshing || grid.loading.value)"
          :loading="isGridMode && refreshing"
          data-test="metrics-explorer-refresh"
          @click="onRefresh"
        >
          {{ t("metrics.explorer.refresh") }}
        </OButton>
        <ShareButton
          v-if="shareUrl"
          :url="shareUrl"
          variant="outline"
          size="icon-toolbar"
          data-test="metrics-explorer-share-btn"
        />
      </div>
    </div>

    <!--
      The filter row. Its own line, not a slot in the toolbar: a matcher's width
      is unbounded (a regex value, any number of them), so it needs the full width.

      ALWAYS present in grid mode, never `v-if="labelFilters.length"` — a row that
      appeared with the first filter would push the grid down as the user reads it.

      Explore + Workspace only: in Visualize the PromQL query carries its own
      matchers, so a filter bar would conflict with it.
    -->
    <div
      v-if="isGridMode"
      class="flex items-center gap-2 shrink-0 p-1.5 border-b border-border-default"
      data-test="metrics-explorer-filter-row"
    >
      <!-- No "Filters" caption: the chips already read `action = accept_challenge`
           and the button already says "+ Filter", so a label in front of them
           only spends the row's leading space to name what is self-evident. -->
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

    <!-- EXPLORE + FAVOURITES — the same browse grid. Favourites is that grid
         narrowed to the metrics you ♥'d, so the body is identical bar the facet
         panel (Explore only): the right column is the search row + grid. -->
    <div v-if="isGridMode" class="flex flex-1 min-h-0">
      <!-- Facet panel — EXPLORE only. It is an editing control (filter by
           prefix/suffix/type); Workspace is a read-only lens viewer, so it shows
           just the grid (with the Views rail), no facets. -->
      <aside
        v-if="isExplore"
        class="w-60 flex-none flex flex-col min-h-0 border-r border-border-default"
        :aria-label="t('metrics.explorer.railsAriaLabel')"
      >
        <!-- Panel header: the facet selector, stretched to fill the column.
             Clear does NOT live here (it collided with the tabs in a 240px
             column); it sits in each facet's search row below instead. -->
        <div
          class="shrink-0 flex items-center px-2 py-2"
        >
          <!-- Natural, content-sized segmented control (not forced full-width —
               that fought the component and clumped the labels). The count sits
               in a FIXED-WIDTH slot that is always present (empty when there is
               no selection), so a count appearing or changing 2→12 never nudges
               the label. Right-aligned + tabular-nums so every count width is the
               same. -->
          <OToggleGroup
            :model-value="grid.activeRail.value"
            type="single"
            data-test="metrics-explorer-rail-toggle"
            @update:model-value="selectRail"
          >
            <OToggleGroupItem
              v-for="rail in rails"
              :key="rail.id"
              :value="rail.id"
              size="sm"
              :data-test="`metrics-explorer-rail-${rail.id}`"
            >
              <span class="flex items-center gap-1">
                <span>{{ rail.label }}</span>
                <span
                  class="w-4 shrink-0 text-right text-2xs font-semibold tabular-nums text-primary"
                  :data-test="`metrics-explorer-rail-count-${rail.id}`"
                  >{{ rail.count || "" }}</span
                >
              </span>
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <!-- Clear rides in each facet's search row (right edge), where there is
             horizontal room — so it never collides with the tabs or shifts the
             list. `has-selection` shows it only when there is something to clear. -->
        <PrefixFilterPanel
          v-if="grid.activeRail.value === 'prefix'"
          mode="prefix"
          class="flex-1 min-h-0 py-2"
          :facets="grid.prefixFacets.value"
          :selected="grid.selectedPrefixes.value"
          :has-selection="railHasSelection"
          @update:selected="onPrefixChange"
          @clear="clearActiveRail"
        />
        <PrefixFilterPanel
          v-else-if="grid.activeRail.value === 'suffix'"
          mode="suffix"
          class="flex-1 min-h-0 py-2"
          :facets="grid.suffixFacets.value"
          :selected="grid.selectedSuffixes.value"
          :has-selection="railHasSelection"
          @update:selected="onSuffixChange"
          @clear="clearActiveRail"
        />

        <div
          v-else-if="grid.activeRail.value === 'type'"
          class="flex flex-col min-h-0 flex-1 py-2"
        >
          <!-- Type search — narrows the type LIST (mirrors the prefix/suffix
               rails). The flex-1/py-2 above match the PrefixFilterPanel wrapper
               (class="flex-1 min-h-0 py-2") so the search box sits at the exact
               same Y when switching Prefix / Suffix / Type. px-2 matches the
               facet toggle's horizontal padding above. -->
          <div class="px-2 pb-2">
            <OInput
              v-model="typeSearch"
              size="sm"
              clearable
              :placeholder="t('metrics.explorer.facets.searchTypes')"
              :aria-label="t('metrics.explorer.facets.searchTypesAria')"
              data-test="metrics-explorer-type-search"
            />
          </div>
          <!-- Always-present "Clear filters" row so the affordance is consistent
               across all three facets. Count + button always shown; button
               disabled when nothing is selected — no disappearing controls. -->
          <div
            class="flex items-center justify-between gap-2 px-3 pb-2"
          >
            <span class="text-xs text-text-secondary tabular-nums">
              {{ t("metrics.explorer.facets.selectedCount", { count: grid.selectedTypes.value.size }) }}
            </span>
            <OButton
              variant="ghost-primary"
              size="xs"
              :disabled="!railHasSelection"
              data-test="metrics-explorer-type-clear"
              @click="clearActiveRail"
            >
              {{ t("metrics.explorer.facets.clearFilters") }}
            </OButton>
          </div>
          <!-- OCheckboxGroup owns the checked-state and toggling; each OCheckbox
               is a member via its `value`. `selectedTypes` stays a Set across the
               composable / URL state — the array<->Set conversion is confined to
               this one binding (`selectedTypesArray`). -->
          <OCheckboxGroup
            v-if="visibleTypeFacets.length"
            :model-value="selectedTypesArray"
            class="px-3 pb-2 overflow-y-auto"
            @update:model-value="onSelectedTypesChange"
          >
            <OCheckbox
              v-for="facet in visibleTypeFacets"
              :key="facet.id"
              size="xs"
              :value="facet.id"
              :label="`${badgeLabels[facet.id]} (${facet.count})`"
              :data-test="`metrics-explorer-type-${facet.id}`"
            />
          </OCheckboxGroup>
          <OEmptyState
            v-else
            size="inline"
            icon="search-off"
            :title="t('metrics.explorer.facets.noTypeMatch')"
            data-test="metrics-explorer-type-empty"
          />
        </div>
      </aside>

      <!-- Right column: the search row on top, the grid beneath. Its left edge
           is where the grid cards start, so the search bar is width-matched to
           the cards (not the full page), and the facet panel to its left runs
           the full height alongside it. -->
      <div class="flex-1 min-w-0 flex flex-col min-h-0">
        <div
          class="flex items-center gap-2 px-3 py-2 border-b border-border-default"
        >
          <!-- The scope toggle lives INSIDE the field, the way the dashboard
               list's folder scope does: it is a property of the search — which
               metrics you are looking through — not another control beside it. -->
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

          <!-- Announced, so a screen reader hears the count change as the user
               types. `shrink-0` + `nowrap` so the growing search field does not
               wrap "60 of 3,315" across two lines. -->
          <span
            aria-live="polite"
            data-test="metrics-explorer-count"
            class="shrink-0 whitespace-nowrap text-xs text-text-secondary tabular-nums"
            >{{ resultCountLabel }}</span
          >

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

          <!-- Convert to dashboard: each favourite becomes a panel. FAVOURITES
               only, where they are what's on screen. -->
          <OButton
            v-if="isWorkspace && grid.favorites.value.length"
            variant="outline"
            size="sm-action"
            icon-left="dashboard-customize"
            data-test="metrics-explorer-convert-dashboard"
            @click="openConvertToDashboard"
          >
            {{ t("metrics.explorer.convertToDashboard") }}
            <OTooltip
              :content="
                t('metrics.explorer.convertToDashboardTooltip', {
                  count: grid.favorites.value.length,
                })
              "
            />
          </OButton>
        </div>

        <section
          ref="scrollRef"
          class="flex-1 min-w-0 overflow-y-auto p-3"
          :class="gridVisible ? '' : 'flex flex-col items-center justify-center'"
          data-test="metrics-explorer-scroll"
        >
        <div v-if="grid.loading.value" class="flex flex-col items-center justify-center gap-2.5 h-3/5 opacity-80">
          <OSpinner size="lg" />
          <span>{{ t("metrics.explorer.loading") }}</span>
        </div>

        <OEmptyState
          v-else-if="grid.loadError.value"
          size="block"
          preset="load-error"
          :description="grid.loadError.value"
          data-test="metrics-explorer-load-error"
          @action="grid.loadStreams(true)"
        />

        <!-- Zero metrics in the org — a "set up ingestion" state, not a filter
             miss. Keeps the metrics-specific heading and the docs link. -->
        <OEmptyState
          v-else-if="!grid.cards.value.length"
          size="block"
          preset="no-streams"
          :title="t('metrics.explorer.noMetrics')"
          :action-label="t('metrics.explorer.learnIngest')"
          data-test="metrics-explorer-no-metrics"
          @action="openIngestDocs"
        />

        <!-- FAVOURITES with none added yet — the reason is not "filters hid
             everything", so show the right guidance (add one in Explore) and NO
             filter-clearing action. -->
        <OEmptyState
          v-else-if="isWorkspace && !grid.favorites.value.length"
          size="block"
          variant="create"
          illustration="board"
          :title="t('metrics.explorer.workspace.emptyScratchpadTitle')"
          :description="t('metrics.explorer.workspace.emptyScratchpadDesc')"
          data-test="metrics-workspace-empty-grid"
        />

        <!-- Every remedy the hint names, as an action card — but only the ones
             that would actually change anything right now: each card is gated
             on its own cause being active. "Clear all filters" is always last. -->
        <OEmptyState
          v-else-if="!visibleCards.length"
          size="block"
          preset="no-search-results"
          :title="t('metrics.explorer.noMatch')"
          :description="noMatchDescription"
          :actions="noMatchActions"
          data-test="metrics-explorer-no-match"
          @action="onEmptyStateAction"
        />

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
              @zoom="onCardZoom"
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
    </div>

    <!-- VISUALIZE mode — the query-driven workspace. Mounts the constrained
         pageType="metrics" PanelEditor (same engine as the metrics editor route),
         where the user writes PromQL and builds a chart. Keyed on mode so it
         re-initialises its panel state cleanly each time Visualize is entered. -->
    <MetricsVisualize
      v-else-if="mode === 'visualize'"
      ref="visualizeRef"
      key="metrics-visualize"
      class="flex-1 min-h-0"
      :selected-date-time="visualizeDateTime"
      :seed="visualizeSeed"
      @seed-consumed="visualizeSeed = null"
    />

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

    <!-- Convert to dashboard: adds every pinned metric as its own panel. Reuses
         the metrics AddToDashboard dialog in its multi-panel mode. -->
    <AddToDashboard
      v-model:open="convertDialogOpen"
      :dashboard-panel-data="{ data: {} }"
      :panels="convertPanels"
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
import useTheme from "@/composables/useTheme";
import { useVirtualizer } from "@tanstack/vue-virtual";
import { isEqual, debounce } from "lodash-es";

import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OCheckboxGroup from "@/lib/forms/Checkbox/OCheckboxGroup.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { EmptyStateAction } from "@/lib/core/EmptyState/presets";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

import ShareButton from "@/components/common/ShareButton.vue";
import MetricCard from "./MetricCard.vue";
import MetricsVisualize from "./MetricsVisualize.vue";
import AddToDashboard from "../AddToDashboard.vue";
import PrefixFilterPanel from "./PrefixFilterPanel.vue";
import LabelFilterBar from "./LabelFilterBar.vue";
import FunctionConfigDialog from "./FunctionConfigDialog.vue";

import useMetricsExplorerGrid, {
  PAGE_SIZE_INCREMENT,
  type LabelFilter,
} from "@/composables/metrics/useMetricsExplorerGrid";
import { buildPanelDataForCard } from "@/utils/metrics/metricsHandoff";
import {
  getMetricsConfig,
  encodeMetricsConfig,
  decodeMetricsConfig,
} from "@/composables/metrics/metricsUrlState";
import { PANEL_RATE_WINDOW } from "@/utils/metrics/metricDefaults";
import { BADGE_LABELS, cardColorForIndex } from "@/utils/metrics/metricPalette";
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
 * The same in both views (one constant rather than two, so they cannot drift).
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
    OCheckboxGroup,
    OInput,
    OSearchInput,
    OSpinner,
    OEmptyState,
    OTag,
    OTooltip,
    OToggleGroup,
    OToggleGroupItem,
    ShareButton,
    MetricCard,
    MetricsVisualize,
    AddToDashboard,
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
    /** A factory, not a literal: the route watcher resets to this too. */
    const defaultSelectedDate = () => ({
      valueType: "relative",
      startTime: null,
      endTime: null,
      relativeTimePeriod: "15m",
    });
    const selectedDate = ref<any>(defaultSelectedDate());

    const { isDark } = useTheme();
    const isGrid = computed(() => grid.viewMode.value === "grid");
    // The rendered slice. Colour index is a card's position here, which is a
    // prefix of the full sorted set, so colours stay stable as pages are added.
    const visibleCards = computed(() => grid.pagedCards.value);

    // Whether the body is rendering the virtualized grid vs a state placeholder
    // (loading / error / empty). The grid must stay top-aligned for the
    // virtualizer; every placeholder is centered in the scroll area instead.
    // `visibleCards.length > 0` implies not-loading, not-errored, and — in
    // Workspace — that favorites matched, so it's exactly the grid's own branch.
    const gridVisible = computed(
      () =>
        !grid.loading.value &&
        !grid.loadError.value &&
        visibleCards.value.length > 0,
    );

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

    // Page mode — the Explore browse grid vs the query-driven Visualize
    // workspace. Local to the component (it is not grid data), synced to the URL
    // as `?mode=` like Logs' `logs_visualize_toggle`. The setter ignores the
    // OToggleGroup deselect (undefined) so a re-click can't leave a blank mode.
    const mode = ref<"explore" | "visualize" | "workspace">("explore");
    const isExplore = computed(() => mode.value === "explore");
    const isWorkspace = computed(() => mode.value === "workspace");
    // Explore and Workspace share the grid + facet body (Workspace adds a views
    // rail); only Visualize swaps to the query workspace.
    const isGridMode = computed(
      () => mode.value === "explore" || mode.value === "workspace",
    );
    const setMode = (v: string | number | undefined) => {
      if (v !== "explore" && v !== "visualize" && v !== "workspace") return;
      // Pause BEFORE the mode flips, synchronously. The watcher below also keeps
      // `paused` in sync, but it runs after the DOM has begun tearing the grid
      // down — and the teardown's own "card visible" events would already have
      // fired a query each. Setting it here closes that window.
      grid.paused.value = v === "visualize";
      mode.value = v;
    };

    // The Favourites tab = only the metrics you ♥'d. So it forces the
    // favourites-only narrowing; Explore browses everything. `showFavoritesOnly`
    // is the existing narrowing mechanism — the mode drives it.
    watch(
      isWorkspace,
      (on) => {
        grid.showFavoritesOnly.value = on;
      },
      { immediate: true },
    );

    // Pause the grid whenever it is not on screen (Visualize). The grid sweeps
    // its slice whenever the slice changes — and switching modes changes it (the
    // pinned-only narrowing flips). Unpaused, that sweep re-queries every card
    // for a grid the user just navigated away from.
    watch(
      isGridMode,
      (on) => {
        grid.paused.value = !on;
      },
      { immediate: true },
    );

    /* ---------------------------------------------------------- layout */

    const containerWidth = ref(1200);
    // Grid view holds at most two columns (a 2-up layout): wider cards give the
    // sparkline more horizontal room and let more of the metric name show. On a
    // narrow container it still drops to one; it never grows past two.
    const MAX_GRID_COLUMNS = 2;
    const columns = computed(() =>
      isGrid.value
        ? Math.min(
            MAX_GRID_COLUMNS,
            Math.max(1, Math.floor(containerWidth.value / CARD_MIN_WIDTH)),
          )
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

    // (Re)attach the width observer to the CURRENT scroll element, disconnecting
    // any previous one. Also sets the width immediately from `clientWidth`, so the
    // column count is right on the first frame after the body (re)mounts rather
    // than waiting for the observer's first async callback.
    const observeScrollWidth = () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      const el = scrollRef.value;
      if (!el || typeof ResizeObserver === "undefined") return;
      containerWidth.value = el.clientWidth || containerWidth.value;
      resizeObserver = new ResizeObserver((entries) => {
        containerWidth.value = entries[0]?.contentRect.width ?? 1200;
      });
      resizeObserver.observe(el);
    };

    /* ----------------------------------------------------------- rails */

    // Three filter panels, metric type last.
    //
    // Prefix and suffix carry a `glyph` instead of an `icon`: `A_` and `_Z` say
    // "matches the start of the name" / "matches the end" more plainly than any
    // icon in the registry does. Where an `icon` IS given, the name must be a
    // key in OIcon's registry — an unknown name renders nothing, silently.
    const rails = computed<
      Array<{
        id: "prefix" | "suffix" | "type";
        label: string;
        /** Active selections in this rail's panel — the toggle's count. */
        count: number;
      }>
    >(() => [
      {
        id: "prefix",
        label: t("metrics.explorer.tabPrefix"),
        count: grid.selectedPrefixes.value.size,
      },
      {
        id: "suffix",
        label: t("metrics.explorer.tabSuffix"),
        count: grid.selectedSuffixes.value.size,
      },
      {
        id: "type",
        label: t("metrics.explorer.tabType"),
        count: grid.selectedTypes.value.size,
      },
    ]);

    // The facet panel is always open — selecting a facet switches which one it
    // shows; it never collapses to nothing. OToggleGroup emits `undefined` on a
    // re-click (it models a deselect); we IGNORE that so the active facet stays
    // put and the panel never blanks. Default is prefix (grid composable).
    const selectRail = (id: string | number | undefined) => {
      if (!id) return;
      grid.activeRail.value = id as "prefix" | "suffix" | "type";
    };

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

    /** The empty state's single way out: every filter, including no-data. */
    const onClearAllFilters = () => {
      grid.clearFilters();
      grid.hideEmptyPanels.value = false;
    };

    /**
     * The hint, with the hidden-count sentence in front when it applies. In
     * Favorites the prefix/suffix facets are ignored, so the hint there must not
     * name them (it would point at a remedy that changes nothing).
     */
    const noMatchDescription = computed(() => {
      const hint = grid.showFavoritesOnly.value
        ? t("metrics.explorer.noMatchHintFavorites")
        : t("metrics.explorer.noMatchHint");
      return grid.emptyHiddenCount.value
        ? `${noDataHiddenLabel.value} ${hint}`
        : hint;
    });

    /**
     * One card per remedy the hint names — gated on its cause, so a card is
     * never an offer to clear something that is not set. Keys, not strings:
     * OEmptyState's action cards run titleKey/descriptionKey through t().
     */
    const noMatchActions = computed(() => {
      const actions: EmptyStateAction[] = [];
      if (grid.searchTerm.value) {
        actions.push({
          id: "clear-search",
          icon: "search",
          titleKey: "metrics.explorer.emptyActions.clearSearch",
          descriptionKey: "metrics.explorer.emptyActions.clearSearchDesc",
        });
      }
      if (grid.labelFilters.value.length) {
        actions.push({
          id: "clear-labels",
          icon: "label",
          titleKey: "metrics.explorer.emptyActions.clearLabels",
          descriptionKey: "metrics.explorer.emptyActions.clearLabelsDesc",
        });
      }
      // Favorites ignores prefix/suffix/type (their panel is Explore-only), so
      // clearing them would not change the result — don't offer it there.
      if (
        !grid.showFavoritesOnly.value &&
        (grid.selectedPrefixes.value.size ||
          grid.selectedSuffixes.value.size ||
          grid.selectedTypes.value.size)
      ) {
        actions.push({
          id: "clear-facets",
          icon: "filter-list",
          titleKey: "metrics.explorer.emptyActions.clearFacets",
          descriptionKey: "metrics.explorer.emptyActions.clearFacetsDesc",
        });
      }
      if (grid.showFavoritesOnly.value) {
        actions.push({
          id: "clear-favorites",
          icon: "favorite",
          titleKey: "metrics.explorer.emptyActions.clearFavorites",
          descriptionKey: "metrics.explorer.emptyActions.clearFavoritesDesc",
        });
      }
      if (grid.hideEmptyPanels.value) {
        actions.push({
          id: "show-all",
          icon: "all-inclusive",
          titleKey: "metrics.explorer.emptyActions.showAll",
          descriptionKey: "metrics.explorer.emptyActions.showAllDesc",
        });
      }
      actions.push({
        id: "clear-all",
        icon: "restart-alt",
        titleKey: "metrics.explorer.clearAllFilters",
        descriptionKey: "metrics.explorer.emptyActions.clearAllDesc",
      });
      return actions;
    });

    const openIngestDocs = () => {
      window.open(
        "https://openobserve.ai/docs/user-guide/metrics/",
        "_blank",
        "noopener",
      );
    };

    const onEmptyStateAction = (id?: string) => {
      switch (id) {
        case "clear-search":
          grid.searchTerm.value = "";
          break;
        case "clear-labels":
          onClearLabelFilters();
          break;
        case "clear-facets":
          grid.selectedPrefixes.value = new Set();
          grid.selectedSuffixes.value = new Set();
          grid.selectedTypes.value = new Set();
          break;
        case "clear-favorites":
          grid.showFavoritesOnly.value = false;
          break;
        case "show-all":
          grid.hideEmptyPanels.value = false;
          break;
        default:
          onClearAllFilters();
      }
    };

    // The type facet uses OCheckboxGroup, which speaks arrays; selectedTypes is a
    // Set everywhere else (composable filtering, URL state). These two adapters
    // are the ONLY place the two representations meet.
    const selectedTypesArray = computed(() => [...grid.selectedTypes.value]);
    const onSelectedTypesChange = (next: (string | number | boolean)[]) => {
      grid.selectedTypes.value = new Set(next.map(String));
      trackFilter("type");
    };

    // Type-rail search — narrows the type LIST (mirrors the prefix/suffix rails).
    // Matches against the human label (BADGE_LABELS), falling back to the id.
    const typeSearch = ref("");
    const visibleTypeFacets = computed(() => {
      const term = typeSearch.value.trim().toLowerCase();
      if (!term) return grid.typeFacets.value;
      return grid.typeFacets.value.filter((facet: { id: string }) =>
        (BADGE_LABELS[facet.id] ?? facet.id).toLowerCase().includes(term),
      );
    });

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

    // The panel-schema data a card hands to Visualize on "Open" — carries the
    // metric's TYPE-BASED operation so Visualize opens on the card's own query.
    // Consumed once by MetricsVisualize, then cleared.
    const visualizeSeed = ref<Record<string, any> | null>(null);

    // The mounted Visualize pane — the toolbar's refresh drives its runQuery in
    // visualize mode.
    const visualizeRef = ref<any>(null);

    // The toolbar window as a CONSUMABLE absolute range (ms) for the Visualize
    // chart. The picker's v-model is a RELATIVE descriptor ({relativeTimePeriod:
    // "15m"}) which the panel cannot use — it needs concrete start/end. Depending
    // on `selectedDate` keeps this reactive as the user changes the range.
    const visualizeDateTime = computed(() => {
      void selectedDate.value; // reactive dep on the toolbar range
      const c = dateTimePickerRef.value?.getConsumableDateTime?.();
      return c ? { startTime: c.startTime, endTime: c.endTime } : {};
    });

    const visualizeBlob = computed(() => {
      const pd = visualizeRef.value?.dashboardPanelData;
      if (!pd?.data?.queries?.[0]?.query) return "";
      return encodeMetricsConfig(getMetricsConfig(pd));
    });

    const shareUrl = computed(() => {
      void route.fullPath; // reactive dep on the URL
      if (mode.value !== "visualize") return window.location.href;
      const url = new URL(window.location.href);
      const blob = visualizeBlob.value;
      if (blob) url.searchParams.set("metrics_data", blob);
      else url.searchParams.delete("metrics_data");
      return url.href;
    });

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

      // Open IN-PAGE Visualize (not the separate editor route), seeded with the
      // card's type-aware panel data — so Visualize opens on the same query the
      // card charted (sum(rate(...)) for a counter, a quantile for a histogram),
      // not a blank editor.
      visualizeSeed.value = buildPanelDataForCard(
        card,
        resolved,
        defaults.bucketUnit,
      );
      // Through setMode so the grid is paused synchronously before it unmounts —
      // otherwise its teardown fires a first-time query per card on the way out.
      setMode("visualize");
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
      // showFavoritesOnly is not restored from the URL — the mode drives it.
      if (f.hideEmptyPanels !== undefined)
        grid.hideEmptyPanels.value = f.hideEmptyPanels;
      if (f.sortBy) grid.sortBy.value = f.sortBy;
      if (f.viewMode) grid.viewMode.value = f.viewMode;
      if (f.mode) mode.value = f.mode;

      // Rehydrate the built chart on refresh / a shared Visualize link: decode
      // the URL blob into a seed so MetricsVisualize opens on it (its own mount
      // consumes `visualizeSeed`, exactly as a card drill-in does) instead of a
      // blank canvas. Only in Visualize — the blob is meaningless to the grid.
      if (f.mode === "visualize" && q.metrics_data) {
        const blob = decodeMetricsConfig(q.metrics_data);
        if (blob?.data) visualizeSeed.value = blob.data;
      }

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

    /** Every URL key this page owns. Anything else rides along untouched. */
    const MANAGED_PARAM_KEYS = [
      ...EXPLORER_FILTER_PARAM_KEYS,
      "period",
      "from",
      "to",
      "refresh",
    ];

    /** The managed slice of the URL that the CURRENT state serializes to. */
    const managedFromState = (): Record<string, any> => {
      const query: Record<string, any> = explorerFiltersToQuery({
        searchTerm: grid.searchTerm.value,
        selectedPrefixes: grid.selectedPrefixes.value,
        selectedSuffixes: grid.selectedSuffixes.value,
        selectedTypes: grid.selectedTypes.value,
        labelFilters: grid.labelFilters.value,
        showFavoritesOnly: grid.showFavoritesOnly.value,
        hideEmptyPanels: grid.hideEmptyPanels.value,
        sortBy: grid.sortBy.value,
        viewMode: grid.viewMode.value,
        mode: mode.value,
      });
      const time: any = selectedDateToQueryParams(selectedDate.value);
      // The default window is recoverable from its absence, like the filters.
      if (time.period !== "15m") Object.assign(query, time);
      if (refreshInterval.value)
        query.refresh = refreshIntervalToLabel(refreshInterval.value);
      return query;
    };

    /* -------------------------------------------- convert to dashboard */

    // The bridge from ephemeral Favourites to a durable Dashboard: build one
    // panel-schema `data` object per FAVOURITE metric, using the same type-based
    // variant the card charts (effectiveVariant + buildPanelDataForCard, as the
    // drill-in does). These become N separate panels on the target dashboard.
    // Rate windows go over as `$__rate_interval` (PANEL_RATE_WINDOW) so each panel
    // re-derives against the dashboard's own range.
    const convertPanels = ref<any[]>([]);
    const convertDialogOpen = ref(false);

    const openConvertToDashboard = () => {
      const byName = new Map(grid.cards.value.map((c) => [c.name, c]));
      const panels: any[] = [];
      for (const name of grid.favorites.value) {
        const card = byName.get(name);
        if (!card) continue;
        const { defaults, resolved } = grid.effectiveVariant(card, undefined, {
          rateWindow: PANEL_RATE_WINDOW,
        });
        if (!resolved) continue;
        const data = buildPanelDataForCard(card, resolved, defaults.bucketUnit);
        data.title = card.name;
        panels.push(data);
      }
      if (!panels.length) return;
      convertPanels.value = panels;
      convertDialogOpen.value = true;
    };

    // State -> URL via replace, so filter changes never stack history entries.
    // Managed keys are wiped first — a cleared filter must leave the URL, and
    // anything else (org_identifier) rides along untouched. Defaults serialize
    // to nothing, so an unfiltered grid keeps a bare /metrics URL.
    const syncUrlState = () => {
      const query: Record<string, any> = { ...route.query };
      for (const key of MANAGED_PARAM_KEYS) delete query[key];
      Object.assign(query, managedFromState());

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
        mode.value,
        selectedDate.value,
        refreshInterval.value,
      ],
      syncUrlState,
    );

    const syncVisualizeUrl = () => {
      if (route.name !== "metrics") return;
      const blob = mode.value === "visualize" ? visualizeBlob.value : "";
      if (String(blob) === String(route.query.metrics_data ?? "")) return;

      const query: Record<string, any> = { ...route.query };
      if (blob) query.metrics_data = blob;
      else delete query.metrics_data;
      router.replace({ query }).catch(() => {});
    };
    const debouncedSyncVisualizeUrl = debounce(syncVisualizeUrl, 300);
    watch(
      () => [mode.value, mode.value === "visualize" ? visualizeBlob.value : ""],
      debouncedSyncVisualizeUrl,
    );

    // URL -> state, for the navigations the mount-time apply cannot see:
    // clicking sidebar "Metrics" while filtered (a bare URL must CLEAR the
    // filters), and back/forward between two /metrics?… entries. Unlike the
    // mount path, absence here means "reset to default" — that is what makes a
    // shared bare link honest. Guarded by comparing the URL's managed slice
    // against what the current state serializes to: our own router.replace
    // round-trips through this watcher, and re-applying identical state would
    // fire the filter watchers (page reset, slice sweep) for nothing.
    watch(
      () => route.query,
      () => {
        // Leaving the page fires this once with the next route's query.
        if (route.name !== "metrics") return;

        const incoming: Record<string, string> = {};
        for (const key of MANAGED_PARAM_KEYS) {
          const v = (route.query as Record<string, any>)[key];
          if (v != null) incoming[key] = String(v);
        }
        const current: Record<string, string> = {};
        for (const [key, v] of Object.entries(managedFromState())) {
          current[key] = String(v);
        }
        if (isEqual(incoming, current)) return;

        // A MODE-only change (Explore <-> Visualize <-> Workspace) is not grid
        // state: switching tabs must not re-apply the filters. Re-assigning them
        // hands the grid brand-new Set/array identities, and its watchers answer
        // an identical-but-new value by re-querying EVERY card — ~40 requests just
        // for clicking a card's Open. Sync the mode and leave the grid alone.
        const withoutMode = (o: Record<string, string>) => {
          const { mode: _m, ...rest } = o;
          return rest;
        };
        if (isEqual(withoutMode(incoming), withoutMode(current))) {
          mode.value =
            (incoming.mode as "explore" | "visualize" | "workspace") ??
            "explore";
          return;
        }

        const q = route.query as Record<string, any>;
        const f = queryToExplorerFilters(q);
        grid.searchTerm.value = f.searchTerm ?? "";
        grid.selectedPrefixes.value = f.selectedPrefixes ?? new Set();
        grid.selectedSuffixes.value = f.selectedSuffixes ?? new Set();
        grid.selectedTypes.value = f.selectedTypes ?? new Set();
        grid.labelFilters.value = f.labelFilters ?? [];
        grid.hideEmptyPanels.value = f.hideEmptyPanels ?? true;
        grid.sortBy.value = f.sortBy ?? "a-z";
        grid.viewMode.value = f.viewMode ?? "grid";
        // Setting mode last lets the isWorkspace watcher set showFavoritesOnly.
        mode.value = f.mode ?? "explore";
        if (f.labelFilters?.length) grid.ensureSchemas();

        selectedDate.value =
          q.period || (q.from && q.to)
            ? queryParamsToSelectedDate(q)
            : defaultSelectedDate();
        refreshInterval.value =
          q.refresh != null
            ? refreshLabelToInterval(
                q.refresh,
                store.state?.zoConfig?.min_auto_refresh_interval || 0,
              )
            : 0;
      },
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
      // Not while the grid is off screen. Leaving Explore unmounts the grid, and
      // the virtualizer's teardown briefly reports rows as "visible" on the way
      // out — each one would fire a FIRST-time query for a card the user will
      // never see (~40 requests just for clicking a card's Open).
      if (grid.paused.value) return;
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
      //
      // BOTH calls, like onRefresh: a range change resets the emptiness set
      // (emptiness is a property of the window), so without the sweep every
      // formerly-hidden no-data card re-enters the grid and blinks back out
      // one at a time as the user scrolls past it. The sweep re-resolves the
      // whole slice where it stands.
      await Promise.all([
        requestOnScreen({ skipCache: true }),
        grid.sweepSlice({ skipCache: true }),
      ]);
    };

    /**
     * Drag-select on a card's chart -> the grid's window.
     *
     * A zoom re-ranges EVERY card, not just the one dragged: the grid is a
     * comparison surface (same window on every card, so a spike at the same x is
     * the same moment), and zooming one card alone would quietly break that.
     * Following a spike therefore reads as "narrow the whole view to here",
     * which is also what the same gesture does on a dashboard.
     *
     * Deliberately does NOT call the grid directly — it drives the picker, and
     * the picker's `@on:date-change` runs `onDateChange`. So a zoom takes the
     * exact path a hand-picked range takes (skipCache + sweep), and the toolbar
     * shows the window the user is actually looking at instead of still
     * claiming "Past 15 Minutes". That also makes it undoable: the picker's
     * range is right there to change back.
     *
     * Mirrors ViewDashboard.onDataZoom, including the equal-endpoints guard —
     * a click-without-drag yields start === end, which is an empty window.
     */
    const onCardZoom = (event: { start: number; end: number }) => {
      if (!event?.start || !event?.end) return;

      const range = { start: new Date(event.start), end: new Date(event.end) };
      range.start.setMilliseconds(0);
      range.end.setMilliseconds(0);
      if (range.start.getTime() === range.end.getTime()) {
        range.end.setMinutes(range.end.getMinutes() + 1);
      }

      dateTimePickerRef.value?.setCustomDate?.("absolute", range);
      // `setCustomDate` alone does NOT reach the grid. It mutates the picker's
      // internal date/time refs and leaves the emit to DateTime's auto-apply
      // watcher — which is gated on `autoApply`, and `DateTimePickerDashboard`
      // defaults `autoApplyDashboard` to false. So the toolbar would show the
      // zoomed range while every card kept its old data.
      //
      // `refresh()` calls `saveDate()` directly, which is what emits
      // `on:date-change` -> `onDateChange` -> skipCache + sweep. This is exactly
      // why ViewDashboard.onDataZoom calls it too; the pair is the contract.
      dateTimePickerRef.value?.refresh?.();
      track("metrics_explorer_card_zoomed", {
        window_seconds: Math.round(
          (range.end.getTime() - range.start.getTime()) / 1000,
        ),
      });
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

      // VISUALIZE: refresh means "re-run the query in the chart" — exactly ONE
      // query — and nothing else.
      //
      // Deliberately does NOT touch the DateTimePicker: its `refresh()` RE-EMITS
      // a date-change, which `onDateChange` answers by re-querying every
      // on-screen card — ~50 requests for a single chart. The Visualize pane
      // re-derives its own window from `selectedDate` inside runQuery, so there
      // is nothing to refresh here but the chart itself.
      if (mode.value === "visualize") {
        visualizeRef.value?.runQuery?.();
        return;
      }

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
          // samples.
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

    // A DEEP watch over every preview is not free — once the first render is
    // reported there is nothing left for it to say, so it unregisters itself
    // rather than re-walking the map on every preview for the life of the page.
    const stopFirstRenderWatch = watch(
      () => grid.previews.value,
      (map) => {
        if (Object.values(map).some((p: any) => p.status === "done")) {
          stopFirstRenderWatch();
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

      observeScrollWidth();
    });

    // The scroll container lives inside the Explore body (`v-if="isExplore"`), so
    // it UNMOUNTS on switching to Visualize and a NEW element mounts on the way
    // back. Re-attach the observer to whichever element is current — otherwise the
    // width stays stale after a round-trip and the grid collapses to one column.
    // `flush: "post"` so the new element is laid out when we read its clientWidth.
    watch(scrollRef, () => observeScrollWidth(), { flush: "post" });

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
      gridVisible,
      resultCountLabel,
      rails,
      selectRail,
      railHasSelection,
      clearActiveRail,
      onClearAllFilters,
      selectedTypesArray,
      onSelectedTypesChange,
      typeSearch,
      visibleTypeFacets,
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
      mode,
      isExplore,
      isWorkspace,
      isGridMode,
      setMode,
      noDataHiddenLabel,
      noMatchDescription,
      noMatchActions,
      onEmptyStateAction,
      openIngestDocs,
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
      openConvertToDashboard,
      convertPanels,
      convertDialogOpen,
      onSelect,
      visualizeSeed,
      visualizeRef,
      visualizeDateTime,
      shareUrl,
      onDateChange,
      onRefreshTick,
      onCardVisible,
      onCardHidden,
      onCardZoom,
      onRefresh,
      refreshing,
    };
  },
});
</script>

