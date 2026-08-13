<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <section
    class="border-border-default bg-card-glass-bg rounded-default space-y-4 border p-4"
    data-test="ai-experiment-comparison"
  >
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-text-primary font-medium">{{ raw("Baseline comparison") }}</h2>
        <p class="text-text-secondary mt-1 text-xs">
          {{ comparison.baselineId }} → {{ comparison.candidateId }}
        </p>
      </div>
      <div class="flex items-end gap-2">
        <OInput
          v-model="thresholdDraft"
          type="number"
          min="0"
          step="0.01"
          :label="raw('Neutral threshold')"
          data-test="ai-experiment-comparison-threshold"
        />
        <OButton size="sm" variant="outline" @click="applyThreshold">
          {{ raw("Apply") }}
        </OButton>
      </div>
    </header>

    <p
      class="border-border-default bg-code-bg text-text-secondary rounded border p-3 text-xs"
      data-test="ai-experiment-comparison-rule"
    >
      {{ comparison.assignmentRule }}
    </p>

    <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" data-test="ai-experiment-counts">
      <div class="border-border-default rounded border p-3">
        <div class="text-text-secondary text-xs">{{ raw("Common rows") }}</div>
        <div class="text-text-primary text-lg font-semibold">
          {{ comparison.counts.commonRows }}
        </div>
        <div class="text-text-secondary text-xs">
          {{
            raw(
              `${comparison.counts.baselineRows} baseline · ${comparison.counts.candidateRows} candidate`,
            )
          }}
        </div>
      </div>
      <div
        v-for="bucket in buckets"
        :key="bucket"
        class="border-border-default rounded border p-3"
        :data-test="`ai-experiment-count-${bucket}`"
      >
        <div class="text-text-secondary text-xs capitalize">{{ bucket }}</div>
        <div class="text-text-primary text-lg font-semibold">{{ comparison.counts[bucket] }}</div>
      </div>
    </div>

    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-test="ai-experiment-deltas">
      <article
        v-for="dimension in comparison.dimensions"
        :key="`${dimension.kind}:${dimension.name}`"
        class="border-border-default rounded border p-3"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-text-primary text-sm font-medium">{{ dimension.name }}</span>
          <OTag size="sm">{{ dimension.kind }}</OTag>
        </div>
        <dl class="text-text-secondary mt-2 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt>{{ raw("Baseline") }}</dt>
            <dd class="text-text-primary">{{ dimensionValue(dimension.baseline) }}</dd>
          </div>
          <div>
            <dt>{{ raw("Candidate") }}</dt>
            <dd class="text-text-primary">{{ dimensionValue(dimension.candidate) }}</dd>
          </div>
          <div>
            <dt>{{ raw("Delta") }}</dt>
            <dd class="text-text-primary">{{ dimensionValue(dimension.delta, true) }}</dd>
          </div>
        </dl>
        <p class="text-text-secondary mt-2 text-xs">
          {{
            raw(
              `${dimension.comparableRowCount} comparable rows · ${dimension.baselineSampleCount}/${dimension.candidateSampleCount} samples`,
            )
          }}
        </p>
        <p
          v-if="dimension.baselineOnlyRowCount || dimension.candidateOnlyRowCount"
          class="text-warning mt-1 text-xs"
          data-test="ai-experiment-one-sided-dimension"
        >
          {{
            raw(
              `${dimension.baselineOnlyRowCount} baseline-only · ${dimension.candidateOnlyRowCount} candidate-only`,
            )
          }}
        </p>
      </article>
    </div>

    <OTable
      :data="comparison.rows"
      :columns="comparisonColumns"
      row-key="logicalId"
      pagination="none"
      sorting="none"
      :default-columns="false"
      :show-global-filter="false"
      :fill-height="false"
      data-test="ai-experiment-comparison-rows"
    >
      <template #cell-bucket="{ row }">
        <OTag size="sm">{{ row.bucket }}</OTag>
      </template>
      <template #cell-dimensions="{ row }">
        <span class="text-text-secondary text-xs">{{ rowDeltaLabel(row) }}</span>
      </template>
      <template #cell-actions="{ row }">
        <OButton
          size="sm"
          variant="outline"
          data-test="ai-experiment-comparison-inspect"
          @click="$emit('inspect', row)"
        >
          {{ raw("Inspect both") }}
        </OButton>
      </template>
    </OTable>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type {
  ExperimentComparison,
  ExperimentComparisonRow,
} from "@/services/llm-experiments.service";

const props = defineProps<{ comparison: ExperimentComparison }>();
const emit = defineEmits<{
  inspect: [row: ExperimentComparisonRow];
  "apply-threshold": [threshold: number];
}>();

const buckets = ["regressed", "improved", "unchanged", "new", "missing"] as const;
const comparisonColumns = computed<OTableColumnDef<ExperimentComparisonRow>[]>(() => [
  { id: "logicalId", header: raw("Dataset row"), accessorKey: "logicalId", sortable: true },
  { id: "bucket", header: raw("Outcome"), accessorKey: "bucket", sortable: true },
  { id: "dimensions", header: raw("Dimension deltas"), accessorKey: "dimensions" },
  { id: "actions", header: raw(""), accessorKey: "actions", isAction: true, size: 130 },
]);
const thresholdDraft = ref(String(props.comparison.threshold));
watch(
  () => props.comparison.threshold,
  (threshold) => (thresholdDraft.value = String(threshold)),
);

function applyThreshold() {
  const threshold = Number(thresholdDraft.value);
  if (Number.isFinite(threshold) && threshold >= 0) emit("apply-threshold", threshold);
}

function dimensionValue(value: number | null, signed = false) {
  if (value === null) return raw("One-sided");
  const prefix = signed && value > 0 ? "+" : "";
  return raw(`${prefix}${value.toFixed(4)}`);
}

function rowDeltaLabel(row: ExperimentComparisonRow) {
  const comparable = row.dimensions.filter((dimension) => dimension.delta !== null);
  const oneSided = row.dimensions.filter((dimension) => dimension.delta === null).length;
  const deltas = comparable
    .map((dimension) => `${dimension.name} ${dimensionValue(dimension.delta, true)}`)
    .join(" · ");
  return raw(
    [deltas, oneSided ? `${oneSided} one-sided` : ""].filter(Boolean).join(" · ") ||
      "No comparable dimensions",
  );
}
</script>
