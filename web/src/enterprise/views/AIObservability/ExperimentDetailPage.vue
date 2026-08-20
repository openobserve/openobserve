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
        v-else-if="failedSlotCount > 0"
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
          :data="visibleSlots"
          :columns="columns"
          row-key="slotKey"
          :loading="loading"
          show-index
          :show-global-filter="false"
          :default-columns="false"
          :enable-column-resize="true"
          :persist-columns="true"
          table-id="ai-experiment-detail-rows"
          pagination="server"
          :current-page="page"
          :page-size="pageSize"
          :total-count="totalSlots"
          width="100%"
          class="h-full w-full"
          data-test="ai-experiment-detail-table"
          @update:current-page="onPageChange"
          @row-click="openRow"
        >
          <template #cell-input="{ row }: { row: any }">
            <span class="text-text-secondary truncate">{{ raw(row.input) }}</span>
          </template>

          <template #cell-output="{ row }: { row: any }">
            <span class="text-text-secondary truncate">
              {{ raw(row.output) }}
            </span>
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
  type ExperimentResultSlot,
  type ExperimentRowDetail,
} from "@/services/llm-experiments.service";
import ExperimentRowDetailDrawer from "@/enterprise/components/AIObservability/ExperimentRowDetailDrawer.vue";
import { aiExperimentCompareRoute, aiExperimentsRoute } from "./experimentRoutes";
import { openExperimentTrace } from "./experimentResults";

defineOptions({ name: "AIExperimentDetailPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experimentId = computed<string>(() => String(route.params.id ?? ""));
const detail = ref<ExperimentDetail | null>(null);
const loading = ref(false);
const acting = ref(false);
const comparePickerOpen = ref(false);
const page = ref(1);
const pageSize = 50;
const rowDrawerOpen = ref(false);
const retryingRow = ref(false);
const selectedRowDetail = ref<ExperimentRowDetail | null>(null);

const backTarget = computed(() => ({
  label: t("aiObservability.nav.experiments"),
  to: aiExperimentsRoute(orgId.value),
}));
const slots = computed<ExperimentResultSlot[]>(() => detail.value?.results.slots ?? []);
const totalSlots = computed(() => detail.value?.results.pagination?.totalSlots ?? 0);

/** Scorer columns come from the pinned scorers, so a run with two scorers gets
 *  two score columns exactly like the dataset grouping on the list page. */
const scorerIds = computed(() => (detail.value?.preview.pinnedScorers ?? []).map((s) => s.id));

/** Only the score records carry the scorer's display name — pinnedScorers and
 *  score_summaries are id-only — so build the lookup from them. */
const scorerNames = computed<Record<string, string>>(() => {
  const names: Record<string, string> = {};
  const record = (raw: Record<string, unknown> | undefined) => {
    const id = String(raw?.scorer_id ?? raw?.scorerId ?? "");
    const name = String(raw?.name ?? "");
    if (id && name && !names[id]) names[id] = name;
  };
  for (const score of detail.value?.results.scores ?? []) record(score);
  for (const slot of slots.value) {
    for (const entry of slot.scores) record(entry.score as Record<string, unknown> | undefined);
  }
  return names;
});

const visibleSlots = computed(() =>
  slots.value.map((slot) => {
    const scores: Record<string, string> = {};
    for (const id of scorerIds.value) {
      const entry = slot.scores.find((s) => s.scorerId === id);
      const value = (entry?.score as Record<string, unknown> | undefined)?.value_numeric;
      scores[`score:${id}`] = typeof value === "number" ? value.toFixed(3) : "—";
    }
    return {
      ...slot,
      ...scores,
      slotKey: `${slot.rowId}:${slot.trialIndex}`,
      input: slot.input ?? "—",
      output: slot.execution?.output ?? "—",
      latency: slot.execution?.latencyMs == null ? "—" : `${slot.execution.latencyMs}ms`,
    };
  }),
);

// Run-level: a page-local count would show or hide the action depending on
// which page happened to be loaded.
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
  // A fixed four: per-scorer cards would grow the row without bound (the API
  // puts no cap on pinned scorers). Per-scorer values live in the table columns.
  const cards: MetricCard[] = [];
  cards.push({
    key: "p50",
    label: t("aiObservability.experiments.detail.p50Latency"),
    value: aggregate?.p50LatencyMs == null ? "—" : String(aggregate.p50LatencyMs),
    unit: aggregate?.p50LatencyMs == null ? undefined : "ms",
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
  return cards;
});

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "input",
    header: t("aiObservability.experiments.detail.columns.input"),
    accessorKey: "input",
    sortable: false,
    size: COL.name,
    minSize: 160,
    meta: { align: "left" as const, flex: true, isName: true },
  },
  {
    id: "output",
    header: t("aiObservability.experiments.detail.columns.output"),
    accessorKey: "output",
    sortable: false,
    size: 320,
    meta: { align: "left" as const },
  },
  ...scorerIds.value.map((id) => ({
    id: `score:${id}`,
    header: raw(scorerNames.value[id] ?? id),
    accessorKey: `score:${id}`,
    sortable: true,
    hideable: true,
    size: 140,
    meta: { align: "left" as const },
  })),
  {
    id: "latency",
    header: t("aiObservability.experiments.detail.columns.latency"),
    accessorKey: "latency",
    sortable: true,
    size: 120,
    meta: { align: "left" as const },
  },
]);

async function refresh() {
  if (!orgId.value || !experimentId.value) return;
  loading.value = true;
  try {
    detail.value = await llmExperimentsService.get(orgId.value, experimentId.value, {
      resultPage: page.value,
      resultPageSize: pageSize,
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.experiments.detail.loadError"),
    });
  } finally {
    loading.value = false;
  }
}

function onPageChange(next: number) {
  page.value = next;
  void refresh();
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
  await runAction(() => llmExperimentsService.cancel(orgId.value, experimentId.value));
}

async function retryExperiment() {
  await runAction(() => llmExperimentsService.retry(orgId.value, experimentId.value));
}

/** This run is the candidate; the picker supplies the baseline it is measured against. */
function openComparison(baselineId: string) {
  const experimentId = detail.value?.experiment.id;
  if (!experimentId) return;
  void router.push(aiExperimentCompareRoute(orgId.value, baselineId, experimentId));
}

async function cloneExperiment() {
  await runAction(() => llmExperimentsService.clone(orgId.value, experimentId.value));
}

async function runAction(action: () => Promise<unknown>) {
  acting.value = true;
  try {
    await action();
    await refresh();
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.experiments.detail.loadError"),
    });
  } finally {
    acting.value = false;
  }
}

watch([orgId, experimentId], refresh, { immediate: true });
</script>
