<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <section class="flex flex-col gap-2" data-test="prompt-version-score-comparison">
    <h4
      class="text-compact text-text-heading border-b-text-secondary/12 m-0 inline-flex items-center gap-1.5 border-b pb-1.5 leading-normal font-semibold"
    >
      {{ t("aiObservability.promptManagement.form.experimentScores") }}
      <OIcon name="info-outline" size="xs" class="text-text-secondary cursor-help">
        <OTooltip :content="t('aiObservability.promptManagement.scoreEvidenceHelp')" />
      </OIcon>
    </h4>
    <p v-if="error" role="alert" class="text-status-error-text m-0 text-xs">{{ error }}</p>
    <p
      v-else-if="!loading && !hasScores"
      class="text-text-secondary m-0 text-xs"
      data-test="prompt-version-score-empty"
    >
      {{ t("aiObservability.promptManagement.form.noExperimentScores") }}
    </p>
    <p v-else-if="loading" class="text-text-secondary m-0 text-xs">
      {{ t("aiObservability.promptManagement.form.loadingScores") }}
    </p>
    <PromptCompareList v-else :rows="rows" data-test="prompt-version-score" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import PromptCompareList from "./PromptCompareList.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
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
const error = ref<I18nText>();
const left = ref<PromptVersionScoreSummary | null>(null);
const right = ref<PromptVersionScoreSummary | null>(null);
const hasScores = computed(() =>
  [left.value, right.value].some((side) => side?.p50 != null || side?.iqr != null),
);
const rows = computed(() => [
  {
    key: "median",
    label: t("aiObservability.promptManagement.form.medianScore"),
    left: metric(left.value?.p50 ?? null),
    right: metric(right.value?.p50 ?? null),
  },
  {
    key: "spread",
    label: t("aiObservability.promptManagement.form.scoreSpread"),
    left: metric(left.value?.iqr ?? null),
    right: metric(right.value?.iqr ?? null),
  },
]);

function metric(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

async function load() {
  loading.value = true;
  error.value = undefined;
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
    error.value =
      caught instanceof Error
        ? raw(caught.message)
        : t("aiObservability.promptManagement.form.scoreLoadError");
  } finally {
    loading.value = false;
  }
}

watch(() => [props.orgId, props.promptId, ...props.versions], load, { immediate: true });
</script>
