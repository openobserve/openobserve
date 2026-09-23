<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div class="flex flex-col gap-5" data-test="prompt-traffic-panel">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <OSelect
        v-model="streamName"
        :options="streamOptions"
        label-key="label"
        value-key="value"
        :placeholder="t('aiObservability.promptManagement.traceStream')"
        searchable
        class="w-56"
        data-test="prompt-traffic-stream"
      />
      <OSelect
        v-model="window"
        :options="windowOptions"
        label-key="label"
        value-key="value"
        class="w-28"
        data-test="prompt-traffic-window"
      />
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        @click="refresh"
      />
    </div>

    <div
      v-if="error"
      class="rounded-default bg-error-subtle text-status-error-text px-3 py-2 text-xs"
    >
      {{ error }}
    </div>
    <div
      v-if="!streamName"
      class="text-text-secondary rounded-default border-border-default border border-dashed p-6 text-center text-xs"
    >
      {{ t("aiObservability.promptManagement.selectTraceStream") }}
    </div>

    <template v-else>
      <section class="grid grid-cols-5 gap-2 max-lg:grid-cols-3 max-md:grid-cols-2">
        <div
          v-for="card in cards"
          :key="card.label"
          class="rounded-default border-border-default bg-surface-base border p-3"
        >
          <div class="text-text-secondary text-2xs font-semibold">{{ card.label }}</div>
          <div class="text-text-heading mt-1 text-xl font-bold tabular-nums">{{ card.value }}</div>
        </div>
      </section>

      <section>
        <h4 class="text-text-heading mb-2 text-sm font-semibold">
          {{ t("aiObservability.promptManagement.byLabelAndModel") }}
        </h4>
        <OTable
          :data="breakdown"
          :columns="breakdownColumns"
          row-key="label"
          :show-global-filter="false"
          :show-footer="false"
          :loading="loading"
          data-test="prompt-traffic-breakdown"
        />
      </section>

      <section>
        <h4 class="text-text-heading mb-2 text-sm font-semibold">
          {{ t("aiObservability.promptManagement.recentAttributedCalls") }}
        </h4>
        <OTable
          :data="recent"
          :columns="recentColumns"
          row-key="id"
          :show-global-filter="false"
          :show-footer="false"
          :page-size="20"
          :loading="loading"
          data-test="prompt-traffic-recent"
        >
          <template #cell-scores="{ row }">
            <div class="flex flex-wrap gap-1">
              <OTag
                v-for="score in row.scores"
                :key="`${score.name}-${score.value}`"
                variant="default-soft"
              >
                {{ score.name }}: {{ score.value }}
              </OTag>
              <span v-if="!row.scores.length" class="text-text-secondary">{{ raw("—") }}</span>
            </div>
          </template>
        </OTable>
      </section>

      <section>
        <h4 class="text-text-heading mb-2 text-sm font-semibold">
          {{ t("aiObservability.promptManagement.experimentEvidence") }}
        </h4>
        <div v-if="!evidence.length" class="text-text-secondary text-xs">
          {{ t("aiObservability.promptManagement.noExperimentEvidence") }}
        </div>
        <article
          v-for="entry in evidence"
          :key="entry.experiment.id"
          class="border-b-border-default flex items-center gap-2 border-b py-2 text-xs"
        >
          <span class="text-text-heading min-w-0 flex-1 truncate font-medium">{{
            entry.experiment.name
          }}</span>
          <OTag v-if="entry.kind === 'content_match'" variant="default-soft">
            {{ t("aiObservability.promptManagement.contentMatch") }}
          </OTag>
          <span class="text-text-secondary">{{ entry.experiment.status }}</span>
        </article>
        <p class="text-text-secondary text-2xs mt-2">
          {{ t("aiObservability.promptManagement.contentMatchHelp") }}
        </p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from "vue";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import useStreams from "@/composables/useStreams";
import { useI18nTyped, raw } from "@/types/i18n";
import { timestampToTimezoneDate } from "@/utils/timezone";
import type { Prompt, PromptVersion } from "@/services/llm-prompts.service";
import {
  usePromptAnalytics,
  type PromptAnalyticsWindow,
  type PromptTrafficRow,
} from "./usePromptAnalytics";

const props = defineProps<{
  orgId: string;
  prompt: Prompt;
  version: PromptVersion;
}>();

const store = useStore();
const { t } = useI18nTyped();
const { getStreams } = useStreams(t);
const streamName = ref("");
const window = ref<PromptAnalyticsWindow>("24h");
const promptRef = toRef(props, "prompt");
const versionRef = toRef(props, "version");
const { kpis, breakdown, recent, evidence, loading, error, loadTraffic, loadExperimentEvidence } =
  usePromptAnalytics(promptRef, versionRef, streamName, window);

const streamOptions = computed(() =>
  (store.state.streams?.traces?.list ?? []).map((stream: { name: string }) => ({
    label: raw(stream.name),
    value: stream.name,
  })),
);
const windowOptions = [
  { label: raw("24h"), value: "24h" },
  { label: raw("7d"), value: "7d" },
  { label: raw("30d"), value: "30d" },
];
const cards = computed(() => [
  { label: t("aiObservability.promptManagement.calls"), value: kpis.value.calls.toLocaleString() },
  {
    label: t("aiObservability.promptManagement.errorRate"),
    value: kpis.value.errorRate == null ? "—" : `${kpis.value.errorRate.toFixed(1)}%`,
  },
  {
    label: t("aiObservability.promptManagement.p50Latency"),
    value: kpis.value.p50LatencyMs == null ? "—" : `${kpis.value.p50LatencyMs.toFixed(0)} ms`,
  },
  {
    label: t("aiObservability.promptManagement.p95Latency"),
    value: kpis.value.p95LatencyMs == null ? "—" : `${kpis.value.p95LatencyMs.toFixed(0)} ms`,
  },
  {
    label: t("aiObservability.promptManagement.cost"),
    value: kpis.value.cost == null ? "—" : `$${kpis.value.cost.toFixed(4)}`,
  },
]);
function displayMilliseconds(value: unknown): string {
  if (value == null || value === "") return "—";
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) ? milliseconds.toFixed(0) : "—";
}
function displayCost(value: unknown): string {
  if (value == null || value === "") return "—";
  const cost = Number(value);
  return Number.isFinite(cost) ? `$${cost.toFixed(6)}` : "—";
}
const breakdownColumns: OTableColumnDef[] = [
  { id: "label", header: t("aiObservability.promptManagement.label"), accessorKey: "label" },
  { id: "model", header: t("aiObservability.promptManagement.model"), accessorKey: "model" },
  { id: "calls", header: t("aiObservability.promptManagement.calls"), accessorKey: "calls" },
  { id: "errors", header: t("aiObservability.promptManagement.errors"), accessorKey: "errors" },
  {
    id: "p50_latency_ms",
    header: t("aiObservability.promptManagement.p50Milliseconds"),
    accessorFn: (row: Record<string, unknown>) => displayMilliseconds(row.p50_latency_ms),
  },
  {
    id: "p95_latency_ms",
    header: t("aiObservability.promptManagement.p95Milliseconds"),
    accessorFn: (row: Record<string, unknown>) => displayMilliseconds(row.p95_latency_ms),
  },
  {
    id: "cost",
    header: t("aiObservability.promptManagement.cost"),
    accessorFn: (row: Record<string, unknown>) => displayCost(row.cost),
  },
];
const recentColumns: OTableColumnDef[] = [
  {
    id: "timestamp",
    header: t("aiObservability.promptManagement.time"),
    accessorFn: (row: PromptTrafficRow) => {
      const timestampUs = Number(row.timestamp);
      return Number.isFinite(timestampUs)
        ? timestampToTimezoneDate(
            timestampUs / 1_000,
            store.state.timezone,
            "yyyy-MM-dd HH:mm:ss.SSS",
          )
        : "—";
    },
  },
  { id: "model", header: t("aiObservability.promptManagement.model"), accessorKey: "model" },
  { id: "label", header: t("aiObservability.promptManagement.label"), accessorKey: "label" },
  { id: "status", header: t("aiObservability.promptManagement.status"), accessorKey: "status" },
  {
    id: "latencyMs",
    header: t("aiObservability.promptManagement.latencyMilliseconds"),
    accessorFn: (row: PromptTrafficRow) => displayMilliseconds(row.latencyMs),
  },
  {
    id: "cost",
    header: t("aiObservability.promptManagement.cost"),
    accessorFn: (row: PromptTrafficRow) => displayCost(row.cost),
  },
  {
    id: "scores",
    header: t("aiObservability.promptManagement.latestScores"),
    accessorKey: "scores",
  },
];

async function refresh() {
  await Promise.all([loadTraffic(), loadExperimentEvidence(props.orgId)]);
}

onMounted(async () => {
  await getStreams("traces", false, false).catch(() => null);
  if (!streamName.value && streamOptions.value.length)
    streamName.value = streamOptions.value[0].value;
  await loadExperimentEvidence(props.orgId).catch(() => null);
});
watch(
  () => [props.version.id, props.orgId],
  () => loadExperimentEvidence(props.orgId),
);
</script>
