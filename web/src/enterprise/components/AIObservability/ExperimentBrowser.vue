<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <section class="space-y-4" data-test="ai-experiment-browser">
    <div v-if="!compact" class="flex flex-wrap items-end gap-3">
      <OSelect
        v-model="datasetFilter"
        class="min-w-56"
        :label="t('aiObservability.experiments.datasetFilter')"
        :options="datasetOptions"
        clearable
        data-test="ai-experiment-dataset-filter"
      />
      <OInput
        v-model="nameSearch"
        class="min-w-56 flex-1"
        :label="t('aiObservability.experiments.nameSearch')"
        data-test="ai-experiment-name-search"
      />
      <OButton
        size="sm"
        variant="primary"
        data-test="ai-experiment-filtered-new"
        @click="$emit('new', selectedDatasetId)"
      >
        {{ t("aiObservability.experiments.newButton") }}
      </OButton>
      <OButton
        size="sm"
        variant="outline"
        :disabled="!comparison.eligible"
        data-test="ai-experiment-compare"
        @click="openComparison"
      >
        {{ t("aiObservability.experiments.compare") }}
      </OButton>
    </div>

    <div
      v-if="comparisonReason"
      class="border-warning text-text-secondary rounded-default border px-3 py-2 text-sm"
      data-test="ai-experiment-comparison-reason"
    >
      {{ comparisonReason }}
    </div>

    <div
      v-if="!groups.length"
      class="border-border-default text-text-secondary rounded-default border border-dashed p-6 text-center"
    >
      {{ t("aiObservability.experiments.emptyFiltered") }}
    </div>

    <section
      v-for="group in groups"
      :key="group.datasetId"
      class="border-border-default rounded-default overflow-hidden border"
      :data-test="`ai-experiment-group-${group.datasetId}`"
    >
      <header class="bg-code-bg flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <h3 class="text-text-primary text-sm font-medium">{{ group.datasetName }}</h3>
          <p class="text-text-secondary text-xs">
            {{ t("aiObservability.experiments.groupCount", { count: group.experiments.length }) }}
          </p>
        </div>
        <OButton
          v-if="compact"
          size="sm"
          variant="outline"
          @click="$emit('open-filtered', group.datasetId)"
        >
          {{ t("aiObservability.experiments.viewAll") }}
        </OButton>
      </header>

      <div
        v-for="experiment in group.experiments"
        :key="experiment.id"
        class="border-border-default border-t px-4 py-3"
        :data-test="`ai-experiment-row-${experiment.id}`"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-text-primary font-medium">{{ experiment.name }}</span>
              <OTag v-if="isBaseline(experiment)" size="sm" variant="blue-soft">
                {{ t("aiObservability.experiments.baseline") }}
              </OTag>
              <OTag size="sm">{{ experiment.status }}</OTag>
            </div>
            <div class="text-text-secondary mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>{{ progressLabel(experiment) }}</span>
              <span>{{ scoreLabel(experiment) }}</span>
              <span>{{ costLabel(experiment) }}</span>
              <OTimeCell :value="experiment.createdAt" unit="ms" mode="relative" />
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <OCheckbox
              v-if="!compact"
              :model-value="selectedIds.includes(experiment.id)"
              :disabled="comparisonDisabled(experiment)"
              :title="
                comparisonDisabled(experiment)
                  ? t('aiObservability.experiments.crossDatasetComparison')
                  : undefined
              "
              :aria-label="t('aiObservability.experiments.selectForComparison')"
              @click.stop
              @update:model-value="toggleComparison(experiment)"
            />
            <OButton
              size="sm"
              :variant="isBaseline(experiment) ? 'outline' : 'ghost'"
              :data-test="`ai-experiment-baseline-${experiment.id}`"
              @click.stop="setBaseline(experiment)"
            >
              {{
                isBaseline(experiment)
                  ? t("aiObservability.experiments.baseline")
                  : t("aiObservability.experiments.setBaseline")
              }}
            </OButton>
            <OButton
              size="sm"
              variant="outline"
              :data-test="`ai-experiment-detail-${experiment.id}`"
              @click="emit('select', experiment.id)"
            >
              {{ t("aiObservability.experiments.viewDetails") }}
            </OButton>
          </div>
        </div>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { LlmDataset } from "@/services/llm-datasets.service";
import type { ExperimentDetail, LlmExperiment } from "@/services/llm-experiments.service";
import {
  comparisonEligibility,
  experimentEvidence,
  groupExperiments,
  readExperimentBaselines,
  writeExperimentBaselines,
} from "@/enterprise/views/AIObservability/experimentDiscovery";

const props = withDefaults(
  defineProps<{
    orgId: string;
    experiments: LlmExperiment[];
    datasets: LlmDataset[];
    details?: Record<string, ExperimentDetail>;
    fixedDatasetId?: string;
    compact?: boolean;
    syncUrl?: boolean;
  }>(),
  { details: () => ({}), fixedDatasetId: "", compact: false, syncUrl: false },
);

const emit = defineEmits<{
  select: [experimentId: string];
  new: [datasetId: string];
  "open-filtered": [datasetId: string];
}>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const initialDataset =
  props.fixedDatasetId || (props.syncUrl ? String(route.query.dataset ?? "") : "");
const datasetFilter = ref(initialDataset);
const nameSearch = ref(props.syncUrl ? String(route.query.experiment ?? "") : "");
const baselineByDataset = ref(readExperimentBaselines(props.orgId));
const selectedIds = ref<string[]>([]);
const rejectedComparisonReason = ref("");

const datasetOptions = computed(() =>
  props.datasets.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);
const datasetNames = computed(
  () => new Map(props.datasets.map((dataset) => [dataset.id, raw(dataset.name)])),
);
const groups = computed(() =>
  groupExperiments(
    props.experiments,
    datasetNames.value,
    baselineByDataset.value,
    props.fixedDatasetId || datasetFilter.value,
    nameSearch.value,
  ),
);
const selectedDatasetId = computed(() => {
  const visible = props.fixedDatasetId || datasetFilter.value;
  return visible && groups.value.length <= 1 ? visible : "";
});
const selectedExperiments = computed(() =>
  props.experiments.filter(({ id }) => selectedIds.value.includes(id)),
);
const comparison = computed(() => comparisonEligibility(selectedExperiments.value));
const comparisonReason = computed(() =>
  selectedIds.value.length || rejectedComparisonReason.value
    ? rejectedComparisonReason.value || comparison.value.reason
    : "",
);

watch(
  () => props.orgId,
  (orgId) => {
    baselineByDataset.value = readExperimentBaselines(orgId);
  },
);

watch(
  () => [route.query.dataset, route.query.experiment, route.query.baseline, route.query.candidate],
  ([dataset, experiment, baseline, candidate]) => {
    if (!props.syncUrl) return;
    const nextDataset = String(dataset ?? "");
    const nextSearch = String(experiment ?? "");
    if (datasetFilter.value !== nextDataset) datasetFilter.value = nextDataset;
    if (nameSearch.value !== nextSearch) nameSearch.value = nextSearch;
    const routeSelection = [baseline, candidate]
      .map((id) => String(id ?? ""))
      .filter((id) => props.experiments.some((row) => row.id === id));
    if (routeSelection.join(":") !== selectedIds.value.join(":")) {
      selectedIds.value = routeSelection;
    }
  },
  { immediate: true },
);

watch([datasetFilter, nameSearch], () => {
  if (!props.syncUrl) return;
  const query = { ...route.query };
  if (datasetFilter.value) query.dataset = datasetFilter.value;
  else delete query.dataset;
  if (nameSearch.value.trim()) query.experiment = nameSearch.value.trim();
  else delete query.experiment;
  const currentDataset = String(route.query.dataset ?? "");
  const currentSearch = String(route.query.experiment ?? "");
  if (currentDataset !== datasetFilter.value || currentSearch !== nameSearch.value.trim()) {
    router.replace({ query });
  }
});

function evidence(experiment: LlmExperiment) {
  return experimentEvidence(props.details[experiment.id]);
}

function progressLabel(experiment: LlmExperiment) {
  const value = evidence(experiment);
  return value.totalSlots
    ? t("aiObservability.experiments.progress", {
        done: value.completedSlots,
        total: value.totalSlots,
      })
    : raw(experiment.status);
}

function scoreLabel(experiment: LlmExperiment) {
  const scores = evidence(experiment).scores;
  return scores.length
    ? raw(scores.map((score) => `${score.name}: ${score.value.toFixed(3)}`).join(" · "))
    : t("aiObservability.experiments.noScores");
}

function costLabel(experiment: LlmExperiment) {
  const cost = evidence(experiment).cost;
  return cost === null ? t("aiObservability.experiments.noCost") : raw(`$${cost.toFixed(4)}`);
}

function isBaseline(experiment: LlmExperiment) {
  return baselineByDataset.value[experiment.datasetId] === experiment.id;
}

function setBaseline(experiment: LlmExperiment) {
  baselineByDataset.value = { ...baselineByDataset.value, [experiment.datasetId]: experiment.id };
  writeExperimentBaselines(props.orgId, baselineByDataset.value);
  selectedIds.value = [experiment.id];
  rejectedComparisonReason.value = "";
}

function comparisonDisabled(experiment: LlmExperiment) {
  const selected = props.experiments.filter(({ id }) => selectedIds.value.includes(id));
  return Boolean(
    selected.length &&
    !selectedIds.value.includes(experiment.id) &&
    selected[0].datasetId !== experiment.datasetId,
  );
}

function toggleComparison(experiment: LlmExperiment) {
  if (selectedIds.value.includes(experiment.id)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== experiment.id);
  } else if (comparisonDisabled(experiment)) {
    rejectedComparisonReason.value = t("aiObservability.experiments.crossDatasetComparison");
    return;
  } else if (selectedIds.value.length < 2) {
    const baselineId = baselineByDataset.value[experiment.datasetId];
    const baselineCanSeed =
      baselineId &&
      baselineId !== experiment.id &&
      props.experiments.some(({ id }) => id === baselineId);
    selectedIds.value = baselineCanSeed
      ? [baselineId, experiment.id]
      : [...selectedIds.value, experiment.id];
  }
  rejectedComparisonReason.value = "";
}

function openComparison() {
  if (!comparison.value.eligible) return;
  const datasetId = selectedExperiments.value[0].datasetId;
  const configuredBaseline = baselineByDataset.value[datasetId];
  const baseline =
    selectedExperiments.value.find(({ id }) => id === configuredBaseline) ??
    selectedExperiments.value[0];
  const candidate = selectedExperiments.value.find(({ id }) => id !== baseline.id);
  if (!candidate) return;
  router.push({
    name: "aiExperiments",
    query: {
      ...route.query,
      dataset: datasetId,
      baseline: baseline.id,
      candidate: candidate.id,
    },
  });
}
</script>
