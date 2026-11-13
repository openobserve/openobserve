<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef, type OTableRowAction } from "@/lib/core/Table/OTable.types";
import ONameLinkCell from "@/lib/core/Table/cells/ONameLinkCell.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { useI18nTyped } from "@/types/i18n";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import { useEditorDraftIds } from "@/composables/useEditorDraft";
import type { ForbiddenState } from "@/utils/featureGate";

const { t } = useI18nTyped();

const roleDrafts = useEditorDraftIds("iam_role");

const props = defineProps<{
  data: any[];
  loading?: boolean;
  forbidden?: ForbiddenState;
  actionLoading?: boolean;
  /** Member counts are still being fetched; unknown counts draw a placeholder instead of a dash. */
  countsLoading?: boolean;
  selectedIds?: string[];
  globalFilter?: string;
  pageSize?: number;
  currentPage?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** Member email being assigned to a role (from the "Assign a role" quick-link).
   *  Presence alone turns on the Assign column — not gated separately. */
  assignTarget?: string;
  /** Role currently in flight for an assign click, so only that row spins. */
  assigningRoleName?: string | null;
  /** Roles assignTarget already belongs to — rendered as "Assigned" instead of
   *  an actionable button. */
  assignedRoleNames?: string[];
}>();

const emit = defineEmits<{
  "update:selectedIds": [ids: string[]];
  "update:globalFilter": [value: string];
  "update:pageSize": [value: number];
  "update:currentPage": [value: number];
  "update:sortBy": [value: string];
  "update:sortOrder": [value: "asc" | "desc"];
  edit: [row: any, tab?: "users" | "serviceAccounts"];
  delete: [row: any];
  "bulk-delete": [];
  create: [];
  assign: [row: any];
}>();

const oTableRef = ref<any>(null);
defineExpose({ restorePage: (page: number) => oTableRef.value?.restorePage?.(page) });

const onEmptyStateAction = (id?: string) => {
  if (id === "clear-filters") {
    emit("update:globalFilter", "");
    return;
  }
  if (id === "create") emit("create");
};

const store = useStore();
// Known before the counts load, so hiding the column for a disabled feature moves nothing later.
const serviceAccountsEnabled = computed(() => !!store.state.zoConfig?.service_account_enabled);
const serviceAccountColumn: OTableColumnDef = {
  id: "service_account_count",
  header: t("iam.serviceAccounts"),
  accessorKey: "service_account_count",
  sortable: true,
  resizable: true,
  hideable: true,
  size: 150,
  minSize: 150,
  meta: { align: "right" },
};

const columns = computed<OTableColumnDef[]>(() => {
  const cols: OTableColumnDef[] = [
    {
      id: "role_name",
      header: t("iam.roleName"),
      accessorKey: "role_name",
      sortable: true,
      meta: { align: "left", autoWidth: true, isName: true },
    },
    // Declared before the counts load, so their arrival moves no column.
    {
      id: "user_count",
      header: t("iam.roleUsers"),
      accessorKey: "user_count",
      sortable: true,
      resizable: true,
      hideable: true,
      size: COL.count,
      meta: { align: "right" },
    },
    ...(serviceAccountsEnabled.value ? [serviceAccountColumn] : []),
  ];

  if (props.assignTarget) {
    cols.push({
      id: "assign",
      header: t("iam.rolesPage.assignColumn"),
      sortable: false,
      resizable: false,
      size: 130,
      meta: { align: "center" },
    });
  }

  cols.push({
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
  });

  return cols;
});

const rowActions: OTableRowAction[] = [
  {
    id: "edit",
    label: t("common.edit"),
    icon: "edit",
    onSelect: (row) => emit("edit", row),
    dataTest: (row) => `iam-roles-edit-${row.role_name}-role-icon`,
  },
  {
    id: "delete",
    label: t("common.delete"),
    icon: "delete",
    onSelect: (row) => emit("delete", row),
    dataTest: (row) => `iam-roles-delete-${row.role_name}-role-icon`,
  },
];

const isAssigned = (row: any): boolean => (props.assignedRoleNames ?? []).includes(row?.role_name);
</script>

<template>
  <OTable
    ref="oTableRef"
    :frame="false"
    :data="data"
    :columns="columns"
    :loading="loading"
    :forbidden="forbidden"
    :selected-ids="selectedIds"
    :global-filter="globalFilter"
    :show-global-filter="false"
    pagination="client"
    :page-size="pageSize ?? 20"
    :page-size-options="[20, 50, 100, 250, 500]"
    :current-page="currentPage ?? 1"
    :sort-by="sortBy"
    :sort-order="sortOrder"
    sorting="client"
    selection="multiple"
    row-key="role_name"
    :row-actions="rowActions"
    row-actions-more-data-test="iam-roles-row-more-actions"
    filter-mode="client"
    :default-columns="false"
    show-index
    @update:selected-ids="emit('update:selectedIds', $event)"
    @update:global-filter="emit('update:globalFilter', $event)"
    @update:page-size="emit('update:pageSize', $event)"
    @update:current-page="emit('update:currentPage', $event)"
    @update:sort-by="emit('update:sortBy', $event)"
    @update:sort-order="emit('update:sortOrder', $event)"
  >
    <template #toolbar>
      <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
        <OSearchInput
          :model-value="globalFilter"
          :placeholder="t('iam.searchRole')"
          class="flex-1"
          data-test="iam-roles-search-input"
          @update:model-value="emit('update:globalFilter', $event)"
        />
      </div>
    </template>

    <template #cell-role_name="{ row, value }">
      <span class="inline-flex max-w-full min-w-0 items-center gap-2">
        <ONameLinkCell :to="() => emit('edit', row)" data-test="iam-roles-table-name-link">{{
          value
        }}</ONameLinkCell>
        <EditorDraftDot
          v-if="roleDrafts.ids.has(row?.role_name)"
          :saved-at="roleDrafts.savedAt(row?.role_name)"
          :data-test="`iam-roles-${row?.role_name}-draft-dot`"
        />
      </span>
    </template>

    <template #cell-user_count="{ row }">
      <OButton
        v-if="typeof row.user_count === 'number'"
        :variant="row.user_count === 0 ? 'ghost-muted' : 'ghost-primary'"
        size="xs"
        class="tabular-nums"
        :aria-label="`${row.role_name}: ${row.user_count} ${t('iam.roleUsers')}`"
        :data-test="`iam-roles-${row.role_name}-users-link`"
        @click.stop="emit('edit', row, 'users')"
      >
        {{ row.user_count }}
      </OButton>
      <OSkeleton
        v-else-if="countsLoading"
        type="text"
        class="ms-auto h-3 w-8"
        :data-test="`iam-roles-${row.role_name}-users-loading`"
      />
      <span v-else class="text-text-muted tabular-nums">—</span>
    </template>
    <template #cell-service_account_count="{ row }">
      <OButton
        v-if="typeof row.service_account_count === 'number'"
        :variant="row.service_account_count === 0 ? 'ghost-muted' : 'ghost-primary'"
        size="xs"
        class="tabular-nums"
        :aria-label="`${row.role_name}: ${row.service_account_count} ${t('iam.serviceAccounts')}`"
        :data-test="`iam-roles-${row.role_name}-service-accounts-link`"
        @click.stop="emit('edit', row, 'serviceAccounts')"
      >
        {{ row.service_account_count }}
      </OButton>
      <OSkeleton
        v-else-if="countsLoading"
        type="text"
        class="ms-auto h-3 w-8"
        :data-test="`iam-roles-${row.role_name}-service-accounts-loading`"
      />
      <span v-else class="text-text-muted tabular-nums">—</span>
    </template>
    <template #toolbar-trailing>
      <slot name="toolbar-trailing" />
    </template>

    <!-- Rendered only when a member (?member=<email>) is being assigned via the token popup's link. -->
    <template #cell-assign="{ row }">
      <div class="flex items-center justify-center">
        <OBadge v-if="isAssigned(row)" variant="success" icon="check" size="sm">
          {{ t("iam.rolesPage.assignedBadge") }}
        </OBadge>
        <OButton
          v-else
          :data-test="`iam-roles-assign-${row.role_name}-btn`"
          variant="outline"
          size="sm"
          :loading="assigningRoleName === row.role_name"
          @click="emit('assign', row)"
        >
          {{ t("iam.rolesPage.assignBtn") }}
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

    <template #selection-actions>
      <OButton
        data-test="iam-roles-bulk-delete-btn"
        variant="outline-destructive"
        size="sm"
        :loading="actionLoading"
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
