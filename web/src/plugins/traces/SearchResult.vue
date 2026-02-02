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
  <div data-test="traces-search-result" class="col column overflow-hidden">
    <div data-test="traces-search-result-list" class="search-list tw:w-full">
      <!-- RED Metrics Dashboard -->
      <transition
        enter-active-class="transition-all duration-300 ease-in-out"
        leave-active-class="transition-all duration-300 ease-in-out"
        enter-from-class="opacity-0 -translate-y-4 max-h-0"
        enter-to-class="opacity-100 translate-y-0 max-h-[1000px]"
        leave-from-class="opacity-100 translate-y-0 max-h-[1000px]"
        leave-to-class="opacity-0 -translate-y-4 max-h-0"
      >
        <TracesMetricsDashboard
          v-if="searchObj.data.stream.selectedStream.value && searchObj.searchApplied"
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
        />
      </transition>

      <div
        data-test="traces-search-result-count"
        class="text-subtitle1 text-bold q-pt-sm q-px-sm"
        v-show="
          searchObj.data.stream.selectedStream.value &&
          !searchObj.data.errorMsg?.trim()?.length &&
          !searchObj.loading &&
          searchObj.searchApplied
        "
      >
        {{ searchObj.data.queryResults?.hits?.length || 0 }} Traces
      </div>

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
      <div
        v-else-if="
          searchObj.data.queryResults.hasOwnProperty('total') &&
          searchObj.data.queryResults?.hits?.length == 0 &&
          searchObj.loading == false
        "
        class="text-center tw:mx-[10%] tw:my-[40px] tw:text-[20px]"
      >
        <q-icon name="info"
color="primary" size="md" /> No traces found. Please
        adjust the filters and try again.
      </div>
      <q-virtual-scroll
        v-else
        v-show="
          searchObj.data.queryResults.hasOwnProperty('total') &&
          !!searchObj.data.queryResults?.hits?.length
        "
        id="tracesSearchGridComponent"
        data-test="traces-search-result-virtual-scroll"
        :items="searchObj.data.queryResults.hits"
        class="traces-table-container"
        :class="
          searchObj.meta.showHistogram
            ? 'tw:h-[calc(100vh-30rem)]'
            : 'tw:h-[calc(100vh-14.50rem)]'
        "
        v-slot="{ item, index }"
        :virtual-scroll-item-size="25"
        :virtual-scroll-sticky-size-start="0"
        :virtual-scroll-sticky-size-end="0"
        :virtual-scroll-slice-size="50"
        :virtual-scroll-slice-ratio-before="10"
        @virtual-scroll="onScroll"
      >
        <q-item data-test="traces-search-result-item" :key="index"
dense>
          <TraceBlock
            :item="item"
            :index="index"
            @click="expandRowDetail(item)"
          />
        </q-item>
      </q-virtual-scroll>
    </div>
  </div>
</template>

<script lang="ts">
import { defineAsyncComponent, defineComponent, ref } from "vue";
import { useQuasar } from "quasar";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";

import { byString } from "../../utils/json";
import useTraces from "../../composables/useTraces";
import { getImageURL } from "../../utils/zincutils";
import TraceBlock from "./TraceBlock.vue";
import { useRouter } from "vue-router";

export default defineComponent({
  name: "SearchResult",
  components: {
    TraceBlock,
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
    onScroll(info: any) {
      if (
        info.ref.items.length / info.index <= 1.2 &&
        this.searchObj.loading == false &&
        this.searchObj.data.resultGrid.currentPage <=
          this.searchObj.data.queryResults.from /
            this.searchObj.meta.resultGrid.rowsPerPage &&
        this.searchObj.data.queryResults.hits.length >
          this.searchObj.meta.resultGrid.rowsPerPage *
            this.searchObj.data.resultGrid.currentPage
      ) {
        this.searchObj.data.resultGrid.currentPage += 1;
        this.$emit("update:scroll");
      }
    },
    onTimeBoxed(obj: any) {
      this.searchObj.meta.showDetailTab = false;
      this.searchObj.data.searchAround.indexTimestamp = obj.key;
      this.$emit("search:timeboxed", obj);
    },
  },
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const $q = useQuasar();
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

    const getRowIndex = (next: boolean, prev: boolean, oldIndex: number) => {
      if (next) {
        return oldIndex + 1;
      } else {
        return oldIndex - 1;
      }
    };

    const addSearchTerm = (term: string) => {
      // searchObj.meta.showDetailTab = false;
      searchObj.data.stream.addToFilter = term;
    };

    const removeSearchTerm = (term: string) => {
      emit("remove:searchTerm", term);
    };

    const onMetricsTimeRangeSelected = (range: {
      start: number;
      end: number;
    }) => {
      // Update the datetime and trigger a new search
      emit("update:datetime", {
        start: range.start,
        end: range.end,
      });
    };

    const getDashboardData = () => {
      metricsDashboardRef?.value?.loadDashboard();
    };

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
      getDashboardData,
    };
  },
});
</script>

<style lang="scss" scoped>
.max-result {
  width: 170px;
}

.search-list {
  width: 100%;

  .my-sticky-header-table {
    .q-table__top,
    .q-table__bottom,
    thead tr:first-child th {
      /* bg color is important for th; just specify one */
      background-color: white;
    }

    thead tr th {
      position: sticky;
      z-index: 1;
    }

    thead tr:first-child th {
      top: 0;
    }

    /* this is when the loading indicator appears */
    &.q-table--loading thead tr:last-child th {
      /* height of all previous header rows */
      top: 48px;
    }
  }

  .q-table__top {
    padding-left: 0;
    padding-top: 0;
  }

  .q-table thead tr,
  .q-table tbody td,
  .q-table th,
  .q-table td {
    height: 25px;
    padding: 0px 5px;
    font-size: 0.75rem;
  }

  .q-table__bottom {
    width: 100%;
  }

  .q-table__bottom {
    min-height: 40px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .q-td {
    overflow: hidden;
    min-width: 100px;

    .expanded {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
      word-break: break-all;
    }
  }

  .highlight {
    background-color: rgb(255, 213, 0);
  }

  .table-header {
    // text-transform: capitalize;

    .table-head-chip {
      background-color: $accent;
      padding: 0px;

      .q-chip__content {
        margin-right: 0.5rem;
        font-size: 0.75rem;
        color: $dark;
      }

      .q-chip__icon--remove {
        height: 1rem;
        width: 1rem;
        opacity: 1;
        margin: 0;

        &:hover {
          opacity: 0.7;
        }
      }

      .q-table th.sortable {
        cursor: pointer;
        text-transform: capitalize;
        font-weight: bold;
      }
    }

    &.isClosable {
      padding-right: 26px;
      position: relative;

      .q-table-col-close {
        transform: translateX(26px);
        position: absolute;
        margin-top: 2px;
        color: grey;
        transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
      }
    }

    .q-table th.sortable {
      cursor: pointer;
      text-transform: capitalize;
      font-weight: bold;
    }
  }
}
.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
  background: #f5f5f5;
}

.q-table--dark .thead-sticky tr > *,
.q-table--dark .tfoot-sticky tr > * {
  background: #565656;
}
.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}

.field_list {
  padding: 0px;
  margin-bottom: 0.125rem;
  position: relative;
  overflow: visible;
  cursor: default;

  .field_overlay {
    position: absolute;
    height: 100%;
    right: 0;
    top: 0;
    background-color: #ffffff;
    border-radius: 6px;
    padding: 0 6px;
    visibility: hidden;
    display: flex;
    align-items: center;
    transition: all 0.3s linear;

    .q-icon {
      cursor: pointer;
      opacity: 0;
      transition: all 0.3s linear;
      margin: 0 1px;
    }
  }

  &:hover {
    .field_overlay {
      visibility: visible;

      .q-icon {
        opacity: 1;
      }
    }
  }
}
</style>
