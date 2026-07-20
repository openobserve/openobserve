<template>
  <EvalListShell
    data-test="scorer"
    :show-empty="false"
  >
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
        class="w-full h-full"
        @row-click="(row: any) => $emit('view', row)"
      >
        <template #toolbar>
          <OSearchInput
            :model-value="search"
            class="flex-1 min-w-0"
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
            class="shrink-0"
            data-test="scorer-list-type-filter"
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="scorer-list-refresh-btn"
            @click="emit('refresh')"
          >
            <OTooltip side="bottom" :content="t('common.refresh')" shortcut-id="scorersRefresh" />
          </OButton>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <!-- Special-case empty: the org has no LLM providers yet. LLM Judge
                 scorers (the most common type) can't be created without one, so
                 we surface a dedicated provider-onboarding card. Rendered inside
                 the table's #empty slot (not EvalListShell's) so the search bar
                 and column header stay visible — consistent with the no-scorers
                 state and the Eval Jobs / Score Configs list pages. Reuses the
                 shared `no-llm-providers` preset with scorer-specific copy. -->
            <OEmptyState
              v-if="showNoProvidersState"
              size="hero"
              preset="no-llm-providers"
              :title="t('onlineEvals.scorer.noProviders.title')"
              :description="t('onlineEvals.scorer.noProviders.description')"
              data-test="scorer-no-providers-state"
              @action="(id) => id === 'create' && $emit('add-provider')"
            />
            <OEmptyState
              v-else
              size="hero"
              preset="no-scorers"
              :filtered="hasFilters"
              :actions="[
                { id: 'create', icon: 'add', titleKey: 'emptyState.noScorers.action', descriptionKey: 'emptyState.noScorers.actionDesc' },
                { id: 'import', icon: 'upload-file', titleKey: 'emptyState.noScorers.import', descriptionKey: 'emptyState.noScorers.importDesc' },
              ]"
              data-test="scorer-empty-state"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #bottom="{ totalRows }">
          <span class="o2-table-footer-title">
            {{ totalRows.toLocaleString() }} {{ t("onlineEvals.scorer.listTitle") }}
          </span>
          <OButton
            v-if="selectedIds.length > 0"
            variant="outline"
            size="sm"
            class="ml-3"
            icon-left="download"
            data-test="scorer-bulk-export-btn"
            @click="handleBulkExport"
          >
            {{ t("onlineEvals.scorer.export.bulkButton") }} ({{ selectedIds.length }})
          </OButton>
        </template>

        <template #cell-type="{ row }">
          <OTag
            type="scorerType"
            :value="scorerTypeOf(row)"
          />
        </template>

        <template #cell-produces="{ row }">
          <span class="font-mono text-xs">{{ producesLabel(row) || "—" }}</span>
        </template>

        <template #cell-version="{ row }">
          <span class="font-mono text-xs">v{{ row.version }}</span>
        </template>

        <template #cell-usedBy="{ row }">
          <span class="font-mono text-xs">{{ usedByText(row) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center actions-container">
            <OButton
              :data-test="`scorer-list-${row.name}-edit-btn`"
              data-row-action="edit"
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
              data-row-action="delete"
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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { isInputFocused } from "@/utils/keyboardShortcuts";
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
import OTag from "@/lib/core/Badge/OTag.vue";
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
  (e: "refresh"): void;
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
    meta: { align: "right" },
  },
  {
    id: "usedBy",
    header: t("onlineEvals.scorer.columns.usedBy"),
    accessorFn: (row: Scorer) => usedByCount(row),
    sortable: true,
    size: COL.count,
    meta: { align: "right" },
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
// nudging the user there first avoids a dead-end. This renders inside the
// OTable's #empty slot (not EvalListShell's) so the search bar + column
// header stay visible, matching the other eval list pages.
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
  else if (id === "import") emit("import-custom");
  else if (id === "clear-filters") {
    emit("update:search", "");
    typeFilter.value = null;
  }
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

useShortcuts([
  { id: "scorersRefresh", handler: () => { if (!isInputFocused()) emit("refresh"); } },
]);
</script>
