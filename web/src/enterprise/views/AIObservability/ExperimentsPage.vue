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
            </span>
            <span v-if="selectedDetail.results.scoringProgress">
              {{
                t(
                  "aiObservability.experiments.scoringProgress",
                  selectedDetail.results.scoringProgress,
                )
              }}
            </span>
          </div>
          <div
            v-if="selectedDetail.results.executions.length"
            class="mt-4 space-y-3"
            data-test="ai-experiment-results"
          >
            <div
              v-for="execution in selectedDetail.results.executions"
              :key="`${execution.rowId}:${execution.trialIndex}`"
              class="border-border-default bg-code-bg rounded-default border p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-text-primary text-sm font-medium">
                  {{ execution.itemLogicalId }} ·
                  {{ t("aiObservability.experiments.trial", { index: execution.trialIndex + 1 }) }}
                </span>
                <OTag size="sm">
                  {{ execution.skipReason ?? execution.status }}
                </OTag>
              </div>
              <pre
                v-if="execution.output !== null"
                class="text-text-primary mt-2 text-xs whitespace-pre-wrap"
                data-test="ai-experiment-output"
                >{{ formatValue(execution.output) }}</pre>
              <p v-if="execution.errorMessage" class="text-negative mt-2 text-xs">
                {{ execution.errorMessage }}
              </p>
              <OButton
                v-if="execution.traceId"
                class="mt-2"
                size="sm"
                variant="outline"
                data-test="ai-experiment-trace-link"
                @click="openTrace(execution)"
              >
                {{ t("aiObservability.experiments.viewTrace") }}
              </OButton>
            </div>
            <div v-if="selectedDetail.results.scores.length" data-test="ai-experiment-scores">
              <h4 class="text-text-primary text-sm font-medium">
                {{ t("aiObservability.experiments.scoresTitle") }}
              </h4>
              <ul class="mt-2 space-y-1 text-xs">
                <li
                  v-for="(score, index) in selectedDetail.results.scores"
                  :key="String(score.id ?? index)"
                >
                  {{ scoreLabel(score) }}
                </li>
              </ul>
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
                    skipped: summary.skippedCount,
                  })
                }}
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
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import onlineEvalsService, { type Scorer } from "@/services/online-evals.service";
import llmExperimentsService, {
  type ExperimentCreatePayload,
  type ExperimentDetail,
  type ExperimentExecution,
  type ExperimentPreview,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { createPreviewRequestGate, withPreviewScorers } from "./experimentPreview";
import { fetchExperimentDetails } from "./experimentDiscovery";

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
    selectedDetail.value = await llmExperimentsService.get(orgId.value, experimentId);
    experimentDetails.value = { ...experimentDetails.value, [experimentId]: selectedDetail.value };
    if (syncUrl && String(route.query.selected ?? "") !== experimentId) {
      router.push({ query: { ...route.query, selected: experimentId } });
    }
    completedScorePolls.value = 0;
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  }
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

async function cancelSelectedExperiment() {
  const experiment = selectedDetail.value?.experiment;
  if (!experiment || experiment.status !== "running" || controllingExperiment.value) return;
  controllingExperiment.value = true;
  try {
    applyLifecycleUpdate(await llmExperimentsService.cancel(orgId.value, experiment.id));
    toast({ variant: "success", message: t("aiObservability.experiments.cancelSuccess") });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.cancelError") });
  } finally {
    controllingExperiment.value = false;
  }
}

async function retrySelectedExperiment() {
  const experiment = selectedDetail.value?.experiment;
  if (!experiment || experiment.status !== "failed" || controllingExperiment.value) return;
  controllingExperiment.value = true;
  try {
    applyLifecycleUpdate(await llmExperimentsService.retry(orgId.value, experiment.id));
    toast({ variant: "success", message: t("aiObservability.experiments.retrySuccess") });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.retryError") });
  } finally {
    controllingExperiment.value = false;
  }
}

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

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function scoreLabel(score: Record<string, unknown>) {
  const name = String(score.name ?? "score");
  const value = score.value_numeric ?? score.value_categorical ?? score.value_boolean ?? "—";
  return `${name}: ${String(value)}`;
}

function openTrace(execution: ExperimentExecution) {
  if (!execution.traceId) return;
  const padding = 3_600_000_000;
  router.push({
    name: "traceDetails",
    query: {
      org_identifier: orgId.value,
      stream: "_evaluator",
      from: Math.max(0, execution.timestamp - padding),
      to: execution.timestamp + padding,
      trace_id: execution.traceId,
    },
  });
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
    selectedDetail.value = await llmExperimentsService.get(orgId.value, detail.experiment.id);
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
