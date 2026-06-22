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
  <div data-test="traces-search-result" class="tw:overflow-hidden tw:h-full">
    <div
      class="card-container tw:h-full tw:flex tw:flex-col tw:overflow-hidden"
    >
      <!-- Section header: title + count badge + insights + pagination -->
      <div
        v-if="
          searchObj.data.stream.selectedStream.value &&
          !searchObj.data.errorMsg?.trim()?.length &&
          searchObj.searchApplied
        "
        ref="sectionHeaderRef"
        data-test="traces-section-header"
        class="tw:flex tw:items-center tw:px-[0.4rem]! tw:h-[2.25rem] tw:shrink-0 tw:border-b tw:border-[rgba(0,0,0,0.07)]"
      >
        <!-- Field panel toggle — same style as logs page -->
        <OButton
          variant="outline"
          size="icon-xs-sq"
          class="tw:mr-1.5 tw:shrink-0"
          data-test="traces-search-field-list-collapse-btn"
          @click="toggleFieldList"
        >
          <OIcon
            :name="searchObj.meta.showFields ? 'keyboard-double-arrow-left' : 'keyboard-double-arrow-right'"
            size="sm"
          />
          <OTooltip
            :content="searchObj.meta.showFields ? t('traces.collapseFields') : t('traces.openFields')"
            side="bottom"
          />
        </OButton>

        <!-- Left: count chips -->
        <OBadge
          data-test="traces-count-badge"
          variant="default"
          class="tw:text-xs tw:rounded! tw:bg-[var(--o2-tag-grey-1)]! tw:py-[0.4rem]! tw:px-[0.625rem]! tw:text-[0.75rem] tw:text-[var(--o2-text-4)]! tw:mr-[0.6rem]"
        >{{ `${formatLargeNumber(searchObj.data.queryResults.total != null ? searchObj.data.queryResults.total : hits.length)} ${searchObj.meta.searchMode === 'spans' ? t('traces.spansFound') : t('traces.tracesFound')}` }}</OBadge>
        <OBadge
          v-if="
            searchObj.data.queryResults.errorCount != null &&
            searchObj.data.queryResults.errorCount > 0
          "
          data-test="traces-error-count-badge"
          variant="error"
          :clickable="true"
          class="tw:text-xs tw:rounded! tw:py-[0.4rem]! tw:px-[0.625rem]! tw:text-[0.75rem]!"
          :class="!showErrorOnly ? 'tw:bg-[var(--o2-error-tag-bg)]! tw:text-[var(--o2-error-tag-text)]!' : ''"
          @click="toggleErrorOnly"
        >
          {{ `${formatLargeNumber(searchObj.data.queryResults.errorCount)} ${searchObj.meta.searchMode === 'traces' ? t('traces.errorTraces') : t('traces.errorSpans')}` }}
          <OTooltip
            :content="showErrorOnly ? t('traces.clearErrorFilter') : t('traces.filterByErrors')"
            side="bottom"
          />
          <template #trailing>
            <OIcon name="filter-alt" size="xs" class="tw:shrink-0" />
          </template>
        </OBadge>

        <div class="tw:flex-1" />

        <!-- Right: Refresh → Insights → rows per page → pagination (same sequence as logs) -->
        <div class="tw:inline-flex tw:items-center tw:border tw:border-[var(--o2-border-color)] tw:rounded-md tw:px-1 tw:h-6 tw:mr-1 tw:overflow-hidden">
          <ORefreshButton
            :last-run-at="searchObj.meta.lastRunAt"
            :loading="searchObj.loading"
            :disabled="searchObj.loading"
            @click="$emit('run-query')"
          />
        </div>
        <OButton
          variant="outline"
          :size="showActionLabels ? 'chip' : 'icon-chip'"
          @click.stop="openUnifiedAnalysisDashboard"
          data-test="insights-button"
        >
          <OIcon name="timeline" size="sm" />
          <span v-if="showActionLabels" class="tw:whitespace-nowrap">{{ t('volumeInsights.analyzeBtnLabel') }}</span>
          <OTooltip v-if="!showActionLabels" :content="t('volumeInsights.analyzeTooltipTraces')" />
        </OButton>
        <template v-if="searchObj.meta.resultGrid.showPagination">
          <OSelect
            :model-value="searchObj.meta.resultGrid.rowsPerPage"
            :options="rowsPerPageOptions"
            class="select-pagination tw:mr-[0.25rem] tw:mt-0! tw:ml-1"
            size="sm"
            data-test="traces-search-result-records-per-page"
            @update:model-value="changeRowsPerPage"
          />
          <OPagination
            :disable="searchObj.loading"
            :model-value="searchObj.data.resultGrid.currentPage + 1"
            :max="totalPages"
            class="float-right paginator-section tw:mt-0!"
            data-test="traces-search-result-pagination"
            @update:model-value="changePage"
          />
        </template>
      </div>

      <!-- Combined scroll area: RED metrics + trace list scroll together -->
      <div class="tw:flex-1 tw:overflow-y-auto tw:bg-[var(--o2-card-bg-solid)]">
        <!-- ════════════════════ RED Metrics Section ════════════════════ -->
        <transition
          enter-active-class="transition-all duration-300 ease-in-out"
          leave-active-class="transition-all duration-300 ease-in-out"
          enter-from-class="opacity-0 -translate-y-4 max-h-0"
          enter-to-class="opacity-100 translate-y-0 max-h-[1000px]"
          leave-from-class="opacity-100 translate-y-0 max-h-[1000px]"
          leave-to-class="opacity-0 -translate-y-4 max-h-0"
        >
          <TracesMetricsDashboard
            v-show="searchObj.meta.showHistogram"
            v-if="
              searchObj.data.stream.selectedStream.value &&
              searchObj.searchApplied
            "
            ref="metricsDashboardRef"
            :streamName="searchObj.data.stream.selectedStream.value"
            :timeRange="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :filter="searchObj.data.editorValue"
            :streamFields="searchObj.data.stream.selectedStreamFields"
            :show="
              searchObj.searchApplied &&
              !searchObj.data.errorMsg?.trim()?.length
            "
            @time-range-selected="onMetricsTimeRangeSelected"
            @filters-updated="onMetricsFiltersUpdated"
          />
        </transition>

        <TracesSearchResultList
          :hits="hits"
          :loading="searchObj.loading"
          :search-performed="searchPerformed"
          :total="searchObj.data.queryResults.total"
          :error-count="searchObj.data.queryResults.errorCount"
          :show-header="
            !!(
              searchObj.data.stream.selectedStream.value &&
              !searchObj.data.errorMsg?.trim()?.length &&
              searchObj.searchApplied
            )
          "
          :current-page="searchObj.data.resultGrid.currentPage + 1"
          :rows-per-page="searchObj.meta.resultGrid.rowsPerPage"
          :show-pagination="searchObj.meta.resultGrid.showPagination"
          :sort-by="searchObj.meta.resultGrid.sortBy"
          :sort-order="searchObj.meta.resultGrid.sortOrder"
          :search-mode="searchObj.meta.searchMode"
          @row-click="expandRowDetail"
          @page-change="changePage"
          @rows-per-page-change="changeRowsPerPage"
          @sort-change="changeSortBy"
          @widen-range="(p) => $emit('widen-range', p)"
          @remove-filter="$emit('remove-filter')"
          @jump-to-stream-data="(from, to) => $emit('jump-to-stream-data', from, to)"
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
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import useTraces from "../../composables/useTraces";
import { useRouter } from "vue-router";
import TracesSearchResultList from "./components/TracesSearchResultList.vue";
import { formatLargeNumber } from "../../utils/zincutils";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OPagination from "@/lib/navigation/Pagination/OPagination.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";

export default defineComponent({
  name: "SearchResult",
  components: {
    ORefreshButton,
    OButton,
    OTooltip,
    OSelect,
    OPagination,
    OBadge,
    TracesSearchResultList,
    TracesMetricsDashboard: defineAsyncComponent(
      () => import("./metrics/TracesMetricsDashboard.vue"),
    ),
    OIcon,
},
  props: {
    showErrorOnly: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "update:sort",
    "remove:searchTerm",
    "search:timeboxed",
    "get:traceDetails",
    "metrics:filters-updated",
    "run-query",
    "widen-range",
    "remove-filter",
    "jump-to-stream-data",
    "error-only-toggled",
  ],
  methods: {
    toggleErrorOnly() {
      this.$emit("error-only-toggled", !this.showErrorOnly);
    },
    closeColumn(col: any) {
      const RGIndex = this.searchObj.data.resultGrid.columns.indexOf(col.name);
      this.searchObj.data.resultGrid.columns.splice(RGIndex, 1);

      const SFIndex = this.searchObj.data.stream.selectedFields.indexOf(
        col.name,
      );

      this.searchObj.data.stream.selectedFields.splice(SFIndex, 1);
      this.searchObj.organizationIdentifier =
        this.store.state.selectedOrganization.identifier;
      this.updatedLocalLogFilterField();
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      this.$emit("search:timeboxed", obj);
    },
  },
  setup(_props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    const { searchObj, updatedLocalLogFilterField } = useTraces();

    const metricsDashboardRef: any = ref(null);

    const sectionHeaderRef = ref<HTMLElement | null>(null);
    const containerWidth = ref(9999);
    let headerResizeObserver: ResizeObserver | null = null;
    const showActionLabels = computed(() => containerWidth.value >= 900);

    onMounted(() => {
      if (sectionHeaderRef.value) {
        containerWidth.value = sectionHeaderRef.value.getBoundingClientRect().width;
        headerResizeObserver = new ResizeObserver((entries) => {
          containerWidth.value = entries[0]?.contentRect.width ?? 0;
        });
        headerResizeObserver.observe(sectionHeaderRef.value);
      }
    });
    
    //Before unmount
    onBeforeUnmount(() => {
      headerResizeObserver?.disconnect();
    });

    watch(
      () => searchObj.loading,
      (loading, wasLoading) => {
        if (wasLoading && !loading && searchObj.searchApplied) {
          searchObj.meta.lastRunAt = Date.now();
        }
      },
    );

    const expandRowDetail = (props: any) => {
      let from: number;
      let to: number;

      if (searchObj.meta.searchMode === "spans") {
        // start_time / end_time are nanoseconds in raw span rows — convert to µs
        const spanStart = Math.floor((props.start_time || 0) / 1000);
        const spanEnd = Math.ceil(
          (props.end_time || props.start_time || 0) / 1000,
        );
        from = spanStart - 60_000_000; // -1 min in µs
        to = spanEnd + 3_600_000_000; // +1 hr in µs
      } else {
        from = props.trace_start_time - 10000000;
        to = props.trace_end_time + 10000000;
      }

      router.push({
        name: "traceDetails",
        query: {
          stream: router.currentRoute.value.query.stream,
          trace_id: props.trace_id,
          ...(searchObj.meta.searchMode === "spans"
            ? { span_id: props.span_id }
            : {}),
          from,
          to,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });

      emit("get:traceDetails", props);
    };

    const onMetricsTimeRangeSelected = (range: {
      start: number;
      end: number;
    }) => {
      emit("update:datetime", {
        start: range.start,
        end: range.end,
      });
    };

    const onMetricsFiltersUpdated = (filters: string[]) => {
      emit("metrics:filters-updated", filters);
    };

    const getDashboardData = () => {
      metricsDashboardRef?.value?.loadDashboard();
    };

    // -----------------------------------------------------------------------
    // Pagination
    // -----------------------------------------------------------------------
    const hits = computed<any[]>(() => searchObj.data.queryResults?.hits ?? []);

    const searchPerformed = computed(() =>
      Object.prototype.hasOwnProperty.call(
        searchObj.data.queryResults,
        "total",
      ),
    );

    const rowsPerPageOptions = [10, 25, 50, 100];

    const totalPages = computed(() =>
      searchObj.data.queryResults.total && searchObj.meta.resultGrid.rowsPerPage
        ? Math.max(
            1,
            Math.ceil(
              searchObj.data.queryResults.total /
                searchObj.meta.resultGrid.rowsPerPage,
            ),
          )
        : 1,
    );

    function changePage(page: number) {
      if (searchObj.loading) return;
      searchObj.data.resultGrid.currentPage = page - 1;
      emit("update:scroll");
    }

    function changeRowsPerPage(val: number) {
      if (searchObj.loading) return;
      searchObj.meta.resultGrid.rowsPerPage = val;
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:scroll");
    }

    function changeSortBy(sortBy: string, sortOrder: "asc" | "desc") {
      if (searchObj.loading) return;
      searchObj.meta.resultGrid.sortBy = sortBy;
      searchObj.meta.resultGrid.sortOrder = sortOrder;
      searchObj.data.resultGrid.currentPage = 0;
      emit("update:sort");
    }

    function openUnifiedAnalysisDashboard() {
      if (metricsDashboardRef.value) {
        metricsDashboardRef.value.openUnifiedAnalysisDashboard();
      }
    }

    const toggleFieldList = () => {
      searchObj.meta.showFields = !searchObj.meta.showFields;
    };

    return {
      t,
      store,
      searchObj,
      updatedLocalLogFilterField,
      metricsDashboardRef,
      sectionHeaderRef,
      showActionLabels,
      expandRowDetail,
      onMetricsTimeRangeSelected,
      onMetricsFiltersUpdated,
      getDashboardData,
      hits,
      searchPerformed,
      changePage,
      changeRowsPerPage,
      changeSortBy,
      rowsPerPageOptions,
      totalPages,
      openUnifiedAnalysisDashboard,
      toggleFieldList,
      formatLargeNumber,
    };
  },
});
</script>

<style lang="scss" scoped>
@import "@/styles/pagination.scss";
/* ── Traces list section ─────────────────────────────────────────────────── */
.traces-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.traces-section-header {
  flex-shrink: 0;
  min-height: 40px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  padding: 4px 8px;
}

/* Scrollable area that holds the column header + rows */
.traces-table-scroll-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}

/* ── Leftover table styles (kept for backward compat) ────────────────────── */
.max-result {
  width: 170px;
}
</style>
