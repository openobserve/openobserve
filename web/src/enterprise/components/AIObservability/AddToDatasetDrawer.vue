<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  "Dataset" from a trace or span: turn this object into a golden. The server
  re-reads and purifies the INPUT from the trace reference, so the only thing a
  human supplies is the expected output — a golden with no answer is not a
  golden, which is why Save stays disabled until one is written.
-->
<template>
  <ODrawer
    :open="open"
    side="right"
    size="lg"
    :title="t('aiObservability.traceActions.dataset.title')"
    :primary-button-label="t('aiObservability.traceActions.dataset.confirm')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-disabled="!canSubmit"
    :primary-button-loading="submitting"
    data-test="trace-dataset-drawer"
    @update:open="(value: boolean) => emit('update:open', value)"
    @click:primary="submit"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <span class="text-text-secondary text-xs">
        {{ t("aiObservability.traceActions.dataset.hint", { ref: refLabel }) }}
      </span>

      <div class="flex flex-col gap-1.5">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.traceActions.dataset.datasetLabel") }}
        </span>
        <OSelect
          :model-value="selectedDatasetId"
          :options="datasetOptions"
          label-key="label"
          value-key="value"
          :loading="loading"
          :placeholder="t('aiObservability.traceActions.dataset.datasetPlaceholder')"
          class="w-full"
          data-test="trace-dataset-select"
          @update:model-value="(v: unknown) => (selectedDatasetId = v ? String(v) : '')"
        />
        <span v-if="!loading && !datasetOptions.length" class="text-text-secondary text-2xs">
          {{ t("aiObservability.traceActions.dataset.noDatasets") }}
        </span>
      </div>

      <!-- The input is read-only: the server re-reads it from the trace, so what
           is shown here is exactly what the golden will carry. -->
      <div v-if="inputPreview" class="flex flex-col gap-1.5">
        <span class="inline-flex items-center gap-1">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.traceActions.dataset.inputLabel") }}
          </span>
          <span class="text-text-secondary text-2xs font-normal">
            {{ t("aiObservability.traceActions.dataset.inputReadOnly") }}
          </span>
        </span>
        <div
          class="border-border-default bg-code-bg rounded-default text-text-body max-h-40 overflow-auto border px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap"
          data-test="trace-dataset-input-preview"
        >
          {{ inputPreview }}
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
          {{ t("aiObservability.traceActions.dataset.expectedLabel") }}
        </span>
        <OTextarea
          v-model="expectedOutput"
          :placeholder="t('aiObservability.traceActions.dataset.expectedPlaceholder')"
          :rows="6"
          data-test="trace-dataset-expected"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="inline-flex items-center gap-1">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.datasets.create.tagsLabel") }}
          </span>
          <span class="text-text-secondary text-2xs font-normal">{{ t("common.optional") }}</span>
        </span>
        <OTagInput
          v-model="tags"
          :placeholder="t('aiObservability.datasets.create.tagsPlaceholder')"
          data-test="trace-dataset-tags"
        />
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";

defineOptions({ name: "AddToDatasetDrawer" });

const props = defineProps<{
  open: boolean;
  orgId: string;
  refType: "trace" | "span";
  refId: string;
  /** The trace stream the reference lives in. */
  sourceStream: string;
  /** Reference start time in MICROSECONDS. */
  refTraceStartTime: number;
  /** Read-only view of the input this golden will carry. */
  inputPreview?: string;
}>();

const emit = defineEmits<{
  (_e: "update:open", _value: boolean): void;
  (_e: "added", _datasetId: string): void;
}>();

const { t } = useI18nTyped();

const datasets = ref<LlmDataset[]>([]);
const loading = ref(false);
const submitting = ref(false);
const selectedDatasetId = ref("");
const expectedOutput = ref("");
const tags = ref<string[]>([]);

const refLabel = computed(() => raw(props.refId));

const datasetOptions = computed(() =>
  datasets.value.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

const canSubmit = computed(
  () => Boolean(selectedDatasetId.value) && expectedOutput.value.trim().length > 0,
);

// Datasets load on first open, never with the trace view.
// `immediate` matters: the host sets the target and `open` in the SAME tick,
// so this component is created with open ALREADY true and a plain watcher
// would never fire — the list would stay empty.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    selectedDatasetId.value = "";
    expectedOutput.value = "";
    tags.value = [];
    if (datasets.value.length || loading.value || !props.orgId) return;
    loading.value = true;
    try {
      datasets.value = await llmDatasetsService.list(props.orgId);
    } catch {
      toast({ variant: "error", message: t("aiObservability.traceActions.dataset.loadError") });
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    await llmDatasetsService.addTelemetryItem(props.orgId, selectedDatasetId.value, {
      refType: props.refType,
      refId: props.refId,
      sourceStream: props.sourceStream,
      refTraceStartTime: props.refTraceStartTime,
      expectedOutput: expectedOutput.value.trim(),
      tags: tags.value,
    });
    toast({
      variant: "success",
      message: t("aiObservability.traceActions.dataset.success"),
    });
    emit("added", selectedDatasetId.value);
    emit("update:open", false);
  } catch {
    toast({ variant: "error", message: t("aiObservability.traceActions.dataset.error") });
  } finally {
    submitting.value = false;
  }
}
</script>
