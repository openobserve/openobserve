<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  Asks which run to measure THIS one against, then opens the comparison. The
  open experiment is always the candidate; only the baseline is chosen, because
  "compare this against X" is the question the detail page raises.
-->
<template>
  <ODialog
    :open="open"
    :title="t('aiObservability.experiments.detail.comparePicker.title')"
    form-id="experiment-compare-form"
    :primary-button-label="t('aiObservability.experiments.detail.comparePicker.confirm')"
    :secondary-button-label="t('common.cancel')"
    data-test="ai-experiment-compare-picker"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OForm id="experiment-compare-form" :form="form" class="flex flex-col gap-5">
      <span class="text-text-secondary text-xs">
        {{ t("aiObservability.experiments.detail.comparePicker.hint") }}
      </span>

      <OFormSelect
        name="baselineId"
        :label="t('aiObservability.experiments.detail.comparePicker.baselineLabel')"
        :options="baselineOptions"
        :loading="loading"
        :placeholder="t('aiObservability.experiments.detail.comparePicker.baselinePlaceholder')"
        searchable
        required
        data-test="ai-experiment-compare-picker-select"
      />

      <span
        v-if="!loading && !baselineOptions.length"
        class="text-text-secondary text-2xs"
        data-test="ai-experiment-compare-picker-empty"
      >
        {{ t("aiObservability.experiments.detail.comparePicker.noPeers") }}
      </span>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmExperimentsService, { type LlmExperiment } from "@/services/llm-experiments.service";
import {
  experimentCompareDefaults,
  makeExperimentCompareSchema,
  type ExperimentCompareForm,
} from "./ExperimentCompareForm.schema";

const props = defineProps<{
  open: boolean;
  orgId: string;
  /** The run being viewed — the candidate side of the comparison. */
  experimentId: string;
  /** Only runs pinned to this dataset can be compared; the server rejects others. */
  datasetId: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  compare: [baselineId: string];
}>();

const { t } = useI18nTyped();

const peers = ref<LlmExperiment[]>([]);
const loading = ref(false);

const baselineOptions = computed(() =>
  peers.value
    .filter(
      (experiment) =>
        experiment.id !== props.experimentId && experiment.datasetId === props.datasetId,
    )
    .map((experiment) => ({
      label: raw(experiment.name) || raw(experiment.id),
      value: experiment.id,
    })),
);

const form = useOForm<ExperimentCompareForm>({
  defaultValues: experimentCompareDefaults(),
  schema: makeExperimentCompareSchema(t),
  onSubmit: (values) => {
    emit("compare", values.baselineId);
    emit("update:open", false);
  },
});

// `immediate`: the host can set `open` in the same tick this mounts, so a plain
// watcher would never fire and the list would stay empty.
watch(
  () => props.open,
  async (open) => {
    if (!open || !props.orgId) return;
    form.reset(experimentCompareDefaults());
    loading.value = true;
    try {
      peers.value = await llmExperimentsService.list(props.orgId);
    } catch (error: any) {
      peers.value = [];
      toast({
        variant: "error",
        message:
          raw(error?.response?.data?.message) ||
          t("aiObservability.experiments.detail.comparePicker.loadError"),
      });
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>
