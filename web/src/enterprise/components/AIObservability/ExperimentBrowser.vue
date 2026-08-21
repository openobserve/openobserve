<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <section class="space-y-4" data-test="ai-experiment-browser">
    <div v-if="!compact" class="grid grid-cols-[30%_1fr_auto] items-end gap-3">
      <OSelect
        v-model="datasetFilter"
        :label="t('aiObservability.experiments.datasetFilter')"
        :placeholder="t('aiObservability.experiments.datasetFilterPlaceholder')"
        :options="datasetOptions"
        clearable
        data-test="ai-experiment-dataset-filter"
      />
      <OInput
        v-model="nameSearch"
        class="min-w-0"
        :label="t('aiObservability.experiments.nameSearch')"
        :placeholder="t('aiObservability.experiments.nameSearchPlaceholder')"
        data-test="ai-experiment-name-search"
      />
      <!-- The counter is ALWAYS rendered and always the same length, so it
           teaches the two-experiment rule up front without the layout moving as
           the selection changes. The tooltip carries the rarer reasons. -->
      <div class="flex items-center gap-2">
        <span
          class="text-text-secondary text-xs whitespace-nowrap"
          data-test="ai-experiment-selection-count"
        >
          {{ t("aiObservability.experiments.selectionCount", { count: selectedIds.length }) }}
        </span>
        <OTooltip :content="comparisonReason" :disabled="comparison.eligible">
          <OButton
            size="sm"
            variant="outline"
            :disabled="!comparison.eligible"
            :aria-description="comparisonReason"
            data-test="ai-experiment-compare"
            @click="openComparison"
          >
            {{ t("aiObservability.experiments.compare") }}
          </OButton>
        </OTooltip>
      </div>
    </div>

    <div
      v-if="!groups.length"
      class="border-border-default text-text-secondary rounded-default border border-dashed p-6 text-center"
    >
      {{ t("aiObservability.experiments.emptyFiltered") }}
    </div>

    <section
      v-for="group in datasetRows"
      :key="group.id"
      class="border-border-default rounded-default overflow-hidden border"
      :data-test="`ai-experiment-group-${group.datasetId}`"
    >
      <header class="px-table-edge flex items-center gap-2 py-2">
        <OButton
          size="icon"
          variant="ghost"
          :icon-left="isGroupExpanded(group.id) ? 'expand-more' : 'chevron-right'"
          :aria-label="t('aiObservability.experiments.toggleGroup')"
          :data-test="`ai-experiment-group-toggle-${group.datasetId}`"
          @click="toggleGroup(group.id)"
        />
        <span class="text-text-heading text-sm font-medium">{{ raw(group.name) }}</span>
        <span class="text-text-secondary text-xs">
          {{ t("aiObservability.experiments.groupCount", { count: group.experimentCount }) }}
        </span>
        <div class="ms-auto flex items-center gap-2">
          <OButton
            v-if="!compact"
            size="sm"
            variant="outline"
            :data-test="`ai-experiment-group-add-${group.datasetId}`"
            @click="$emit('new', group.datasetId)"
          >
            {{ t("aiObservability.experiments.addToDataset") }}
          </OButton>
          <OButton
            v-if="compact"
            size="sm"
            variant="outline"
            @click="$emit('open-filtered', group.datasetId)"
          >
            {{ t("aiObservability.experiments.viewAll") }}
          </OButton>
        </div>
      </header>

      <OTable
        v-if="isGroupExpanded(group.id)"
        :data="group.children"
        :columns="buildColumns(group.children)"
        row-key="id"
        show-index
        :show-global-filter="false"
        :fill-height="false"
        :frame="false"
        pagination="none"
        sorting="client"
        :default-columns="false"
        :enable-column-resize="true"
        :persist-columns="true"
        table-id="ai-experiments-rows"
        :selection="compact ? 'none' : 'multiple'"
        :show-select-all="false"
        :selected-ids="selectedIds"
        :is-row-selectable="canSelectRow"
        width="100%"
        class="w-full"
        :data-test="`ai-experiment-table-${group.datasetId}`"
        @update:selected-ids="(ids: string[]) => onSelectionChange(ids, group.children)"
        @row-click="(experiment: any) => $emit('select', experiment.id)"
      >
        <template #cell-name="{ row: experiment }">
          <div
            class="flex min-w-0 items-center gap-2"
            :data-test="`ai-experiment-row-${experiment.id}`"
          >
            <span class="text-text-heading truncate font-medium">{{ experiment.name }}</span>
            <OTag v-if="isBaseline(experiment)" size="sm" variant="blue-soft">
              {{ t("aiObservability.experiments.baseline") }}
            </OTag>
          </div>
        </template>

        <template #cell-status="{ row }">
          <div
            class="flex min-w-0 items-center gap-2"
            :data-test="`ai-experiment-status-${row.id}`"
          >
            <ODataBarCell
              v-if="row.status === 'running'"
              :value="evidence(row).completedSlots"
              :max="evidence(row).totalSlots || 1"
              :display="progressLabel(row)"
            />
            <template v-else>
              <OTag size="sm" :variant="statusVariant(row.status, 'eval').variant">
                {{ statusVariant(row.status, "eval").label }}
              </OTag>
              <span v-if="row.statusReason" class="text-text-secondary truncate text-xs">
                {{ raw(row.statusReason) }}
              </span>
            </template>
          </div>
        </template>

        <template #cell-cost="{ row }">
          <span class="text-text-secondary">{{ costLabel(row) }}</span>
        </template>

        <template #cell-createdAt="{ row }">
          <OTimeCell :value="row.createdAt" unit="ms" mode="relative" />
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center gap-2">
            <OButton
              size="sm"
              variant="ghost"
              :icon-left="isBaseline(row) ? 'keep' : 'keep-outline'"
              :title="
                isBaseline(row)
                  ? t('aiObservability.experiments.baseline')
                  : t('aiObservability.experiments.setBaseline')
              "
              :aria-label="
                isBaseline(row)
                  ? t('aiObservability.experiments.baseline')
                  : t('aiObservability.experiments.setBaseline')
              "
              :data-test="`ai-experiment-baseline-${row.id}`"
              @click.stop="setBaseline(row)"
            />
          </div>
        </template>
      </OTable>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ODataBarCell from "@/lib/core/Table/cells/ODataBarCell.vue";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { LlmDataset } from "@/services/llm-datasets.service";
import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";
import {
  comparisonEligibility,
  experimentEvidence,
  groupExperiments,
  readExperimentBaselines,
  type ComparisonIneligibilityReason,
  writeExperimentBaselines,
} from "@/enterprise/views/AIObservability/experimentDiscovery";
import { aiExperimentCompareRoute } from "@/enterprise/views/AIObservability/experimentRoutes";

const props = withDefaults(
  defineProps<{
    orgId: string;
    experiments: LlmExperiment[];
    datasets: LlmDataset[];
    details?: Record<string, ExperimentDetail>;
    fixedDatasetId?: string;
    compact?: boolean;
    syncUrl?: boolean;
  }>(),
  { details: () => ({}), fixedDatasetId: "", compact: false, syncUrl: false },
);

defineEmits<{
  select: [experimentId: string];
  new: [datasetId: string];
  "open-filtered": [datasetId: string];
}>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const initialDataset =
  props.fixedDatasetId || (props.syncUrl ? String(route.query.dataset ?? "") : "");
const datasetFilter = ref(initialDataset);
const nameSearch = ref(props.syncUrl ? String(route.query.experiment ?? "") : "");
const baselineByDataset = ref(readExperimentBaselines(props.orgId));
const selectedIds = ref<string[]>([]);
const collapsedGroups = ref<string[]>([]);

function isGroupRow(row: TreeRow): row is DatasetRow {
  return (row as DatasetRow).isGroup === true;
}

function buildColumns(experiments: LlmExperiment[]): OTableColumnDef[] {
  const scoreColumns: OTableColumnDef[] = groupScorerNames(experiments).map((name) => ({
    id: `score:${name}`,
    header: raw(name),
    accessorFn: (row: TreeRow) => (isGroupRow(row) ? "" : scoreCell(row, name)),
    sortable: true,
    hideable: true,
    size: 140,
    meta: { align: "left" as const },
  }));

  return [
    {
      id: "name",
      header: t("aiObservability.experiments.columns.name"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      minSize: 160,
      meta: { align: "left" as const, flex: true, isName: true },
    },
    {
      id: "status",
      header: t("aiObservability.experiments.columns.status"),
      accessorKey: "status",
      sortable: true,
      size: 200,
      meta: { align: "left" as const },
    },
    ...scoreColumns,
    {
      id: "cost",
      header: t("aiObservability.experiments.columns.cost"),
      hideable: true,
      sortable: false,
      size: 110,
      meta: { align: "left" as const },
    },
    {
      id: "createdAt",
      header: t("aiObservability.experiments.columns.created"),
      accessorKey: "createdAt",
      sortable: true,
      size: 140,
      meta: { align: "left" as const },
    },
    {
      id: "actions",
      header: t("aiObservability.experiments.columns.actions"),
      sortable: false,
      isAction: true,
      size: 72,
      meta: { align: "left" as const },
    },
  ];
}

const datasetOptions = computed(() =>
  props.datasets.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);
const datasetNames = computed(
  () => new Map(props.datasets.map((dataset) => [dataset.id, raw(dataset.name)])),
);
// Datasets are parent rows and their experiments are children, so one table
// gives the whole list shared sorting, column sizing and persistence.
type DatasetRow = {
  id: string;
  isGroup: true;
  name: string;
  datasetId: string;
  experimentCount: number;
  children: LlmExperiment[];
};
// The optional false discriminant lets the template narrow a row to an
// experiment with `v-if="!row.isGroup"`.
type ExperimentRow = LlmExperiment & { isGroup?: false };
type TreeRow = DatasetRow | ExperimentRow;

// Groups are open unless explicitly collapsed, so a new dataset never hides.
function isGroupExpanded(groupId: string) {
  return !collapsedGroups.value.includes(groupId);
}

function toggleGroup(groupId: string) {
  collapsedGroups.value = isGroupExpanded(groupId)
    ? [...collapsedGroups.value, groupId]
    : collapsedGroups.value.filter((id) => id !== groupId);
}

const datasetRows = computed<DatasetRow[]>(() =>
  groups.value.map((group) => ({
    id: `dataset:${group.datasetId}`,
    isGroup: true as const,
    name: group.datasetName,
    datasetId: group.datasetId,
    experimentCount: group.experiments.length,
    children: group.experiments,
  })),
);
const groups = computed(() =>
  groupExperiments(
    props.experiments,
    datasetNames.value,
    baselineByDataset.value,
    props.fixedDatasetId || datasetFilter.value,
    nameSearch.value,
  ),
);
const selectedExperiments = computed(() =>
  props.experiments.filter(({ id }) => selectedIds.value.includes(id)),
);
const comparison = computed(() => comparisonEligibility(selectedExperiments.value));
/** Why Compare is disabled. Always available, so the tooltip can explain it. */
const comparisonReason = computed(() => {
  const reason = comparison.value.reason;
  return reason ? translateComparisonReason(reason) : raw("");
});

watch(
  () => props.orgId,
  (orgId) => {
    baselineByDataset.value = readExperimentBaselines(orgId);
  },
);

watch(
  () => [route.query.dataset, route.query.experiment, route.query.baseline, route.query.candidate],
  ([dataset, experiment, baseline, candidate]) => {
    if (!props.syncUrl) return;
    const nextDataset = String(dataset ?? "");
    const nextSearch = String(experiment ?? "");
    if (datasetFilter.value !== nextDataset) datasetFilter.value = nextDataset;
    if (nameSearch.value !== nextSearch) nameSearch.value = nextSearch;
    const routeSelection = [baseline, candidate]
      .map((id) => String(id ?? ""))
      .filter((id) => props.experiments.some((row) => row.id === id));
    if (routeSelection.join(":") !== selectedIds.value.join(":")) {
      selectedIds.value = routeSelection;
    }
  },
  { immediate: true },
);

watch([datasetFilter, nameSearch], () => {
  if (!props.syncUrl) return;
  const query = { ...route.query };
  if (datasetFilter.value) query.dataset = datasetFilter.value;
  else delete query.dataset;
  if (nameSearch.value.trim()) query.experiment = nameSearch.value.trim();
  else delete query.experiment;
  const currentDataset = String(route.query.dataset ?? "");
  const currentSearch = String(route.query.experiment ?? "");
  if (currentDataset !== datasetFilter.value || currentSearch !== nameSearch.value.trim()) {
    router.replace({ query });
  }
});

function evidence(experiment: LlmExperiment) {
  return experimentEvidence(props.details[experiment.id]);
}

function progressLabel(experiment: LlmExperiment) {
  const value = evidence(experiment);
  return value.totalSlots
    ? t("aiObservability.experiments.progress", {
        done: value.completedSlots,
        total: value.totalSlots,
      })
    : raw(experiment.status);
}

// One column per scorer in the group: the scores array already carries each
// scorer separately, so nothing here needs the API to change.
function groupScorerNames(experiments: LlmExperiment[]): string[] {
  const names: string[] = [];
  for (const experiment of experiments) {
    for (const score of evidence(experiment).scores) {
      if (!names.includes(score.name)) names.push(score.name);
    }
  }
  return names;
}

function scoreCell(experiment: LlmExperiment, scorerName: string): string {
  const score = evidence(experiment).scores.find((entry) => entry.name === scorerName);
  if (!score) return "—";
  if (score.kind === "numeric") return score.value.toFixed(3);
  if (score.kind === "boolean") {
    const pct = score.sampleCount ? Math.round((score.trueCount / score.sampleCount) * 100) : 0;
    return `${pct}% true`;
  }
  const top = [...score.values].sort((a, b) => b.count - a.count)[0];
  return top ? `${top.value} × ${top.count}` : "—";
}

function rejectComparison(reason: ComparisonIneligibilityReason) {
  toast({ variant: "warning", message: translateComparisonReason(reason) });
}

function translateComparisonReason(reason: ComparisonIneligibilityReason) {
  return t(`aiObservability.experiments.comparisonReasons.${reason}`);
}

function costLabel(experiment: LlmExperiment) {
  const cost = evidence(experiment).cost;
  return cost === null ? raw("—") : raw(`$${cost.toFixed(4)}`);
}

function isBaseline(experiment: LlmExperiment) {
  return baselineByDataset.value[experiment.datasetId] === experiment.id;
}

function setBaseline(experiment: LlmExperiment) {
  baselineByDataset.value = { ...baselineByDataset.value, [experiment.datasetId]: experiment.id };
  writeExperimentBaselines(props.orgId, baselineByDataset.value);
  selectedIds.value = [experiment.id];
}

function comparisonDisabled(experiment: LlmExperiment) {
  const selected = props.experiments.filter(({ id }) => selectedIds.value.includes(id));
  return Boolean(
    selected.length &&
    !selectedIds.value.includes(experiment.id) &&
    selected[0].datasetId !== experiment.datasetId,
  );
}

const COMPARISON_LIMIT = 2;

function canSelectRow(row: LlmExperiment) {
  // An already-picked row stays selectable so it can be unpicked; everything
  // else is closed once two are chosen, so the cap is visible rather than a
  // checkbox that silently refuses to tick.
  if (selectedIds.value.includes(row.id)) return true;
  if (selectedIds.value.length >= COMPARISON_LIMIT) return false;
  return !comparisonDisabled(row);
}

// OTable hands back the whole next selection; route the one row that changed
// through toggleComparison so the two-item cap and baseline seeding still apply.
function onSelectionChange(next: string[], rows: LlmExperiment[]) {
  // Each dataset renders its own table, so only diff within that table's rows —
  // otherwise one group's emit would look like it deselected another's.
  const scope = rows.map((row) => row.id);
  const inScope = selectedIds.value.filter((id) => scope.includes(id));
  const changedId =
    next.find((id) => !inScope.includes(id)) ?? inScope.find((id) => !next.includes(id));
  const experiment = props.experiments.find(({ id }) => id === changedId);
  if (experiment) toggleComparison(experiment);
}

function toggleComparison(experiment: LlmExperiment) {
  if (selectedIds.value.includes(experiment.id)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== experiment.id);
  } else if (comparisonDisabled(experiment)) {
    rejectComparison("different_dataset");
    return;
  } else if (selectedIds.value.length >= COMPARISON_LIMIT) {
    rejectComparison("select_only_two");
    return;
  } else {
    const baselineId = baselineByDataset.value[experiment.datasetId];
    const baselineCanSeed =
      baselineId &&
      baselineId !== experiment.id &&
      props.experiments.some(({ id }) => id === baselineId);
    selectedIds.value = baselineCanSeed
      ? [baselineId, experiment.id]
      : [...selectedIds.value, experiment.id];
  }
}

function openComparison() {
  if (!comparison.value.eligible) return;
  const datasetId = selectedExperiments.value[0].datasetId;
  const configuredBaseline = baselineByDataset.value[datasetId];
  const baseline =
    selectedExperiments.value.find(({ id }) => id === configuredBaseline) ??
    selectedExperiments.value[0];
  const candidate = selectedExperiments.value.find(({ id }) => id !== baseline.id);
  if (!candidate) return;
  router.push(aiExperimentCompareRoute(props.orgId, baseline.id, candidate.id));
}
</script>
