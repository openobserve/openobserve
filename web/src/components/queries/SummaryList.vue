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
  <OTable
    v-if="isMetaOrg"
    :frame="false"
    data-test="running-queries-table"
    :data="rows"
    :columns="columns"
    row-key="row_id"
    :loading="loadingState"
    pagination="client"
    selection="multiple"
    v-model:selected-ids="selectedIds"
    @row-click="getAllUserQueries"
    style="width: 100%"
    :show-global-filter="false"
    :default-columns="false"
  >
    <template #empty>
      <OEmptyState
        size="hero"
        preset="no-queries"
        :filtered="filtered"
        :hide-action="!filtered"
        @action="(id) => id === 'clear-filters' && $emit('clear:filters')"
      />
    </template>
    <template #cell-actions="{ row }">
      <OButton
        variant="ghost-destructive"
        size="icon-sm"
        :title="t('queries.cancelQuery')"
        data-test="cancelQuery-btn"
        @click.stop="confirmDeleteAction({ row })"
        icon-left="close"
      />
    </template>
    <template #cell-duration="{ row }">
      {{ durationFormatter(row.duration) }}
    </template>
    <template #cell-queryRange="{ row }">
      {{ durationFormatter(row.queryRange) }}
    </template>

    <template #bottom>
      <OButton
        v-if="selectedRow.length"
        data-test="qm-multiple-cancel-query-btn"
        variant="outline-destructive"
        size="sm-action"
        @click="handleMultiQueryCancel"
      >
        {{ t('queries.cancelQuery') }}
      </OButton>
    </template>
  </OTable>
</template>

<script lang="ts">

import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { ref, type Ref, defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from '@/lib/core/Button/OButton.vue';
import { durationFormatter } from "@/utils/zincutils";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { TABLE_INDEX_COL_SIZE, COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "RunningQueriesList",
  components: { OEmptyState, OTable, OButton, OSpinner, OCheckbox },
  props: {
    rows: {
      type: Array,
      required: true,
    },
    selectedRows: {
      type: Array,
      required: true,
    },
    filtered: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    "cancel:hideform",
    "filter:queries",
    "update:selectedRows",
    "delete:queries",
    "clear:filters",
  ],
  setup(props, { emit }) {
    const { isMetaOrg } = useIsMetaOrg();
    const resultTotal = ref<number>(0);

    const loadingState = ref(false);

    const deleteDialog = ref({
      show: false,
      title: "Delete Running Query",
      message: "Are you sure you want to delete this running query?",
      data: null as any,
    });

    const { t } = useI18n();
    const showListSchemaDialog = ref(false);

    const pageSize = ref(20);
    const pageSizeOptions = [5, 10, 20, 50, 100];

    const columns = ref<OTableColumnDef[]>([
      { id: "#", header: "#", accessorKey: "#", size: TABLE_INDEX_COL_SIZE, meta: { align: "left" } },
      { id: "user_id", header: t("user.email"), accessorKey: "user_id", size: COL.email, sortable: true, meta: { align: "left" , autoWidth: true } },
      { id: "search_type_label", header: t("queries.searchType"), accessorKey: "search_type_label", size: 130, sortable: true, meta: { align: "left"  } },
      { id: "numOfQueries", header: t("queries.numOfQueries"), accessorKey: "numOfQueries", size: 170, sortable: true, meta: { align: "left" } },
      { id: "duration", header: t("queries.totalDuration"), accessorKey: "duration", size: 190, cell: " ", sortable: true, meta: { align: "left" } },
      { id: "queryRange", header: t("queries.totalTimeRange"), accessorKey: "queryRange", size: 170, cell: " ", sortable: true, meta: { align: "left" } },
      { id: "actions", header: t("common.actions"), isAction: true, size: 100, meta: { align: "center", actionCount: 1 } },
    ]);

    const selectedIds = computed({
      get: () => (props.selectedRows as any[]).map((row: any) => row.row_id),
      set: (ids: string[]) => {
        const rows = (props.rows as any[]).filter((row: any) => ids.includes(row.row_id));
        emit("update:selectedRows", rows);
      },
    });

    const selectedRow = computed(() => props.selectedRows);

    const confirmDeleteAction = (props: any) => {
      emit("delete:queries", props.row.trace_ids || []);
    };

    const handleMultiQueryCancel = () => {
      emit("delete:queries");
    };

    const getAllUserQueries = (event: any, row: any) => {
      emit("filter:queries", row);
    };

    return {
      t,
      columns,
      confirmDeleteAction,
      deleteDialog,
      pageSize,
      pageSizeOptions,
      showListSchemaDialog,
      "cancel": "cancel",
      loadingState,
      isMetaOrg,
      selectedIds,
      selectedRow,
      handleMultiQueryCancel,
      getAllUserQueries,
      durationFormatter,
    };
  },
});
</script>

<style lang="scss" scoped>
.query-management-tabs {
  :deep(.q-btn:before) {
    border: none !important;
  }
}

:deep(.no-data-image) {
  margin-bottom: 0.5rem;
}

.label-container {
  display: flex;
  width: 100%;
  justify-content: flex-end;
}
</style>

<style lang="scss">
.running-queries-page {
  .search-input {
    width: 250px;
  }
}

.search-field-select {
  .q-field__control {
    padding-left: 12px;
    top: -1px;
    position: relative;
  }
}
</style>
