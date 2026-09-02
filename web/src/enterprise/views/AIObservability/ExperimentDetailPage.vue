<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OPageLayout
    data-test="ai-experiment-detail-page"
    :title="raw(detail?.experiment.name ?? '')"
    icon="science"
    :back="backTarget"
    bleed
  >
    <template #actions>
      <OTag
        v-if="detail"
        size="sm"
        :variant="statusVariant(detail.experiment.status, 'eval').variant"
      >
        {{ statusVariant(detail.experiment.status, "eval").label }}
      </OTag>
      <OButton
        v-if="detail?.experiment.status === 'running'"
        size="sm"
        variant="outline"
        :disabled="acting"
        data-test="ai-experiment-detail-cancel"
        @click="cancelExperiment"
      >
        {{ t("aiObservability.experiments.cancel") }}
      </OButton>
      <OButton
        v-else-if="detail?.experiment.status === 'failed' || failedSlotCount > 0"
        size="sm"
        variant="outline"
        :disabled="acting"
        data-test="ai-experiment-detail-retry"
        @click="retryExperiment"
      >
        {{ t("aiObservability.experiments.detail.retryFailed") }}
      </OButton>
      <OButton
        size="sm"
        variant="outline"
        :disabled="!detail"
        data-test="ai-experiment-detail-compare"
        @click="comparePickerOpen = true"
      >
        {{ t("aiObservability.experiments.detail.compare") }}
      </OButton>
      <OButton
        size="sm"
        variant="outline"
        :disabled="acting || !detail"
        data-test="ai-experiment-detail-clone"
        @click="cloneExperiment"
      >
        {{ t("aiObservability.experiments.clone") }}
      </OButton>
    </template>

    <template v-if="detail" #subnav>
      <div
        class="px-page-edge flex flex-wrap items-center gap-x-4 gap-y-2 py-2"
        data-test="ai-experiment-detail-meta"
      >
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="text-2xs text-text-tertiary font-semibold">
            {{ t("aiObservability.experiments.detail.metaLabels.dataset") }}
          </span>
          <span
            class="text-text-secondary truncate text-xs"
            data-test="ai-experiment-detail-dataset"
          >
            {{ datasetLabel }}
          </span>
        </div>

        <OSeparator vertical class="h-4" />

        <div class="flex min-w-0 items-center gap-1.5">
          <span class="text-2xs text-text-tertiary font-semibold">
            {{ t("aiObservability.experiments.detail.metaLabels.task") }}
          </span>
          <span class="text-text-secondary truncate text-xs">
            {{ t(`aiObservability.experiments.detail.taskType.${detail.experiment.task.type}`) }}
          </span>
        </div>

        <template v-if="taskModel">
          <OSeparator vertical class="h-4" />
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="text-2xs text-text-tertiary font-semibold">
              {{ t("aiObservability.experiments.detail.metaLabels.model") }}
            </span>
            <span class="text-text-secondary truncate text-xs">{{ raw(taskModel) }}</span>
          </div>
        </template>

        <OSeparator vertical class="h-4" />

        <div class="flex min-w-0 items-center gap-1.5">
          <span class="text-2xs text-text-tertiary font-semibold">
            {{ t("aiObservability.experiments.detail.metaLabels.run") }}
          </span>
          <span class="text-text-secondary truncate text-xs">{{ runSummary }}</span>
        </div>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <KpiCardRow v-if="metricCards.length" class="px-page-edge shrink-0 py-2.5">
        <KpiCard
          v-for="card in metricCards"
          :key="card.key"
          :label="card.label"
          :icon="card.icon"
          :data-test="card.dataTest"
        >
          <template #value>
            <span class="text-text-secondary text-2xl leading-none font-bold">
              {{ raw(card.value) }}
            </span>
            <span v-if="card.unit" class="text-compact text-text-secondary font-semibold">
              {{ raw(card.unit) }}
            </span>
          </template>
          <template v-if="card.footer" #footer>
            <span class="text-3xs text-text-tertiary font-medium">{{ raw(card.footer) }}</span>
          </template>
        </KpiCard>
      </KpiCardRow>

      <div class="min-h-0 flex-1 overflow-hidden">
        <OTable
          :data="visibleRows"
          :columns="columns"
          row-key="rowKey"
          :loading="loading || rowsLoading"
          :show-global-filter="false"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="ai-experiment-detail-rows"
          pagination="client"
          width="100%"
          class="h-full w-full"
          data-test="ai-experiment-detail-table"
          @row-click="openRow"
        >
          <template #toolbar>
            <div class="flex w-full items-center gap-2">
              <OInput
                v-model="rowSearch"
                class="min-w-0 flex-1"
                :placeholder="
                  t(
                    isMultiTrial
                      ? 'aiObservability.experiments.detail.searchInputPlaceholder'
                      : 'aiObservability.experiments.detail.searchPlaceholder',
                  )
                "
                clearable
                data-test="ai-experiment-detail-search"
              />
              <OSelect
                v-model="statusFilter"
                class="shrink-0"
                width="sm"
                :options="statusOptions"
                :placeholder="t('aiObservability.experiments.detail.statusFilterAll')"
                :searchable="false"
                clearable
                data-test="ai-experiment-detail-status-filter"
              />
              <OSelect
                v-if="isMultiTrial"
                v-model="dispersionView"
                class="shrink-0"
                width="md"
                :options="dispersionOptions"
                :searchable="false"
                data-test="ai-experiment-detail-dispersion-filter"
              />
            </div>
          </template>

          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :loading="loading"
              data-test="ai-experiment-detail-refresh"
              @click="refresh"
            >
              <OTooltip side="bottom" :content="t('common.refresh')" />
            </OButton>
          </template>

          <template #cell-slotStatus="{ row }: { row: any }">
            <OTag
              size="sm"
              :variant="statusVariant(row.status, 'eval').variant"
              :label="statusVariant(row.status, 'eval').label"
              :data-test="`ai-experiment-row-status-${row.rowKey}`"
            />
          </template>

          <template #cell-input="{ row }: { row: any }">
            <span class="text-text-secondary truncate">{{ raw(row.input) }}</span>
          </template>

          <template #cell-output="{ row }: { row: any }">
            <span class="text-text-secondary truncate">
              {{ raw(row.output) }}
            </span>
          </template>

          <template #cell-trialCount="{ row }: { row: any }">
            <span class="text-text-secondary">{{ raw(row.trialLabel) }}</span>
          </template>

          <template #cell-dispersion="{ row }: { row: any }">
            <OTag
              v-if="row.highDispersion"
              size="sm"
              variant="warning"
              :label="`${t('aiObservability.experiments.detail.highDispersionBadge')} · ${raw(row.dispersionLabel)}`"
            />
            <span v-else class="text-text-secondary">{{ raw(row.dispersionLabel) }}</span>
          </template>

          <template #cell-latency="{ row }: { row: any }">
            <span class="text-text-secondary">{{ raw(row.latency) }}</span>
          </template>

          <template #empty>
            <div class="flex items-center justify-center py-8">
              <OEmptyState size="hero" preset="no-experiments" />
            </div>
          </template>
        </OTable>
      </div>
    </div>

    <ExperimentComparePickerDialog
      v-if="detail"
      v-model:open="comparePickerOpen"
      :org-id="orgId"
      :experiment-id="detail.experiment.id"
      :dataset-id="detail.experiment.datasetId"
      @compare="openComparison"
    />

    <ExperimentRowDetailDrawer
      :open="rowDrawerOpen"
      :detail="selectedRowDetail"
      :retrying="retryingRow"
      @update:open="rowDrawerOpen = $event"
      @navigate="loadRowDetail"
      @retry="retryRowSlot"
      @trace="openTrace"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { gt, raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ExperimentComparePickerDialog from "@/enterprise/components/AIObservability/ExperimentComparePickerDialog.vue";
import KpiCard from "@/components/common/KpiCard.vue";
import KpiCardRow from "@/components/common/KpiCardRow.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmExperimentsService, {
  type ExperimentDetail,
  type ExperimentExecution,
  type ExperimentResultRow,
  type ExperimentResultRowSort,
  type ExperimentResultSlot,
  type ExperimentRowDetail,
} from "@/services/llm-experiments.service";
import ExperimentRowDetailDrawer from "@/enterprise/components/AIObservability/ExperimentRowDetailDrawer.vue";
import {
  aiExperimentCompareRoute,
  aiExperimentCreateRoute,
  aiExperimentDetailRoute,
  aiExperimentsRoute,
} from "./experimentRoutes";
import { canCloneInForm } from "@/enterprise/components/AIObservability/ExperimentForm.schema";
import {
  durationLabel,
  durationUnit,
  formatDuration,
} from "@/enterprise/components/AIObservability/experimentRowContent";
import { experimentScoreSummaryValue, openExperimentTrace } from "./experimentResults";

defineOptions({ name: "AIExperimentDetailPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experimentId = computed<string>(() => String(route.params.id ?? ""));
const detail = ref<ExperimentDetail | null>(null);
const loading = ref(false);
const rowsLoading = ref(false);
const acting = ref(false);
const comparePickerOpen = ref(false);
const RESULTS_PAGE_SIZE = 100;
const resultRows = ref<ExperimentResultRow[]>([]);
const rowSearch = ref("");
const statusFilter = ref("");
const dispersionView = ref<"dataset" | "dispersion_desc" | "high_only">("dataset");
const rowDrawerOpen = ref(false);
const retryingRow = ref(false);
const selectedRowDetail = ref<ExperimentRowDetail | null>(null);

const backTarget = computed(() => ({
  label: t("aiObservability.nav.experiments"),
  to: aiExperimentsRoute(orgId.value),
}));
const isMultiTrial = computed(() => (detail.value?.experiment.trialCount ?? 1) > 1);

/** Scorer columns come from the pinned scorers, so a run with two scorers gets
 *  two score columns exactly like the dataset grouping on the list page. */
const scorerIds = computed(() => (detail.value?.preview.pinnedScorers ?? []).map((s) => s.id));

/** Score summaries carry the pinned Score Config name even before the first
 *  Score exists. Completed Score records remain a compatibility fallback. */
const scorerNames = computed<Record<string, string>>(() => {
  const names: Record<string, string> = {};
  const record = (raw: Record<string, unknown> | undefined) => {
    const id = String(raw?.scorer_id ?? raw?.scorerId ?? "");
    const name = String(raw?.name ?? "");
    if (id && name && !names[id]) names[id] = name;
  };
  for (const summary of detail.value?.results.scoreSummaries ?? []) {
    const name = summary.scoreConfigName || summary.name;
    if (summary.scorerId && name && !names[summary.scorerId]) {
      names[summary.scorerId] = name;
    }
  }
  for (const score of detail.value?.results.scores ?? []) record(score);
  return names;
});

const tableRows = computed(() =>
  resultRows.value.map((row) => {
    const scores: Record<string, string> = {};
    for (const id of scorerIds.value) {
      const summary = row.scoreSummaries.find((candidate) => candidate.scorerId === id);
      scores[`score:${id}`] = experimentScoreSummaryValue(summary?.value ?? null);
    }
    const maxDispersion = row.dispersion?.maxNormalized ?? null;
    return {
      ...row,
      ...scores,
      rowKey: row.rowId,
      input: row.input ?? "—",
      output: row.output ?? "—",
      trialLabel: gt(
        "aiObservability.experiments.detail.trialCount",
        { count: row.trialCount },
        row.trialCount,
      ),
      latency: durationLabel(row.p50LatencyMs),
      dispersion: maxDispersion ?? -1,
      dispersionLabel: maxDispersion === null ? "—" : `${Math.round(maxDispersion * 100)}%`,
      highDispersion: row.dispersion?.high ?? false,
    };
  }),
);

const STATUS_FILTERS = [
  "pending",
  "running",
  "scoring",
  "completed",
  "skipped",
  "task_failed",
  "score_failed",
] as const;

const statusOptions = computed(() =>
  STATUS_FILTERS.map((status) => ({
    label: statusVariant(status, "eval").label,
    value: status,
  })),
);

const dispersionOptions = computed(() => [
  {
    label: t("aiObservability.experiments.detail.dispersionDatasetOrder"),
    value: "dataset",
  },
  {
    label: t("aiObservability.experiments.detail.dispersionHighestFirst"),
    value: "dispersion_desc",
  },
  {
    label: t("aiObservability.experiments.detail.dispersionHighOnly"),
    value: "high_only",
  },
]);

const visibleRows = computed(() => {
  const term = rowSearch.value.trim().toLowerCase();
  return tableRows.value.filter((row) => {
    if (statusFilter.value && row.status !== statusFilter.value) return false;
    if (!term) return true;
    return `${row.input} ${row.output}`.toLowerCase().includes(term);
  });
});

const failedSlotCount = computed(
  () => detail.value?.results.aggregateSummary?.incompleteTaskSlots ?? 0,
);

// Built as parts rather than one interpolated sentence so a task without a
// model simply drops that segment instead of rendering a dash.
const taskModel = computed(() => {
  const task = detail.value?.experiment.task;
  return task && "model" in task ? (task.model ?? "") : "";
});

const datasetLabel = computed(() => {
  const experiment = detail.value?.experiment;
  if (!experiment) return raw("");
  return t("aiObservability.experiments.detail.datasetVersion", {
    dataset: experiment.datasetName ?? experiment.datasetId,
    version: experiment.datasetVersion,
  });
});

const runSummary = computed(() => {
  const experiment = detail.value?.experiment;
  if (!experiment) return raw("");
  return t("aiObservability.experiments.detail.runSummary", {
    trials: gt(
      "aiObservability.experiments.detail.trialCount",
      { count: experiment.trialCount },
      experiment.trialCount,
    ),
    scorers: gt(
      "aiObservability.experiments.detail.scorerCount",
      { count: experiment.scorers.length },
      experiment.scorers.length,
    ),
  });
});

interface MetricCard {
  key: string;
  label: I18nText;
  value: string;
  unit?: string;
  footer?: string;
  icon: IconName;
  dataTest: string;
}

const metricCards = computed<MetricCard[]>(() => {
  const results = detail.value?.results;
  if (!results) return [];
  const aggregate = results.aggregateSummary;
  const task = results.taskProgress;
  const scoring = results.scoringProgress;
  const scoreDistribution = (results.scoreSummaries ?? []).reduce(
    (distribution, summary) => ({
      success: distribution.success + summary.sampleCount,
      failed: distribution.failed + summary.errorCount,
      pending: distribution.pending + summary.pendingCount,
      skipped: distribution.skipped + summary.skippedCount,
    }),
    { success: 0, failed: 0, pending: 0, skipped: 0 },
  );
  // Scoring stays one run-level card: per-scorer cards would grow the row
  // without bound (the API puts no cap on pinned scorers). Per-scorer values
  // live in the table columns.
  const cards: MetricCard[] = [];
  // Seconds once past a second: a raw "10449" costs the reader the magnitude and
  // overflows the tile. Unit rides beside the number, so it is never guessed at.
  const p50 = aggregate?.p50LatencyMs ?? null;
  const p50Unit = p50 === null ? undefined : durationUnit(p50);
  cards.push({
    key: "p50",
    label: t("aiObservability.experiments.detail.p50Latency"),
    value: p50 === null || p50Unit === undefined ? "—" : formatDuration(p50, p50Unit),
    unit: p50Unit,
    icon: "speed" as IconName,
    dataTest: "ai-experiment-detail-p50",
  });
  cards.push({
    key: "cost",
    label: t("aiObservability.experiments.detail.totalCost"),
    value: aggregate?.totalCost == null ? "—" : `$${aggregate.totalCost.toFixed(4)}`,
    icon: "payments" as IconName,
    dataTest: "ai-experiment-detail-cost",
  });
  cards.push({
    key: "dispersion",
    label: t("aiObservability.experiments.detail.highDispersion"),
    value: String(results.dispersionSummary?.highDispersionRowCount ?? 0),
    footer: t("aiObservability.experiments.detail.highDispersionHint"),
    icon: "error-outline" as IconName,
    dataTest: "ai-experiment-detail-dispersion",
  });
  if (task) {
    cards.push({
      key: "progress",
      label: t("aiObservability.experiments.detail.progress"),
      value: `${task.completed}/${task.total}`,
      footer: task.skipped
        ? t("aiObservability.experiments.detail.skippedCount", { count: task.skipped })
        : undefined,
      icon: "check-circle" as IconName,
      dataTest: "ai-experiment-detail-progress",
    });
  }
  if (scoring && (scoring.total > 0 || results.scoreSummaries?.length)) {
    cards.push({
      key: "scoring",
      label: t("aiObservability.experiments.detail.scoring"),
      value: `${scoring.completed}/${scoring.total}`,
      footer: t("aiObservability.experiments.detail.scoringDistribution", scoreDistribution),
      icon: "fact-check" as IconName,
      dataTest: "ai-experiment-detail-scoring",
    });
  }
  return cards;
});

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "slotStatus",
    header: t("aiObservability.experiments.detail.slotStatus"),
    accessorKey: "status",
    sortable: true,
    size: COL.status,
    meta: { align: "left" as const },
  },
  {
    id: "input",
    header: t("aiObservability.experiments.detail.columns.input"),
    accessorKey: "input",
    sortable: false,
    size: COL.name,
    minSize: 160,
    meta: { align: "left" as const, flex: true, isName: true },
  },
  ...(isMultiTrial.value
    ? [
        {
          id: "trialCount",
          header: t("aiObservability.experiments.detail.columns.trials"),
          accessorKey: "trialCount",
          sortable: true,
          size: 120,
          meta: { align: "left" as const },
        },
      ]
    : [
        {
          id: "output",
          header: t("aiObservability.experiments.detail.columns.output"),
          accessorKey: "output",
          sortable: false,
          size: 320,
          meta: { align: "left" as const },
        },
      ]),
  ...scorerIds.value.map((id) => ({
    id: `score:${id}`,
    header: raw(scorerNames.value[id] ?? id),
    accessorKey: `score:${id}`,
    sortable: true,
    hideable: true,
    size: 140,
    meta: { align: "left" as const },
  })),
  ...(isMultiTrial.value
    ? [
        {
          id: "dispersion",
          header: t("aiObservability.experiments.detail.columns.dispersion"),
          accessorKey: "dispersion",
          sortable: true,
          size: 130,
          meta: { align: "left" as const },
        },
      ]
    : []),
  {
    id: "latency",
    header: isMultiTrial.value
      ? t("aiObservability.experiments.detail.columns.p50Latency")
      : t("aiObservability.experiments.detail.columns.latency"),
    accessorKey: "latency",
    sortable: true,
    size: 120,
    meta: { align: "left" as const },
  },
]);

function resultRowOptions(page: number) {
  const sort: ExperimentResultRowSort =
    dispersionView.value === "dataset" ? "dataset" : "dispersion_desc";
  return {
    page,
    pageSize: RESULTS_PAGE_SIZE,
    sort,
    highDispersionOnly: dispersionView.value === "high_only",
  };
}

async function fetchAllResultRows() {
  const rows: ExperimentResultRow[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const next = await llmExperimentsService.listRows(
      orgId.value,
      experimentId.value,
      resultRowOptions(page),
    );
    rows.push(...next.rows);
    hasMore = next.pagination.hasMore;
    page += 1;
  }
  return rows;
}

function showLoadError(error: any) {
  toast({
    variant: "error",
    message:
      raw(error?.response?.data?.message) || t("aiObservability.experiments.detail.loadError"),
  });
}

async function refreshRows() {
  if (!orgId.value || !experimentId.value) return;
  rowsLoading.value = true;
  try {
    resultRows.value = await fetchAllResultRows();
  } catch (error: any) {
    showLoadError(error);
  } finally {
    rowsLoading.value = false;
  }
}

async function refresh() {
  if (!orgId.value || !experimentId.value) return;
  loading.value = true;
  rowsLoading.value = true;
  try {
    const [nextDetail, rows] = await Promise.all([
      llmExperimentsService.get(orgId.value, experimentId.value, {
        resultPage: 1,
        resultPageSize: 1,
      }),
      fetchAllResultRows(),
    ]);
    detail.value = nextDetail;
    resultRows.value = rows;
  } catch (error: any) {
    showLoadError(error);
  } finally {
    loading.value = false;
    rowsLoading.value = false;
  }
}

async function openRow(row: { rowId: string }) {
  await loadRowDetail(row.rowId);
  rowDrawerOpen.value = true;
}

async function loadRowDetail(rowId: string) {
  try {
    selectedRowDetail.value = await llmExperimentsService.getRow(
      orgId.value,
      experimentId.value,
      rowId,
    );
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.experiments.detail.loadError"),
    });
  }
}

function openTrace(execution: ExperimentExecution) {
  openExperimentTrace(
    orgId.value,
    execution,
    (location) => router.resolve(location),
    globalThis.open,
  );
}

async function retryRowSlot(slot: ExperimentResultSlot) {
  if (slot.taskStatus !== "error") return;
  retryingRow.value = true;
  try {
    await llmExperimentsService.retrySlot(
      orgId.value,
      experimentId.value,
      slot.rowId,
      slot.trialIndex,
      globalThis.crypto.randomUUID(),
    );
    await loadRowDetail(slot.rowId);
    await refresh();
    toast({ variant: "success", message: t("aiObservability.experiments.retrySuccess") });
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.experiments.retryError"),
    });
  } finally {
    retryingRow.value = false;
  }
}

async function cancelExperiment() {
  await runAction(() => llmExperimentsService.cancel(orgId.value, experimentId.value), {
    success: t("aiObservability.experiments.cancelSuccess"),
    error: t("aiObservability.experiments.cancelError"),
  });
}

async function retryExperiment() {
  await runAction(() => llmExperimentsService.retry(orgId.value, experimentId.value), {
    success: t("aiObservability.experiments.retrySuccess"),
    error: t("aiObservability.experiments.retryError"),
  });
}

/** This run is the candidate; the picker supplies the baseline it is measured against. */
function openComparison(baselineId: string) {
  const experimentId = detail.value?.experiment.id;
  if (!experimentId) return;
  void router.push(aiExperimentCompareRoute(orgId.value, baselineId, experimentId));
}

// Opens the create form seeded from this run rather than starting a copy
// outright: a clone costs a full execution, and it is normally made in order to
// change something first.
async function cloneExperiment() {
  const task = detail.value?.experiment.task;
  if (task && canCloneInForm(task)) {
    void router.push(aiExperimentCreateRoute(orgId.value, { cloneOf: experimentId.value }));
    return;
  }
  acting.value = true;
  try {
    const clone = await llmExperimentsService.clone(orgId.value, experimentId.value);
    toast({ variant: "success", message: t("aiObservability.experiments.cloneSuccess") });
    void router.push(aiExperimentDetailRoute(orgId.value, clone.id));
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.experiments.cloneError"),
    });
  } finally {
    acting.value = false;
  }
}

async function runAction(
  action: () => Promise<unknown>,
  messages: { success: I18nText; error: I18nText },
) {
  acting.value = true;
  try {
    await action();
    toast({ variant: "success", message: messages.success });
    await refresh();
  } catch (error: any) {
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || messages.error,
    });
  } finally {
    acting.value = false;
  }
}

watch([orgId, experimentId], refresh, { immediate: true });
watch(dispersionView, refreshRows);
</script>
