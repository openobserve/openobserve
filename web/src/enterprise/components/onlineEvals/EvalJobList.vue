<template>
  <EvalListShell data-test="eval-job" :show-empty="false">
    <template #table>
      <OTable
        v-model:selected-ids="selectedIds"
        selection="multiple"
        data-test="eval-job-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :footer-title="t('onlineEvals.job.listTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="eval-job-list"
        width="100%"
        class="h-full w-full"
        @row-click="(row: any) => $emit('view', row)"
      >
        <template #toolbar>
          <OSearchInput
            :model-value="search"
            class="min-w-0 flex-1"
            :placeholder="t('onlineEvals.job.searchPlaceholder')"
            data-test="eval-job-list-search-input"
            clearable
            @update:model-value="$emit('update:search', $event as string)"
          />
          <OSelect
            v-model="statusFilter"
            :options="statusOptions"
            :placeholder="t('onlineEvals.job.allStatuses')"
            size="md"
            width="sm"
            class="shrink-0"
            data-test="eval-job-list-status-filter"
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="eval-job-list-refresh-btn"
            @click="emit('refresh')"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="evalJobsRefresh" />
          </OButton>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-eval-jobs"
              :filtered="hasFilters"
              data-test="eval-job-empty-state"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #bottom="{ totalRows }">
          <span class="text-xs font-normal">
            {{ totalRows.toLocaleString() }} {{ t("onlineEvals.job.listTitle") }}
          </span>
          <OButton
            v-if="selectedIds.length > 0"
            variant="outline-destructive"
            size="sm"
            class="ml-3"
            icon-left="delete"
            data-test="eval-job-bulk-delete-btn"
            :loading="actionLoading"
            @click="handleBulkDelete"
          >
            {{ t("onlineEvals.job.deleteBulkButton") }} ({{ selectedIds.length }})
          </OButton>
        </template>

        <template #cell-status="{ row }">
          <OTag type="evalStatus" :value="statusOf(row)" :label="statusLabel(statusOf(row))" />
        </template>

        <template #cell-stream="{ row }">
          {{ row.stream }}
        </template>

        <template #cell-targetScope="{ row }">
          <OTag type="fieldTag" :value="targetScopeOf(row)">{{ targetScopeLabel(row) }}</OTag>
        </template>

        <template #cell-scorers="{ row }">
          <span class="tabular-nums">{{ scorerCountText(row) }}</span>
        </template>

        <template #cell-created="{ row }">
          {{ formatDateShort(rowCreated(row)) }}
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center">
            <OButton
              v-if="canActivate(row.status)"
              :data-test="`eval-job-list-${row.name}-activate-btn`"
              variant="ghost-success"
              size="icon-sm"
              :title="t('onlineEvals.actions.activate')"
              icon-left="play-arrow"
              :loading="pendingStatusId === row.id"
              :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
              @click.stop="$emit('activate', row)"
            />
            <OButton
              v-if="canPause(row.status)"
              :data-test="`eval-job-list-${row.name}-pause-btn`"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('onlineEvals.actions.pause')"
              icon-left="pause"
              :loading="pendingStatusId === row.id"
              :disabled="pendingStatusId !== null && pendingStatusId !== row.id"
              @click.stop="$emit('pause', row)"
            />
            <OButton
              :data-test="`eval-job-list-${row.name}-edit-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.edit')"
              icon-left="edit"
              @click.stop="$emit('edit', row)"
            />
            <OButton
              :data-test="`eval-job-list-${row.name}-delete-btn`"
              variant="ghost-destructive"
              size="icon-sm"
              :title="t('onlineEvals.actions.delete')"
              icon-left="delete"
              @click.stop="$emit('delete', row)"
            />
          </div>
        </template>
      </OTable>
    </template>
  </EvalListShell>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import type { EvalJob, EvalJobStatus } from "@/services/online-evals.service";
import { statusOf, targetScopeOf, valueOf } from "./utils/evalEntity";
import { formatDate } from "@/utils/date";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EvalListShell from "./EvalListShell.vue";
import { useNumberedRows } from "./composables/useNumberedRows";

const props = defineProps<{
  rows: EvalJob[];
  search: string;
  loading?: boolean;
  /** A bulk action (e.g. delete-selected) is in flight — shows the table overlay. */
  actionLoading?: boolean;
  /** ID of the job whose activate/pause request is currently in flight. */
  pendingStatusId?: string | null;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: EvalJob): void;
  (e: "view", row: EvalJob): void;
  (e: "delete", row: EvalJob): void;
  (e: "activate", row: EvalJob): void;
  (e: "pause", row: EvalJob): void;
  (e: "delete-bulk", ids: string[]): void;
  (e: "refresh"): void;
}>();

function canActivate(status: EvalJobStatus): boolean {
  return status === "draft" || status === "paused" || status === "degraded";
}

function canPause(status: EvalJobStatus): boolean {
  return status === "active" || status === "degraded";
}

const { t } = useI18n();
const statusFilter = ref<EvalJobStatus | null>(null);
const selectedIds = ref<string[]>([]);

function handleBulkDelete() {
  const ids = [...selectedIds.value];
  if (ids.length === 0) return;
  emit("delete-bulk", ids);
}

// After the list reloads (e.g. following a bulk delete), drop any selected ids
// whose rows no longer exist so the bulk-action button count stays accurate.
// Pruning (rather than clearing on emit) keeps the selection intact if the user
// cancels the confirm dialog.
watch(
  () => props.rows,
  (rows) => {
    const valid = new Set(rows.map((r) => r.id));
    const pruned = selectedIds.value.filter((id) => valid.has(id));
    if (pruned.length !== selectedIds.value.length) selectedIds.value = pruned;
  },
);

const statusOptions = computed(() => [
  { label: t("onlineEvals.job.allStatuses"), value: null },
  { label: t("onlineEvals.jobStatus.draft"), value: "draft" },
  { label: t("onlineEvals.jobStatus.active"), value: "active" },
  { label: t("onlineEvals.jobStatus.paused"), value: "paused" },
  { label: t("onlineEvals.jobStatus.degraded"), value: "degraded" },
  { label: t("onlineEvals.jobStatus.archived"), value: "archived" },
]);

const columns = computed(() =>
  [
    {
      id: "#",
      header: "#",
      accessorKey: "#",
      sortable: false,
      size: 56,
      meta: { align: "left" },
    },
    {
      id: "name",
      header: t("onlineEvals.job.columns.name"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      // `flex` (not `autoWidth`): fills leftover width on load AND stays
      // resizable — matches Dashboards/AlertList; `autoWidth` has no resize grip.
      meta: { align: "left", flex: true },
    },
    {
      id: "status",
      header: t("onlineEvals.job.columns.status"),
      accessorFn: (row: EvalJob) => statusOf(row),
      sortable: true,
      size: COL.status,
      meta: { align: "left" },
    },
    {
      id: "stream",
      header: t("onlineEvals.job.columns.stream"),
      accessorKey: "stream",
      sortable: true,
      size: COL.streamName,
      meta: { align: "left" },
    },
    {
      id: "targetScope",
      header: t("onlineEvals.job.columns.targetScope"),
      accessorFn: (row: EvalJob) => targetScopeOf(row),
      sortable: true,
      size: 120,
      meta: { align: "left" },
    },
    {
      id: "scorers",
      header: t("onlineEvals.job.columns.scorers"),
      accessorFn: (row: EvalJob) => (row.scorers || []).length,
      sortable: true,
      size: COL.count,
      meta: { align: "right" },
    },
    {
      id: "created",
      header: t("onlineEvals.job.columns.created"),
      accessorFn: (row: EvalJob) => rowCreated(row),
      sortable: true,
      size: COL.createdAt,
      meta: { align: "left" },
    },
    {
      id: "actions",
      header: t("onlineEvals.job.columns.actions"),
      sortable: false,
      isAction: true,
      size: 100,
      meta: { align: "center", cellClass: "actions-column", actionCount: 2 },
    },
  ].map((c: any) => ({
    ...c,
    // Every column except the row index, the name (row identity) and the
    // actions column is offered in OTable's "Manage columns" chooser.
    hideable: c.id !== "#" && c.id !== "name" && !c.isAction,
  })),
);

const filteredRows = computed(() =>
  statusFilter.value
    ? props.rows.filter((row) => statusOf(row) === statusFilter.value)
    : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

// Whether the user has narrowed the list with the search box or the status
// dropdown. Drives OEmptyState's `:filtered` so the body switches between
// the first-run preset ("Create your first eval job") and the auto
// "No evaluation jobs match these filters" + Clear-filters card.
const hasFilters = computed(() => !!props.search?.trim() || !!statusFilter.value);

// Wire OEmptyState's action ids back into the existing emit contract.
// `create` mirrors a click on the OPageHeader's "New job" button;
// `clear-filters` resets the search + status filter inline.
function onEmptyAction(id?: string) {
  if (id === "create") emit("create");
  else if (id === "clear-filters") {
    emit("update:search", "");
    statusFilter.value = null;
  }
}

function statusLabel(status: EvalJobStatus) {
  return t(`onlineEvals.jobStatus.${status}`);
}

function scorerCountText(row: EvalJob) {
  const count = (row.scorers || []).length;
  if (count === 1) return t("onlineEvals.job.scorerCount", { count });
  return t("onlineEvals.job.scorersCount", { count });
}

function targetScopeLabel(row: EvalJob) {
  return t(`onlineEvals.job.targetScopes.${targetScopeOf(row)}`);
}

function rowCreated(row: EvalJob) {
  return Number(
    valueOf(row, "createdAt", "created_at") || valueOf(row, "updatedAt", "updated_at") || 0,
  );
}

function formatDateShort(value: number) {
  if (!value) return "—";
  return formatDate(value, "YYYY-MM-DD HH:mm:ss");
}

useShortcuts([
  {
    id: "evalJobsRefresh",
    handler: () => {
      if (!isInputFocused()) emit("refresh");
    },
  },
]);
</script>
