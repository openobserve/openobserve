<!-- Copyright 2026 OpenObserve Inc.

  Pull ONE item out of a dataset and into the bench's variable values.

  One item, not a table of them: conclusions over a whole dataset are an
  experiment's job. The bench's job is to look at a single case closely, and
  the neighbouring cases are a Next away without leaving the page.

  The item is copied BY VALUE. A later edit to the dataset never changes what
  the bench ran on, which is the only way a Playground result stays
  interpretable once you walk away from it.
-->
<template>
  <ODialog
    :open="open"
    size="sm"
    :title="t('aiObservability.playground.sampleTitle')"
    :primary-button-label="t('aiObservability.playground.sampleSubmit')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="loading"
    :primary-button-disabled="!datasetId"
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

      <p
        v-if="selectedDataset"
        class="text-text-secondary m-0 text-xs leading-relaxed"
        data-test="ai-playground-sample-summary"
      >
        {{
          t("aiObservability.playground.sampleSummary", {
            count: selectedDataset.itemCount,
            token: inputToken,
          })
        }}
      </p>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, {
  type LlmDataset,
  type LlmDatasetItem,
} from "@/services/llm-datasets.service";
import type { PlaygroundSample } from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  open: boolean;
  datasets: LlmDataset[];
  initialDatasetId: string;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  sample: [sample: PlaygroundSample, item: LlmDatasetItem];
}>();

const { t } = useI18nTyped();
const store = useStore();

const datasetId = ref("");
const loading = ref(false);

const inputToken = raw("{{input}}");

const datasetOptions = computed(() =>
  props.datasets.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

const selectedDataset = computed(
  () => props.datasets.find((candidate) => candidate.id === datasetId.value) ?? null,
);

watch(
  () => props.open,
  (open) => {
    if (open) datasetId.value = props.initialDatasetId || props.datasets[0]?.id || "";
  },
  { immediate: true },
);

/** A random position, fetched one row wide. The items endpoint has no random
 *  sampler, but it does page — so the whole dataset is reachable, not just the
 *  first page, and Next walks from wherever this lands. */
async function submit() {
  const dataset = selectedDataset.value;
  if (!dataset) return;
  loading.value = true;
  try {
    const total = dataset.itemCount;
    if (total <= 0) {
      toast({ variant: "warning", message: t("aiObservability.playground.sampleEmpty") });
      return;
    }
    const index = Math.floor(Math.random() * total);
    const page = await llmDatasetsService.listItems(
      store.state.selectedOrganization?.identifier ?? "",
      dataset.id,
      { from: index, size: 1 },
    );
    const item = page.items[0];
    if (!item) {
      toast({ variant: "warning", message: t("aiObservability.playground.sampleEmpty") });
      return;
    }
    emit(
      "sample",
      {
        datasetId: dataset.id,
        datasetName: dataset.name,
        itemId: item.id,
        index,
        total: page.total,
      },
      item,
    );
    emit("update:open", false);
  } catch {
    toast({ variant: "error", message: t("aiObservability.playground.sampleLoadError") });
  } finally {
    loading.value = false;
  }
}
</script>
