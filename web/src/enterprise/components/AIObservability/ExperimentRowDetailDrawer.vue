<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    bleed
    :title="raw(detail?.logicalId ?? 'Experiment row')"
    :sub-title="snapshotLabel"
    data-test="ai-experiment-row-detail"
    @update:open="$emit('update:open', $event)"
  >
    <div v-if="detail" class="flex h-full min-h-0 flex-col">
      <header class="border-border-default flex items-center justify-between border-b px-5 py-3">
        <OButton
          size="sm"
          variant="outline"
          :disabled="!detail.navigation.previousRowId"
          data-test="ai-experiment-row-previous"
          @click="navigate(detail.navigation.previousRowId)"
        >
          {{ raw("Previous row") }}
        </OButton>
        <span class="text-text-secondary text-xs">
          {{ raw(`Row ${detail.navigation.rowIndex + 1} of ${detail.navigation.totalRows}`) }}
        </span>
        <OButton
          size="sm"
          variant="outline"
          :disabled="!detail.navigation.nextRowId"
          data-test="ai-experiment-row-next"
          @click="navigate(detail.navigation.nextRowId)"
        >
          {{ raw("Next row") }}
        </OButton>
      </header>

      <div class="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
        <section class="grid gap-3 md:grid-cols-2">
          <EvidenceCard
            :label="raw('Input')"
            :value="detail.input"
            data-test="ai-experiment-row-input"
          />
          <EvidenceCard
            :label="raw('Expected output')"
            :value="detail.expectedOutput"
            :empty-label="raw('Not provided')"
            data-test="ai-experiment-row-expected-output"
          />
        </section>

        <section>
          <h3 class="text-text-primary mb-2 text-sm font-semibold">{{ raw("Trials") }}</h3>
          <div class="flex gap-2 overflow-x-auto" role="tablist">
            <OButton
              v-for="trial in detail.trials"
              :key="trial.trialIndex"
              size="sm"
              :variant="trial.trialIndex === activeTrialIndex ? 'primary' : 'outline'"
              role="tab"
              :aria-selected="trial.trialIndex === activeTrialIndex"
              :data-test="`ai-experiment-row-trial-${trial.trialIndex}`"
              @click="activeTrialIndex = trial.trialIndex"
            >
              {{ raw(`Trial ${trial.trialIndex + 1}`) }}
            </OButton>
          </div>

          <div v-if="activeTrial" class="border-border-default mt-3 space-y-3 rounded border p-3">
            <div class="flex items-center justify-between gap-2">
              <OTag size="sm">{{ activeTrial.taskStatus }}</OTag>
              <OButton
                v-if="activeTrial.taskStatus === 'error'"
                size="sm"
                variant="primary"
                :disabled="retrying"
                data-test="ai-experiment-row-retry"
                @click="$emit('retry', activeTrial)"
              >
                {{ raw("Retry failed slot") }}
              </OButton>
            </div>
            <EvidenceCard
              v-if="activeTrial.execution?.output != null"
              :label="raw('Output')"
              :value="activeTrial.execution?.output"
            />
            <p v-if="activeTrial.execution?.errorMessage" class="text-negative text-sm">
              {{ activeTrial.execution.errorMessage }}
            </p>
            <dl class="text-text-secondary grid grid-cols-2 gap-x-4 gap-y-2 text-xs md:grid-cols-3">
              <ExecutionFact
                label="Latency"
                :value="milliseconds(activeTrial.execution?.latencyMs)"
              />
              <ExecutionFact
                label="Input tokens"
                :value="numberValue(activeTrial.execution?.tokensIn)"
              />
              <ExecutionFact
                label="Output tokens"
                :value="numberValue(activeTrial.execution?.tokensOut)"
              />
              <ExecutionFact label="Cost" :value="costValue(activeTrial.execution?.cost)" />
              <ExecutionFact
                label="Task fingerprint"
                :value="activeTrial.execution?.taskFingerprint ?? '—'"
              />
            </dl>
            <OButton
              v-if="activeTrial.execution?.traceId"
              size="sm"
              variant="outline"
              data-test="ai-experiment-row-trace"
              @click="$emit('trace', activeTrial.execution)"
            >
              {{ raw("View trace") }}
            </OButton>
          </div>
        </section>

        <section>
          <h3 class="text-text-primary mb-2 text-sm font-semibold">{{ raw("Score matrix") }}</h3>
          <div class="border-border-default overflow-x-auto rounded border">
            <table class="w-full text-left text-xs" data-test="ai-experiment-row-score-matrix">
              <thead class="bg-code-bg text-text-secondary">
                <tr>
                  <th class="p-2">{{ raw("Dimension") }}</th>
                  <th v-for="trial in detail.trials" :key="trial.trialIndex" class="p-2">
                    {{ raw(`Trial ${trial.trialIndex + 1}`) }}
                  </th>
                  <th class="p-2">{{ raw("Aggregate") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="summary in detail.scoreSummaries"
                  :key="`${summary.scorerId}:${summary.scorerVersion}`"
                  class="border-border-default border-t align-top"
                >
                  <th class="p-2 font-medium">
                    {{ raw(`${summary.scorerId} · v${summary.scorerVersion}`) }}
                  </th>
                  <td v-for="trial in detail.trials" :key="trial.trialIndex" class="p-2">
                    <template v-if="scoreFor(trial, summary)">
                      <div>{{ scoreValue(scoreFor(trial, summary)?.score) }}</div>
                      <p
                        v-if="scoreReasoning(scoreFor(trial, summary)?.score)"
                        class="text-text-secondary mt-1"
                      >
                        {{ scoreReasoning(scoreFor(trial, summary)?.score) }}
                      </p>
                      <OTag
                        v-if="isClientReported(scoreFor(trial, summary)?.score)"
                        size="sm"
                        class="mt-1"
                      >
                        {{ raw("Client reported") }}
                      </OTag>
                    </template>
                    <span v-else class="text-text-secondary">—</span>
                  </td>
                  <td class="p-2">{{ format(summary.value) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import EvidenceCard from "./ExperimentRowEvidenceCard.vue";
import ExecutionFact from "./ExperimentExecutionFact.vue";
import type {
  ExperimentExecution,
  ExperimentResultSlot,
  ExperimentRowDetail,
  ExperimentScoreSummary,
} from "@/services/llm-experiments.service";

const props = defineProps<{
  open: boolean;
  detail: ExperimentRowDetail | null;
  retrying?: boolean;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  navigate: [rowId: string];
  retry: [slot: ExperimentResultSlot];
  trace: [execution: ExperimentExecution];
}>();

const activeTrialIndex = ref(0);
watch(
  () => props.detail?.rowId,
  () => (activeTrialIndex.value = props.detail?.trials[0]?.trialIndex ?? 0),
  { immediate: true },
);

const activeTrial = computed(() =>
  props.detail?.trials.find((trial) => trial.trialIndex === activeTrialIndex.value),
);
const snapshotLabel = computed(() =>
  raw(
    props.detail
      ? `${props.detail.snapshot.datasetId} · snapshot v${props.detail.snapshot.datasetVersion}`
      : "Pinned snapshot",
  ),
);

function navigate(rowId: string | null) {
  if (rowId) emit("navigate", rowId);
}

function scoreFor(trial: ExperimentResultSlot, summary: ExperimentScoreSummary) {
  return trial.scores.find(
    (score) => score.scorerId === summary.scorerId && score.scorerVersion === summary.scorerVersion,
  );
}

function scoreValue(score: Record<string, unknown> | null | undefined) {
  if (!score) return "—";
  return String(
    score.value_numeric ?? score.value_categorical ?? score.value_boolean ?? score.status ?? "—",
  );
}

function scoreReasoning(score: Record<string, unknown> | null | undefined) {
  return typeof score?.reasoning === "string" ? score.reasoning : "";
}

function isClientReported(score: Record<string, unknown> | null | undefined) {
  const source = String(score?.source_type ?? score?.sourceType ?? "");
  const metadata = score?.metadata as Record<string, unknown> | undefined;
  return source === "remote" || source === "feedback" || metadata?.client_reported === true;
}

function format(value: unknown) {
  if (value === null || value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}
const milliseconds = (value: number | null | undefined) => (value == null ? "—" : `${value} ms`);
const numberValue = (value: number | null | undefined) => (value == null ? "—" : String(value));
const costValue = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(6)}`;
</script>
