<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import NoData from "@/components/shared/grid/NoData.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  data: any[];
  loading?: boolean;
  selectedIds?: string[];
  globalFilter?: string;
}>();

const emit = defineEmits<{
  "update:selectedIds": [ids: string[]];
  edit: [row: any];
  delete: [row: any];
  "bulk-delete": [];
}>();

const columns: OTableColumnDef[] = [
  {
    id: "#",
    header: "#",
    accessorFn: (row: any) => row["#"],
    size: 40,
    minSize: 32,
    maxSize: 50,
    meta: { compactPadding: true, align: "left" },
  },
  {
    id: "role_name",
    header: t("iam.roleName"),
    accessorKey: "role_name",
    sortable: true,
    meta: { align: "left", autoWidth: true },
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
    :data="data"
    :columns="columns"
    :loading="loading"
    :selected-ids="selectedIds"
    :global-filter="globalFilter"
    pagination="client"
    :page-size="20"
    :page-size-options="[20, 50, 100, 250, 500]"
    :footer-title="t('iam.roles')"
    sorting="client"
    selection="multiple"
    row-key="role_name"
    filter-mode="client"
    :default-columns="false"
    :show-global-filter="false"
    @update:selected-ids="emit('update:selectedIds', $event)"
  >
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
      <NoData />
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
