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
  <template v-if="isMetaOrg">
    <OTable
      :frame="false"
      data-test="running-queries-table"
      :data="rows"
      :columns="columns"
      row-key="trace_id"
      :loading="loadingState"
      :selected-ids="selectedRowIds"
      selection="multiple"
      pagination="client"
      :page-size="20"
      :page-size-options="[5, 10, 20, 50, 100]"
      sorting="client"
      filter-mode="client"
      :default-columns="false"
      show-index
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="settings-query-management"
      :show-global-filter="false"
      @update:selected-ids="handleSelectedIdsUpdate"
    >
      <template #toolbar>
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <span
            class="text-xs font-bold whitespace-nowrap"
            data-test="running-queries-last-refresh"
          >
            {{ t("queries.lastDataRefreshTime") }} {{ lastRefreshed }}
          </span>
          <div class="flex-1"></div>
          <OToggleGroup
            v-if="searchTypes && searchTypes.length"
            :model-value="searchType"
            @update:model-value="$emit('update:searchType', $event)"
            data-test="running-queries-search-type-tabs"
          >
            <OToggleGroupItem
              v-for="visual in searchTypes"
              :key="visual as string"
              :value="visual as string"
              size="sm"
            >
              {{ (searchTypeLabels as Record<string, string>)?.[visual as string] ?? visual }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>
      </template>
      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          class="shrink-0"
          icon-left="refresh"
          data-test="running-queries-refresh-btn"
          @click="$emit('refresh')"
        >
          <OTooltip side="bottom" :content="t('common.refresh')" />
        </OButton>
      </template>
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
          icon-left="format-list-bulleted"
          variant="ghost"
          size="icon-sm"
          :title="t('queries.queryList')"
          data-test="queryList-btn"
          @click="listSchema(row)"
        />
        <OButton
          icon-left="close"
          variant="ghost-destructive"
          size="icon-sm"
          :title="t('queries.cancelQuery')"
          data-test="cancelQuery-btn"
          @click="confirmDeleteAction(row)"
        />
      </template>
      <template #cell-user_id="{ row }">
        <OUserCell :value="row.user_id" />
      </template>
      <template #cell-duration="{ row }">
        {{ durationFormatter(row.duration) }}
      </template>
      <template #cell-queryRange="{ row }">
        {{ durationFormatter(row.queryRange) }}
      </template>
      <template #cell-status="{ row }">
        <OTag type="queryStatus" :value="row.status" />
      </template>

      <template #bottom>
        <OButton
          v-if="selectedRowsModel?.length"
          data-test="qm-multiple-cancel-query-btn"
          variant="outline-destructive"
          size="sm-action"
          @click="handleMultiQueryCancel"
        >
          {{ t('queries.cancelQuery') }}
        </OButton>
      </template>
    </OTable>
    <ODrawer
      bleed
      v-model:open="showListSchemaDialog"
      size="lg"
      data-test="list-schema-dialog"
    >
      <QueryList :schemaData="schemaData" @close="showListSchemaDialog = false" />
    </ODrawer>
  </template>
</template>

<script lang="ts">
import useIsMetaOrg from "@/composables/useIsMetaOrg";
import { ref, defineComponent, computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { useStore } from "vuex";
import QueryList from "@/components/queries/QueryList.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { getDuration, durationFormatter } from "@/utils/zincutils";
import OTable from "@/lib/core/Table/OTable.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";

export default defineComponent({
  name: "RunningQueriesList",
  components: { QueryList, OEmptyState, OButton, OTooltip, OToggleGroup, OToggleGroupItem, ODrawer, OTable, OUserCell, OTag },
  props: {
    rows: {
      type: Array,
      required: true,
    },
    selectedRows: {
      type: Array,
      required: false,
    },
    filtered: {
      type: Boolean,
      default: false,
    },
    lastRefreshed: {
      type: String,
      default: "",
    },
    searchType: {
      type: String,
      default: "",
    },
    searchTypes: {
      type: Array,
      default: () => [],
    },
    searchTypeLabels: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: [
    "update:searchType",
    "update:selectedRows",
    "delete:queries",
    "delete:query",
    "show:schema",
    "clear:filters",
    "refresh",
  ],
  setup(props, { emit }) {
    const store = useStore();
    const schemaData = ref({});
    const { isMetaOrg } = useIsMetaOrg();
    const loadingState = ref(false);

    const { t } = useI18n();
    const showListSchemaDialog = ref(false);

    const listSchema = (row: any) => {
      emit("show:schema", row);
    };

    const columns: OTableColumnDef[] = [
      {
        id: "user_id",
        header: t("user.email"),
        accessorKey: "user_id",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.email,
        minSize: 160,
        meta: { align: "left" , flex: true },
      },
      {
        id: "org_id",
        header: t("organization.id"),
        accessorKey: "org_id",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.owner,
        meta: { align: "left" },
      },
      {
        id: "search_type",
        header: t("queries.searchType"),
        accessorKey: "search_type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 130,
        meta: { align: "left" },
      },
      {
        id: "query_source",
        header: t("queries.querySource"),
        accessorKey: "query_source",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 140,
        meta: { align: "left" },
      },
      {
        id: "duration",
        header: t("queries.duration"),
        accessorKey: "duration",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 150,
        meta: { align: "left" },
      },
      {
        id: "queryRange",
        header: t("queries.queryRange"),
        accessorKey: "queryRange",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 130,
        meta: { align: "left" },
      },
      {
        id: "work_group",
        header: t("queries.queryType"),
        accessorKey: "work_group",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 130,
        meta: { align: "left" },
      },
      {
        id: "status",
        header: t("queries.status"),
        accessorKey: "status",
        sortable: true,
        resizable: true,
        hideable: true,
        size: COL.status,
        meta: { align: "left" },
      },
      {
        id: "stream_type",
        header: t("alerts.streamType"),
        accessorKey: "stream_type",
        sortable: true,
        resizable: true,
        hideable: true,
        size: 130,
        meta: { align: "left" },
      },
      {
        id: "actions",
        header: t("common.actions"),
        isAction: true,
        pinned: "right",
        size: 100,
        meta: { align: "center", actionCount: 2 },
      },
    ];

    const selectedRowIds = computed(() =>
      ((props.selectedRows as any[]) || []).map((r: any) => r.trace_id),
    );

    const handleSelectedIdsUpdate = (ids: string[]) => {
      const rows = (props.rows as any[]) || [];
      const map = new Map(rows.map((r: any) => [r.trace_id, r]));
      const selected = ids.map((id: any) => map.get(id)).filter(Boolean);
      emit("update:selectedRows", selected);
    };

    const selectedRowsModel = computed(() => props.selectedRows);

    const confirmDeleteAction = (row: any) => {
      emit("delete:query", row);
    };

    const handleMultiQueryCancel = () => {
      emit("delete:queries");
    };

    return {
      t,
      store,
      columns,
      confirmDeleteAction,
      listSchema,
      showListSchemaDialog,
      schemaData,
      loadingState,
      isMetaOrg,
      selectedRowsModel,
      selectedRowIds,
      handleSelectedIdsUpdate,
      handleMultiQueryCancel,
      getDuration,
      durationFormatter,
    };
  },
});
</script>

<style scoped>
/* keep(lib-override): empty-state image spacing (child EmptyState DOM) */
:deep(.no-data-image) {
  margin-bottom: 0.5rem;
}
</style>
