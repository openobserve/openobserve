<template>
  <div
    data-test="eval-job-list-page"
    class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:h-full tw:min-h-0"
  >
    <div v-if="showEmptyState" class="tw:flex-1 tw:min-h-0">
      <div class="card-container tw:h-full tw:flex tw:items-center tw:justify-center">
        <EvalJobEmptyState @create="$emit('create')" />
      </div>
    </div>

    <template v-else>
      <div class="tw:shrink-0">
        <div class="card-container tw:mb-[0.625rem]">
          <div class="tw:flex tw:justify-between tw:items-center tw:py-3 tw:px-4 tw:h-[68px]">
            <div
              class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]"
              data-test="eval-job-list-title"
            >
              {{ t("onlineEvals.job.listTitle") }}
            </div>

            <div class="tw:flex tw:ml-auto tw:ps-2 tw:items-center">
              <OInput
                v-model="searchModel"
                class="tw:ml-2 tw:w-[200px]"
                :placeholder="t('onlineEvals.job.searchPlaceholder')"
                data-test="eval-job-list-search-input"
              >
                <template #icon-left>
                  <OIcon name="search" size="sm" />
                </template>
              </OInput>

              <OSelect
                v-model="statusFilter"
                :options="statusOptions"
                :placeholder="t('onlineEvals.job.allStatuses')"
                size="md"
                class="tw:ml-2 tw:w-[150px]"
                data-test="eval-job-list-status-filter"
              />

              <OButton
                data-test="eval-job-list-add-btn"
                class="tw:ml-2"
                variant="primary"
                size="sm"
                  @click="$emit('create')"
              >
                {{ t("onlineEvals.job.newButton") }}
              </OButton>
            </div>
          </div>
        </div>
      </div>

      <div class="tw:flex-1 tw:min-h-0">
        <div class="card-container tw:h-full">
          <OTable
            data-test="eval-job-list-table"
            :data="filteredRows"
            :columns="columns"
            row-key="id"
            :loading="loading"
            :footer-title="t('onlineEvals.job.listTitle')"
            :global-filter="searchModel"
            :show-global-filter="false"
            :page-size="20"
            :page-size-options="[20, 50, 100, 250, 500]"
            width="100%"
            class="tw:w-full tw:h-full"
            @row-click="(row: any) => $emit('edit', row)"
          >
            <template #cell-status="{ row }">
              <span class="ej-status-chip" :class="`ej-status-chip--${statusOf(row)}`">
                <span class="ej-status-chip__dot" />
                {{ statusLabel(statusOf(row)) }}
              </span>
            </template>

            <template #cell-stream="{ row }">
              <span class="ej-mono-cell">{{ row.stream }}</span>
            </template>

            <template #cell-scorers="{ row }">
              <span class="ej-mono-cell">{{ scorerCountText(row) }}</span>
            </template>

            <template #cell-successRate>
              <span class="ej-muted-cell">—</span>
            </template>

            <template #cell-lastRun>
              <span class="ej-muted-cell">—</span>
            </template>

            <template #cell-created="{ row }">
              {{ formatDateShort(rowCreated(row)) }}
            </template>

            <template #cell-actions="{ row }">
              <div class="tw:flex tw:items-center actions-container">
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
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type {
  EvalJob,
  EvalJobStatus,
} from "@/services/online-evals.service";
import { statusOf, valueOf } from "./utils/evalEntity";
import EvalJobEmptyState from "./EvalJobEmptyState.vue";

const props = defineProps<{
  rows: EvalJob[];
  search: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: EvalJob): void;
  (e: "delete", row: EvalJob): void;
}>();

const { t } = useI18n();
const statusFilter = ref<EvalJobStatus | null>(null);

const searchModel = computed({
  get: () => props.search,
  set: (v: string) => emit("update:search", v),
});

const statusOptions = computed(() => [
  { label: t("onlineEvals.job.allStatuses"), value: null },
  { label: t("onlineEvals.jobStatus.draft"), value: "draft" },
  { label: t("onlineEvals.jobStatus.active"), value: "active" },
  { label: t("onlineEvals.jobStatus.paused"), value: "paused" },
  { label: t("onlineEvals.jobStatus.degraded"), value: "degraded" },
  { label: t("onlineEvals.jobStatus.archived"), value: "archived" },
]);

const columns = computed(() => [
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
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("onlineEvals.job.columns.status"),
    accessorFn: (row: EvalJob) => statusOf(row),
    sortable: true,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "stream",
    header: t("onlineEvals.job.columns.stream"),
    accessorKey: "stream",
    sortable: true,
    size: 180,
    meta: { align: "left" },
  },
  {
    id: "scorers",
    header: t("onlineEvals.job.columns.scorers"),
    accessorFn: (row: EvalJob) => (row.scorers || []).length,
    sortable: true,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "successRate",
    header: t("onlineEvals.job.columns.successRate"),
    sortable: false,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "lastRun",
    header: t("onlineEvals.job.columns.lastRun"),
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "created",
    header: t("onlineEvals.job.columns.created"),
    accessorFn: (row: EvalJob) => rowCreated(row),
    sortable: true,
    size: 130,
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
]);

const filteredRows = computed(() => {
  const rows = statusFilter.value
    ? props.rows.filter((row) => statusOf(row) === statusFilter.value)
    : props.rows;
  return rows.map((row, index) => ({
    ...row,
    "#": index + 1 <= 9 ? `0${index + 1}` : String(index + 1),
  }));
});

const showEmptyState = computed(
  () =>
    !props.loading &&
    props.rows.length === 0 &&
    !searchModel.value &&
    !statusFilter.value,
);

function statusLabel(status: EvalJobStatus) {
  return t(`onlineEvals.jobStatus.${status}`);
}

function scorerCountText(row: EvalJob) {
  const count = (row.scorers || []).length;
  if (count === 1) return t("onlineEvals.job.scorerCount", { count });
  return t("onlineEvals.job.scorersCount", { count });
}

function rowCreated(row: EvalJob) {
  return Number(
    valueOf(row, "createdAt", "created_at") || valueOf(row, "updatedAt", "updated_at") || 0,
  );
}

function formatDateShort(value: number) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}
</script>

<style lang="scss">
.ej-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: 999px;
  font: 600 11px/1.5 inherit;
  text-transform: capitalize;
}

.ej-status-chip__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}

.ej-status-chip--active {
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
}

.ej-status-chip--draft {
  background: color-mix(in srgb, var(--color-text-secondary) 14%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.ej-status-chip--paused {
  background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent);
  color: var(--o2-status-warning-text);
}

.ej-status-chip--degraded {
  background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent);
  color: var(--o2-status-warning-text);
}

.ej-status-chip--archived {
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  opacity: 0.7;
}

.ej-mono-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.ej-muted-cell {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}
</style>
