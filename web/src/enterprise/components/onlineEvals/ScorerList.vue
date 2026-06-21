<template>
  <EvalListShell
    data-test="scorer"
    :show-empty="showNoProvidersState"
  >
    <!-- Special-case empty: the org has no LLM providers yet. LLM Judge
         scorers (the most common type) can't be created without one, so we
         surface a dedicated provider-onboarding card outside the OTable
         flow. Reuses the shared `no-llm-providers` preset (same illustration
         + "Add provider" action) but overrides the copy with scorer-specific
         context, so it matches the empty-state language used elsewhere in
         the app instead of the bespoke EvalEmptyState card. -->
    <template #empty>
      <OEmptyState
        size="hero"
        preset="no-llm-providers"
        :title="t('onlineEvals.scorer.noProviders.title')"
        :description="t('onlineEvals.scorer.noProviders.description')"
        data-test="scorer-no-providers-state"
        @action="(id) => id === 'create' && $emit('add-provider')"
      />
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
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="scorer-list"
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

        <template #empty>
          <div class="tw:flex tw:items-center tw:justify-center tw:py-8">
            <OEmptyState
              size="hero"
              preset="no-scorers"
              :filtered="hasFilters"
              data-test="scorer-empty-state"
              @action="onEmptyAction"
            />
          </div>
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
          <OBadge :variant="scorerTypeBadgeVariant(scorerTypeOf(row))" size="sm">
            {{ scorerTypeLabel(scorerTypeOf(row)) }}
          </OBadge>
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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import type {
  EvalJob,
  Provider,
  ScoreConfig,
  Scorer,
  ScorerType,
} from "@/services/online-evals.service";
import { entityId, scorerTypeOf, valueOf } from "./utils/evalEntity";
import EvalListShell from "./EvalListShell.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
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
    size: COL.name,
    // `flex` (not `autoWidth`): fills leftover width on load AND stays
    // resizable — matches Dashboards/AlertList; `autoWidth` has no resize grip.
    meta: { align: "left", flex: true },
  },
  {
    id: "type",
    header: t("onlineEvals.scorer.columns.type"),
    accessorFn: (row: Scorer) => scorerTypeOf(row),
    sortable: true,
    size: COL.type,
    meta: { align: "left" },
  },
  {
    id: "produces",
    header: t("onlineEvals.scorer.columns.produces"),
    accessorFn: (row: Scorer) => producesLabel(row),
    sortable: true,
    size: COL.template,
    meta: { align: "left" },
  },
  {
    id: "version",
    header: t("onlineEvals.scorer.columns.version"),
    accessorKey: "version",
    sortable: true,
    size: COL.version,
    meta: { align: "left" },
  },
  {
    id: "usedBy",
    header: t("onlineEvals.scorer.columns.usedBy"),
    accessorFn: (row: Scorer) => usedByCount(row),
    sortable: true,
    size: COL.count,
    meta: { align: "left" },
  },
  {
    id: "lastRun",
    header: t("onlineEvals.scorer.columns.lastRun"),
    sortable: false,
    size: COL.date,
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
].map((c: any) => ({
  ...c,
  // Every column except the row index, the name (row identity) and the
  // actions column is offered in OTable's "Manage columns" chooser.
  hideable: c.id !== "#" && c.id !== "name" && !c.isAction,
})));

const filteredRows = computed(() =>
  typeFilter.value
    ? props.rows.filter((row) => scorerTypeOf(row) === typeFilter.value)
    : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

// When the org has no providers AND no scorers yet, surface a dedicated
// provider-onboarding screen instead of the standard empty state. LLM Judge
// scorers (the most common type) can't be created without a provider, so
// nudging the user there first avoids a dead-end. This case routes through
// EvalListShell's #empty slot (full card) so the OTable doesn't render.
const showNoProvidersState = computed(
  () =>
    !props.loading &&
    props.allScorers.length === 0 &&
    !props.search &&
    !typeFilter.value &&
    props.providers.length === 0,
);

// For everything else the OTable always renders (so the search + type
// filter widgets stay visible). OEmptyState lives inside the table's
// #empty slot and switches between the first-run and "Clear filters"
// variants via `:filtered`.
const hasFilters = computed(
  () => !!props.search?.trim() || !!typeFilter.value,
);

function onEmptyAction(id?: string) {
  if (id === "create") emit("create");
  else if (id === "clear-filters") {
    emit("update:search", "");
    typeFilter.value = null;
  }
}

function scorerTypeLabel(type: ScorerType) {
  if (type === "remote") return t("onlineEvals.scorer.badgeRemote");
  return t("onlineEvals.scorer.badgeLlm");
}

// Map a scorer type to a neutral design-system OBadge soft variant
// (llm_judge → blue, remote → teal, code → purple). Types are just labels,
// so use neutral palette colors rather than semantic success/warning variants.
function scorerTypeBadgeVariant(type: ScorerType | string) {
  if (type === "remote") return "teal-soft" as const;
  if (type === "code") return "purple-soft" as const;
  return "blue-soft" as const; // llm_judge
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
.sr-mono-cell {
  font-size: 12px;
}

.sr-muted-cell {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
}
</style>
