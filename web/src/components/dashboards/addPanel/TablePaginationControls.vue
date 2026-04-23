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

<template>
  <div class="row items-center" data-test="dashboard-table-pagination-controls">
    <!-- Records per page dropdown: only when pagination is enabled -->
    <div v-if="showPagination" class="row items-center q-gutter-sm">
      <span class="text-caption" data-test="dashboard-table-rows-per-page-label">{{ t("dashboard.rowsPerPage") }}
</span>
      <q-select
        :model-value="pagination.rowsPerPage"
        @update:model-value="(val: number) => $emit('update:rowsPerPage', val)"
        :options="paginationOptions"
        :option-label="(opt: any) => (opt === 0 ? 'All' : opt)"
        borderless
        dense
        options-dense
        class="q-table__select"
      />
    </div>

    <!-- Count display -->
    <span class="text-caption q-pa-sm" data-test="dashboard-table-row-count">
      {{ countDisplay }}
    </span>

    <!-- Navigation arrows: only when pagination is enabled -->
    <template v-if="showPagination">
      <OButton
  variant="ghost"
  size="icon"
  v-if="pagesNumber > 1"
  @click="$emit('firstPage')"
  :disabled="isFirstPage">
  <template #icon-left><ChevronsLeft class="tw:w-4 tw:h-4" /></template>
</OButton>
      <OButton
  variant="ghost"
  size="icon"
  v-if="pagesNumber > 1"
  @click="$emit('prevPage')"
  :disabled="isFirstPage">
  <template #icon-left><ChevronLeft class="tw:w-4 tw:h-4" /></template>
</OButton>
      <OButton
  variant="ghost"
  size="icon"
  v-if="pagesNumber > 1"
  @click="$emit('nextPage')"
  :disabled="isLastPage">
  <template #icon-left><ChevronRight class="tw:w-4 tw:h-4" /></template>
</OButton>
      <OButton
  variant="ghost"
  size="icon"
  v-if="pagesNumber > 1"
  @click="$emit('lastPage')"
  :disabled="isLastPage">
  <template #icon-left><ChevronsRight class="tw:w-4 tw:h-4" /></template>
</OButton>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";

import OButton from "@/lib/core/Button/Button.vue";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-vue-next";
export default defineComponent({
  components: {
    OButton,
    ChevronsLeft,
    ChevronLeft,
    ChevronRight,
    ChevronsRight,
  },

name: "TablePaginationControls",
  props: {
    showPagination: {
      type: Boolean,
      default: false,
    },
    pagination: {
      type: Object as () => { rowsPerPage: number; page: number },
      required: true,
      default: () => ({ rowsPerPage: 0, page: 1 }),
    },
    paginationOptions: {
      type: Array as () => number[],
      default: () => [10, 20, 50, 100, 250, 500, 1000],
    },
    totalRows: {
      type: Number,
      required: true,
      default: 0,
    },
    pagesNumber: {
      type: Number,
      default: 1,
    },
    isFirstPage: {
      type: Boolean,
      default: true,
    },
    isLastPage: {
      type: Boolean,
      default: true,
    },
  },
  emits: [
    "update:rowsPerPage",
    "firstPage",
    "prevPage",
    "nextPage",
    "lastPage",
  ],
  setup(props) {
    const { t } = useI18n();
    const countDisplay = computed(() => {
      const { showPagination, pagination, totalRows } = props;
      if (totalRows === 0) return "0 of 0";
      if (!showPagination || pagination.rowsPerPage === 0) {
        return `1-${totalRows} of ${totalRows}`;
      }

      const start = (pagination.page - 1) * pagination.rowsPerPage + 1;
      const end = Math.min(pagination.page * pagination.rowsPerPage, totalRows);
      return `${start}-${end} of ${totalRows}`;
    });

    return {
      countDisplay,
      t,
    };
  },
});
</script>
