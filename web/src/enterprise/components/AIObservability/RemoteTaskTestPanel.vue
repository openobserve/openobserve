<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  The Test-connection rail on the register/edit form.

  A test connection is not a preview: it is the ONLY thing that publishes a
  version, so this panel is the register button's other half rather than an
  optional extra. It always shows the raw exchange, on success and on failure
  alike, because "what did we actually send, and what came back" is the only
  thing that helps when someone else's service says no.
-->
<template>
  <aside
    class="border-border-default max-[68.75rem]:border-border-default flex min-h-0 flex-col overflow-auto border-l max-[68.75rem]:border-t max-[68.75rem]:border-l-0"
    data-test="ai-remote-task-test-panel"
  >
    <div class="flex flex-col gap-4 p-5">
      <div class="flex flex-col gap-1">
        <h3 class="text-text-heading m-0 text-sm font-bold">
          {{ t("aiObservability.remoteTasks.testPanel.title") }}
        </h3>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.remoteTasks.testPanel.sourceLabel") }}
        </span>
        <OToggleGroup v-model="source" type="single" data-test="ai-remote-task-test-source">
          <OToggleGroupItem value="dataset" size="sm">
            {{ t("aiObservability.remoteTasks.testPanel.sourceDataset") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="manual" size="sm">
            {{ t("aiObservability.remoteTasks.testPanel.sourceManual") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <!-- The picker is a convenience the FE builds, not a backend feature: it
           reads one dataset item and drops its input into the field below, so
           what gets sent is still exactly what is shown. -->
      <OSelect
        v-if="source === 'dataset'"
        v-model="datasetId"
        :label="t('aiObservability.remoteTasks.testPanel.datasetLabel')"
        :placeholder="t('aiObservability.remoteTasks.testPanel.datasetPlaceholder')"
        :options="datasetOptions"
        :loading="loadingDatasets || loadingSample"
        data-test="ai-remote-task-test-dataset"
        @update:model-value="onDatasetPicked"
      />

      <OTextarea
        :model-value="input"
        @update:model-value="emit('update:input', String($event ?? ''))"
        :label="t('aiObservability.remoteTasks.testPanel.inputLabel')"
        :placeholder="t('aiObservability.remoteTasks.testPanel.inputPlaceholder')"
        :rows="4"
        size="sm"
        data-test="ai-remote-task-test-input"
      />

      <OTextarea
        :model-value="metadata"
        @update:model-value="emit('update:metadata', String($event ?? ''))"
        :label="t('aiObservability.remoteTasks.testPanel.metadataLabel')"
        :placeholder="t('aiObservability.remoteTasks.testPanel.metadataPlaceholder')"
        :rows="2"
        size="sm"
        data-test="ai-remote-task-test-metadata"
      />

      <div class="flex flex-col items-start gap-1.5">
        <OButton
          variant="primary"
          size="sm-action"
          icon-left="play-arrow"
          :loading="state === 'running'"
          :disabled="state === 'running' || !canRun"
          data-test="ai-remote-task-test-run-btn"
          @click="emit('run')"
        >
          {{ t("aiObservability.remoteTasks.testPanel.run") }}
        </OButton>
        <span
          v-if="!canRun && state !== 'running'"
          class="text-text-secondary text-2xs italic"
          data-test="ai-remote-task-test-disabled-hint"
        >
          {{ t("aiObservability.remoteTasks.testPanel.disabledHint") }}
        </span>
      </div>

      <p
        v-if="state === 'idle'"
        class="text-text-secondary border-border-default rounded-default bg-surface-base m-0 border px-3 py-2.5 text-xs"
        data-test="ai-remote-task-test-idle"
      >
        {{ t("aiObservability.remoteTasks.testPanel.idle") }}
      </p>

      <div
        v-else
        class="border-border-default rounded-default bg-surface-base flex flex-col gap-2.5 border p-3"
        :class="{
          'border-status-success-text': state === 'passed',
          'border-status-error-text': state === 'failed',
        }"
        data-test="ai-remote-task-test-result"
      >
        <span v-if="state === 'running'" class="text-text-secondary text-xs">
          {{ t("aiObservability.remoteTasks.testPanel.running") }}
        </span>

        <template v-else>
          <div class="flex items-center gap-2">
            <OTag :variant="state === 'passed' ? 'success-soft' : 'error-soft'" dot>
              {{
                state === "passed"
                  ? t("aiObservability.remoteTasks.testPanel.passed")
                  : t("aiObservability.remoteTasks.testPanel.failed")
              }}
            </OTag>
          </div>

          <p
            v-if="errorMessage"
            class="text-status-error-text m-0 text-xs leading-relaxed"
            data-test="ai-remote-task-test-error"
          >
            {{ errorMessage }}
          </p>

          <dl
            v-if="report"
            class="text-text-secondary m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
          >
            <template v-if="report.statusCode !== undefined">
              <dt class="font-medium">
                {{ t("aiObservability.remoteTasks.testPanel.statusCode") }}
              </dt>
              <dd class="text-text-body m-0 tabular-nums">{{ report.statusCode }}</dd>
            </template>
            <dt class="font-medium">{{ t("aiObservability.remoteTasks.testPanel.latency") }}</dt>
            <dd class="text-text-body m-0 tabular-nums">{{ latencyLabel }}</dd>
          </dl>

          <template v-if="report && report.parsedOutput !== undefined">
            <span class="text-text-heading text-2xs font-semibold">
              {{ t("aiObservability.remoteTasks.testPanel.output") }}
            </span>
            <pre
              class="rounded-default bg-card-bg border-border-default text-text-body m-0 max-h-40 overflow-auto border p-2 font-mono text-xs whitespace-pre-wrap"
              data-test="ai-remote-task-test-output"
              >{{ prettyJson(report.parsedOutput) }}</pre>
          </template>

          <template v-if="report">
            <details class="text-text-secondary text-xs">
              <summary class="cursor-pointer font-medium">
                {{ t("aiObservability.remoteTasks.testPanel.rawRequest") }}
              </summary>
              <pre
                class="rounded-default bg-card-bg border-border-default text-text-body mt-1.5 max-h-40 overflow-auto border p-2 font-mono text-xs whitespace-pre-wrap"
                data-test="ai-remote-task-test-raw-request"
                >{{ prettyJson(report.rawRequest) }}</pre>
            </details>
            <details class="text-text-secondary text-xs">
              <summary class="cursor-pointer font-medium">
                {{ t("aiObservability.remoteTasks.testPanel.rawResponse") }}
              </summary>
              <pre
                class="rounded-default bg-card-bg border-border-default text-text-body mt-1.5 max-h-40 overflow-auto border p-2 font-mono text-xs whitespace-pre-wrap"
                data-test="ai-remote-task-test-raw-response"
                >{{ prettyJson(report.rawResponse) }}</pre>
            </details>
          </template>
        </template>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService from "@/services/llm-datasets.service";
import type { RemoteTaskVerificationReport } from "@/services/remote-tasks.service";
import { prettyJson } from "./remoteTaskContent";

const props = defineProps<{
  orgId: string;
  /**
   * The sample lives on the page, not here: the footer's primary button submits
   * the same test this panel runs, so a copy in the panel would be a second
   * source of truth for what gets sent.
   */
  input: string;
  metadata: string;
  /** Whether the configuration is complete enough for a call to mean anything. */
  canRun: boolean;
  state: "idle" | "running" | "passed" | "failed";
  report: RemoteTaskVerificationReport | null;
  errorMessage: I18nText | null;
}>();

const emit = defineEmits<{
  "update:input": [value: string];
  "update:metadata": [value: string];
  run: [];
}>();

const { t } = useI18nTyped();

const source = ref<"dataset" | "manual">("dataset");
const datasetId = ref("");
const datasets = ref<{ id: string; name: string }[]>([]);
const loadingDatasets = ref(false);
const loadingSample = ref(false);

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

const latencyLabel = computed(() =>
  props.report ? raw(`${props.report.latencyMs} ms`) : raw("—"),
);

/** Reads one item and drops its input into the field, so the request that goes
 *  out is still exactly the text on screen. */
async function onDatasetPicked(value: unknown) {
  const id = String(value ?? "");
  if (!id || !props.orgId) return;
  loadingSample.value = true;
  try {
    const page = await llmDatasetsService.listItems(props.orgId, id, { from: 0, size: 1 });
    const first = page.items[0];
    if (!first) {
      toast({
        variant: "warning",
        message: t("aiObservability.remoteTasks.testPanel.datasetEmpty"),
      });
      return;
    }
    emit("update:input", first.input);
  } catch {
    toast({ variant: "error", message: t("aiObservability.remoteTasks.testPanel.datasetError") });
  } finally {
    loadingSample.value = false;
  }
}

onMounted(async () => {
  if (!props.orgId) return;
  loadingDatasets.value = true;
  try {
    datasets.value = await llmDatasetsService.list(props.orgId);
  } catch {
    datasets.value = [];
  } finally {
    loadingDatasets.value = false;
  }
});
</script>
