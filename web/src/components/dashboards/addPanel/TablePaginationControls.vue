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
  <div class="flex items-center" data-test="dashboard-table-pagination-controls">
    <!-- Records per page dropdown: only when pagination is enabled -->
    <div v-if="showPagination" class="flex flex-row items-center gap-2">
      <span class="text-xs" data-test="dashboard-table-rows-per-page-label"
        >{{ t("dashboard.rowsPerPage") }}
      </span>
      <OSelect
        :model-value="pagination.rowsPerPage"
        @update:model-value="(val: SelectModelValue) => $emit('update:rowsPerPage', Number(val))"
        :options="formattedPaginationOptions"
        size="sm"
        :searchable="false"
        class="w-fit!"
        data-test="dashboard-table-rows-per-page-select"
      />
    </div>

    <!-- Count display -->
    <span class="px-2 text-xs" data-test="dashboard-table-row-count">
      {{ countDisplay }}
    </span>

    <!-- Navigation arrows: only when pagination is enabled -->
    <template v-if="showPagination">
      <OButton
        v-if="pagesNumber > 1"
        variant="ghost"
        size="icon"
        :disabled="isFirstPage"
        @click="$emit('firstPage')"
        icon-left="first-page"
        data-test="dashboard-table-pagination-first-page"
      >
      </OButton>
      <OButton
        v-if="pagesNumber > 1"
        variant="ghost"
        size="icon"
        :disabled="isFirstPage"
        @click="$emit('prevPage')"
        icon-left="chevron-left"
        data-test="dashboard-table-pagination-prev-page"
      >
      </OButton>
      <OButton
        v-if="pagesNumber > 1"
        variant="ghost"
        size="icon"
        :disabled="isLastPage"
        @click="$emit('nextPage')"
        icon-left="chevron-right"
        data-test="dashboard-table-pagination-next-page"
      >
      </OButton>
      <OButton
        v-if="pagesNumber > 1"
        variant="ghost"
        size="icon"
        :disabled="isLastPage"
        @click="$emit('lastPage')"
        icon-left="last-page"
        data-test="dashboard-table-pagination-last-page"
      >
      </OButton>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
export default defineComponent({
  name: "TablePaginationControls",
  components: { OButton, OSelect },
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
  emits: ["update:rowsPerPage", "firstPage", "prevPage", "nextPage", "lastPage"],
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

    const formattedPaginationOptions = computed(() =>
      props.paginationOptions.map((opt) => ({
        label: opt === 0 ? "All" : String(opt),
        value: opt,
      })),
    );

    return {
      countDisplay,
      formattedPaginationOptions,
      t,
    };
  },
});
</script>
