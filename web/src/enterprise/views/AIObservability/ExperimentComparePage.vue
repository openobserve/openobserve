<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <OPageLayout
    data-test="ai-experiment-compare-page"
    :title="t('aiObservability.experiments.comparePage.title')"
    icon="science"
    :back="backTarget"
    bleed
  >
    <template #title-trail>
      <div
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
        data-test="ai-experiment-compare-picker"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-text-tertiary shrink-0 text-xs">
            {{ t("aiObservability.experiments.comparePage.baseline") }}
          </span>
          <OSelect
            :model-value="baselineId"
            :options="baselineOptions"
            :loading="optionsLoading"
            :placeholder="t('aiObservability.experiments.comparePage.baselinePlaceholder')"
            size="sm"
            width="md"
            searchable
            data-test="ai-experiment-compare-baseline-select"
            @update:model-value="selectSide('baseline', $event)"
          />
        </div>
        <OTooltip :content="t('aiObservability.experiments.comparePage.swap')">
          <OButton
            variant="ghost"
            size="icon"
            type="button"
            class="shrink-0"
            :disabled="!baselineId || !candidateId"
            :aria-label="t('aiObservability.experiments.comparePage.swap')"
            data-test="ai-experiment-compare-swap"
            @click="swapSides"
          >
            <OIcon name="swap-horiz" size="sm" />
          </OButton>
        </OTooltip>
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-text-tertiary shrink-0 text-xs">
            {{ t("aiObservability.experiments.comparePage.candidate") }}
          </span>
          <OSelect
            :model-value="candidateId"
            :options="candidateOptions"
            :loading="optionsLoading"
            :placeholder="t('aiObservability.experiments.comparePage.candidatePlaceholder')"
            size="sm"
            width="md"
            searchable
            data-test="ai-experiment-compare-candidate-select"
            @update:model-value="selectSide('candidate', $event)"
          />
        </div>
      </div>
    </template>

    <!-- v-if goes INSIDE the slot, not on the template: with it on the template
         the slot key is absent on first render, so OPageHeader's hasActions
         never re-evaluates and a badge that arrives with async data never shows. -->
    <template #actions>
      <OTooltip v-if="datasetName" :content="datasetName" :disabled="!datasetNameTruncated">
        <OTag
          size="sm"
          variant="default-soft"
          icon=""
          :label="datasetLabel"
          data-test="ai-experiment-compare-dataset"
        />
      </OTooltip>
    </template>

    <template v-if="comparison" #subnav>
      <div
        class="px-table-edge text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs"
        data-test="ai-experiment-compare-meta"
      >
        <span>{{
          t("aiObservability.experiments.comparePage.commonRows", {
            common: comparison.counts.commonRows,
            total: totalRows,
          })
        }}</span>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div
        v-if="loading"
        class="border-border-default text-text-secondary rounded-default m-page-edge border p-4 text-center"
        data-test="ai-experiment-compare-loading"
      >
        {{ t("aiObservability.experiments.comparePage.loading") }}
      </div>
      <ExperimentComparisonPanel
        v-else-if="comparison"
        :comparison="comparison"
        :scorer-names="scorerNames"
        @apply-threshold="applyThreshold"
        @inspect="inspectRow"
      />
      <div
        v-else
        class="border-border-default text-text-secondary rounded-default m-page-edge border border-dashed p-6 text-center"
        data-test="ai-experiment-compare-empty"
      >
        {{ t("aiObservability.experiments.comparePage.missing") }}
      </div>
    </div>

    <ExperimentComparisonRowDrawer
      :open="rowDrawerOpen"
      :row="selectedRow"
      :baseline-id="comparison?.baselineId ?? ''"
      :candidate-id="comparison?.candidateId ?? ''"
      :baseline="baselineRow"
      :candidate="candidateRow"
      :scorer-names="scorerNames"
      :index="rowIndex + 1"
      :total="siblingRows.length"
      :has-previous="rowIndex > 0"
      :has-next="rowIndex >= 0 && rowIndex < siblingRows.length - 1"
      @update:open="rowDrawerOpen = $event"
      @step="stepRow"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import ExperimentComparisonPanel from "@/enterprise/components/AIObservability/ExperimentComparisonPanel.vue";
import ExperimentComparisonRowDrawer from "@/enterprise/components/AIObservability/ExperimentComparisonRowDrawer.vue";
import onlineEvalsService from "@/services/online-evals.service";
import llmExperimentsService, {
  type ExperimentComparison,
  type ExperimentComparisonRow,
  type ExperimentRowDetail,
  type LlmExperiment,
} from "@/services/llm-experiments.service";
import { aiExperimentCompareRoute, aiExperimentsRoute } from "./experimentRoutes";

defineOptions({ name: "AIExperimentComparePage" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgId = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const baselineId = computed(() => String(route.params.baselineId ?? ""));
const candidateId = computed(() => String(route.params.candidateId ?? ""));

const comparison = ref<ExperimentComparison | null>(null);
const loading = ref(false);
const rowDrawerOpen = ref(false);
const selectedRow = ref<ExperimentComparisonRow | null>(null);
/** The filtered order the panel is showing, so paging follows what's on screen. */
const siblingRows = ref<ExperimentComparisonRow[]>([]);
const baselineRow = ref<ExperimentRowDetail | null>(null);
const candidateRow = ref<ExperimentRowDetail | null>(null);
const experiments = ref<LlmExperiment[]>([]);
const scorerNames = ref<Record<string, string>>({});
const optionsLoading = ref(false);

const backTarget = computed(() => ({
  label: t("aiObservability.nav.experiments"),
  to: aiExperimentsRoute(orgId.value),
}));

/** The dataset both sides are pinned to — the server refuses to compare across datasets. */
const datasetId = computed(
  () =>
    comparison.value?.datasetId ??
    experiments.value.find(({ id }) => id === baselineId.value)?.datasetId ??
    "",
);

const datasetName = computed(
  () => raw(experiments.value.find(({ id }) => id === baselineId.value)?.datasetName) ?? "",
);

// Long dataset names would crowd the header, so the badge carries a clipped
// name and the tooltip the whole one.
const DATASET_NAME_MAX = 30;
const datasetNameTruncated = computed(() => datasetName.value.length > DATASET_NAME_MAX);
const datasetLabel = computed(() =>
  datasetNameTruncated.value
    ? raw(`${datasetName.value.slice(0, DATASET_NAME_MAX)}…`)
    : raw(datasetName.value),
);

/** Rows in either run, so the common-row count reads as a share of the whole set. */
const totalRows = computed(() => {
  const counts = comparison.value?.counts;
  if (!counts) return 0;
  return counts.commonRows + counts.new + counts.missing;
});

/** The dataset's experiments — the only pairs the server will compare. */
const sideOptions = computed(() =>
  experiments.value
    .filter(({ datasetId: id }) => !datasetId.value || id === datasetId.value)
    .map((experiment) => ({
      label: raw(experiment.name) || raw(experiment.id),
      value: experiment.id,
    })),
);

// Each side hides what the other already holds, so a run can never be compared
// with itself; reversing the pair is the swap button's job instead.
const baselineOptions = computed(() =>
  sideOptions.value.filter(({ value }) => value !== candidateId.value),
);
const candidateOptions = computed(() =>
  sideOptions.value.filter(({ value }) => value !== baselineId.value),
);

// The comparison names its score dimensions by scorer ID; only the Scorers API
// carries the display name, so resolve it once for the page.
async function loadScorerNames() {
  if (!orgId.value) return;
  try {
    const scorers = await onlineEvalsService.scorers.list(orgId.value);
    scorerNames.value = Object.fromEntries(
      scorers
        .filter((scorer) => scorer.id && scorer.name)
        .map((scorer) => [scorer.id, scorer.name]),
    );
  } catch {
    // A missing name is survivable — the column falls back to the raw ID.
    scorerNames.value = {};
  }
}

async function loadExperiments() {
  if (!orgId.value) return;
  optionsLoading.value = true;
  try {
    experiments.value = await llmExperimentsService.list(orgId.value);
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        t("aiObservability.experiments.comparePage.optionsError"),
    });
  } finally {
    optionsLoading.value = false;
  }
}

// Replace rather than push: fiddling with the pair shouldn't bury the
// experiments list under a stack of near-identical comparisons.
function comparePair(nextBaseline: string, nextCandidate: string) {
  if (!nextBaseline || !nextCandidate) return;
  if (nextBaseline === baselineId.value && nextCandidate === candidateId.value) return;
  void router.replace(aiExperimentCompareRoute(orgId.value, nextBaseline, nextCandidate));
}

function selectSide(side: "baseline" | "candidate", next: SelectModelValue) {
  const id = typeof next === "string" ? next : "";
  if (!id) return;
  if (side === "baseline") comparePair(id, candidateId.value);
  else comparePair(baselineId.value, id);
}

function swapSides() {
  comparePair(candidateId.value, baselineId.value);
}

async function loadComparison(threshold?: number) {
  if (!orgId.value || !baselineId.value || !candidateId.value) {
    comparison.value = null;
    return;
  }
  loading.value = true;
  try {
    comparison.value = await llmExperimentsService.compare(
      orgId.value,
      baselineId.value,
      candidateId.value,
      threshold,
    );
  } catch (error: any) {
    comparison.value = null;
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        t("aiObservability.experiments.comparePage.loadError"),
    });
  } finally {
    loading.value = false;
  }
}

function applyThreshold(threshold: number) {
  void loadComparison(threshold);
}

const rowIndex = computed(() =>
  siblingRows.value.findIndex(({ logicalId }) => logicalId === selectedRow.value?.logicalId),
);

function stepRow(direction: -1 | 1) {
  const next = siblingRows.value[rowIndex.value + direction];
  if (next) void inspectRow(next, siblingRows.value);
}

async function inspectRow(row: ExperimentComparisonRow, siblings?: ExperimentComparisonRow[]) {
  const current = comparison.value;
  if (!current) return;
  if (siblings) siblingRows.value = siblings;
  selectedRow.value = row;
  baselineRow.value = null;
  candidateRow.value = null;
  rowDrawerOpen.value = true;
  try {
    const [baseline, candidate] = await Promise.all([
      row.baselineRowId
        ? llmExperimentsService.getRow(orgId.value, current.baselineId, row.baselineRowId)
        : Promise.resolve(null),
      row.candidateRowId
        ? llmExperimentsService.getRow(orgId.value, current.candidateId, row.candidateRowId)
        : Promise.resolve(null),
    ]);
    baselineRow.value = baseline;
    candidateRow.value = candidate;
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) ||
        t("aiObservability.experiments.comparePage.rowError"),
    });
  }
}

watch(
  orgId,
  () => {
    void loadExperiments();
    void loadScorerNames();
  },
  { immediate: true },
);
watch([orgId, baselineId, candidateId], () => loadComparison(), { immediate: true });
</script>
