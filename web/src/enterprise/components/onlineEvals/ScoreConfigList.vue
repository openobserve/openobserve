<template>
  <EvalListShell
    data-test="score-config"
    :show-empty="showEmptyState"
  >
    <template #empty>
      <EvalEmptyState
        data-test="score-config-empty-state"
        icon="fact-check"
        :title="t('onlineEvals.scoreConfig.empty.title')"
        :description="t('onlineEvals.scoreConfig.empty.description')"
        :chips="[
          { icon: 'data-array', label: t('onlineEvals.scoreConfig.empty.chipTypes') },
          { icon: 'favorite', label: t('onlineEvals.scoreConfig.empty.chipThreshold') },
        ]"
        :cta-label="t('onlineEvals.scoreConfig.newButton')"
        cta-data-test="score-config-empty-create-btn"
        @create="$emit('create')"
      >
        <template #secondary>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="md"
                data-test="score-config-empty-import"
                icon-right="expand-more"
              >
                {{ t("onlineEvals.scoreConfig.import.button") }}
              </OButton>
            </template>
            <ODropdownItem
              @select="$emit('import-custom')"
              data-test="score-config-empty-import-custom"
            >
              <div class="tw:flex tw:flex-col">
                <span>{{ t("onlineEvals.scoreConfig.import.customLabel") }}</span>
                <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60">
                  {{ t("onlineEvals.scoreConfig.import.customSubtitle") }}
                </span>
              </div>
            </ODropdownItem>
            <ODropdownItem
              @select="$emit('open-library')"
              data-test="score-config-empty-import-library"
            >
              <div class="tw:flex tw:flex-col">
                <span>{{ t("onlineEvals.scoreConfig.import.libraryLabel") }}</span>
                <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60">
                  {{ t("onlineEvals.scoreConfig.import.librarySubtitle") }}
                </span>
              </div>
            </ODropdownItem>
          </ODropdown>
        </template>
      </EvalEmptyState>
    </template>

    <template #table>
      <OTable
        v-model:selected-ids="selectedIds"
        selection="multiple"
        data-test="score-config-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :footer-title="t('onlineEvals.scoreConfig.listTitle')"
        :global-filter="search"
        :show-global-filter="false"
        :page-size="20"
        :page-size-options="[20, 50, 100, 250, 500]"
        width="100%"
        class="tw:w-full tw:h-full"
        @row-click="(row: any) => $emit('view', row)"
      >
        <template #toolbar>
          <OSearchInput
            :model-value="search"
            class="tw:flex-1 tw:min-w-0"
            :placeholder="t('onlineEvals.scoreConfig.searchPlaceholder')"
            data-test="score-config-list-search-input"
            clearable
            @update:model-value="$emit('update:search', $event as string)"
          />
          <OSelect
            v-model="typeFilter"
            :options="typeOptions"
            :placeholder="t('onlineEvals.scoreConfig.allTypes')"
            size="md"
            width="sm"
            class="tw:shrink-0"
            data-test="score-config-list-type-filter"
          />
        </template>

        <template #cell-type="{ row }">
          <span class="sc-dtype-chip" :class="`sc-dtype-chip--${dataTypeOf(row)}`">
            {{ dataTypeOf(row) }}
          </span>
        </template>

        <template #cell-rangeValues="{ row }">
          <span class="sc-mono-cell">{{ rangeOrValues(row) }}</span>
        </template>

        <template #cell-healthy="{ row }">
          <span class="sc-mono-cell tw:font-semibold">{{ healthyDisplay(row) }}</span>
        </template>

        <template #cell-version="{ row }">
          <span class="sc-version-cell">
            <span class="sc-version-cell__dot" />v{{ row.version }}
            <span class="sc-version-cell__muted">({{ t("onlineEvals.scoreConfig.active") }})</span>
          </span>
        </template>

        <template #cell-usedBy="{ row }">
          <span class="sc-mono-cell">{{ usedByText(row) }}</span>
        </template>

        <template #cell-created="{ row }">
          {{ formatDateShort(rowCreated(row)) }}
        </template>

        <template #bottom="{ totalRows }">
          <span class="o2-table-footer-title tw:text-primary">
            {{ totalRows.toLocaleString() }} {{ t("onlineEvals.scoreConfig.listTitle") }}
          </span>
          <OButton
            v-if="selectedIds.length > 0"
            variant="outline"
            size="sm"
            class="tw:ml-3"
            icon-left="download"
            data-test="score-config-bulk-export-btn"
            @click="handleBulkExport"
          >
            {{ t("onlineEvals.scoreConfig.export.bulkButton") }} ({{ selectedIds.length }})
          </OButton>
        </template>

        <template #cell-actions="{ row }">
          <div class="tw:flex tw:items-center actions-container">
            <OButton
              :data-test="`score-config-list-${row.name}-edit-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.edit')"
              icon-left="edit"
              @click.stop="$emit('edit', row)"
            />
            <OButton
              :data-test="`score-config-list-${row.name}-export-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.export')"
              icon-left="download"
              @click.stop="$emit('export', row)"
            />
            <OButton
              :data-test="`score-config-list-${row.name}-delete-btn`"
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
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "./utils/evalEntity";
import { formatDate } from "@/utils/date";
import EvalEmptyState from "@/components/EvalEmptyState.vue";
import EvalListShell from "./EvalListShell.vue";
import { useNumberedRows } from "./composables/useNumberedRows";

type DataType = "numeric" | "categorical" | "boolean";

const props = defineProps<{
  rows: ScoreConfig[];
  allScoreConfigs: ScoreConfig[];
  scorers: Scorer[];
  search: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: ScoreConfig): void;
  (e: "view", row: ScoreConfig): void;
  (e: "delete", row: ScoreConfig): void;
  (e: "imported"): void;
  (e: "import-custom"): void;
  (e: "open-library"): void;
  (e: "export", row: ScoreConfig): void;
  (e: "export-bulk", ids: string[]): void;
}>();

const { t } = useI18n();
const typeFilter = ref<DataType | null>(null);
const selectedIds = ref<string[]>([]);

function handleBulkExport() {
  // Snapshot the ids before clearing so the parent receives a stable array
  // and the table immediately reflects deselection.
  const ids = [...selectedIds.value];
  selectedIds.value = [];
  emit("export-bulk", ids);
}

const typeOptions = computed(() => [
  { label: t("onlineEvals.scoreConfig.allTypes"), value: null },
  { label: t("onlineEvals.scoreConfig.dataTypes.numeric"), value: "numeric" },
  { label: t("onlineEvals.scoreConfig.dataTypes.categorical"), value: "categorical" },
  { label: t("onlineEvals.scoreConfig.dataTypes.boolean"), value: "boolean" },
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
    header: t("onlineEvals.scoreConfig.columns.name"),
    accessorKey: "name",
    sortable: true,
    size: "auto",
    meta: { align: "left" },
  },
  {
    id: "type",
    header: t("onlineEvals.scoreConfig.columns.type"),
    accessorFn: (row: ScoreConfig) => dataTypeOf(row),
    sortable: true,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "rangeValues",
    header: t("onlineEvals.scoreConfig.columns.rangeValues"),
    accessorFn: (row: ScoreConfig) => rangeOrValues(row),
    sortable: false,
    meta: { align: "left" },
  },
  {
    id: "healthy",
    header: t("onlineEvals.scoreConfig.columns.healthy"),
    accessorFn: (row: ScoreConfig) => healthyDisplay(row),
    sortable: false,
    size: 150,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("onlineEvals.scoreConfig.columns.activeVersion"),
    accessorKey: "version",
    sortable: true,
    size: 140,
    meta: { align: "left" },
  },
  {
    id: "usedBy",
    header: t("onlineEvals.scoreConfig.columns.usedBy"),
    accessorFn: (row: ScoreConfig) => usedByCount(row),
    sortable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "created",
    header: t("onlineEvals.scoreConfig.columns.created"),
    accessorFn: (row: ScoreConfig) => rowCreated(row),
    sortable: true,
    size: 180,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("onlineEvals.scoreConfig.columns.actions"),
    sortable: false,
    isAction: true,
    size: 140,
    meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
  },
]);

const filteredRows = computed(() =>
  typeFilter.value
    ? props.rows.filter((row) => dataTypeOf(row) === typeFilter.value)
    : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

const showEmptyState = computed(
  () =>
    !props.loading &&
    props.allScoreConfigs.length === 0 &&
    !props.search &&
    !typeFilter.value,
);

function rowCreated(row: ScoreConfig) {
  return Number(
    valueOf(row, "createdAt", "created_at") || valueOf(row, "updatedAt", "updated_at") || 0,
  );
}

function rangeOrValues(row: ScoreConfig) {
  const type = dataTypeOf(row);
  if (type === "numeric") {
    const range = valueOf(row, "numericRange", "numeric_range");
    if (!range || range.min === undefined || range.max === undefined) return "—";
    return `${range.min} – ${range.max}`;
  }
  if (type === "categorical") {
    const cats = row.categories;
    if (!Array.isArray(cats) || cats.length === 0) return "—";
    return cats.join(" · ");
  }
  return t("onlineEvals.scoreConfig.booleanValues");
}

function healthyDisplay(row: ScoreConfig) {
  const ht = valueOf(row, "healthyThreshold", "healthy_threshold");
  if (!ht) return "—";
  const type = dataTypeOf(row);
  if (type === "numeric") {
    if (ht.value === undefined || !ht.direction) return "—";
    const symbol = ht.direction === "gte" ? "≥" : "≤";
    return `${symbol} ${ht.value}`;
  }
  if (type === "categorical") {
    const list = ht.healthy_categories || ht.healthyCategories;
    if (!Array.isArray(list) || list.length === 0) return "—";
    return list.join(", ");
  }
  const val = ht.healthy_value ?? ht.healthyValue;
  if (val === undefined || val === null) return "—";
  return String(val);
}

function usedByCount(row: ScoreConfig) {
  const id = entityId(row);
  return props.scorers.filter(
    (scorer) =>
      String(valueOf(scorer, "producesScoreConfigId", "produces_score_config_id") || "") === id,
  ).length;
}

function usedByText(row: ScoreConfig) {
  const count = usedByCount(row);
  if (count === 1) return t("onlineEvals.scoreConfig.usedByScorer", { count });
  return t("onlineEvals.scoreConfig.usedByScorers", { count });
}

function formatDateShort(value: number) {
  if (!value) return "—";
  return formatDate(value, "YYYY-MM-DD HH:mm:ss");
}
</script>

<style lang="scss">
.sc-dtype-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 11px/1.5 inherit;
}

.sc-dtype-chip--numeric {
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  color: var(--o2-status-info-text);
}
.sc-dtype-chip--categorical {
  background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent);
  color: var(--o2-status-warning-text);
}
.sc-dtype-chip--boolean {
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
}

.sc-mono-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.sc-version-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.sc-version-cell__dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--o2-status-success-text);
  display: inline-block;
}

.sc-version-cell__muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 400;
}
</style>
