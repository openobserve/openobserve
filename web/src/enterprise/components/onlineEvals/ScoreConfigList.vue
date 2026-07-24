<template>
  <EvalListShell data-test="score-config" :show-empty="false">
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
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="score-config-list"
        width="100%"
        class="h-full w-full"
        @row-click="(row: any) => $emit('view', row)"
      >
        <template #toolbar>
          <OSearchInput
            :model-value="search"
            class="min-w-0 flex-1"
            :placeholder="t('onlineEvals.scoreConfig.searchPlaceholder')"
            data-test="score-config-list-search-input"
            clearable
            @update:model-value="$emit('update:search', $event as string)"
          />
        </template>

        <template #toolbar-trailing>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="refresh"
            :loading="loading"
            data-test="score-config-list-refresh-btn"
            @click="emit('refresh')"
          >
            <OTooltip
              side="bottom"
              :content="t('common.refresh')"
              shortcut-id="scoreConfigsRefresh"
            />
          </OButton>
        </template>

        <!-- Data-type breakdown (catalog signal) — doubles as a filter synced to
             the type dropdown; Total last, never itself the active tile. -->
        <template #subheader>
          <div
            class="px-page-edge border-table-row-divider border-b py-1.5"
            data-test="score-config-list-summary"
          >
            <OStatStrip
              :items="summaryStats"
              :loading="loading"
              selectable
              :selected-key="selectedStatKey"
              @select="onStatSelect"
            />
          </div>
        </template>

        <template #empty>
          <div class="flex items-center justify-center py-8">
            <OEmptyState
              size="hero"
              preset="no-score-configs"
              :filtered="hasFilters"
              :actions="[
                {
                  id: 'create',
                  icon: 'add',
                  titleKey: 'emptyState.noScoreConfigs.action',
                  descriptionKey: 'emptyState.noScoreConfigs.actionDesc',
                },
                {
                  id: 'import',
                  icon: 'upload-file',
                  titleKey: 'emptyState.noScoreConfigs.import',
                  descriptionKey: 'emptyState.noScoreConfigs.importDesc',
                },
              ]"
              data-test="score-config-empty-state"
              @action="onEmptyAction"
            />
          </div>
        </template>

        <template #cell-type="{ row }">
          <OTag type="evalDataType" :value="dataTypeOf(row)" />
        </template>

        <template #cell-rangeValues="{ row }">
          <span class="tabular-nums">{{ rangeOrValues(row) }}</span>
        </template>

        <template #cell-healthy="{ row }">
          <span class="font-semibold">{{ healthyDisplay(row) }}</span>
        </template>

        <template #cell-version="{ row }">
          <span class="tabular-nums">{{ t("onlineEvals.versionPrefix") }}{{ row.version }}</span>
        </template>

        <template #cell-usedBy="{ row }">
          <span class="tabular-nums">{{ usedByText(row) }}</span>
        </template>

        <template #cell-created="{ row }">
          <OTimeCell :value="rowCreated(row)" mode="relative" empty-label="—" />
        </template>

        <template #bottom="{ totalRows }">
          <span class="text-xs font-normal">
            {{ totalRows.toLocaleString() }} {{ t("onlineEvals.scoreConfig.listTitle") }}
          </span>
          <OButton
            v-if="selectedIds.length > 0"
            variant="outline"
            size="sm"
            class="ml-3"
            icon-left="download"
            data-test="score-config-bulk-export-btn"
            @click="handleBulkExport"
          >
            {{ t("onlineEvals.scoreConfig.export.bulkButton") }} ({{ selectedIds.length }})
          </OButton>
        </template>

        <template #cell-actions="{ row }">
          <div class="actions-container flex items-center">
            <OButton
              :data-test="`score-config-list-${row.name}-edit-btn`"
              data-row-action="edit"
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { COL } from "@/lib/core/Table/OTable.types";
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "./utils/evalEntity";
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
  (e: "refresh"): void;
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
      header: t("onlineEvals.scoreConfig.columns.name"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      minSize: 160,
      // `flex` (not `autoWidth`): fills leftover width on load AND stays
      // resizable — matches Dashboards/AlertList; `autoWidth` has no resize grip.
      meta: { align: "left", flex: true },
    },
    {
      id: "type",
      header: t("onlineEvals.scoreConfig.columns.type"),
      accessorFn: (row: ScoreConfig) => dataTypeOf(row),
      sortable: true,
      // Type values are short ("numeric" / "categorical" / "boolean"), so the
      // shared COL.type (180) is wider than needed — trim it back so the flex
      // `name` column reclaims the width (matching the Scorers table).
      size: 120,
      meta: { align: "left" },
    },
    {
      id: "rangeValues",
      header: t("onlineEvals.scoreConfig.columns.rangeValues"),
      accessorFn: (row: ScoreConfig) => rangeOrValues(row),
      sortable: false,
      // Slightly narrower than COL.description (300) — the range/values text is
      // compact, and the freed width goes to the flex `name` column.
      size: 160,
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
      size: COL.version,
      meta: { align: "right" },
    },
    {
      id: "usedBy",
      header: t("onlineEvals.scoreConfig.columns.usedBy"),
      accessorFn: (row: ScoreConfig) => usedByCount(row),
      sortable: true,
      size: COL.count,
      meta: { align: "right" },
    },
    {
      id: "created",
      header: t("onlineEvals.scoreConfig.columns.created"),
      accessorFn: (row: ScoreConfig) => rowCreated(row),
      sortable: true,
      size: COL.createdAt,
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
  ].map((c: any) => ({
    ...c,
    // Every column except the row index, the name (row identity) and the
    // actions column is offered in OTable's "Manage columns" chooser.
    hideable: c.id !== "#" && c.id !== "name" && !c.isAction,
  })),
);

const filteredRows = computed(() =>
  typeFilter.value ? props.rows.filter((row) => dataTypeOf(row) === typeFilter.value) : props.rows,
);

const numberedRows = useNumberedRows(filteredRows);

// Data-type breakdown for the summary strip (over all configs, so the counts
// stay stable as you filter). Tiles double as filters wired to `typeFilter`.
const typeCounts = computed(() => {
  const rows = props.rows || [];
  let numeric = 0;
  let categorical = 0;
  let boolean = 0;
  for (const r of rows) {
    const ty = dataTypeOf(r);
    if (ty === "numeric") numeric += 1;
    else if (ty === "categorical") categorical += 1;
    else if (ty === "boolean") boolean += 1;
  }
  return { numeric, categorical, boolean, total: rows.length };
});
const summaryStats = computed<StatItem[]>(() => {
  const c = typeCounts.value;
  const has = c.total > 0;
  const v = (n: number): string | number => (has ? n : "—");
  const share = has ? c.total : undefined;
  return [
    {
      key: "numeric",
      label: t("onlineEvals.scoreConfig.dataTypes.numeric"),
      value: v(c.numeric),
      icon: "tag",
      tone: "blue",
      max: share,
      dataTest: "score-config-summary-numeric",
    },
    {
      key: "categorical",
      label: t("onlineEvals.scoreConfig.dataTypes.categorical"),
      value: v(c.categorical),
      icon: "category",
      tone: "purple",
      max: share,
      dataTest: "score-config-summary-categorical",
    },
    {
      key: "boolean",
      label: t("onlineEvals.scoreConfig.dataTypes.boolean"),
      value: v(c.boolean),
      icon: "toggle-off",
      tone: "teal",
      max: share,
      dataTest: "score-config-summary-boolean",
    },
    {
      key: "all",
      label: t("onlineEvals.summaryAll"),
      value: v(c.total),
      icon: "format-list-bulleted",
      tone: "primary",
      dataTest: "score-config-summary-all",
    },
  ];
});
// Nothing is highlighted while viewing all rows (like the Incidents/Alerts strip);
// the "All" tile clears the facet but is never itself the active tile.
const selectedStatKey = computed(() => typeFilter.value);
function onStatSelect(key: string) {
  // Re-clicking the active tile clears the filter (toggle), matching the Alerts strip.
  typeFilter.value = key === "all" || typeFilter.value === key ? null : (key as DataType);
}

// Drives OEmptyState's `:filtered` — true whenever the user has narrowed
// the list (search or type filter). The filtered case auto-renders the
// "No score configs match these filters" + Clear-filters card; the
// first-run case shows the preset's "Create score config" CTA.
const hasFilters = computed(() => !!props.search?.trim() || !!typeFilter.value);

function onEmptyAction(id?: string) {
  if (id === "create") emit("create");
  else if (id === "import") emit("import-custom");
  else if (id === "clear-filters") {
    emit("update:search", "");
    typeFilter.value = null;
  }
}

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

useShortcuts([
  {
    id: "scoreConfigsRefresh",
    handler: () => {
      if (!isInputFocused()) emit("refresh");
    },
  },
]);
</script>
