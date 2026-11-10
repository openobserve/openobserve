<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OPageLayout
    data-test="ai-experiments-page"
    :title="header?.title ?? t('aiObservability.nav.experiments')"
    :subtitle="header?.subtitle ?? t('aiObservability.subtitle.experiments')"
    :icon="header?.icon ?? 'science'"
    bleed
    :tabs-below="hasTabs"
  >
    <template v-if="hasTabs" #header-tabs><AiSectionTabs /></template>
    <template #actions>
      <OButton
        size="sm"
        variant="primary"
        data-test="ai-experiments-new-btn"
        :aria-label="
          experimentDrafts.hasNew
            ? t('common.editorDraft.newDot', { label: t('aiObservability.experiments.newButton') })
            : undefined
        "
        @click="openCreate('')"
      >
        {{ t("aiObservability.experiments.newButton") }}
        <EditorDraftDot
          v-if="experimentDrafts.hasNew"
          :saved-at="experimentDrafts.savedAt(null)"
          corner
          data-test="ai-experiments-new-draft-dot"
        />
      </OButton>
    </template>

    <div class="flex h-full min-h-0 flex-col p-4">
      <section class="min-h-0 min-w-0 flex-1 space-y-3 overflow-auto">
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
          :last-updated-at="lastUpdatedAt"
          :experiments="experiments"
          :datasets="datasets"
          @new="openCreate"
          @refresh="refresh(true)"
          @select="openExperiment"
          @baseline-changed="onBaselineChanged"
          sync-url
        />
      </section>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import AiSectionTabs from "@/enterprise/components/AIObservability/AiSectionTabs.vue";
import { useAiSectionTabs } from "@/enterprise/components/AIObservability/aiSectionTabs";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ExperimentBrowser from "@/enterprise/components/AIObservability/ExperimentBrowser.vue";
import EditorDraftDot from "@/components/common/drafts/EditorDraftDot.vue";
import { useEditorDraftIds } from "@/composables/useEditorDraft";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import type { LlmExperiment } from "@/services/llm-experiments.service";
import { experimentsListQuery } from "@/services/llm-experiments.queries";
import { experimentKeys } from "@/services/llm-experiments.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { aiExperimentCreateRoute, aiExperimentDetailRoute } from "./experimentRoutes";

defineOptions({ name: "AIExperimentsPage" });

const { t } = useI18nTyped();
const { hasTabs, header } = useAiSectionTabs();
const store = useStore();
const route = useRoute();
const router = useRouter();
const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const experiments = ref<LlmExperiment[]>([]);
const datasets = ref<LlmDataset[]>([]);
const loading = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const experimentDrafts = useEditorDraftIds("experiment");

function onBaselineChanged(experiment: LlmExperiment, previousBaselineId: string | null) {
  experiments.value = experiments.value.map((row) => {
    if (row.id === experiment.id) return experiment;
    if (previousBaselineId && row.id === previousBaselineId) return { ...row, isBaseline: false };
    return row;
  });
}

// Stalled runs back off to once a minute: a dead SDK run stays "running" until its 24 h deadline.
const LIVE_STATUSES = new Set(["pending", "running", "scoring"]);
const LIVE_POLL_MS = 5_000;
const LIVE_POLL_MAX_MS = 60_000;
let livePoll: ReturnType<typeof setTimeout> | undefined;
let pollDelay = LIVE_POLL_MS;
let lastProgress = "";

function liveProgress(rows: LlmExperiment[]) {
  return rows
    .filter((row) => LIVE_STATUSES.has(row.status))
    .map(
      (row) =>
        `${row.id}:${row.status}:${row.executionProgress?.completed ?? 0}:${row.scoringProgress?.completed ?? 0}`,
    )
    .join("|");
}

function scheduleLivePoll(rows: LlmExperiment[]) {
  clearTimeout(livePoll);
  const progress = liveProgress(rows);
  pollDelay =
    progress && progress === lastProgress
      ? Math.min(pollDelay * 2, LIVE_POLL_MAX_MS)
      : LIVE_POLL_MS;
  lastProgress = progress;
  if (!progress || document.hidden) return;
  livePoll = setTimeout(pollLive, pollDelay);
}

async function pollLive() {
  const opts = experimentsListQuery(orgId.value);
  const before = experiments.value;
  try {
    experiments.value = await queryClient.fetchQuery({ ...opts, staleTime: 0 });
    lastUpdatedAt.value = queryClient.getQueryState(opts.queryKey)?.dataUpdatedAt ?? Date.now();
  } catch {
    // Refresh still reports the error; a background poll should not toast on every read.
    return;
  }
  // Structural sharing returns the same array when nothing changed, which the watch never sees.
  if (experiments.value === before) scheduleLivePoll(before);
}

watch(experiments, scheduleLivePoll);

function onVisibilityChange() {
  if (document.hidden || !liveProgress(experiments.value)) return;
  clearTimeout(livePoll);
  void pollLive();
}
onMounted(() => document.addEventListener("visibilitychange", onVisibilityChange));
onBeforeUnmount(() => {
  clearTimeout(livePoll);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});

// `force` reaches the server: the mount may serve the cached list, but Refresh and post-write reloads must not.
async function refresh(force = false) {
  if (!orgId.value) return;
  loading.value = true;
  try {
    if (force) {
      await queryClient.invalidateQueries({ queryKey: experimentKeys.all(orgId.value) });
    }
    const opts = experimentsListQuery(orgId.value);
    [experiments.value, datasets.value] = await Promise.all([
      queryClient.fetchQuery(opts),
      llmDatasetsService.list(orgId.value),
    ]);
    lastUpdatedAt.value = queryClient.getQueryState(opts.queryKey)?.dataUpdatedAt ?? Date.now();
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
