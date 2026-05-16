<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  data: any[];
  loading?: boolean;
  selectedIds?: string[];
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
    meta: { align: "left" },
  },
];
</script>

<template>
  <OTable
    :data="data"
    :columns="columns"
    :loading="loading"
    :selected-ids="selectedIds"
    pagination="client"
    :page-size="20"
    sorting="client"
    selection="multiple"
    row-key="role_name"
    filter-mode="client"
    :default-columns="false"
    @update:selected-ids="emit('update:selectedIds', $event)"
  >
    <!-- Row actions: edit + delete -->
    <template #cell-actions="{ row }">
      <div class="tw:flex tw:items-center tw:gap-2 tw:justify-center">
        <OButton
          :data-test="`iam-roles-edit-${row.role_name}-role-icon`"
          variant="ghost"
          size="icon-circle-sm"
          :title="t('common.edit')"
          @click="emit('edit', row)"
        >
          <q-icon name="edit" />
        </OButton>
        <OButton
          :data-test="`iam-roles-delete-${row.role_name}-role-icon`"
          variant="ghost"
          size="icon-circle-sm"
          :title="t('common.delete')"
          @click="emit('delete', row)"
        >
          <q-icon :name="outlinedDelete" />
        </OButton>
      </div>
    </template>

    <!-- Bottom: bulk action in pagination bar -->
    <template
      v-if="(selectedIds?.length ?? 0) > 0"
      #bottom
    >
      <span class="tw:text-xs tw:text-text-primary tw:font-medium">
        {{ selectedIds?.length }} selected
      </span>
      <OButton
        data-test="iam-roles-bulk-delete-btn"
        variant="ghost"
        size="sm"
        @click="emit('bulk-delete')"
      >
        <template #icon-left>
          <q-icon name="delete" size="1rem" />
        </template>
        {{ t("common.delete") }}
      </OButton>
    </template>
  </OTable>
</template>
