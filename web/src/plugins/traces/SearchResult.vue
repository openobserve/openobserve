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
      <TracesSearchResultList
        :hits="hits"
        :loading="searchObj.loading"
        :search-performed="searchPerformed"
        :show-header="
          !!(
            searchObj.data.stream.selectedStream.value &&
            !searchObj.data.errorMsg?.trim()?.length &&
            searchObj.searchApplied
          )
        "
        @row-click="expandRowDetail"
        @load-more="loadMore"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineAsyncComponent, defineComponent, ref } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import useTraces from "../../composables/useTraces";
import { useRouter } from "vue-router";
import TracesSearchResultList from "./components/TracesSearchResultList.vue";

export default defineComponent({
  name: "SearchResult",
  components: {
    TracesSearchResultList,
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
    // Infinite scroll
    // -----------------------------------------------------------------------
    const hits = computed<any[]>(() => searchObj.data.queryResults?.hits ?? []);

    const searchPerformed = computed(() =>
      Object.prototype.hasOwnProperty.call(
        searchObj.data.queryResults,
        "total",
      ),
    );

    function loadMore() {
      if (
        searchObj.loading == false &&
        searchObj.data.resultGrid.currentPage *
          searchObj.meta.resultGrid.rowsPerPage <
          searchObj.data.queryResults.total
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
      metricsDashboardRef,
      expandRowDetail,
      onMetricsTimeRangeSelected,
      onMetricsFiltersUpdated,
      getDashboardData,
      hits,
      searchPerformed,
      loadMore,
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
