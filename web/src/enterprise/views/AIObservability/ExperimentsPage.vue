<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OPageLayout
    data-test="ai-experiments-page"
    :title="t('aiObservability.nav.experiments')"
    :subtitle="t('aiObservability.subtitle.experiments')"
    icon="function"
    bleed
  >
    <template #actions>
      <OButton size="sm" variant="primary" @click="openCreate('')">
        {{ t("aiObservability.experiments.newButton") }}
      </OButton>
    </template>

    <div class="grid min-h-0 gap-4 p-4" :class="showCreate ? 'lg:grid-cols-[1fr_26rem]' : ''">
      <section class="min-w-0 space-y-3">
        <div
          v-if="loading"
          class="border-border-default text-text-secondary rounded-default border p-6 text-center"
        >
          {{ t("common.loading") }}
        </div>
        <div
          v-else-if="!experiments.length"
          class="border-border-default text-text-secondary rounded-default border border-dashed p-8 text-center"
        >
          {{ t("aiObservability.experiments.empty") }}
        </div>
        <ExperimentBrowser
          v-else
          :org-id="orgId"
          :experiments="experiments"
          :datasets="datasets"
          :details="experimentDetails"
          sync-url
          @select="loadDetail"
          @new="openCreate"
        />

        <div
          v-if="comparisonLoading"
          class="border-border-default text-text-secondary rounded-default border p-4 text-center"
          data-test="ai-experiment-comparison-loading"
        >
          {{ raw("Loading comparison…") }}
        </div>
        <ExperimentComparisonPanel
          v-else-if="comparison"
          :comparison="comparison"
          @apply-threshold="applyComparisonThreshold"
          @inspect="inspectComparisonRow"
        />

        <div
          v-if="selectedDetail"
          class="border-border-default bg-card-glass-bg rounded-default border p-4"
          data-test="ai-experiment-detail-preview"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-text-primary font-medium">{{ selectedDetail.experiment.name }}</h3>
            <OButton
              v-if="selectedDetail.experiment.status === 'running'"
              size="sm"
              variant="outline"
              :disabled="controllingExperiment"
              data-test="ai-experiment-cancel"
              @click="cancelSelectedExperiment"
            >
              {{ t("aiObservability.experiments.cancel") }}
            </OButton>
            <OButton
              v-else-if="selectedDetail.experiment.status === 'failed'"
              size="sm"
              variant="primary"
              :disabled="controllingExperiment"
              data-test="ai-experiment-retry"
              @click="retrySelectedExperiment"
            >
              {{ t("aiObservability.experiments.retry") }}
            </OButton>
            <OButton
              v-else-if="selectedDetail.experiment.status === 'cancelled'"
              size="sm"
              variant="primary"
              :disabled="controllingExperiment"
              data-test="ai-experiment-clone"
              @click="cloneSelectedExperiment"
            >
              {{ t("aiObservability.experiments.clone") }}
            </OButton>
          </div>
          <p class="text-text-secondary mt-1 text-sm">
            {{
              t("aiObservability.experiments.previewCounts", {
                rows: selectedDetail.preview.rowCount,
                trials: selectedDetail.preview.trialCount,
                slots: selectedDetail.preview.slotCount,
              })
            }}
          </p>
          <p class="text-text-secondary mt-2 text-xs">
            {{ t("aiObservability.experiments.immutableHint") }}
          </p>
          <div
            v-if="selectedDetail.results.taskProgress"
            class="text-text-secondary mt-3 flex flex-wrap gap-3 text-xs"
            data-test="ai-experiment-progress-summary"
          >
            <span>
              {{
                t("aiObservability.experiments.taskProgress", selectedDetail.results.taskProgress)
              }}
              <progress
                class="ml-2"
                :value="selectedDetail.results.taskProgress.completed"
                :max="Math.max(1, selectedDetail.results.taskProgress.total)"
                data-test="ai-experiment-task-progress"
              />
            </span>
            <span v-if="selectedDetail.results.scoringProgress">
              {{
                t(
                  "aiObservability.experiments.scoringProgress",
                  selectedDetail.results.scoringProgress,
                )
              }}
              <progress
                class="ml-2"
                :value="selectedDetail.results.scoringProgress.completed"
                :max="Math.max(1, selectedDetail.results.scoringProgress.total)"
                data-test="ai-experiment-scoring-progress"
              />
            </span>
          </div>
          <div
            v-if="selectedDetail.results.aggregateSummary"
            class="text-text-secondary mt-2 flex flex-wrap gap-3 text-xs"
            data-test="ai-experiment-aggregate-summary"
          >
            <span>{{
              aggregateLatencyLabel(selectedDetail.results.aggregateSummary.p50LatencyMs)
            }}</span>
            <span>{{ aggregateCostLabel(selectedDetail.results.aggregateSummary.totalCost) }}</span>
            <span v-if="selectedDetail.results.aggregateSummary.incomplete">{{
              raw("Incomplete")
            }}</span>
          </div>
          <div v-if="pendingDetail" class="mt-3" data-test="ai-experiment-new-results-banner">
            <OButton size="sm" variant="outline" @click="acceptNewResults">
              {{ raw("Show new results") }}
            </OButton>
          </div>
          <div
            v-if="selectedDetail.results.slots?.length || selectedDetail.results.executions.length"
            class="mt-4 space-y-3"
            data-test="ai-experiment-results"
          >
            <div class="flex flex-wrap gap-2" data-test="ai-experiment-status-filters">
              <OButton
                v-for="filter in resultStatusFilters"
                :key="filter"
                size="sm"
                :variant="resultStatusFilter === filter ? 'primary' : 'outline'"
                @click="resultStatusFilter = filter"
              >
                {{ raw(filter) }}
              </OButton>
            </div>
            <div
              v-for="slot in filteredResultSlots"
              :key="`${slot.rowId}:${slot.trialIndex}`"
              class="border-border-default bg-code-bg rounded-default border p-3"
              data-test="ai-experiment-result-slot"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-text-primary text-sm font-medium">
                  {{ slot.logicalId }} ·
                  {{ t("aiObservability.experiments.trial", { index: slot.trialIndex + 1 }) }}
                </span>
                <div class="flex items-center gap-2">
                  <OTag size="sm">{{ slotStatusLabel(slot) }}</OTag>
                  <OButton
                    size="sm"
                    variant="outline"
                    data-test="ai-experiment-inspect-row"
                    @click="openRowDetail(slot.rowId)"
                  >
                    {{ raw("Inspect row") }}
                  </OButton>
                </div>
              </div>
              <pre
                v-if="slot.execution?.output !== null && slot.execution?.output !== undefined"
                class="text-text-primary mt-2 text-xs whitespace-pre-wrap"
                data-test="ai-experiment-output"
                >{{ formatValue(slot.execution.output) }}</pre>
              <p v-if="slot.execution?.errorMessage" class="text-negative mt-2 text-xs">
                {{ slot.execution.errorMessage }}
              </p>
              <OButton
                v-if="slot.execution?.traceId"
                class="mt-2"
                size="sm"
                variant="outline"
                data-test="ai-experiment-trace-link"
                @click="openTrace(slot.execution)"
              >
                {{ t("aiObservability.experiments.viewTrace") }}
              </OButton>
              <ul class="text-text-secondary mt-2 space-y-1 text-xs">
                <li v-for="score in slot.scores" :key="`${score.scorerId}:${score.scorerVersion}`">
                  {{ resultScoreLabel(score.scorerId, score.scorerVersion, score.status) }}
                  <span v-if="score.score"> · {{ scoreLabel(score.score) }}</span>
                </li>
              </ul>
            </div>
            <div
              v-if="selectedDetail.results.pagination"
              class="flex items-center gap-2"
              data-test="ai-experiment-result-pagination"
            >
              <OButton
                size="sm"
                variant="outline"
                :disabled="currentResultPage <= 1"
                @click="loadResultPage(currentResultPage - 1)"
                >{{ raw("Previous") }}</OButton
              >
              <span class="text-text-secondary text-xs">{{
                resultPageLabel(currentResultPage)
              }}</span>
              <OButton
                size="sm"
                variant="outline"
                :disabled="!selectedDetail.results.pagination.hasMore"
                @click="loadResultPage(currentResultPage + 1)"
                >{{ raw("Next") }}</OButton
              >
            </div>
            <ul
              v-if="selectedDetail.results.scoreSummaries?.length"
              class="text-text-secondary space-y-1 text-xs"
              data-test="ai-experiment-score-summaries"
            >
              <li
                v-for="summary in selectedDetail.results.scoreSummaries"
                :key="`${summary.scorerId}:${summary.scorerVersion}`"
              >
                {{
                  t("aiObservability.experiments.scoreEvidence", {
                    scorer: summary.scorerId,
                    version: summary.scorerVersion,
                    samples: summary.sampleCount,
                    noReference: summary.noReferenceCount,
                    noTrace: summary.noTraceCount,
                  })
                }}
                <span v-if="summary.value"> · {{ formatValue(summary.value) }}</span>
                <span v-if="summary.pendingCount">{{
                  summaryCountLabel(summary.pendingCount, "pending")
                }}</span>
                <span v-if="summary.errorCount">{{
                  summaryCountLabel(summary.errorCount, "errors")
                }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <aside
        v-if="showCreate"
        class="border-border-default bg-card-glass-bg rounded-default h-fit space-y-4 border p-4"
        data-test="ai-experiment-create"
      >
        <div>
          <h2 class="text-text-primary font-medium">
            {{ t("aiObservability.experiments.createTitle") }}
          </h2>
          <p class="text-text-secondary mt-1 text-xs">
            {{ t("aiObservability.experiments.immutableHint") }}
          </p>
        </div>

        <OInput v-model="draft.name" :label="t('aiObservability.experiments.name')" />
        <OSelect
          v-model="draft.datasetId"
          :label="t('aiObservability.experiments.dataset')"
          :options="datasetOptions"
          searchable
        />
        <OSelect
          v-model="draft.scorerIds"
          :label="t('aiObservability.experiments.scorers')"
          :options="scorerOptions"
          multiple
          searchable
        />
        <OInput v-model="draft.providerId" :label="t('aiObservability.experiments.provider')" />
        <OInput v-model="draft.model" :label="t('aiObservability.experiments.model')" />
        <OTextarea
          v-model="draft.prompt"
          :label="t('aiObservability.experiments.prompt')"
          :rows="5"
        />
        <OInput
          v-model="draft.trialCount"
          type="number"
          min="1"
          max="100"
          :label="t('aiObservability.experiments.trials')"
        />

        <div
          v-if="preview"
          class="border-border-default bg-code-bg rounded-default border p-3 text-sm"
          data-test="ai-experiment-slot-preview"
        >
          <div class="text-text-primary font-medium">
            {{
              t("aiObservability.experiments.previewCounts", {
                rows: preview.rowCount,
                trials: preview.trialCount,
                slots: preview.slotCount,
              })
            }}
          </div>
          <div
            v-if="preview.applicability"
            class="text-text-secondary mt-2 text-xs"
            data-test="ai-experiment-applicability"
          >
            {{
              t("aiObservability.experiments.skipTiers", {
                full: preview.applicability.fullySkippedRowCount,
                partial: preview.applicability.partiallySkippedRowCount,
              })
            }}
            <ul class="mt-1 space-y-1">
              <li
                v-for="scorer in preview.applicability.scorerApplicability"
                :key="`${scorer.scorerId}:${scorer.scorerVersion}`"
              >
                {{
                  t("aiObservability.experiments.scorerApplicability", {
                    scorer: scorer.scorerId,
                    version: scorer.scorerVersion,
                    eligible: scorer.eligibleSlotCount,
                    noReference: scorer.noReferenceSlotCount,
                  })
                }}
              </li>
            </ul>
          </div>
          <ul class="text-text-secondary mt-2 space-y-1 text-xs">
            <li v-for="slot in preview.sampleSlots" :key="`${slot.rowId}:${slot.trialIndex}`">
              {{ slot.logicalId }} ·
              {{ t("aiObservability.experiments.trial", { index: slot.trialIndex + 1 }) }}
            </li>
          </ul>
        </div>

        <div class="flex justify-end gap-2">
          <OButton variant="outline" :loading="previewing" @click="previewDraft">
            {{ t("aiObservability.experiments.preview") }}
          </OButton>
          <OButton variant="primary" :disabled="!preview" :loading="creating" @click="createDraft">
            {{ t("aiObservability.experiments.create") }}
          </OButton>
        </div>
      </aside>
    </div>

    <ExperimentRowDetailDrawer
      :open="rowDrawerOpen"
      :detail="selectedRowDetail"
      :retrying="retryingRow"
      @update:open="rowDrawerOpen = $event"
      @navigate="loadRowDetail"
      @retry="retryRowSlot"
      @trace="openTrace"
    />
    <ExperimentComparisonRowDrawer
      :open="comparisonRowDrawerOpen"
      :row="selectedComparisonRow"
      :baseline-id="comparison?.baselineId ?? ''"
      :candidate-id="comparison?.candidateId ?? ''"
      :baseline="baselineComparisonRow"
      :candidate="candidateComparisonRow"
      @update:open="comparisonRowDrawerOpen = $event"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ExperimentBrowser from "@/enterprise/components/AIObservability/ExperimentBrowser.vue";
import ExperimentComparisonPanel from "@/enterprise/components/AIObservability/ExperimentComparisonPanel.vue";
import ExperimentComparisonRowDrawer from "@/enterprise/components/AIObservability/ExperimentComparisonRowDrawer.vue";
import ExperimentRowDetailDrawer from "@/enterprise/components/AIObservability/ExperimentRowDetailDrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import onlineEvalsService, { type Scorer } from "@/services/online-evals.service";
import llmExperimentsService, {
  type ExperimentCreatePayload,
  type ExperimentComparison,
  type ExperimentComparisonRow,
  type ExperimentDetail,
  type ExperimentExecution,
  type ExperimentPreview,
  type ExperimentResultSlot,
  type ExperimentRowDetail,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { createPreviewRequestGate, withPreviewScorers } from "./experimentPreview";
import { fetchExperimentDetails } from "./experimentDiscovery";
import {
  createExperimentLifecycleActions,
  type ExperimentLifecycleAction,
} from "./experimentLifecycleActions";
import {
  experimentResultSlotStatus,
  filterExperimentResultSlots,
  openExperimentTrace,
  type ExperimentResultStatusFilter,
} from "./experimentResults";

defineOptions({ name: "AIExperimentsPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experiments = ref<LlmExperiment[]>([]);
const experimentDetails = ref<Record<string, ExperimentDetail>>({});
const datasets = ref<LlmDataset[]>([]);
const scorers = ref<Scorer[]>([]);
const loading = ref(false);
const previewing = ref(false);
const creating = ref(false);
const controllingExperiment = ref(false);
const showCreate = ref(false);
const preview = ref<ExperimentPreview | null>(null);
const selectedDetail = ref<ExperimentDetail | null>(null);
const pendingDetail = ref<ExperimentDetail | null>(null);
const currentResultPage = ref(1);
const resultStatusFilter = ref<ExperimentResultStatusFilter>("all");
const rowDrawerOpen = ref(false);
const selectedRowDetail = ref<ExperimentRowDetail | null>(null);
const retryingRow = ref(false);
const comparison = ref<ExperimentComparison | null>(null);
const comparisonLoading = ref(false);
const comparisonThreshold = ref(0);
const comparisonRowDrawerOpen = ref(false);
const selectedComparisonRow = ref<ExperimentComparisonRow | null>(null);
const baselineComparisonRow = ref<ExperimentRowDetail | null>(null);
const candidateComparisonRow = ref<ExperimentRowDetail | null>(null);
const resultStatusFilters = ["all", "ok", "no_reference", "no_trace", "error"] as const;
const completedScorePolls = ref(0);
const MAX_COMPLETED_SCORE_POLLS = 12;
const nextIdempotencyKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
const idempotencyKey = ref(nextIdempotencyKey());
const previewRequests = createPreviewRequestGate();
const draft = reactive({
  name: "",
  datasetId: "",
  scorerIds: [] as string[],
  providerId: "",
  model: "",
  prompt: "{{ input }}",
  trialCount: "1",
});

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);
const scorerOptions = computed(() =>
  scorers.value.map((scorer) => ({
    label: raw(`${scorer.name} · v${scorer.version}`),
    value: scorer.entityId ?? scorer.entity_id ?? scorer.id,
  })),
);

watch(
  draft,
  () => {
    previewRequests.invalidate();
    preview.value = null;
    previewing.value = false;
  },
  { deep: true, flush: "sync" },
);

function payload(): ExperimentCreatePayload {
  const dataset = datasets.value.find((candidate) => candidate.id === draft.datasetId);
  return {
    name: draft.name.trim(),
    datasetId: draft.datasetId,
    datasetVersion: dataset?.globalVersion ?? 0,
    task: {
      type: "inline_prompt",
      messages: [{ role: "user", content: draft.prompt }],
      providerId: draft.providerId.trim(),
      model: draft.model.trim() || null,
    },
    scorers: draft.scorerIds.map((id) => ({ id })),
    trialCount: Number(draft.trialCount),
    idempotencyKey: idempotencyKey.value,
  };
}

async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    [experiments.value, datasets.value, scorers.value] = await Promise.all([
      llmExperimentsService.list(orgId.value),
      llmDatasetsService.list(orgId.value),
      onlineEvalsService.scorers.list(orgId.value),
    ]);
    experimentDetails.value = await fetchExperimentDetails(experiments.value, (experimentId) =>
      llmExperimentsService.get(orgId.value, experimentId),
    );
    await selectDetailFromRoute();
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  } finally {
    loading.value = false;
  }
}

function openCreate(datasetId: string) {
  const selectedDatasetId = datasetId || String(route.query.dataset ?? "");
  if (datasets.value.some((dataset) => dataset.id === selectedDatasetId))
    draft.datasetId = selectedDatasetId;
  showCreate.value = true;
}

async function previewDraft() {
  const request = previewRequests.start();
  previewing.value = true;
  try {
    const result = await llmExperimentsService.preview(orgId.value, payload());
    if (previewRequests.isCurrent(request)) preview.value = result;
  } catch (error) {
    if (previewRequests.isCurrent(request)) {
      toast({
        variant: "error",
        message:
          error instanceof Error
            ? raw(error.message)
            : t("aiObservability.experiments.previewError"),
      });
    }
  } finally {
    if (previewRequests.isCurrent(request)) previewing.value = false;
  }
}

async function createDraft() {
  const currentPreview = preview.value;
  if (!currentPreview) return;
  creating.value = true;
  try {
    const result = await llmExperimentsService.create(
      orgId.value,
      withPreviewScorers(payload(), currentPreview),
    );
    experiments.value = [result.experiment, ...experiments.value];
    experimentDetails.value = { ...experimentDetails.value, [result.experiment.id]: result };
    selectedDetail.value = result;
    completedScorePolls.value = 0;
    idempotencyKey.value = nextIdempotencyKey();
    showCreate.value = false;
    toast({ variant: "success", message: t("aiObservability.experiments.createSuccess") });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.createError") });
  } finally {
    creating.value = false;
  }
}

async function loadDetail(experimentId: string, syncUrl = true) {
  try {
    selectedDetail.value = await llmExperimentsService.get(orgId.value, experimentId, {
      resultPage: currentResultPage.value,
    });
    experimentDetails.value = { ...experimentDetails.value, [experimentId]: selectedDetail.value };
    if (syncUrl && String(route.query.selected ?? "") !== experimentId) {
      router.push({ query: { ...route.query, selected: experimentId } });
    }
    completedScorePolls.value = 0;
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  }
}

const resultSlots = computed<ExperimentResultSlot[]>(() => {
  const slots = selectedDetail.value?.results.slots;
  if (slots?.length) return slots;
  return (selectedDetail.value?.results.executions ?? []).map((execution) => ({
    rowId: execution.rowId,
    logicalId: execution.itemLogicalId,
    trialIndex: execution.trialIndex,
    input: null,
    expectedOutput: null,
    taskStatus: execution.status === "pending" ? "in_progress" : execution.status,
    execution,
    scores: [],
  }));
});

function slotStatusLabel(slot: ExperimentResultSlot) {
  return experimentResultSlotStatus(slot);
}

const filteredResultSlots = computed(() =>
  filterExperimentResultSlots(resultSlots.value, resultStatusFilter.value),
);

async function loadResultPage(page: number) {
  const detail = selectedDetail.value;
  if (!detail || page < 1) return;
  currentResultPage.value = page;
  pendingDetail.value = null;
  await loadDetail(detail.experiment.id, false);
}

async function loadRowDetail(rowId: string) {
  const detail = selectedDetail.value;
  if (!detail) return;
  try {
    selectedRowDetail.value = await llmExperimentsService.getRow(
      orgId.value,
      detail.experiment.id,
      rowId,
    );
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  }
}

async function openRowDetail(rowId: string) {
  rowDrawerOpen.value = true;
  selectedRowDetail.value = null;
  await loadRowDetail(rowId);
}

async function retryRowSlot(slot: ExperimentResultSlot) {
  const detail = selectedDetail.value;
  if (!detail || slot.taskStatus !== "error") return;
  retryingRow.value = true;
  try {
    await llmExperimentsService.retrySlot(
      orgId.value,
      detail.experiment.id,
      slot.rowId,
      slot.trialIndex,
      globalThis.crypto.randomUUID(),
    );
    await loadRowDetail(slot.rowId);
    await loadDetail(detail.experiment.id, false);
    toast({ variant: "success", message: t("aiObservability.experiments.retrySuccess") });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.retryError") });
  } finally {
    retryingRow.value = false;
  }
}

function resultEvidenceKeys(detail: ExperimentDetail) {
  return new Set(
    detail.results.executions.map((row) => `${row.rowId}:${row.trialIndex}:${row.timestamp}`),
  );
}

function acceptNewResults() {
  if (!pendingDetail.value) return;
  selectedDetail.value = pendingDetail.value;
  experimentDetails.value = {
    ...experimentDetails.value,
    [pendingDetail.value.experiment.id]: pendingDetail.value,
  };
  pendingDetail.value = null;
}

function applyLifecycleUpdate(experiment: LlmExperiment) {
  experiments.value = experiments.value.map((candidate) =>
    candidate.id === experiment.id ? experiment : candidate,
  );
  const detail = selectedDetail.value;
  if (!detail || detail.experiment.id !== experiment.id) return;
  const updated = { ...detail, experiment };
  selectedDetail.value = updated;
  experimentDetails.value = { ...experimentDetails.value, [experiment.id]: updated };
}

const lifecycleActions = createExperimentLifecycleActions({
  current: () => selectedDetail.value?.experiment,
  busy: () => controllingExperiment.value,
  setBusy: (busy) => (controllingExperiment.value = busy),
  execute: (action, experiment) => {
    if (action === "cancel") return llmExperimentsService.cancel(orgId.value, experiment.id);
    if (action === "retry") return llmExperimentsService.retry(orgId.value, experiment.id);
    return llmExperimentsService.clone(orgId.value, experiment.id);
  },
  apply: async (action, experiment) => {
    if (action !== "clone") {
      applyLifecycleUpdate(experiment);
      return;
    }
    experiments.value = [experiment, ...experiments.value];
    await loadDetail(experiment.id);
  },
  notify: (action: ExperimentLifecycleAction, success) => {
    toast({
      variant: success ? "success" : "error",
      message: t(`aiObservability.experiments.${action}${success ? "Success" : "Error"}`),
    });
  },
});

const cancelSelectedExperiment = lifecycleActions.cancel;
const retrySelectedExperiment = lifecycleActions.retry;
const cloneSelectedExperiment = lifecycleActions.clone;

async function selectDetailFromRoute() {
  const experimentId = String(route.query.selected ?? "");
  if (!experimentId) {
    selectedDetail.value = null;
    return;
  }
  const cached = experimentDetails.value[experimentId];
  if (cached) {
    selectedDetail.value = cached;
    completedScorePolls.value = 0;
    return;
  }
  if (orgId.value) await loadDetail(experimentId, false);
}

watch(() => route.query.selected, selectDetailFromRoute);

async function loadComparison(threshold = comparisonThreshold.value) {
  const baselineId = String(route.query.baseline ?? "");
  const candidateId = String(route.query.candidate ?? "");
  if (!orgId.value || !baselineId || !candidateId) {
    comparison.value = null;
    return;
  }
  comparisonLoading.value = true;
  try {
    comparison.value = await llmExperimentsService.compare(
      orgId.value,
      baselineId,
      candidateId,
      threshold,
    );
    comparisonThreshold.value = comparison.value.threshold;
  } catch {
    comparison.value = null;
    toast({ variant: "error", message: raw("Failed to compare Experiments") });
  } finally {
    comparisonLoading.value = false;
  }
}

function applyComparisonThreshold(threshold: number) {
  comparisonThreshold.value = threshold;
  void loadComparison(threshold);
}

async function inspectComparisonRow(row: ExperimentComparisonRow) {
  const current = comparison.value;
  if (!current) return;
  selectedComparisonRow.value = row;
  baselineComparisonRow.value = null;
  candidateComparisonRow.value = null;
  comparisonRowDrawerOpen.value = true;
  try {
    const [baseline, candidate] = await Promise.all([
      row.baselineRowId
        ? llmExperimentsService.getRow(orgId.value, current.baselineId, row.baselineRowId)
        : Promise.resolve(null),
      row.candidateRowId
        ? llmExperimentsService.getRow(orgId.value, current.candidateId, row.candidateRowId)
        : Promise.resolve(null),
    ]);
    baselineComparisonRow.value = baseline;
    candidateComparisonRow.value = candidate;
  } catch {
    toast({ variant: "error", message: raw("Failed to load comparison row") });
  }
}

watch(
  [() => route.query.baseline, () => route.query.candidate, orgId],
  () => {
    comparisonThreshold.value = 0;
    void loadComparison(0);
  },
  { immediate: true },
);

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function aggregateLatencyLabel(value: number | null) {
  return raw(`P50 ${value ?? "—"} ms`);
}

function aggregateCostLabel(value: number) {
  return raw(`$${value.toFixed(4)}`);
}

function resultScoreLabel(scorerId: string, scorerVersion: number, status: string) {
  return raw(`${scorerId} · v${scorerVersion}: ${status}`);
}

function resultPageLabel(page: number) {
  return raw(`Page ${page}`);
}

function summaryCountLabel(count: number, label: string) {
  return raw(` · ${count} ${label}`);
}

function scoreLabel(score: Record<string, unknown>) {
  const name = String(score.name ?? "score");
  const status = String(score.status ?? "success");
  if (status === "skipped") {
    const reason = String(score.skip_reason ?? score.skipReason ?? "unknown");
    return `${name}: ${status} (${reason})`;
  }
  const value = score.value_numeric ?? score.value_categorical ?? score.value_boolean ?? "—";
  return `${name}: ${String(value)}`;
}

function openTrace(execution: ExperimentExecution) {
  openExperimentTrace(
    orgId.value,
    execution,
    (location) => router.resolve(location),
    globalThis.open,
  );
}

const detailPoller = globalThis.setInterval(async () => {
  const detail = selectedDetail.value;
  const scoredScorers = new Set(
    detail?.results.scores.map((score) => String(score.scorer_id ?? score.scorerId ?? "")) ?? [],
  );
  const waitingForScores =
    detail?.experiment.status === "completed" &&
    completedScorePolls.value < MAX_COMPLETED_SCORE_POLLS &&
    detail.experiment.scorers.some((scorer) => !scoredScorers.has(scorer.id));
  if (!detail || (!["running", "pending"].includes(detail.experiment.status) && !waitingForScores))
    return;
  if (detail.experiment.status === "completed") completedScorePolls.value += 1;
  try {
    const refreshedDetail = await llmExperimentsService.get(orgId.value, detail.experiment.id, {
      resultPage: currentResultPage.value,
    });
    const visibleEvidence = resultEvidenceKeys(detail);
    const hasNewEvidence = [...resultEvidenceKeys(refreshedDetail)].some(
      (key) => !visibleEvidence.has(key),
    );
    if (hasNewEvidence) {
      pendingDetail.value = refreshedDetail;
      selectedDetail.value = {
        ...detail,
        experiment: refreshedDetail.experiment,
        results: {
          ...detail.results,
          taskProgress: refreshedDetail.results.taskProgress,
          scoringProgress: refreshedDetail.results.scoringProgress,
          skipSummary: refreshedDetail.results.skipSummary,
          scoreSummaries: refreshedDetail.results.scoreSummaries,
          aggregateSummary: refreshedDetail.results.aggregateSummary,
        },
      };
      return;
    }
    selectedDetail.value = refreshedDetail;
    experimentDetails.value = {
      ...experimentDetails.value,
      [detail.experiment.id]: selectedDetail.value,
    };
    const refreshed = selectedDetail.value.experiment;
    experiments.value = experiments.value.map((experiment) =>
      experiment.id === refreshed.id ? refreshed : experiment,
    );
  } catch {
    // The next poll or a manual selection retries without producing toast noise.
  }
}, 5_000);

onMounted(refresh);
onUnmounted(() => globalThis.clearInterval(detailPoller));
</script>
