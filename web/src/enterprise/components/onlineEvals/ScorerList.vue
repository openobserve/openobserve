<template>
  <EvalListShell
    data-test="scorer"
    :show-empty="showEmptyState"
  >
    <template #empty>
      <EvalEmptyState
        v-if="showNoProvidersState"
        data-test="scorer-no-providers-state"
        icon="hub"
        :title="t('onlineEvals.scorer.noProviders.title')"
        :description="t('onlineEvals.scorer.noProviders.description')"
        :chips="[
          { icon: 'smart-toy', label: t('onlineEvals.scorer.noProviders.chipRequired') },
        ]"
        :cta-label="t('onlineEvals.scorer.noProviders.cta')"
        cta-data-test="scorer-empty-add-provider-btn"
        @create="$emit('add-provider')"
      />
      <EvalEmptyState
        v-else
        data-test="scorer-empty-state"
        icon="rule"
        :title="t('onlineEvals.scorer.empty.title')"
        :description="t('onlineEvals.scorer.empty.description')"
        :chips="[
          { icon: 'smart-toy', label: t('onlineEvals.scorer.empty.chipLlmJudge') },
          { icon: 'cloud', label: t('onlineEvals.scorer.empty.chipRemote') },
        ]"
        :cta-label="t('onlineEvals.scorer.newButton')"
        cta-data-test="scorer-empty-create-btn"
        @create="$emit('create')"
      >
        <template #secondary>
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                variant="outline"
                size="md"
                data-test="scorer-empty-import"
                icon-right="expand-more"
              >
                {{ t("onlineEvals.scorer.import.button") }}
              </OButton>
            </template>
            <ODropdownItem
              @select="$emit('import-custom')"
              data-test="scorer-empty-import-custom"
            >
              <div class="tw:flex tw:flex-col">
                <span>{{ t("onlineEvals.scorer.import.customLabel") }}</span>
                <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60">
                  {{ t("onlineEvals.scorer.import.customSubtitle") }}
                </span>
              </div>
            </ODropdownItem>
            <ODropdownItem
              @select="$emit('open-library')"
              data-test="scorer-empty-import-library"
            >
              <div class="tw:flex tw:flex-col">
                <span>{{ t("onlineEvals.scorer.import.libraryLabel") }}</span>
                <span class="tw:text-xs tw:text-dropdown-item-text tw:opacity-60">
                  {{ t("onlineEvals.scorer.import.librarySubtitle") }}
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
        data-test="scorer-list-table"
        :data="numberedRows"
        :columns="columns"
        row-key="id"
        :loading="loading"
        :footer-title="t('onlineEvals.scorer.listTitle')"
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
            :placeholder="t('onlineEvals.scorer.searchPlaceholder')"
            data-test="scorer-list-search-input"
            clearable
            @update:model-value="$emit('update:search', $event as string)"
          />
          <OSelect
            v-model="typeFilter"
            :options="typeOptions"
            :placeholder="t('onlineEvals.scorer.allTypes')"
            size="md"
            width="sm"
            class="tw:shrink-0"
            data-test="scorer-list-type-filter"
          />
        </template>

        <template #bottom="{ totalRows }">
          <span class="o2-table-footer-title tw:text-primary">
            {{ totalRows.toLocaleString() }} {{ t("onlineEvals.scorer.listTitle") }}
          </span>
          <OButton
            v-if="selectedIds.length > 0"
            variant="outline"
            size="sm"
            class="tw:ml-3"
            icon-left="download"
            data-test="scorer-bulk-export-btn"
            @click="handleBulkExport"
          >
            {{ t("onlineEvals.scorer.export.bulkButton") }} ({{ selectedIds.length }})
          </OButton>
        </template>

        <template #cell-type="{ row }">
          <span class="sr-type-chip" :class="`sr-type-chip--${scorerTypeOf(row)}`">
            {{ scorerTypeLabel(scorerTypeOf(row)) }}
          </span>
        </template>

        <template #cell-produces="{ row }">
          <span class="sr-mono-cell">{{ producesLabel(row) || "—" }}</span>
        </template>

        <template #cell-version="{ row }">
          <span class="sr-mono-cell">v{{ row.version }}</span>
        </template>

        <template #cell-usedBy="{ row }">
          <span class="sr-mono-cell">{{ usedByText(row) }}</span>
        </template>

        <template #cell-lastRun>
          <span class="sr-muted-cell">—</span>
        </template>

        <template #cell-actions="{ row }">
          <div class="tw:flex tw:items-center actions-container">
            <OButton
              :data-test="`scorer-list-${row.name}-edit-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.edit')"
              icon-left="edit"
              @click.stop="$emit('edit', row)"
            />
            <OButton
              :data-test="`scorer-list-${row.name}-export-btn`"
              variant="ghost"
              size="icon-sm"
              :title="t('onlineEvals.actions.export')"
              icon-left="download"
              @click.stop="$emit('export', row)"
            />
            <OButton
              :data-test="`scorer-list-${row.name}-delete-btn`"
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
import type {
  EvalJob,
  Provider,
  ScoreConfig,
  Scorer,
  ScorerType,
} from "@/services/online-evals.service";
import { entityId, scorerTypeOf, valueOf } from "./utils/evalEntity";
import EvalEmptyState from "@/components/EvalEmptyState.vue";
import EvalListShell from "./EvalListShell.vue";
import { useNumberedRows } from "./composables/useNumberedRows";

const props = defineProps<{
  rows: Scorer[];
  allScorers: Scorer[];
  jobs: EvalJob[];
  scoreConfigs: ScoreConfig[];
  providers: Provider[];
  search: string;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: Scorer): void;
  (e: "view", row: Scorer): void;
  (e: "delete", row: Scorer): void;
  (e: "imported"): void;
  (e: "import-custom"): void;
  (e: "open-library"): void;
  (e: "export", row: Scorer): void;
  (e: "export-bulk", ids: string[]): void;
  (e: "add-provider"): void;
}>();

const { t } = useI18n();
const typeFilter = ref<ScorerType | null>(null);
const selectedIds = ref<string[]>([]);

function handleBulkExport() {
  const ids = [...selectedIds.value];
  selectedIds.value = [];
  emit("export-bulk", ids);
}

const typeOptions = computed(() => [
  { label: t("onlineEvals.scorer.allTypes"), value: null },
  { label: t("onlineEvals.scorer.badgeLlm"), value: "llm_judge" },
  { label: t("onlineEvals.scorer.badgeRemote"), value: "remote" },
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
    header: t("onlineEvals.scorer.columns.name"),
    accessorKey: "name",
    sortable: true,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "type",
    header: t("onlineEvals.scorer.columns.type"),
    accessorFn: (row: Scorer) => scorerTypeOf(row),
    sortable: true,
    size: 160,
    meta: { align: "left" },
  },
  {
    id: "produces",
    header: t("onlineEvals.scorer.columns.produces"),
    accessorFn: (row: Scorer) => producesLabel(row),
    sortable: true,
    size: 180,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("onlineEvals.scorer.columns.version"),
    accessorKey: "version",
    sortable: true,
    size: 100,
    meta: { align: "left" },
  },
  {
    id: "usedBy",
    header: t("onlineEvals.scorer.columns.usedBy"),
    accessorFn: (row: Scorer) => usedByCount(row),
    sortable: true,
    size: 130,
    meta: { align: "left" },
  },
  {
    id: "lastRun",
    header: t("onlineEvals.scorer.columns.lastRun"),
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("onlineEvals.scorer.columns.actions"),
    sortable: false,
    isAction: true,
    size: 140,
    meta: { align: "center", cellClass: "actions-column", actionCount: 3 },
  },
]);

const filteredRows = computed(() =>
  typeFilter.value
    ? props.rows.filter((row) => scorerTypeOf(row) === typeFilter.value)
    : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

const showEmptyState = computed(
  () =>
    !props.loading &&
    props.allScorers.length === 0 &&
    !props.search &&
    !typeFilter.value,
);

// When the org has no providers AND no scorers yet, surface a dedicated
// provider-onboarding screen instead of the standard empty state. LLM Judge
// scorers (the most common type) can't be created without a provider, so
// nudging the user there first avoids a dead-end.
const showNoProvidersState = computed(
  () => showEmptyState.value && props.providers.length === 0,
);

function scorerTypeLabel(type: ScorerType) {
  if (type === "remote") return t("onlineEvals.scorer.badgeRemote");
  return t("onlineEvals.scorer.badgeLlm");
}

function producesLabel(row: Scorer) {
  const id = String(
    valueOf(row, "producesScoreConfigId", "produces_score_config_id") || "",
  );
  if (!id) return "";
  const cfg = props.scoreConfigs.find((c) => entityId(c) === id);
  return cfg?.name || id;
}

function usedByCount(row: Scorer) {
  const scorerId = entityId(row);
  return props.jobs.filter((job) =>
    (job.scorers || []).some((ref) =>
      typeof ref === "string" ? ref === scorerId : ref.id === scorerId,
    ),
  ).length;
}

function usedByText(row: Scorer) {
  const count = usedByCount(row);
  if (count === 1) return t("onlineEvals.scorer.usedByJob", { count });
  return t("onlineEvals.scorer.usedByJobs", { count });
}
</script>

<style lang="scss">
.sr-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 11px/1.5 inherit;
}

.sr-type-chip--llm_judge {
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  color: var(--o2-status-info-text);
}
.sr-type-chip--remote {
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
}
.sr-type-chip--code {
  background: color-mix(in srgb, var(--o2-status-warning-text) 14%, transparent);
  color: var(--o2-status-warning-text);
}

.sr-mono-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.sr-muted-cell {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}
</style>
