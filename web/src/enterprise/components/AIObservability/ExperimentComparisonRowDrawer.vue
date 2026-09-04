<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    bleed
    :title="
      raw(row?.logicalId) || t('aiObservability.experiments.comparePage.rowDrawer.fallbackTitle')
    "
    :sub-title="bucketLabel"
    data-test="ai-experiment-comparison-row"
    @update:open="$emit('update:open', $event)"
  >
    <div class="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
      <!-- Input and Expected Output come from the dataset row, so they are the
           same on both sides — shown once instead of duplicated per column. -->
      <ContentBox
        ref="inputBoxRef"
        :label="t('aiObservability.experiments.comparePage.rowDrawer.input')"
        :tag-label="t('aiObservability.experiments.comparePage.rowDrawer.fromDataset')"
        :value="sharedInput"
        :fullscreen="fullscreenEl === inputBoxRef?.rootEl"
        data-test="ai-experiment-comparison-input"
        @toggle-fullscreen="toggle"
      />

      <ContentBox
        ref="expectedBoxRef"
        :label="t('aiObservability.experiments.comparePage.rowDrawer.expectedOutput')"
        :tag-label="t('aiObservability.experiments.comparePage.rowDrawer.fromDataset')"
        :value="sharedExpected"
        :fullscreen="fullscreenEl === expectedBoxRef?.rootEl"
        data-test="ai-experiment-comparison-expected"
        @toggle-fullscreen="toggle"
      />

      <section class="flex flex-col gap-1.5">
        <div class="flex min-h-8 flex-wrap items-center justify-between gap-2">
          <h4 class="text-compact text-text-heading m-0 font-semibold">
            {{ t("aiObservability.experiments.comparePage.rowDrawer.outputHeading") }}
          </h4>
          <OToggleGroup
            v-if="trialCount > 1"
            v-model="activeTrialIndex"
            type="single"
            data-test="ai-experiment-comparison-trials"
          >
            <OToggleGroupItem
              v-for="index in trialCount"
              :key="index - 1"
              :value="index - 1"
              size="sm"
            >
              {{ t("aiObservability.experiments.comparePage.rowDrawer.trial", { index }) }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <div class="grid gap-3 lg:grid-cols-2">
          <ContentBox
            v-for="side in sides"
            :key="side.key"
            :ref="(el) => setOutputBoxRef(side.key, el)"
            :label="side.label"
            :value="side.output"
            :absent="!side.detail"
            :fullscreen="fullscreenEl === outputBoxRefs[side.key]?.rootEl"
            :data-test="`ai-experiment-comparison-${side.key}-output`"
            @toggle-fullscreen="toggle"
          />
        </div>
      </section>

      <section v-if="scoreRows.length" class="flex flex-col gap-1.5">
        <h4 class="text-compact text-text-heading m-0 font-semibold">
          {{ t("aiObservability.experiments.comparePage.rowDrawer.scores") }}
        </h4>
        <OTable
          :data="scoreRows"
          :columns="scoreColumns"
          row-key="key"
          pagination="none"
          sorting="none"
          :default-columns="false"
          :show-global-filter="false"
          :fill-height="false"
          data-test="ai-experiment-comparison-scores"
        >
          <!-- The type is what makes the two numbers beside it readable: without
               it a boolean flip and a rank move both render as `0 → 1`. -->
          <template #cell-dimension="{ row: score }">
            <div class="flex items-center gap-1.5">
              <span class="text-text-body">{{ score.dimension }}</span>
              <OTag
                v-if="score.dataType"
                size="sm"
                icon=""
                variant="default-soft"
                :label="score.dataType"
              />
            </div>
          </template>

          <template #cell-delta="{ row: score }">
            <OTag
              v-if="score.delta !== null"
              size="sm"
              icon=""
              :variant="score.variant"
              :label="score.deltaLabel"
            />
            <span v-else class="text-text-secondary">{{ raw("—") }}</span>
          </template>
        </OTable>
      </section>
    </div>

    <template v-if="total > 1" #footer>
      <ExperimentRowNav
        :index="index"
        :total="total"
        :has-previous="hasPrevious"
        :has-next="hasNext"
        data-test="ai-experiment-comparison-nav"
        @previous="$emit('step', -1)"
        @next="$emit('step', 1)"
      />
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useFullscreenBox } from "@/composables/useFullscreenBox";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import ContentBox from "./ExperimentRowContentBox.vue";
import ExperimentRowNav from "./ExperimentRowNav.vue";
import {
  dataTypeLabel,
  dimensionIdentity,
  dimensionLabel,
  dimensionSideValue,
  signedNumber,
} from "./experimentRowContent";
import type {
  ExperimentComparisonRow,
  ExperimentRowDetail,
} from "@/services/llm-experiments.service";

const props = withDefaults(
  defineProps<{
    open: boolean;
    row: ExperimentComparisonRow | null;
    baselineId: string;
    candidateId: string;
    baseline: ExperimentRowDetail | null;
    candidate: ExperimentRowDetail | null;
    /** 1-based position within the rows the panel is currently showing. */
    index?: number;
    total?: number;
    hasPrevious?: boolean;
    hasNext?: boolean;
  }>(),
  { index: 0, total: 0, hasPrevious: false, hasNext: false },
);

defineEmits<{ "update:open": [open: boolean]; step: [direction: -1 | 1] }>();

const { t } = useI18nTyped();

const activeTrialIndex = ref(0);

// One fullscreen slot shared by all four boxes (Input, Expected Output,
// Baseline, Candidate) — the Fullscreen API only ever has a single fullscreen
// element, so each box compares itself against the SAME ref rather than
// carrying its own boolean.
const { fullscreenEl, toggle } = useFullscreenBox();
const inputBoxRef = ref<InstanceType<typeof ContentBox> | null>(null);
const expectedBoxRef = ref<InstanceType<typeof ContentBox> | null>(null);
const outputBoxRefs = ref<Record<string, InstanceType<typeof ContentBox> | null>>({});

function setOutputBoxRef(key: string, el: unknown) {
  outputBoxRefs.value[key] = el as InstanceType<typeof ContentBox> | null;
}

const bucketLabel = computed(() => raw(props.row?.bucket));

/** Both sides read the same dataset row, so either side can supply it. */
const sharedInput = computed(() => props.baseline?.input ?? props.candidate?.input ?? null);
const sharedExpected = computed(
  () => props.baseline?.expectedOutput ?? props.candidate?.expectedOutput ?? null,
);

const trialCount = computed(() =>
  Math.max(props.baseline?.trials.length ?? 0, props.candidate?.trials.length ?? 0),
);

// A newly opened row may have fewer trials than the last one.
watch(
  () => props.row?.logicalId,
  () => (activeTrialIndex.value = 0),
);

function outputFor(detail: ExperimentRowDetail | null) {
  if (!detail) return null;
  const trial = detail.trials[activeTrialIndex.value] ?? detail.trials[0];
  return trial?.execution?.output ?? null;
}

const sides = computed(() => [
  {
    key: "baseline",
    label: t("aiObservability.experiments.comparePage.baseline"),
    detail: props.baseline,
    output: outputFor(props.baseline),
  },
  {
    key: "candidate",
    label: t("aiObservability.experiments.comparePage.candidate"),
    detail: props.candidate,
    output: outputFor(props.candidate),
  },
]);

const scoreColumns = computed<OTableColumnDef<(typeof scoreRows.value)[number]>[]>(() => [
  {
    id: "dimension",
    header: t("aiObservability.experiments.comparePage.rowDrawer.dimension"),
    accessorKey: "dimension",
  },
  {
    id: "baseline",
    header: t("aiObservability.experiments.comparePage.baseline"),
    accessorKey: "baseline",
  },
  {
    id: "candidate",
    header: t("aiObservability.experiments.comparePage.candidate"),
    accessorKey: "candidate",
  },
  {
    id: "delta",
    header: t("aiObservability.experiments.comparePage.rowDrawer.change"),
    accessorKey: "delta",
  },
]);

const scoreRows = computed(() =>
  (props.row?.dimensions ?? []).map((dimension) => ({
    key: dimensionIdentity(dimension),
    dimension: dimensionLabel(dimension),
    dataType: dataTypeLabel(dimension),
    baseline: dimensionSideValue(dimension, "baseline"),
    candidate: dimensionSideValue(dimension, "candidate"),
    delta: dimension.delta,
    // A delta smaller than the trial noise on both sides is a `~`, not a claim.
    deltaLabel: dimension.withinNoise
      ? raw(`~${signedNumber(dimension.delta)}`)
      : signedNumber(dimension.delta),
    // Colour follows orientedDelta: a latency rising by +31 is a positive
    // NUMBER but a worse RESULT.
    variant: (dimension.orientedDelta === null || dimension.orientedDelta === 0
      ? "default-soft"
      : dimension.orientedDelta > 0
        ? "success-soft"
        : "error-soft") as BadgeVariant,
  })),
);
</script>
