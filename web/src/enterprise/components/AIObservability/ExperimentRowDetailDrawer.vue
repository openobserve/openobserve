<!-- Copyright 2026 OpenObserve Inc. -->

<template>
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    bleed
    :title="raw(detail?.logicalId) || t('aiObservability.experiments.rowDetail.fallbackTitle')"
    :sub-title="snapshotLabel"
    data-test="ai-experiment-row-detail"
    @update:open="$emit('update:open', $event)"
  >
    <div v-if="detail" class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 space-y-5 overflow-auto px-5 py-4">
        <!-- Full-width stacked sections, matching DatasetItemDetail so an item
             reads the same in the dataset and in an experiment row. -->
        <section class="flex flex-col gap-1.5">
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("aiObservability.experiments.rowDetail.input") }}
            </h4>
            <OButton
              variant="outline"
              size="sm"
              :disabled="!hasContent(detail.input)"
              data-test="ai-experiment-row-copy-input"
              @click="copyContent(detail.input, 'input')"
            >
              <OIcon name="content-copy" size="xs" />
            </OButton>
          </div>
          <div
            class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
            data-test="ai-experiment-row-input"
          >
            <div
              v-if="!hasContent(detail.input)"
              class="text-text-secondary p-8 text-center text-sm italic"
            >
              {{ t("aiObservability.experiments.rowDetail.noDataAvailable") }}
            </div>
            <LLMContentRenderer
              v-else-if="isPlainText(detail.input)"
              :content="detail.input as string"
              content-type="input"
              view-mode="formatted"
            />
            <pre v-else class="m-0 font-mono text-xs break-words whitespace-pre-wrap">{{
              pretty(detail.input)
            }}</pre>
          </div>
        </section>

        <section class="flex flex-col gap-1.5">
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h4 class="text-compact text-text-heading m-0 font-semibold">
              {{ t("aiObservability.experiments.rowDetail.expectedOutput") }}
            </h4>
            <OButton
              variant="outline"
              size="sm"
              :disabled="!hasContent(detail.expectedOutput)"
              data-test="ai-experiment-row-copy-expected"
              @click="copyContent(detail.expectedOutput, 'output')"
            >
              <OIcon name="content-copy" size="xs" />
            </OButton>
          </div>
          <div
            class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
            data-test="ai-experiment-row-expected-output"
          >
            <div
              v-if="!hasContent(detail.expectedOutput)"
              class="text-text-secondary p-8 text-center text-sm italic"
            >
              {{ t("aiObservability.experiments.rowDetail.noDataAvailable") }}
            </div>
            <LLMContentRenderer
              v-else-if="isPlainText(detail.expectedOutput)"
              :content="detail.expectedOutput as string"
              content-type="output"
              view-mode="formatted"
            />
            <pre v-else class="m-0 font-mono text-xs break-words whitespace-pre-wrap">{{
              pretty(detail.expectedOutput)
            }}</pre>
          </div>
        </section>

        <section>
          <h3 class="text-text-heading mb-2 text-sm font-semibold">
            {{
              hasMultipleTrials
                ? t("aiObservability.experiments.rowDetail.trials")
                : t("aiObservability.experiments.rowDetail.execution")
            }}
          </h3>
          <!-- A segmented control, not buttons: selecting a trial is a view
               switch, so it must not look like a primary action. -->
          <OToggleGroup v-if="hasMultipleTrials" v-model="activeTrialIndex" type="single">
            <OToggleGroupItem
              v-for="trial in detail.trials"
              :key="trial.trialIndex"
              :value="trial.trialIndex"
              :data-test="`ai-experiment-row-trial-${trial.trialIndex}`"
            >
              {{
                t("aiObservability.experiments.rowDetail.trial", { index: trial.trialIndex + 1 })
              }}
            </OToggleGroupItem>
          </OToggleGroup>

          <div
            v-if="activeTrial"
            class="border-border-default rounded-default mt-3 space-y-3 border p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <OTag size="sm" :variant="statusVariant(activeTrial.taskStatus, 'eval').variant">
                {{ statusVariant(activeTrial.taskStatus, "eval").label }}
              </OTag>
              <div class="flex items-center gap-2">
                <OButton
                  v-if="activeTrial.execution?.traceId"
                  size="sm"
                  variant="outline"
                  data-test="ai-experiment-row-trace"
                  @click="$emit('trace', activeTrial.execution)"
                >
                  {{ t("aiObservability.experiments.rowDetail.viewTrace") }}
                </OButton>
                <OButton
                  v-if="activeTrial.taskStatus === 'error'"
                  size="sm"
                  variant="outline"
                  :disabled="retrying"
                  data-test="ai-experiment-row-retry"
                  @click="$emit('retry', activeTrial)"
                >
                  {{ t("aiObservability.experiments.rowDetail.retryFailedSlot") }}
                </OButton>
              </div>
            </div>

            <section v-if="activeTrial.execution?.output != null" class="flex flex-col gap-1.5">
              <div class="flex min-h-8 items-center justify-between gap-2">
                <h4 class="text-compact text-text-heading m-0 font-semibold">
                  {{ t("aiObservability.experiments.rowDetail.output") }}
                </h4>
                <OButton
                  variant="outline"
                  size="sm"
                  :disabled="!hasContent(activeTrial.execution.output)"
                  data-test="ai-experiment-row-copy-output"
                  @click="copyContent(activeTrial.execution.output, 'output')"
                >
                  <OIcon name="content-copy" size="xs" />
                </OButton>
              </div>
              <div
                class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
                data-test="ai-experiment-row-output"
              >
                <LLMContentRenderer
                  v-if="isPlainText(activeTrial.execution.output)"
                  :content="activeTrial.execution.output as string"
                  content-type="output"
                  view-mode="formatted"
                />
                <pre v-else class="m-0 font-mono text-xs break-words whitespace-pre-wrap">{{
                  pretty(activeTrial.execution.output)
                }}</pre>
              </div>
            </section>

            <p v-if="activeTrial.execution?.errorMessage" class="text-negative text-sm">
              {{ raw(activeTrial.execution.errorMessage) }}
            </p>

            <div
              class="text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              data-test="ai-experiment-row-execution-facts"
            >
              <span>
                {{ t("aiObservability.experiments.rowDetail.latency") }}
                <span class="text-text-body">{{
                  raw(durationLabel(activeTrial.execution?.latencyMs))
                }}</span>
              </span>
              <span>
                {{ t("aiObservability.experiments.rowDetail.inputTokens") }}
                <span class="text-text-body">{{
                  raw(numberValue(activeTrial.execution?.tokensIn))
                }}</span>
              </span>
              <span>
                {{ t("aiObservability.experiments.rowDetail.outputTokens") }}
                <span class="text-text-body">{{
                  raw(numberValue(activeTrial.execution?.tokensOut))
                }}</span>
              </span>
              <span>
                {{ t("aiObservability.experiments.rowDetail.cost") }}
                <span class="text-text-body">{{
                  raw(costValue(activeTrial.execution?.cost))
                }}</span>
              </span>
            </div>
          </div>
        </section>

        <section>
          <h3 class="text-text-heading mb-2 text-sm font-semibold">
            {{ t("aiObservability.experiments.rowDetail.scores") }}
          </h3>
          <OTable
            :data="scoreRows"
            :columns="scoreColumns"
            row-key="key"
            :show-global-filter="false"
            :fill-height="false"
            :frame="false"
            pagination="none"
            :default-columns="false"
            width="100%"
            class="w-full"
            data-test="ai-experiment-row-score-matrix"
          />
        </section>
      </div>
    </div>

    <template v-if="detail" #footer>
      <ExperimentRowNav
        :index="detail.navigation.rowIndex + 1"
        :total="detail.navigation.totalRows"
        :has-previous="!!detail.navigation.previousRowId"
        :has-next="!!detail.navigation.nextRowId"
        data-test="ai-experiment-row"
        @previous="navigate(detail.navigation.previousRowId)"
        @next="navigate(detail.navigation.nextRowId)"
      />
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { statusVariant } from "@/lib/core/Table/cells/statusVariant";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import ExperimentRowNav from "./ExperimentRowNav.vue";
import { durationLabel } from "./experimentRowContent";
import {
  experimentScoreSummaryValue,
  experimentScoreValue,
} from "@/enterprise/views/AIObservability/experimentResults";
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

const { t } = useI18nTyped();

const activeTrialIndex = ref(0);
watch(
  () => props.detail?.rowId,
  () => (activeTrialIndex.value = props.detail?.trials[0]?.trialIndex ?? 0),
  { immediate: true },
);

const hasMultipleTrials = computed(() => (props.detail?.trials.length ?? 0) > 1);

const activeTrial = computed(() =>
  props.detail?.trials.find((trial) => trial.trialIndex === activeTrialIndex.value),
);

const snapshotLabel = computed(() =>
  props.detail
    ? t("aiObservability.experiments.rowDetail.snapshot", {
        version: props.detail.snapshot.datasetVersion,
      })
    : raw(""),
);

/** The score records are the only place a scorer's display name exists. */
const scorerNames = computed<Record<string, string>>(() => {
  const names: Record<string, string> = {};
  for (const trial of props.detail?.trials ?? []) {
    for (const entry of trial.scores) {
      const record = entry.score as Record<string, unknown> | undefined;
      const id = String(record?.scorer_id ?? record?.scorerId ?? entry.scorerId ?? "");
      const name = String(record?.name ?? "");
      if (id && name && !names[id]) names[id] = name;
    }
  }
  return names;
});

const scoreColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "dimension",
    header: t("aiObservability.experiments.rowDetail.dimension"),
    accessorKey: "dimension",
    sortable: false,
    minSize: 160,
    meta: { align: "left" as const, flex: true, isName: true },
  },
  ...(props.detail?.trials ?? []).map((trial) => ({
    id: `trial-${trial.trialIndex}`,
    header: t("aiObservability.experiments.rowDetail.trial", { index: trial.trialIndex + 1 }),
    accessorKey: `trial-${trial.trialIndex}`,
    sortable: false,
    size: 120,
    meta: { align: "left" as const },
  })),
  ...(hasMultipleTrials.value
    ? [
        {
          id: "aggregate",
          header: t("aiObservability.experiments.rowDetail.aggregate"),
          accessorKey: "aggregate",
          sortable: false,
          size: 120,
          meta: { align: "left" as const },
        },
      ]
    : []),
]);

const scoreRows = computed(() =>
  (props.detail?.scoreSummaries ?? []).map((summary) => {
    const row: Record<string, string> = {
      key: `${summary.scorerId}:${summary.scorerVersion}`,
      dimension:
        summary.scoreConfigName ||
        summary.name ||
        scorerNames.value[summary.scorerId] ||
        t("aiObservability.experiments.rowDetail.unknownDimension"),
      aggregate: experimentScoreSummaryValue(summary.value),
    };
    for (const trial of props.detail?.trials ?? []) {
      const result = scoreFor(trial, summary);
      row[`trial-${trial.trialIndex}`] =
        result?.status === "success" ? experimentScoreValue(result.score) : "—";
    }
    return row;
  }),
);

// Same emptiness rules and copy behaviour as TraceDetailsSidebar.
function hasContent(content: unknown): boolean {
  if (content === null || content === undefined) return false;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "null") return false;
  }
  if (Array.isArray(content) && content.length === 0) return false;
  if (typeof content === "object" && !Array.isArray(content) && Object.keys(content).length === 0) {
    return false;
  }
  const stringified = JSON.stringify(content);
  return !(stringified === "null" || stringified === "{}" || stringified === "[]");
}

function copyContent(content: unknown, type: "input" | "output") {
  try {
    const text =
      typeof content === "string" ? content : content ? JSON.stringify(content, null, 2) : "";
    copyToClipboard(text, t, {
      successMessage: t("aiObservability.experiments.rowDetail.copied", {
        type: type === "input" ? "Input" : "Output",
      }),
      errorMessage: t("aiObservability.experiments.rowDetail.copyFailed"),
    });
  } catch {
    toast({ variant: "error", message: t("aiObservability.experiments.rowDetail.copyFailed") });
  }
}

function isPlainText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function navigate(rowId: string | null) {
  if (rowId) emit("navigate", rowId);
}

function scoreFor(trial: ExperimentResultSlot, summary: ExperimentScoreSummary) {
  return trial.scores.find(
    (score) => score.scorerId === summary.scorerId && score.scorerVersion === summary.scorerVersion,
  );
}

const numberValue = (value: number | null | undefined) => (value == null ? "—" : String(value));
const costValue = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(6)}`;
</script>
