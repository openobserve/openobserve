<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    bleed
    :title="raw(row?.logicalId ?? 'Comparison row')"
    :sub-title="raw(row?.bucket ?? 'comparison')"
    data-test="ai-experiment-comparison-row"
    @update:open="$emit('update:open', $event)"
  >
    <div class="grid gap-4 p-5 lg:grid-cols-2">
      <section
        v-for="side in sides"
        :key="side.label"
        class="border-border-default min-w-0 space-y-4 rounded border p-4"
        :data-test="`ai-experiment-comparison-${side.key}`"
      >
        <h3 class="text-text-primary font-semibold">{{ side.label }}</h3>
        <p class="text-text-secondary text-xs">{{ side.experimentId }}</p>
        <template v-if="side.detail">
          <div class="grid gap-3 md:grid-cols-2">
            <EvidenceCard :label="raw('Input')" :value="side.detail.input" />
            <EvidenceCard
              :label="raw('Expected output')"
              :value="side.detail.expectedOutput"
              :empty-label="raw('Not provided')"
            />
          </div>
          <article
            v-for="trial in side.detail.trials"
            :key="trial.trialIndex"
            class="border-border-default bg-code-bg rounded border p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-text-primary text-sm font-medium">
                {{ raw(`Trial ${trial.trialIndex + 1}`) }}
              </span>
              <OTag size="sm">{{ trial.taskStatus }}</OTag>
            </div>
            <EvidenceCard
              class="mt-3"
              :label="raw('Output')"
              :value="trial.execution?.output"
              :empty-label="raw('No output')"
            />
            <ul class="text-text-secondary mt-3 space-y-2 text-xs">
              <li v-for="score in trial.scores" :key="`${score.scorerId}:${score.scorerVersion}`">
                <span class="text-text-primary font-medium">{{ score.scorerId }}</span>
                · {{ score.status }} · {{ scoreValue(score.score) }}
              </li>
            </ul>
          </article>
        </template>
        <p v-else class="text-text-secondary py-8 text-center text-sm">
          {{ raw(`No ${side.label.toLowerCase()} row`) }}
        </p>
      </section>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw } from "@/types/i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import EvidenceCard from "./ExperimentRowEvidenceCard.vue";
import type {
  ExperimentComparisonRow,
  ExperimentRowDetail,
} from "@/services/llm-experiments.service";

const props = defineProps<{
  open: boolean;
  row: ExperimentComparisonRow | null;
  baselineId: string;
  candidateId: string;
  baseline: ExperimentRowDetail | null;
  candidate: ExperimentRowDetail | null;
}>();

defineEmits<{ "update:open": [open: boolean] }>();

const sides = computed(() => [
  { key: "baseline", label: "Baseline", experimentId: props.baselineId, detail: props.baseline },
  {
    key: "candidate",
    label: "Candidate",
    experimentId: props.candidateId,
    detail: props.candidate,
  },
]);

function scoreValue(score: Record<string, unknown> | null) {
  if (!score) return raw("No score");
  return raw(
    String(
      score.value_numeric ?? score.value_categorical ?? score.value_boolean ?? score.status ?? "—",
    ),
  );
}
</script>
