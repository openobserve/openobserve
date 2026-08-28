<!-- Copyright 2026 OpenObserve Inc.

  Pull ONE item out of a dataset and into the bench's variable values.

  One item, not a table of them: conclusions over a whole dataset are an
  experiment's job. The bench's job is to look at a single case closely, and
  the neighbouring cases are a Next away without leaving the page.

  You choose which case. The dialog used to pick an index at random and say
  nothing about it, so two Samples of the same dataset gave two different
  benches and no way to tell which case either one was.

  The item is copied BY VALUE. A later edit to the dataset never changes what
  the bench ran on, which is the only way a Playground result stays
  interpretable once you walk away from it.
-->
<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('aiObservability.playground.sampleTitle')"
    :primary-button-label="t('aiObservability.playground.sampleSubmit')"
    :secondary-button-label="t('common.cancel')"
    :primary-button-loading="loading"
    :primary-button-disabled="!selectedItem"
    data-test="ai-playground-sample-dialog"
    @update:open="emit('update:open', $event)"
    @click:primary="submit"
    @click:secondary="emit('update:open', false)"
  >
    <div class="flex flex-col gap-3">
      <template v-if="viewing && selectedItem">
        <div class="flex items-center gap-2">
          <OButton
            variant="outline"
            size="xs"
            icon-left="arrow-back"
            data-test="ai-playground-sample-back"
            @click="viewing = false"
          >
            {{ t("aiObservability.playground.sampleBack") }}
          </OButton>
          <span class="text-text-secondary text-xs">
            {{
              t("aiObservability.playground.samplePosition", {
                dataset: selectedDataset?.name ?? "",
                index: from + selectedPosition + 1,
                total,
              })
            }}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.playground.sampleInput") }}
          </span>
          <div
            class="border-border-default rounded-default bg-surface-subtle text-text-body max-h-64 overflow-y-auto px-2.5 py-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
            data-test="ai-playground-sample-full-input"
          >
            {{ raw(selectedItem.inputPreview || selectedItem.input) }}
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <span class="o-input-label text-compact text-input-label-text leading-tight font-medium">
            {{ t("aiObservability.playground.sampleExpected") }}
          </span>
          <div
            class="border-border-default rounded-default bg-surface-subtle text-text-body max-h-64 overflow-y-auto px-2.5 py-2 font-mono text-xs leading-relaxed wrap-break-word whitespace-pre-wrap"
            :class="selectedItem.expectedOutput ? '' : 'text-text-secondary italic'"
            data-test="ai-playground-sample-full-expected"
          >
            {{
              selectedItem.expectedOutput
                ? raw(selectedItem.expectedOutput)
                : t("aiObservability.playground.sampleNoExpected")
            }}
          </div>
        </div>
      </template>

      <template v-else>
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
          v-if="loadingItems"
          class="text-text-secondary m-0 text-xs italic"
          data-test="ai-playground-sample-loading"
        >
          {{ t("common.loading") }}
        </p>
        <p
          v-else-if="!items.length"
          class="text-text-secondary m-0 text-xs italic"
          data-test="ai-playground-sample-empty"
        >
          {{ t("aiObservability.playground.sampleEmpty") }}
        </p>

        <!-- Labelled like the field above it, because that is what it is: one
           required choice. An unlabelled list of cards reads as a preview of
           the dataset, not as something waiting to be picked from. -->
        <template v-else>
          <span
            id="ai-playground-sample-item-label"
            class="o-input-label text-compact text-input-label-text -mb-1 leading-tight font-medium"
          >
            {{ t("aiObservability.playground.sampleItem") }}
          </span>
          <!-- Stacked, not two columns: a dataset input is usually a paragraph,
             and a single-line cell truncates away the part that distinguishes
             one case from the next. -->
          <div
            class="flex max-h-96 flex-col gap-1.5 overflow-y-auto"
            role="radiogroup"
            aria-labelledby="ai-playground-sample-item-label"
          >
            <button
              v-for="(item, position) in items"
              :key="item.rowId"
              type="button"
              role="radio"
              :aria-checked="item.id === selectedItemId"
              class="rounded-default flex cursor-pointer items-start gap-2 border px-2.5 py-2 text-left transition-colors"
              :class="
                item.id === selectedItemId
                  ? 'border-accent bg-surface-selected'
                  : 'border-border-default hover:bg-surface-hover'
              "
              :data-test="`ai-playground-sample-item-${from + position}`"
              @click="selectedItemId = item.id"
            >
              <!-- The marker, not just a tinted border: a highlighted card reads
                 as hover, a filled radio reads as chosen. -->
              <OIcon
                :name="
                  item.id === selectedItemId ? 'radio-button-checked' : 'radio-button-unchecked'
                "
                size="sm"
                class="mt-0.5 shrink-0"
                :class="item.id === selectedItemId ? 'text-accent' : 'text-text-muted'"
                aria-hidden="true"
              />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <!-- Every row stays the same two lines. `wrap-break-word` is
                   what keeps an unbroken 400-character token inside the row
                   instead of pushing a scrollbar across the dialog. -->
                <div class="flex items-start gap-1.5">
                  <OTag variant="blue-soft" size="xs" shape="rounded" :label="inputToken" />
                  <span
                    class="text-text-body line-clamp-2 min-w-0 flex-1 text-xs leading-relaxed wrap-break-word"
                  >
                    {{ raw(previewOf(item.inputPreview || item.input)) }}
                  </span>
                </div>
                <div class="flex items-start gap-1.5">
                  <OTag variant="amber-soft" size="xs" shape="rounded" :label="expectedToken" />
                  <span
                    class="text-text-secondary line-clamp-1 min-w-0 flex-1 text-xs wrap-break-word"
                    :class="item.expectedOutput ? '' : 'italic'"
                  >
                    {{
                      item.expectedOutput
                        ? raw(previewOf(item.expectedOutput))
                        : t("aiObservability.playground.sampleNoExpected")
                    }}
                  </span>
                </div>
              </div>
              <!-- Reading the whole case is its own view, not a taller row: a
                 dataset input can be pages long, and a row that grows to fit it
                 pushes every other candidate off the screen. -->
              <OButton
                v-if="item.id === selectedItemId"
                variant="ghost-muted"
                size="icon-xs"
                icon-left="open-in-full"
                class="shrink-0"
                :title="t('aiObservability.playground.sampleFullView')"
                :data-test="`ai-playground-sample-expand-${from + position}`"
                @click.stop="viewing = true"
              />
            </button>
          </div>
        </template>

        <!-- Paging, not searching: the items endpoint takes `from`/`size` and no
           query, so this is the only way through a long dataset. -->
        <div v-if="total > items.length || from > 0" class="flex items-center gap-2">
          <span class="text-text-secondary text-2xs" data-test="ai-playground-sample-range">
            {{
              t("aiObservability.playground.sampleShowing", {
                from: from + 1,
                to: from + items.length,
                total,
              })
            }}
          </span>
          <div class="grow" />
          <OButton
            variant="outline"
            size="xs"
            :disabled="from === 0 || loadingItems"
            data-test="ai-playground-sample-prev-page"
            @click="loadPage(from - PAGE_SIZE)"
          >
            {{ t("common.previous") }}
          </OButton>
          <OButton
            variant="outline"
            size="xs"
            :disabled="from + items.length >= total || loadingItems"
            data-test="ai-playground-sample-next-page"
            @click="loadPage(from + PAGE_SIZE)"
          >
            {{ t("common.next") }}
          </OButton>
        </div>
      </template>
    </div>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmDatasetsService, {
  type LlmDataset,
  type LlmDatasetItem,
} from "@/services/llm-datasets.service";
import type { PlaygroundSample } from "@/enterprise/views/AIObservability/playgroundDraft";

/** Enough to choose from without the dialog becoming the dataset page. */
const PAGE_SIZE = 20;

/**
 * How much of an item a row renders.
 *
 * `line-clamp` hides the overflow but the browser still lays out every
 * character behind it, so a page of multi-kilobyte items cost a full text
 * layout each — paid again on every return from the full view, which rebuilds
 * the list. Two clamped lines can never show more than this anyway.
 */
const PREVIEW_CHARS = 180;

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
const loadingItems = ref(false);

const items = ref<LlmDatasetItem[]>([]);
const from = ref(0);
const total = ref(0);
const selectedItemId = ref("");
/** Reading one case in full, rather than choosing between them. */
const viewing = ref(false);

const inputToken = raw("{{input}}");
const expectedToken = raw("{{expected_output}}");

function previewOf(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\u2026` : text;
}

const datasetOptions = computed(() =>
  props.datasets.map((dataset) => ({ label: raw(dataset.name), value: dataset.id })),
);

const selectedDataset = computed(
  () => props.datasets.find((candidate) => candidate.id === datasetId.value) ?? null,
);

const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedItemId.value) ?? null,
);

const selectedPosition = computed(() =>
  items.value.findIndex((item) => item.id === selectedItemId.value),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    viewing.value = false;
    datasetId.value = props.initialDatasetId || props.datasets[0]?.id || "";
  },
  { immediate: true },
);

// Both sources, one watcher: opening with the dataset unchanged must still
// refetch (the dataset may have grown since), and opening while the dataset
// changes must not fetch twice — a multi-source watcher fires once per flush.
watch(
  [() => props.open, datasetId],
  ([open, id]) => {
    if (open && id) loadPage(0);
  },
  // Immediate, because the dialog can be mounted already open — `open` never
  // changes in that case, so a lazy watcher would leave the list empty.
  { immediate: true },
);

async function loadPage(start: number) {
  const dataset = selectedDataset.value;
  if (!dataset) return;
  loadingItems.value = true;
  try {
    const page = await llmDatasetsService.listItems(
      store.state.selectedOrganization?.identifier ?? "",
      dataset.id,
      { from: Math.max(0, start), size: PAGE_SIZE },
    );
    items.value = page.items;
    viewing.value = false;
    from.value = page.from;
    total.value = page.total;
    // The first row of the page, so Sample is one click away and the choice is
    // still visible — the previous default chose for you and showed nothing.
    selectedItemId.value = page.items[0]?.id ?? "";
  } catch {
    items.value = [];
    toast({ variant: "error", message: t("aiObservability.playground.sampleLoadError") });
  } finally {
    loadingItems.value = false;
  }
}

function submit() {
  const dataset = selectedDataset.value;
  const item = selectedItem.value;
  if (!dataset || !item) return;
  const position = items.value.findIndex((candidate) => candidate.id === item.id);
  loading.value = true;
  try {
    emit(
      "sample",
      {
        datasetId: dataset.id,
        datasetName: dataset.name,
        itemId: item.id,
        // Absolute, not the position on this page: the bench walks the dataset
        // from here with Prev/Next.
        index: from.value + position,
        total: total.value,
      },
      item,
    );
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
}
</script>
