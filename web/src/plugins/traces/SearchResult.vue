<!-- Copyright 2023 OpenObserve Inc.

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
  <div data-test="traces-search-result" class="overflow-hidden tw:h-full">
    <!-- ════════════════════ RED Metrics Section ════════════════════ -->
    <div class="card-container tw:h-fit tw:overflow-hidden">
      <transition
        enter-active-class="transition-all duration-300 ease-in-out"
        leave-active-class="transition-all duration-300 ease-in-out"
        enter-from-class="opacity-0 -translate-y-4 max-h-0"
        enter-to-class="opacity-100 translate-y-0 max-h-[1000px]"
        leave-from-class="opacity-100 translate-y-0 max-h-[1000px]"
        leave-to-class="opacity-0 -translate-y-4 max-h-0"
      >
        <TracesMetricsDashboard
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
            searchObj.searchApplied && !searchObj.data.errorMsg?.trim()?.length
          "
          @time-range-selected="onMetricsTimeRangeSelected"
          @filters-updated="onMetricsFiltersUpdated"
        />
      </transition>
    </div>
    <div
      class="card-container tw:overflow-hidden tw:mt-[0.625rem] tw:duration-300 tw:ease-in"
      :class="
        searchObj.meta.showHistogram
          ? 'tw:h-[calc(100%-16.8rem)]!'
          : 'tw:h-[calc(100%-3.25rem)]!'
      "
    >
      <!-- ════════════════════ Loading State ════════════════════ -->
      <div
        class="full-height flex justify-center items-center tw:pt-[4rem]"
        v-if="searchObj.loading == true"
      >
        <div class="q-pb-lg">
          <q-spinner-hourglass
            color="primary"
            size="40px"
            style="margin: 0 auto; display: block"
          />
          <span class="text-center">
            Hold on tight, we're fetching your traces.
          </span>
        </div>
      </div>

      <!-- ════════════════════ Empty State ════════════════════ -->
      <div
        v-else-if="noResults"
        class="text-center tw:mx-[10%] tw:my-[40px] tw:text-[20px]"
      >
        <q-icon name="info" color="primary" size="md" /> No traces found. Please
        adjust the filters and try again.
      </div>

      <!-- ════════════════════ Traces List Section ════════════════════ -->
      <div
        v-else
        v-show="hasResults"
        data-test="traces-table-wrapper"
        class="traces-section column tw:h-full"
      >
        <!-- Section header: title + count badge -->
        <div
          data-test="traces-section-header"
          class="traces-section-header row items-center q-px-sm q-py-xs tw:bg-[var(--o2-section-header-bg)]!"
          v-show="
            searchObj.data.stream.selectedStream.value &&
            !searchObj.data.errorMsg?.trim()?.length &&
            searchObj.searchApplied
          "
        >
          <span
            data-test="traces-section-title"
            class="tw:text-[0.75rem] tw:font-bold tw:tracking-[0.0625rem]! tw:text-[var(--o2-text-1)]! tw:mr-[0.85rem]"
          >
            TRACES
          </span>
          <q-badge
            data-test="traces-count-badge"
            rounded
            :label="`${hits.length} Traces Found`"
            class="text-caption tw:bg-[var(--o2-tag-grey-1)]! tw:px-[0.625rem]! tw:text-[0.75rem] tw:text-[var(--o2-text-2)]! tw:mr-[0.85rem]"
          />
        </div>

        <!-- Table scroll area -->
        <div
          data-test="traces-search-result-list"
          class="traces-table-scroll-area tw:w-full"
        >
          <TracesTable
            :columns="tracesColumns"
            :rows="hits"
            :row-class="traceRowClass"
            @row-click="expandRowDetail"
            @load-more="loadMore"
          >
            <template #cell-timestamp="{ item }">
              <TraceTimestampCell :item="item" />
            </template>

            <template #cell-service_operation="{ item }">
              <TraceServiceCell :item="item" />
            </template>

            <template #cell-duration="{ item }">
              <span class="text-caption" data-test="trace-row-duration">
                {{ formatTimeWithSuffix(item.duration) || "0us" }}
              </span>
            </template>

            <template #cell-spans="{ item }">
              <q-badge
                data-test="trace-row-spans-badge"
                :label="item.spans"
                class="tw:bg-[var(--o2-tag-grey-2)]! tw:text-[var(--o2-text-1)]! tw:px-[0.5rem]! tw:py-[0.325rem]!"
              />
            </template>

            <template #cell-status="{ item }">
              <TraceStatusCell :item="item" />
            </template>

            <template #cell-input_tokens="{ item }">
              <span class="text-caption" data-test="trace-row-input-tokens">
                {{
                  isLLMTrace(item)
                    ? formatTokens(extractLLMData(item)?.usage?.input ?? 0)
                    : "-"
                }}
              </span>
            </template>

            <template #cell-output_tokens="{ item }">
              <span class="text-caption" data-test="trace-row-output-tokens">
                {{
                  isLLMTrace(item)
                    ? formatTokens(extractLLMData(item)?.usage?.output ?? 0)
                    : "-"
                }}
              </span>
            </template>

            <template #cell-cost="{ item }">
              <span class="text-caption" data-test="trace-row-cost">
                {{
                  isLLMTrace(item)
                    ? `$${formatCost(extractLLMData(item)?.cost?.total ?? 0)}`
                    : "-"
                }}
              </span>
            </template>

            <template #cell-service_latency="{ item }">
              <TraceLatencyCell :item="item" />
            </template>

            <template #empty />
          </TracesTable>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineAsyncComponent, defineComponent, ref } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import { byString } from "../../utils/json";
import useTraces from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import TracesTable from "@/components/traces/TracesTable.vue";
import { useTracesTableColumns } from "./composables/useTracesTableColumns";
import TraceTimestampCell from "./components/TraceTimestampCell.vue";
import TraceServiceCell from "./components/TraceServiceCell.vue";
import TraceLatencyCell from "./components/TraceLatencyCell.vue";
import TraceStatusCell from "./components/TraceStatusCell.vue";
import { useRouter } from "vue-router";
import {
  isLLMTrace,
  extractLLMData,
  formatCost,
  formatTokens,
} from "../../utils/llmUtils";
import { formatTimeWithSuffix } from "../../utils/zincutils";

export default defineComponent({
  name: "SearchResult",
  components: {
    TracesTable,
    TraceTimestampCell,
    TraceServiceCell,
    TraceLatencyCell,
    TraceStatusCell,
    TracesMetricsDashboard: defineAsyncComponent(
      () => import("./metrics/TracesMetricsDashboard.vue"),
    ),
  },
  emits: [
    "update:scroll",
    "update:datetime",
    "remove:searchTerm",
    "search:timeboxed",
    "get:traceDetails",
    "metrics:filters-updated",
  ],
  methods: {
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
    useQuasar();
    const router = useRouter();

    const { searchObj, updatedLocalLogFilterField } = useTraces();
    const totalHeight = ref(0);

    const searchTableRef: any = ref(null);
    const metricsDashboardRef: any = ref(null);

    const expandRowDetail = (props: any) => {
      router.push({
        name: "traceDetails",
        query: {
          stream: router.currentRoute.value.query.stream,
          trace_id: props.trace_id,
          from: props.trace_start_time - 10000000,
          to: props.trace_end_time + 10000000,
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });

      emit("get:traceDetails", props);
    };

    const getRowIndex = (next: boolean, _prev: boolean, oldIndex: number) => {
      if (next) {
        return oldIndex + 1;
      } else {
        return oldIndex - 1;
      }
    };

    const addSearchTerm = (term: string) => {
      searchObj.data.stream.addToFilter = term;
    };

    const removeSearchTerm = (term: string) => {
      emit("remove:searchTerm", term);
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

    const hasLlmTraces = computed(() =>
      (searchObj.data.queryResults?.hits ?? []).some((hit: any) =>
        isLLMTrace(hit),
      ),
    );

    const tracesColumns = useTracesTableColumns(hasLlmTraces);

    const traceRowClass = (row: any) =>
      (row.errors ?? 0) > 0 ? "oz-table__row--error" : "";

    // -----------------------------------------------------------------------
    // Infinite scroll
    // -----------------------------------------------------------------------
    const hits = computed<any[]>(() => searchObj.data.queryResults?.hits ?? []);

    const noResults = computed(
      () =>
        Object.prototype.hasOwnProperty.call(
          searchObj.data.queryResults,
          "total",
        ) &&
        hits.value.length === 0 &&
        !searchObj.loading,
    );

    const hasResults = computed(
      () =>
        Object.prototype.hasOwnProperty.call(
          searchObj.data.queryResults,
          "total",
        ) && hits.value.length > 0,
    );

    function loadMore() {
      if (
        searchObj.loading == false &&
        searchObj.data.resultGrid.currentPage <=
          searchObj.data.queryResults.from /
            searchObj.meta.resultGrid.rowsPerPage &&
        searchObj.data.queryResults.hits.length >
          searchObj.meta.resultGrid.rowsPerPage *
            searchObj.data.resultGrid.currentPage
      ) {
        searchObj.data.resultGrid.currentPage += 1;
        emit("update:scroll");
      }
    }

    return {
      t,
      store,
      searchObj,
      updatedLocalLogFilterField,
      byString,
      searchTableRef,
      metricsDashboardRef,
      addSearchTerm,
      removeSearchTerm,
      expandRowDetail,
      totalHeight,
      getImageURL,
      getRowIndex,
      onMetricsTimeRangeSelected,
      onMetricsFiltersUpdated,
      getDashboardData,
      hasLlmTraces,
      tracesColumns,
      traceRowClass,
      // Infinite scroll
      hits,
      noResults,
      hasResults,
      loadMore,
      // Cell utilities exposed for slot templates
      formatTimeWithSuffix,
      isLLMTrace,
      extractLLMData,
      formatTokens,
      formatCost,
    };
  },
});
</script>

<style lang="scss" scoped>
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
