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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div data-test="traces-search-result" class="h-full overflow-hidden">
    <div class="bg-card-glass-bg @container/results flex h-full flex-col overflow-hidden">
      <div
        v-if="showHeader"
        data-test="traces-section-header"
        class="border-border-default relative flex h-9 shrink-0 items-center border-b px-[0.4rem]! max-md:h-auto max-md:min-h-9 max-md:flex-wrap max-md:gap-y-1 max-md:py-0.5 @max-[58rem]/results:h-auto @max-[58rem]/results:min-h-9 @max-[58rem]/results:flex-wrap @max-[58rem]/results:gap-y-1 @max-[58rem]/results:py-0.5"
      >
        <!-- Field panel toggle — same style as logs page -->
        <OButton
          variant="outline"
          size="icon-xs-sq"
          class="me-1.5 shrink-0"
          data-test="traces-search-field-list-collapse-btn"
          @click="isMobile ? $emit('open-mobile-fields') : toggleFieldList()"
        >
          <OIcon
            :name="
              isMobile
                ? 'menu'
                : searchObj.meta.showFields
                  ? 'keyboard-double-arrow-left'
                  : 'keyboard-double-arrow-right'
            "
            size="sm"
          />
          <OTooltip
            :content="
              isMobile
                ? t('traces.openFields')
                : searchObj.meta.showFields
                  ? t('traces.collapseFields')
                  : t('traces.openFields')
            "
            side="bottom"
          />
        </OButton>

        <!-- Left: count chips -->
        <OTag
          data-test="traces-count-badge"
          type="logsResultChip"
          value="neutral"
          class="me-2.5 tabular-nums"
          :aria-busy="countState.loading ? 'true' : undefined"
        >
          <template v-if="countState.loading">
            <OSkeleton
              type="text"
              animation="none"
              class="w-11"
              data-test="traces-count-skeleton"
              aria-hidden="true"
            />
            <span class="sr-only">{{ t("common.loading") }}</span>
            <span aria-hidden="true">{{ countNoun }}</span>
          </template>
          <span v-else class="transition-opacity" :class="{ 'opacity-60': headerDimmed }">
            {{ countLabel }}
          </span>
        </OTag>
        <OTag
          v-if="shownErrorCount > 0"
          data-test="traces-error-count-badge"
          type="logsResultChip"
          value="error"
          :clickable="true"
          class="tabular-nums transition-opacity"
          :class="[
            showErrorOnly
              ? 'bg-badge-error-solid-bg! text-badge-error-solid-text!'
              : 'bg-error-tag-bg! text-error-tag-text!',
            { 'opacity-60': headerDimmed },
          ]"
          :aria-disabled="regionBusy ? 'true' : undefined"
          @click="toggleErrorOnly"
        >
          {{
            `${formatLargeNumber(shownErrorCount)} ${searchObj.meta.searchMode === "traces" ? t("traces.errorTraces") : t("traces.errorSpans")}`
          }}
          <OTooltip
            :content="showErrorOnly ? t('traces.clearErrorFilter') : t('traces.filterByErrors')"
            side="bottom"
          />
          <template #trailing>
            <OIcon name="filter-alt" size="xs" class="shrink-0" />
          </template>
        </OTag>

        <div
          class="hidden basis-full @max-[58rem]/results:block"
          aria-hidden="true"
          data-test="traces-search-result-header-break"
        />
        <div class="flex min-w-0 flex-1 items-center px-2 @max-[58rem]/results:flex-none">
          <ORegionStatus
            :noun="regionNoun"
            :elapsed-seconds="region.elapsedSeconds.value"
            data-test="traces-search-result-long-wait"
          />
        </div>

        <div
          class="me-1 flex min-w-0 items-center @max-[58rem]/results:flex-1 @max-[58rem]/results:justify-end @min-[58rem]/results:min-w-33"
          data-test="traces-search-result-data-age"
        >
          <ORefreshButton
            layout="inline"
            age-format="clock"
            :last-run-at="searchObj.meta.lastRunAt"
            :failed-at="searchObj.meta.refreshFailedAt"
            :loading="regionBusy"
            :spinner="false"
            data-test="traces-search-result-refresh"
            @click="$emit('run-query')"
          />
        </div>
        <!-- Same affordance as the logs table: a long operation name is often
             the widest thing on a row, and clipping it hides the part that
             distinguishes one trace or span from the next. -->
        <OButton
          variant="outline"
          size="icon-chip"
          :active="searchObj.meta.resultGrid.wrapCells"
          @click.stop="toggleWrapCells"
          data-test="traces-search-result-wrap-btn"
        >
          <OIcon name="wrap-text" size="sm" />
          <OTooltip :content="t('search.messageWrapContent')" />
        </OButton>
        <div
          v-if="pagerShown"
          class="flex items-center transition-opacity"
          :class="{ 'opacity-60': pagerInert }"
          :aria-disabled="regionBusy ? 'true' : undefined"
          data-test="traces-search-result-pager-group"
        >
          <OSelect
            :model-value="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="select-pagination ms-1 me-1 mt-0!"
            size="sm"
            :searchable="false"
            data-test="traces-search-result-records-per-page"
            @update:model-value="changeRowsPerPage"
          />
          <OPagination
            :model-value="searchObj.data.resultGrid.currentPage + 1"
            :max="totalPages"
            class="paginator-section float-right mt-0! min-w-54 justify-end"
            data-test="traces-search-result-pagination"
            @update:model-value="(page: number) => changePage(page)"
          />
        </div>
      </div>

      <!-- Combined scroll area: RED metrics + trace list scroll together.
           This is the single vertical scroller — the trace table delegates its
           virtualizer here (via :scroll-el) so it doesn't add a nested one. -->
      <div
        ref="scrollContainerRef"
        class="bg-card-glass-solid flex-1 overflow-auto"
        :data-test="pending ? 'traces-search-loading' : undefined"
        v-bind="region.regionAttrs.value"
        @scroll.passive="rememberScrollTop"
      >
        <!-- ════════════════════ RED Metrics Section ════════════════════ -->
        <TracesMetricsDashboard
          v-show="searchObj.meta.showHistogram"
          v-if="searchObj.data.stream.selectedStream.value && searchObj.searchApplied"
          ref="metricsDashboardRef"
          class="sticky start-0 z-1"
          :streamName="searchObj.data.stream.selectedStream.value"
          :timeRange="{
            startTime: searchObj.data.datetime.startTime,
            endTime: searchObj.data.datetime.endTime,
          }"
          :filter="searchObj.data.editorValue"
          :streamFields="searchObj.data.stream.selectedStreamFields"
          :show="searchObj.searchApplied && !searchObj.data.errorMsg?.trim()?.length"
          :ai-enabled="aiEnabled"
          @time-range-selected="onMetricsTimeRangeSelected"
          @editor-filter-set="onMetricsEditorFilterSet"
          @editor-filter-run="onMetricsEditorFilterRun"
          @send-to-ai-chat="$emit('send-to-ai-chat', $event)"
        />
        <TracesMetricsPlaceholder v-else-if="pending && searchObj.meta.showHistogram" />

        <TracesSearchResultList
          ref="searchResultListRef"
          :hits="hits"
          :wrap="searchObj.meta.resultGrid.wrapCells"
          :scroll-el="scrollContainerRef"
          :loading="searchObj.loading || pending"
          :search-performed="searchPerformed"
          :total="searchObj.data.queryResults.total"
          :error-count="searchObj.data.queryResults.errorCount"
          :show-header="showHeader"
          :current-page="searchObj.data.resultGrid.currentPage + 1"
          :rows-per-page="searchObj.meta.resultGrid.rowsPerPage"
          :show-pagination="searchObj.meta.resultGrid.showPagination && !countPending"
          :sort-by="searchObj.meta.resultGrid.sortBy"
          :sort-order="searchObj.meta.resultGrid.sortOrder"
          :search-mode="searchObj.meta.searchMode"
          :ai-enabled="aiEnabled"
          :stream-doc-time-range="streamDocTimeRange"
          :query-window-us="queryWindowUs"
          :row-href="traceDetailsHref"
          @row-click="expandRowDetail"
          @open-in-new-tab="openTraceInNewTab"
          @page-change="(page: number) => changePage(page)"
          @cross-page="(page: number) => changePage(page, { fromCrossing: true })"
          @rows-per-page-change="changeRowsPerPage"
          @sort-change="changeSortBy"
          @remove-filter="$emit('remove-filter')"
          @jump-to-stream-data="(from, to) => $emit('jump-to-stream-data', from, to)"
          @ask-ai="$emit('ask-ai')"
          @send-to-ai-chat="(v) => $emit('send-to-ai-chat', v)"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
  watch,
  type PropType,
} from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";

import useTraces from "../../composables/useTraces";
import useBreakpoint from "@/composables/useBreakpoint";
import { useRouter } from "vue-router";
import TracesSearchResultList from "./components/TracesSearchResultList.vue";
import { formatLargeNumber } from "../../utils/zincutils";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useLocalWrapTracesContent } from "@/utils/storage";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import TracesMetricsPlaceholder from "./metrics/TracesMetricsPlaceholder.vue";
import ORegionStatus from "@/lib/feedback/RegionStatus/ORegionStatus.vue";
import { useRegionLoading } from "@/lib/feedback/RegionStatus/useRegionLoading";
import { resultText, type RegionNoun } from "@/lib/feedback/RegionStatus/regionText";
import { useSettledValue } from "@/composables/useSettledValue";
import { formatRefreshFailed } from "@/utils/formatters";

export default defineComponent({
  name: "SearchResult",
  components: {
    ORefreshButton,
    OButton,
    OTooltip,
    OSelect,
    OPagination,
    OTag,
    OSkeleton,
    ORegionStatus,
    TracesSearchResultList,
    TracesMetricsPlaceholder,
    TracesMetricsDashboard: defineAsyncComponent({
      // Its charts load as chunks of their own, so they load with it and the placeholder stays until they can draw.
      loader: () =>
        Promise.all([
          import("./metrics/TracesMetricsDashboard.vue"),
          import("@/views/Dashboards/RenderDashboardCharts.vue"),
          import("@/components/dashboards/panels/ChartRenderer.vue"),
        ]).then(([dashboard]) => dashboard),
      loadingComponent: TracesMetricsPlaceholder,
      delay: 0,
    }),
    OIcon,
  },
  props: {
    /** The stream list is still loading: draw the final layout with its loaders, no data yet. */
    pending: {
      type: Boolean,
      default: false,
    },
    showErrorOnly: {
      type: Boolean,
      default: false,
    },
    aiEnabled: {
      type: Boolean,
      default: false,
    },
    streamDocTimeRange: {
      type: Object as PropType<{ min: number; max: number }>,
      default: undefined,
    },
    queryWindowUs: {
      type: Object as PropType<{ start: number; end: number }>,
      default: undefined,
    },
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "update:sort",
    "remove:searchTerm",
    "search:timeboxed",
    "get:traceDetails",
    "metrics:editor-filter-set",
    "metrics:editor-filter-run",
    "run-query",
    "remove-filter",
    "jump-to-stream-data",
    "error-only-toggled",
    "ask-ai",
    "send-to-ai-chat",
    "open-mobile-fields",
  ],
  methods: {
    toggleErrorOnly() {
      if (this.regionBusy) return;
      this.$emit("error-only-toggled", !this.showErrorOnly);
    },
    closeColumn(col: any) {
      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.name);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = this.searchObj.data.stream.selectedFields.indexOf(col.name);

      this.searchObj.data.stream.selectedFields.splice(SFIndex, 1);
      this.searchObj.organizationIdentifier = this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      this.$emit("search:timeboxed", obj);
    },
  },
  setup(props, { emit }) {
    const { t } = useI18nTyped();
    const store = useStore();
    const router = useRouter();
    const { isMobile } = useBreakpoint();

    const { searchObj, updatedLocalLogFilterField, patchUrlViewState } = useTraces();

    const metricsDashboardRef: any = ref(null);

    // Single vertical scroll container for the results area. Delegated to the
    // trace table's virtualizer (:scroll-el) so the table doesn't render its own
    // nested scrollbar — fixes the double-scrollbar on the traces page.
    const scrollContainerRef = ref<HTMLElement | null>(null);

    // Keep-alive detaches the DOM before onDeactivated runs, and a detached element reads scrollTop 0.
    let savedScrollTop = 0;
    let restoringScroll = false;
    const rememberScrollTop = () => {
      if (!restoringScroll && scrollContainerRef.value?.isConnected) {
        savedScrollTop = scrollContainerRef.value.scrollTop;
      }
    };
    onDeactivated(() => {
      restoringScroll = true;
    });
    onActivated(async () => {
      await nextTick();
      // The virtualized rows lay out in the next frame; before that the offset would clamp short.
      requestAnimationFrame(() => {
        if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = savedScrollTop;
        restoringScroll = false;
      });
    });

    onMounted(() => {
      // Restore the wrap choice: a preference that resets on every reload is
      // not much of a preference.
      searchObj.meta.resultGrid.wrapCells = useLocalWrapTracesContent() === "true";
    });

    // A failed run leaves the age where it was, so kept rows never read as fresh.
    watch(
      () => searchObj.loading,
      (loading, wasLoading) => {
        if (
          wasLoading &&
          !loading &&
          searchObj.searchApplied &&
          !searchObj.meta.refreshFailedAt &&
          !searchObj.data.errorMsg?.trim()?.length
        ) {
          searchObj.meta.lastRunAt = Date.now();
        }
      },
    );

    const traceTimeRange = (props: any) => {
      if (searchObj.meta.searchMode === "spans") {
        // start_time / end_time are nanoseconds in raw span rows — convert to µs
        const spanStart = Math.floor((props.start_time || 0) / 1000);
        const spanEnd = Math.ceil((props.end_time || props.start_time || 0) / 1000);
        return { from: spanStart - 60_000_000, to: spanEnd + 3_600_000_000 };
      }
      return { from: props.trace_start_time, to: props.trace_end_time };
    };

    const traceDetailsLocation = (props: any, from: number, to: number) => ({
      name: "traceDetails",
      query: {
        stream: router.currentRoute.value.query.stream,
        trace_id: props.trace_id,
        ...(searchObj.meta.searchMode === "spans" ? { span_id: props.span_id } : {}),
        from,
        to,
        org_identifier: store.state.selectedOrganization.identifier,
      },
    });

    const traceDetailsHref = (row: any) => {
      const { from, to } = traceTimeRange(row);
      return router.resolve(traceDetailsLocation(row, from, to)).href;
    };

    const openTraceInNewTab = (row: any) => {
      window.open(traceDetailsHref(row), "_blank", "noopener");
    };

    const expandRowDetail = async (props: any) => {
      searchObj.meta.resultGrid.navigation.lastOpenedId =
        searchObj.meta.searchMode === "spans" ? props.span_id : props.trace_id;
      const { from, to } = traceTimeRange(props);

      // The URL write is debounced; Back restores what this entry holds, so it must land before leaving.
      await patchUrlViewState();
      router.push(traceDetailsLocation(props, from, to));

      emit("get:traceDetails", props);
    };

    const onMetricsTimeRangeSelected = (range: { start: number; end: number }) => {
      emit("update:datetime", {
        start: range.start,
        end: range.end,
      });
    };

    const onMetricsEditorFilterSet = (text: string) => {
      emit("metrics:editor-filter-set", text);
    };

    const onMetricsEditorFilterRun = (text: string) => {
      emit("metrics:editor-filter-run", text);
    };

    const getDashboardData = () => {
      metricsDashboardRef?.value?.loadDashboard();
    };

    // -----------------------------------------------------------------------
    // Pagination
    // -----------------------------------------------------------------------
    const hits = computed<any[]>(() => searchObj.data.queryResults?.hits ?? []);

    const resultTotal = computed<number>(() =>
      Number(searchObj.data.queryResults?.total ?? hits.value.length),
    );

    const searchPerformed = computed(() =>
      Object.prototype.hasOwnProperty.call(searchObj.data.queryResults, "total"),
    );

    const rowsPerPageOptions = [10, 25, 50, 100];

    const showHeader = computed(
      () =>
        props.pending ||
        !!(
          searchObj.data.stream.selectedStream.value &&
          !searchObj.data.errorMsg?.trim()?.length &&
          searchObj.searchApplied
        ),
    );

    // The count runs after the rows, so until it answers there is no total to show.
    const countPending = computed(() => searchObj.data.queryResults?.countPending === true);
    const regionBusy = computed(() => props.pending || searchObj.loading || countPending.value);
    const regionNoun = computed<RegionNoun>(() =>
      searchObj.meta.searchMode === "spans" ? "spans" : "traces",
    );

    // Another stream or mode is another count, so its previous value is never kept.
    const countSettled = useSettledValue<{ total: number; errorCount: number }>(() => {
      const results = searchObj.data.queryResults;
      const busy = regionBusy.value;
      return {
        value: busy
          ? null
          : { total: resultTotal.value, errorCount: Number(results?.errorCount ?? 0) },
        busy,
        key: `${searchObj.data.stream.selectedStream.value}|${searchObj.meta.searchMode}`,
      };
    });
    const countState = computed(() => countSettled.state.value);
    const headerDimmed = computed(() => countSettled.dimmed.value);
    const pagerShown = computed(
      () => searchObj.meta.resultGrid.showPagination || countState.value.loading,
    );
    const pagerInert = computed(() => headerDimmed.value || countState.value.loading);
    const shownTotal = computed(() => countState.value.value?.total ?? resultTotal.value);
    const shownErrorCount = computed(() => countState.value.value?.errorCount ?? 0);

    const countText = (count: string, plural: number) =>
      searchObj.meta.searchMode === "spans"
        ? `${count} ${t("traces.spansFound")}`
        : t("traces.results.tracesWithMatchingSpan", { count }, plural);
    const countLabel = computed(() =>
      countText(formatLargeNumber(shownTotal.value), shownTotal.value),
    );
    // A blank count would be replaced by the plural number, so a space stands in and is trimmed.
    const countNoun = computed(() => countText(" ", 2).trim());

    // The pager keeps the last settled page count through a run, so it never shrinks to one page.
    const settledTotal = ref<number | null>(null);
    watch(
      () => [countPending.value, searchObj.data.queryResults?.total] as const,
      ([pending, total]) => {
        if (!pending && total != null) settledTotal.value = Number(total);
      },
      { immediate: true },
    );
    const totalPages = computed(() => {
      const total = searchObj.data.queryResults?.total ?? settledTotal.value;
      return total && searchObj.meta.resultGrid.rowsPerPage
        ? Math.max(1, Math.ceil(total / searchObj.meta.resultGrid.rowsPerPage))
        : 1;
    });

    // Leaving the page cancels its search; that end must not be announced over the page now shown.
    let pageShown = true;
    onDeactivated(() => (pageShown = false));
    onActivated(() => (pageShown = true));
    const region = useRegionLoading({
      busy: () => regionBusy.value,
      noun: () => regionNoun.value,
      error: () =>
        pageShown && searchObj.meta.refreshFailedAt && searchObj.meta.lastRunAt
          ? formatRefreshFailed(t, {
              failedAt: searchObj.meta.refreshFailedAt,
              dataFrom: searchObj.meta.lastRunAt,
            })
          : null,
      result: () =>
        !pageShown || searchObj.data.errorMsg?.trim()?.length || props.pending
          ? null
          : resultText(t, { count: resultTotal.value, noun: regionNoun.value }),
    });

    const resetRowSelection = () => {
      const navigation = searchObj.meta.resultGrid.navigation;
      navigation.selectionActive = false;
      navigation.currentRowIndex = null;
      navigation.pendingPageSelection = null;
    };

    // Until the count settles the pager shows the previous run's page count, so a page picked from it may not exist.
    function changePage(page: number, options: { fromCrossing?: boolean } = {}) {
      if (options.fromCrossing ? searchObj.loading : regionBusy.value) return;
      if (!options.fromCrossing) resetRowSelection();
      searchObj.data.resultGrid.currentPage = page - 1;
      emit("update:scroll");
    }

    function changeRowsPerPage(val: SelectModelValue) {
      if (regionBusy.value) return;
      resetRowSelection();
      // rowsPerPageOptions are all numbers, so val is always a number here
      searchObj.meta.resultGrid.rowsPerPage = val as number;
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:scroll");
    }

    function changeSortBy(sortBy: string, sortOrder: "asc" | "desc") {
      if (searchObj.loading) return;
      resetRowSelection();
      searchObj.meta.resultGrid.sortBy = sortBy;
      searchObj.meta.resultGrid.sortOrder = sortOrder;
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:sort");
    }

    /** Persisted under its own key: the traces table and the logs table are
     *  different views, and wrapping one is not a request to wrap the other. */
    function toggleWrapCells() {
      searchObj.meta.resultGrid.wrapCells = !searchObj.meta.resultGrid.wrapCells;
      useLocalWrapTracesContent(searchObj.meta.resultGrid.wrapCells ? "true" : "false");
    }

    function openComparison() {
      metricsDashboardRef.value?.openComparison();
    }

    const toggleFieldList = () => {
      searchObj.meta.showFields = !searchObj.meta.showFields;
    };

    const searchResultListRef = ref<InstanceType<typeof TracesSearchResultList> | null>(null);
    const stepTraceRow = (direction: 1 | -1, isRepeat = false) =>
      searchResultListRef.value?.stepTraceRow(direction, isRepeat);

    return {
      t,
      store,
      resultTotal,
      isMobile,
      searchObj,
      updatedLocalLogFilterField,
      metricsDashboardRef,
      scrollContainerRef,
      expandRowDetail,
      traceDetailsHref,
      openTraceInNewTab,
      onMetricsTimeRangeSelected,
      onMetricsEditorFilterSet,
      onMetricsEditorFilterRun,
      getDashboardData,
      hits,
      searchPerformed,
      showHeader,
      countPending,
      countState,
      countLabel,
      countNoun,
      headerDimmed,
      pagerShown,
      pagerInert,
      shownErrorCount,
      regionBusy,
      regionNoun,
      region,
      rememberScrollTop,
      changePage,
      changeRowsPerPage,
      changeSortBy,
      rowsPerPageOptions,
      totalPages,
      openComparison,
      toggleWrapCells,
      toggleFieldList,
      formatLargeNumber,
      searchResultListRef,
      stepTraceRow,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override:opagination): reaches into the OPagination/OSelect-rendered
   button DOM to compress the pagination controls into the results toolbar. */
.paginator-section {
  line-height: 1.5rem;
  max-height: 2rem;
  border-radius: 0.5rem;
  padding: 0.125rem 0.25rem;
  background: color-mix(in srgb, var(--color-white) 10%, transparent);
  backdrop-filter: blur(0.625rem);
  margin-top: 0;
  overflow: visible;
}

.paginator-section :deep(.o-pagination__btn) {
  padding: 0.125rem 0.25rem !important;
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  min-width: 1.5rem !important;
  font-size: var(--text-xs) !important;
  border-radius: 0.25rem !important;
  line-height: 1rem !important;
}

.paginator-section :deep(.o-pagination__btn svg) {
  width: 1rem !important;
  height: 1rem !important;
}

.select-pagination {
  position: relative;
  width: 4rem !important;
  height: 1.5rem !important;
  margin-top: 0;
}

.select-pagination :deep(button) {
  height: 1.5rem !important;
  min-height: 1.5rem !important;
  font-size: var(--text-xs) !important;
  padding-inline: 0.5rem !important;
}
</style>
