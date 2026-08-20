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
      <OButton
        size="sm"
        variant="primary"
        data-test="ai-experiments-new-btn"
        @click="openCreate('')"
      >
        {{ t("aiObservability.experiments.newButton") }}
      </OButton>
    </template>

    <div class="grid min-h-0 gap-4 p-4">
      <section class="min-w-0 space-y-3">
        <div
          v-if="loading"
          class="border-border-default text-text-secondary rounded-default border p-6 text-center"
        >
          {{ t("common.loading") }}
        </div>
        <OEmptyState
          v-else-if="!experiments.length"
          size="hero"
          preset="no-experiments"
          data-test="ai-experiments-empty"
          @action="openCreate('')"
        />
        <ExperimentBrowser
          v-else
          :org-id="orgId"
          :experiments="experiments"
          :datasets="datasets"
          :details="experimentDetails"
          @new="openCreate"
          @select="openExperiment"
          sync-url
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
      </section>
    </div>

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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ExperimentBrowser from "@/enterprise/components/AIObservability/ExperimentBrowser.vue";
import ExperimentComparisonPanel from "@/enterprise/components/AIObservability/ExperimentComparisonPanel.vue";
import ExperimentComparisonRowDrawer from "@/enterprise/components/AIObservability/ExperimentComparisonRowDrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import llmExperimentsService, {
  type ExperimentComparison,
  type ExperimentComparisonRow,
  type ExperimentDetail,
  type ExperimentRowDetail,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { fetchExperimentDetails } from "./experimentDiscovery";
import { aiExperimentCreateRoute, aiExperimentDetailRoute } from "./experimentRoutes";
import {} from "./experimentLifecycleActions";

defineOptions({ name: "AIExperimentsPage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experiments = ref<LlmExperiment[]>([]);
const experimentDetails = ref<Record<string, ExperimentDetail>>({});
const datasets = ref<LlmDataset[]>([]);
const loading = ref(false);
const comparison = ref<ExperimentComparison | null>(null);
const comparisonLoading = ref(false);
const comparisonThreshold = ref(0);
const comparisonRowDrawerOpen = ref(false);
const selectedComparisonRow = ref<ExperimentComparisonRow | null>(null);
const baselineComparisonRow = ref<ExperimentRowDetail | null>(null);
const candidateComparisonRow = ref<ExperimentRowDetail | null>(null);
async function refresh() {
  if (!orgId.value) return;
  loading.value = true;
  try {
    [experiments.value, datasets.value] = await Promise.all([
      llmExperimentsService.list(orgId.value),
      llmDatasetsService.list(orgId.value),
    ]);
    experimentDetails.value = await fetchExperimentDetails(experiments.value, (experimentId) =>
      llmExperimentsService.get(orgId.value, experimentId),
    );
  } catch (error: any) {
    // Surface the server's message; a bare catch here hid a stale ?selected=
    // 404 behind "failed to load experiments" while the list rendered fine.
    toast({
      variant: "error",
      message: raw(error?.response?.data?.message) || t("aiObservability.experiments.loadError"),
    });
  } finally {
    loading.value = false;
  }
}

function openExperiment(experimentId: string) {
  router.push(aiExperimentDetailRoute(orgId.value, experimentId));
}

function openCreate(datasetId: string) {
  const selectedDatasetId = datasetId || String(route.query.dataset ?? "");
  const known = datasets.value.some((dataset) => dataset.id === selectedDatasetId);
  router.push(
    aiExperimentCreateRoute(orgId.value, { datasetId: known ? selectedDatasetId : undefined }),
  );
}

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

onMounted(refresh);
</script>
