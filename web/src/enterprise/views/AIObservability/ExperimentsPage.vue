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
        <OEmptyState
          v-if="!loading && !experiments.length"
          size="hero"
          preset="no-experiments"
          data-test="ai-experiments-empty"
          @action="openCreate('')"
        />
        <ExperimentBrowser
          v-else
          :org-id="orgId"
          :loading="loading"
          :experiments="experiments"
          :datasets="datasets"
          :details="experimentDetails"
          @new="openCreate"
          @refresh="refresh"
          @select="openExperiment"
          sync-url
        />
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ExperimentBrowser from "@/enterprise/components/AIObservability/ExperimentBrowser.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import llmExperimentsService, {
  type ExperimentDetail,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { fetchExperimentDetails } from "./experimentDiscovery";
import { aiExperimentCreateRoute, aiExperimentDetailRoute } from "./experimentRoutes";

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

onMounted(refresh);
</script>
