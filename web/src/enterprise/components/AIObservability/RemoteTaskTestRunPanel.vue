<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  The test-run bench: try the latest published version against a handful of
  samples using the real contract — same template, auth, signing, headers,
  timeout, and retry policy an Experiment would use.

  It is volatile by design: no Experiment, no execution records, no history. The
  panel says so, because a results table that looks like a run would otherwise
  imply the numbers were kept.
-->
<template>
  <section class="flex flex-col gap-3" data-test="ai-remote-task-test-run-panel">
    <div class="flex flex-col gap-1">
      <h3 class="text-text-heading m-0 text-sm font-bold">
        {{ t("aiObservability.remoteTasks.testRun.title") }}
      </h3>
      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.remoteTasks.testRun.hint") }}
      </p>
    </div>

    <p
      v-if="!canRun"
      class="text-text-secondary border-border-default rounded-default bg-surface-base m-0 border px-3 py-2.5 text-xs"
      data-test="ai-remote-task-test-run-blocked"
    >
      {{ t("aiObservability.remoteTasks.testRun.needsPublished") }}
    </p>

    <template v-else>
      <div class="flex flex-col gap-2">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.remoteTasks.testRun.samplesLabel") }}
        </span>
        <div v-for="(_, index) in samples" :key="index" class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <OTextarea
              :model-value="samples[index]"
              :placeholder="t('aiObservability.remoteTasks.testRun.samplePlaceholder')"
              :rows="2"
              size="sm"
              :data-test="`ai-remote-task-test-run-sample-${index}`"
              @update:model-value="updateSample(index, String($event ?? ''))"
            />
          </div>
          <OButton
            variant="ghost-destructive"
            size="icon-sm"
            icon-left="delete"
            :disabled="samples.length === 1"
            :aria-label="t('aiObservability.remoteTasks.testRun.removeSample')"
            :data-test="`ai-remote-task-test-run-remove-${index}`"
            @click="removeSample(index)"
          />
        </div>
        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="sm"
            icon-left="add"
            :disabled="samples.length >= MAX_SAMPLES"
            data-test="ai-remote-task-test-run-add"
            @click="addSample"
          >
            {{ t("aiObservability.remoteTasks.testRun.addSample") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            icon-left="play-arrow"
            :loading="running"
            :disabled="running || !hasSample"
            data-test="ai-remote-task-test-run-btn"
            @click="run"
          >
            {{ t("aiObservability.remoteTasks.testRun.run") }}
          </OButton>
        </div>
      </div>

      <div v-if="results.length" class="flex flex-col gap-2">
        <span class="text-text-heading text-compact font-semibold">
          {{ t("aiObservability.remoteTasks.testRun.resultsTitle") }}
        </span>
        <OTable
          :data="results"
          :columns="columns"
          row-key="rowId"
          :frame="false"
          :show-global-filter="false"
          :page-size="10"
          width="100%"
          data-test="ai-remote-task-test-run-results"
        >
          <template #cell-status="{ row }">
            <OTag :variant="statusVariant(row.status)" dot>{{ statusLabel(row.status) }}</OTag>
          </template>
          <template #cell-parsedOutput="{ row }">
            <span
              v-if="row.parsedOutput !== undefined"
              class="text-text-body line-clamp-1 font-mono text-xs"
            >
              {{ prettyJson(row.parsedOutput) }}
            </span>
            <span v-else class="text-status-error-text line-clamp-1 text-xs">
              {{ row.error || DASH }}
            </span>
          </template>
          <template #cell-latencyMs="{ row }">
            <span class="tabular-nums">{{ latency(row.latencyMs) }}</span>
          </template>
          <!-- The bench runs the registered retry policy, so a retried sample has
               to read as one; a silent "1 call" would measure a different task. -->
          <template #cell-attempts="{ row }">
            <span class="tabular-nums">{{ attemptsLabel(row.attempts) }}</span>
          </template>
        </OTable>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import remoteTasksService, { type RemoteTaskTestRunRow } from "@/services/remote-tasks.service";
import { parseSampleInput, prettyJson } from "./remoteTaskContent";

const props = defineProps<{
  orgId: string;
  entityId: string;
  /** The bench always runs the latest PUBLISHED version, so a head that has
   *  never published has nothing to run. */
  canRun: boolean;
  maxAttempts: number;
}>();

const { t } = useI18nTyped();

/** The server enforces this again; the button stops short of a guaranteed 400. */
const MAX_SAMPLES = 10;
const DASH = raw("—");

const samples = ref<string[]>([""]);
const results = ref<RemoteTaskTestRunRow[]>([]);
const running = ref(false);

const hasSample = computed(() => samples.value.some((sample) => sample.trim().length > 0));

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "rowId",
    header: t("aiObservability.remoteTasks.testRun.columns.row"),
    accessorKey: "rowId",
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("aiObservability.remoteTasks.testRun.columns.status"),
    accessorKey: "status",
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "parsedOutput",
    header: t("aiObservability.remoteTasks.testRun.columns.output"),
    accessorKey: "parsedOutput",
    sortable: false,
    size: 320,
    meta: { align: "left", flex: true },
  },
  {
    id: "latencyMs",
    header: t("aiObservability.remoteTasks.testRun.columns.latency"),
    accessorKey: "latencyMs",
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
  {
    id: "attempts",
    header: t("aiObservability.remoteTasks.testRun.columns.attempts"),
    accessorKey: "attempts",
    sortable: false,
    size: 120,
    meta: { align: "left" },
  },
]);

const latency = (value: number) => raw(`${value} ms`);

const attemptsLabel = (attempts: number) =>
  t("aiObservability.remoteTasks.testRun.attemptsValue", {
    count: attempts,
    max: props.maxAttempts,
  });

function statusVariant(status: string): BadgeVariant {
  if (status === "ok") return "success-soft";
  if (status === "skipped") return "default-soft";
  return "error-soft";
}

function statusLabel(status: string): I18nText {
  return raw(status);
}

function updateSample(index: number, value: string) {
  samples.value = samples.value.map((sample, position) => (position === index ? value : sample));
}

function addSample() {
  if (samples.value.length >= MAX_SAMPLES) return;
  samples.value = [...samples.value, ""];
}

function removeSample(index: number) {
  if (samples.value.length === 1) return;
  samples.value = samples.value.filter((_, position) => position !== index);
}

async function run() {
  running.value = true;
  try {
    const payload = samples.value
      .map((sample, index) => ({ sample, index }))
      .filter((entry) => entry.sample.trim().length > 0)
      .map((entry) => ({
        rowId: `sample-${entry.index + 1}`,
        input: parseSampleInput(entry.sample),
      }));
    results.value = await remoteTasksService.testRun(props.orgId, props.entityId, payload);
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        raw(error?.response?.data?.message) || t("aiObservability.remoteTasks.testRun.error"),
    });
  } finally {
    running.value = false;
  }
}
</script>
