<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
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
  "update:globalFilter": [value: string];
  edit: [row: any];
  delete: [row: any];
  "bulk-delete": [];
  create: [];
}>();

const onEmptyStateAction = (id?: string) => {
  if (id === "clear-filters") {
    emit("update:globalFilter", "");
    return;
  }
  if (id === "create") emit("create");
};

const columns: OTableColumnDef[] = [
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
    meta: { align: "center", actionCount: 2 },
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
    show-index
    @update:selected-ids="emit('update:selectedIds', $event)"
    @update:global-filter="emit('update:globalFilter', $event)"
  >
    <template #toolbar>
      <div class="flex items-center gap-2 w-full">
        <OSearchInput
          :model-value="globalFilter"
          :placeholder="t('iam.searchRole')"
          class="flex-1"
          data-test="iam-roles-search-input"
          @update:model-value="emit('update:globalFilter', $event)"
        />
      </div>
    </template>
    <template #toolbar-trailing>
      <slot name="toolbar-trailing" />
    </template>
    <!-- Row actions: edit + delete -->
    <template #cell-actions="{ row }">
      <div class="flex items-center justify-center">
        <OButton
          :data-test="`iam-roles-edit-${row.role_name}-role-icon`"
          data-row-action="edit"
          variant="ghost"
          size="icon-sm"
          :title="t('common.edit')"
          @click="emit('edit', row)"
        >
          <OIcon name="edit" size="sm" />
        </OButton>
        <OButton
          :data-test="`iam-roles-delete-${row.role_name}-role-icon`"
          data-row-action="delete"
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
        @action="onEmptyStateAction"
      />
    </template>

    <template #bottom>
      <span class="text-xs font-normal">{{ data.length }} {{ t("iam.roles") }}</span>
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
