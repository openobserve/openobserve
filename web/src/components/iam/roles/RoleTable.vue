<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { useI18n } from "vue-i18n";
import { TABLE_INDEX_COL_SIZE } from "@/lib/core/Table/OTable.types";

const { t } = useI18n();

defineProps<{
  data: any[];
  loading?: boolean;
  selectedIds?: string[];
  globalFilter?: string;
}>();

const emit = defineEmits<{
  "update:selectedIds": [ids: string[]];
  "update:globalFilter": [value: string];
  edit: [row: any];
  delete: [row: any];
  "bulk-delete": [];
}>();

const columns: OTableColumnDef[] = [
  {
    id: "#",
    header: "#",
    accessorFn: (row: any) => row["#"],
    size: TABLE_INDEX_COL_SIZE,
    minSize: 32,
    maxSize: 50,
    meta: { compactPadding: true, align: "left" },
  },
  {
    id: "role_name",
    header: t("iam.roleName"),
    accessorKey: "role_name",
    sortable: true,
    meta: { align: "left", autoWidth: true, isName: true },
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    meta: { align: "left", actionCount: 2 },
  },
];
</script>

<template>
  <OTable
    :frame="false"
    :data="data"
    :columns="columns"
    :loading="loading"
    :selected-ids="selectedIds"
    :global-filter="globalFilter"
    :show-global-filter="false"
    pagination="client"
    :page-size="20"
    :page-size-options="[20, 50, 100, 250, 500]"
    :footer-title="t('iam.roles')"
    sorting="client"
    selection="multiple"
    row-key="role_name"
    filter-mode="client"
    :default-columns="false"
    @update:selected-ids="emit('update:selectedIds', $event)"
    @update:global-filter="emit('update:globalFilter', $event)"
  >
    <template #toolbar>
      <div class="tw:flex tw:items-center tw:gap-2 tw:w-full">
        <OSearchInput
          :model-value="globalFilter"
          :placeholder="t('iam.searchRole')"
          class="tw:flex-1"
          @update:model-value="emit('update:globalFilter', $event)"
        />
      </div>
    </template>
    <!-- Row actions: edit + delete -->
    <template #cell-actions="{ row }">
      <div class="tw:flex tw:items-center tw:justify-center">
        <OButton
          :data-test="`iam-roles-edit-${row.role_name}-role-icon`"
          variant="ghost"
          size="icon-sm"
          :title="t('common.edit')"
          @click="emit('edit', row)"
        >
          <OIcon name="edit" size="sm" />
        </OButton>
        <OButton
          :data-test="`iam-roles-delete-${row.role_name}-role-icon`"
          variant="ghost"
          size="icon-sm"
          :title="t('common.delete')"
          @click="emit('delete', row)"
        >
          <OIcon name="delete" size="sm" />
        </OButton>
      </div>
    </template>

    <template #empty>
      <OEmptyState
        size="hero"
        preset="no-roles"
        :filtered="!!globalFilter"
        :hide-action="!globalFilter"
        @action="emit('update:globalFilter', '')"
      />
    </template>

    <template #bottom>
      <span class="o2-table-footer-title tw:text-text-primary">{{ data.length }} {{ t("iam.roles") }}</span>
      <OButton
        v-if="(selectedIds?.length ?? 0) > 0"
        data-test="iam-roles-bulk-delete-btn"
        variant="outline-destructive"
        size="sm"
        @click="emit('bulk-delete')"
      >
        <template #icon-left>
          <OIcon name="delete" size="sm" />
        </template>
        {{ t("common.delete") }}
      </OButton>
    </template>
  </OTable>
</template>
