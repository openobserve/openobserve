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
        <!-- Section header: title + count badge (left) | pagination controls (right) -->
        <div
          data-test="traces-section-header"
          class="traces-section-header row items-center q-px-sm q-py-xs tw:bg-[var(--o2-section-header-bg)]!"
          v-show="
            searchObj.data.stream.selectedStream.value &&
            !searchObj.data.errorMsg?.trim()?.length &&
            searchObj.searchApplied
          "
        >
          <!-- Left: label + count -->
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

          <q-space />

          <!-- Right: rows-per-page + range info + page buttons -->
          <div class="pagination-block tw:flex tw:items-center">
            <q-select
              v-model="rowsPerPage"
              :options="rowsPerPageOptions"
              dense
              borderless
              data-test="traces-rows-per-page"
              class="tw:m-0! select-pagination tw:mr-[0.325rem]!"
              @update:model-value="onRowsPerPageChange"
            />
            <q-pagination
              v-model="pageInput"
              :max="totalPages"
              :max-pages="5"
              :input="false"
              :boundary-numbers="false"
              direction-links
              size="sm"
              color="primary"
              active-design="unelevated"
              data-test="traces-pagination"
              icon-first="skip_previous"
              icon-last="skip_next"
              icon-prev="fast_rewind"
              icon-next="fast_forward"
              rowsPerPageLabel="Rows per page"
              @update:model-value="onPageChange"
              class="paginator-section tw:mt-0!"
            />
          </div>
        </div>

        <!-- Table scroll area -->
        <div
          data-test="traces-search-result-list"
          class="traces-table-scroll-area tw:w-full"
        >
          <TracesTable
            :columns="tracesColumns"
            :rows="pagedHits"
            :row-class="traceRowClass"
            @row-click="expandRowDetail"
          >
            <template #empty />
          </TracesTable>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  ref,
  watch,
} from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import { byString } from "../../utils/json";
import useTraces from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import TracesTable from "@/components/traces/TracesTable.vue";
import { useTracesTableColumns } from "./composables/useTracesTableColumns";
import { useRouter } from "vue-router";
import { isLLMTrace } from "../../utils/llmUtils";

export default defineComponent({
  name: "SearchResult",
  components: {
    TracesTable,
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
    // Pagination
    // -----------------------------------------------------------------------
    const rowsPerPageOptions = [10, 25, 50, 100];
    const rowsPerPage = ref<number>(
      searchObj.meta.resultGrid.rowsPerPage || 25,
    );
    const pageInput = ref(1);

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

    const totalPages = computed(() =>
      Math.max(1, Math.ceil(hits.value.length / rowsPerPage.value)),
    );

    const pagedHits = computed(() => {
      const rpp = rowsPerPage.value;
      const page = pageInput.value;
      return hits.value.slice((page - 1) * rpp, page * rpp);
    });

    const onPageChange = (page: number) => {
      pageInput.value = page;
    };

    const onRowsPerPageChange = (rpp: number) => {
      searchObj.meta.resultGrid.rowsPerPage = rpp;
      pageInput.value = 1;
    };

    // Reset to first page whenever a new search kicks off
    watch(
      () => searchObj.loading,
      (isLoading) => {
        if (isLoading) pageInput.value = 1;
      },
    );

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
      // Pagination
      rowsPerPageOptions,
      rowsPerPage,
      pageInput,
      hits,
      noResults,
      hasResults,
      totalPages,
      pagedHits,
      onPageChange,
      onRowsPerPageChange,
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
