<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OPageLayout
    data-test="ai-experiments-page"
    :title="t('aiObservability.nav.experiments')"
    :subtitle="t('aiObservability.subtitle.experiments')"
    icon="science"
    bleed
  >
    <template #actions>
      <OButton size="sm" variant="primary" @click="showCreate = !showCreate">
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
        <button
          v-for="experiment in experiments"
          :key="experiment.id"
          type="button"
          class="border-border-default bg-card-glass-bg hover:border-primary rounded-default block w-full border p-4 text-left"
          @click="loadDetail(experiment.id)"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-text-primary font-medium">{{ experiment.name }}</div>
              <div class="text-text-secondary mt-1 text-xs">
                {{
                  t("aiObservability.experiments.summary", {
                    version: experiment.datasetVersion,
                    trials: experiment.trialCount,
                    scorers: experiment.scorers.length,
                  })
                }}
              </div>
            </div>
            <OTag size="sm">{{ experiment.status }}</OTag>
          </div>
        </button>

        <div
          v-if="selectedDetail"
          class="border-border-default bg-card-glass-bg rounded-default border p-4"
          data-test="ai-experiment-detail-preview"
        >
          <h3 class="text-text-primary font-medium">{{ selectedDetail.experiment.name }}</h3>
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
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import onlineEvalsService, { type Scorer } from "@/services/online-evals.service";
import llmExperimentsService, {
  type ExperimentCreatePayload,
  type ExperimentDetail,
  type ExperimentPreview,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { createPreviewRequestGate, withPreviewScorers } from "./experimentPreview";

defineOptions({ name: "AIExperimentsPage" });

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experiments = ref<LlmExperiment[]>([]);
const datasets = ref<LlmDataset[]>([]);
const scorers = ref<Scorer[]>([]);
const loading = ref(false);
const previewing = ref(false);
const creating = ref(false);
const showCreate = ref(false);
const preview = ref<ExperimentPreview | null>(null);
const selectedDetail = ref<ExperimentDetail | null>(null);
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
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  } finally {
    loading.value = false;
  }
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
    selectedDetail.value = result;
    idempotencyKey.value = nextIdempotencyKey();
    showCreate.value = false;
    toast({ variant: "success", message: t("aiObservability.experiments.createSuccess") });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.createError") });
  } finally {
    creating.value = false;
  }
}

async function loadDetail(experimentId: string) {
  try {
    selectedDetail.value = await llmExperimentsService.get(orgId.value, experimentId);
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.loadError") });
  }
}

onMounted(refresh);
</script>
