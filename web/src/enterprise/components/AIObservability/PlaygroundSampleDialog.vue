<!-- Copyright 2026 OpenObserve Inc.

  Pull up to ten rows out of a dataset and into the bench.

  Rows are copied BY VALUE. A later edit to the dataset never changes what the
  bench ran on, which is the only way a Playground result stays interpretable
  once you walk away from it.

  The zero-reference warning here is informational only — sampling costs
  nothing, and "sample first, fix the prompt after" is a legitimate order of
  work. The hard gate lives on Run, where the money is.
-->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('aiObservability.playground.sampleTitle')"
    :primary-button-label="submitLabel"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="loading"
    :primary-button-disabled="!datasetId || room <= 0"
    data-test="ai-playground-sample-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="submit"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-4">
      <OSelect
        v-model="datasetId"
        :options="datasetOptions"
        :label="t('aiObservability.playground.sampleDataset')"
        :placeholder="t('aiObservability.playground.sampleDatasetPlaceholder')"
        size="sm"
        searchable
        data-test="ai-playground-sample-dataset"
      />

      <div class="flex flex-col gap-1.5">
        <span class="text-text-heading text-xs font-semibold">
          {{ t("aiObservability.playground.sampleRowFields") }}
          <span class="text-text-secondary font-normal">
            {{ t("aiObservability.playground.sampleRowFieldsHelp", { token: variableToken }) }}
          </span>
        </span>
        <div class="flex flex-wrap items-center gap-1.5">
          <OTag
            v-for="field in datasetFields"
            :key="field"
            :variant="templateVars.includes(field) ? 'success' : 'default'"
            size="sm"
            :label="raw(tokenFor(field))"
            :data-test="`ai-playground-sample-field-${field}`"
          />
          <span v-if="referencedFields.length" class="text-text-secondary text-2xs">
            {{ t("aiObservability.playground.sampleInTemplate") }}
          </span>
        </div>
      </div>

      <OBanner
        v-if="zeroReference"
        variant="warning"
        dense
        icon="warning"
        :content="
          t('aiObservability.playground.zeroRefSampleWarning', { token: tokenFor('input') })
        "
        data-test="ai-playground-sample-zero-ref"
      />

      <div class="flex flex-col gap-1.5">
        <span class="text-text-heading text-xs font-semibold">
          {{ t("aiObservability.playground.sampleRows") }}
          <span class="text-text-secondary font-normal">
            {{ t("aiObservability.playground.sampleRowsHelp") }}
          </span>
        </span>
        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="icon-xs"
            icon-left="remove"
            :disabled="count <= 1"
            data-test="ai-playground-sample-decrement"
            @click="count = Math.max(1, count - 1)"
          />
          <span class="w-6 text-center font-mono text-sm font-bold">{{ count }}</span>
          <OButton
            variant="outline"
            size="icon-xs"
            icon-left="add"
            :disabled="count >= room"
            data-test="ai-playground-sample-increment"
            @click="count = Math.min(room, count + 1)"
          />
          <span class="text-text-secondary text-xs">
            {{ t("aiObservability.playground.sampleMax", { max: room }) }}
          </span>
        </div>
        <span class="text-text-secondary text-2xs">
          {{ t("aiObservability.playground.sampleCopies") }}
        </span>
      </div>

      <div v-if="currentRows > 0" class="flex flex-col gap-1.5">
        <span class="text-text-heading text-xs font-semibold">
          {{ t("aiObservability.playground.sampleExisting") }}
        </span>
        <ORadioGroup v-model="mode" :options="modeOptions" data-test="ai-playground-sample-mode" />
      </div>

      <p class="text-text-secondary m-0 text-xs leading-relaxed">
        {{ t("aiObservability.playground.sampleScaleNote") }}
      </p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, { type LlmDataset } from "@/services/llm-datasets.service";
import {
  MAX_ROWS,
  playgroundId,
  type PlaygroundRow,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  open: boolean;
  datasets: LlmDataset[];
  initialDatasetId: string;
  currentRows: number;
  templateVars: string[];
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  sample: [rows: PlaygroundRow[], mode: "replace" | "add"];
}>();

const { t } = useI18nTyped();
const store = useStore();

const variableToken = "{{variables}}";

function tokenFor(name: string) {
  return `{{${name}}}`;
}

const datasetId = ref("");
const count = ref(5);
const mode = ref<"replace" | "add">("replace");
const loading = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    datasetId.value = props.initialDatasetId || props.datasets[0]?.id || "";
    count.value = 5;
    mode.value = "replace";
  },
  { immediate: true },
);

const datasetOptions = computed(() =>
  props.datasets.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

/** A plain-text dataset row binds as `{{input}}` — the 3.0 binding rule. */
const datasetFields = ["input"];

const referencedFields = computed(() =>
  datasetFields.filter((field) => props.templateVars.includes(field)),
);

const zeroReference = computed(() => referencedFields.value.length === 0);

/** Replacing frees every slot; adding is capped by what is already on the bench. */
const room = computed(() =>
  mode.value === "add" ? Math.max(0, MAX_ROWS - props.currentRows) : MAX_ROWS,
);

watch(room, (available) => {
  if (count.value > available) count.value = Math.max(1, available);
});

const modeOptions = computed(() => [
  { label: t("aiObservability.playground.sampleReplace"), value: "replace" },
  {
    label: t("aiObservability.playground.sampleAdd", {}),
    value: "add",
    disabled: MAX_ROWS - props.currentRows <= 0,
  },
]);

const submitLabel = computed(() =>
  mode.value === "add"
    ? t("aiObservability.playground.sampleAddSubmit", { count: count.value })
    : t("aiObservability.playground.sampleSubmit", { count: count.value }),
);

/**
 * Fetch a page and take a random slice of it. The items endpoint has no random
 * sampler, and the bench needs at most ten rows, so drawing from the first page
 * is honest about what "sample" means here without a second round trip.
 */
async function submit() {
  if (!datasetId.value) return;
  loading.value = true;
  try {
    const page = await llmDatasetsService.listItems(
      store.state.selectedOrganization?.identifier ?? "",
      datasetId.value,
      { from: 0, size: 100 },
    );
    if (!page.items.length) {
      toast({ variant: "warning", message: t("aiObservability.playground.sampleEmpty") });
      return;
    }

    const dataset = props.datasets.find((candidate) => candidate.id === datasetId.value);
    const shuffled = [...page.items].sort(() => Math.random() - 0.5).slice(0, count.value);

    const rows: PlaygroundRow[] = shuffled.map((item) => ({
      id: playgroundId("row"),
      input: item.inputPreview || item.input,
      expectedOutput: item.expectedOutput,
      source: {
        datasetId: datasetId.value,
        datasetName: dataset?.name ?? datasetId.value,
        itemId: item.id,
      },
    }));

    emit("sample", rows, mode.value);
    emit("update:open", false);
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.sampleLoadError") });
  } finally {
    loading.value = false;
  }
}
</script>
