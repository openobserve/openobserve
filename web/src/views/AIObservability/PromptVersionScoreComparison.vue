<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <section class="mt-4" data-test="prompt-version-score-comparison">
    <h4 class="text-text-heading mb-2 text-sm font-semibold">
      {{ t("aiObservability.promptManagement.managedExperimentScores") }}
    </h4>
    <div v-if="loading" class="text-text-secondary text-xs">
      {{ t("aiObservability.promptManagement.loadingScoreEvidence") }}
    </div>
    <div v-else-if="error" class="text-status-error-text text-xs">{{ error }}</div>
    <div v-else class="grid grid-cols-2 gap-3 max-md:grid-cols-1">
      <div
        v-for="side in sides"
        :key="side.version"
        class="rounded-default border-border-default bg-surface-base border p-3"
      >
        <div class="text-text-heading text-xs font-semibold">
          {{ t("aiObservability.promptManagement.versionNumber", { version: side.version }) }}
        </div>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-xs">
          <dt class="text-text-secondary">{{ t("aiObservability.promptManagement.scoreP50") }}</dt>
          <dd class="text-right tabular-nums">{{ metric(side.p50) }}</dd>
          <dt class="text-text-secondary">{{ t("aiObservability.promptManagement.scoreIqr") }}</dt>
          <dd class="text-right tabular-nums">{{ metric(side.iqr) }}</dd>
        </dl>
      </div>
    </div>
    <p class="text-text-secondary text-2xs mt-2">
      {{ t("aiObservability.promptManagement.scoreEvidenceHelp") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import {
  loadPromptVersionScoreComparison,
  type PromptVersionScoreSummary,
} from "./usePromptAnalytics";

const { t } = useI18nTyped();
const props = defineProps<{
  orgId: string;
  promptId: string;
  versions: [number, number];
}>();

const loading = ref(false);
const error = ref("");
const left = ref<PromptVersionScoreSummary | null>(null);
const right = ref<PromptVersionScoreSummary | null>(null);
const sides = computed(() =>
  [left.value, right.value].filter((value): value is PromptVersionScoreSummary => value != null),
);

function metric(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const comparison = await loadPromptVersionScoreComparison(
      props.orgId,
      props.promptId,
      props.versions,
    );
    left.value = comparison.left;
    right.value = comparison.right;
  } catch (caught: unknown) {
    left.value = null;
    right.value = null;
    error.value = caught instanceof Error ? caught.message : "Failed to load score evidence.";
  } finally {
    loading.value = false;
  }
}

watch(() => [props.orgId, props.promptId, ...props.versions], load, { immediate: true });
</script>
