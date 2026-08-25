<!-- Copyright 2026 OpenObserve Inc.

  One row, in full. The section that earns the drawer is "Rendered prompt": the
  exact messages sent for THIS row, variables substituted. Variable binding is
  the single most common source of a confusing Playground result, and it has to
  be seen to be believed.
-->
<template>
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    :title="t('aiObservability.playground.rowDetail', { index: rowIndex + 1 })"
    data-test="ai-playground-row-drawer"
    @update:open="emit('update:open', $event)"
  >
    <template #header-right>
      <div class="flex items-center gap-1.5">
        <span class="text-text-secondary font-mono text-xs">
          {{ t("aiObservability.playground.rowPosition", { index: rowIndex + 1, total }) }}
        </span>
        <OButton
          variant="ghost-muted"
          size="icon-xs"
          icon-left="keyboard-arrow-up"
          :disabled="rowIndex === 0"
          :title="t('aiObservability.playground.previousRow')"
          data-test="ai-playground-row-prev"
          @click="emit('navigate', -1)"
        />
        <OButton
          variant="ghost-muted"
          size="icon-xs"
          icon-left="keyboard-arrow-down"
          :disabled="rowIndex >= total - 1"
          :title="t('aiObservability.playground.nextRow')"
          data-test="ai-playground-row-next"
          @click="emit('navigate', 1)"
        />
      </div>
    </template>

    <div v-if="row" class="flex flex-col gap-5">
      <section class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <h4 class="text-compact text-text-heading m-0 font-semibold">
            {{ t("aiObservability.playground.drawerInput") }}
          </h4>
          <OTag
            variant="default"
            size="sm"
            :label="
              row.source
                ? t('aiObservability.playground.drawerFrom', { name: row.source.datasetName })
                : t('aiObservability.playground.manualRow')
            "
          />
        </div>
        <div
          class="border-border-default bg-code-bg rounded-default text-text-body border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
          data-test="ai-playground-drawer-input"
        >
          {{ row.input }}
        </div>
      </section>

      <section class="flex flex-col gap-1.5">
        <h4 class="text-compact text-text-heading m-0 font-semibold">
          {{ t("aiObservability.playground.drawerExpected") }}
        </h4>
        <div
          v-if="row.expectedOutput"
          class="border-border-default bg-code-bg rounded-default text-text-body border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
          data-test="ai-playground-drawer-expected"
        >
          {{ row.expectedOutput }}
        </div>
        <p v-else class="text-text-secondary m-0 text-xs italic">
          {{ t("aiObservability.playground.drawerNoExpected") }}
        </p>
      </section>

      <section class="flex flex-col gap-1.5">
        <OButton
          variant="ghost-muted"
          size="xs"
          class="self-start"
          :icon-left="promptOpen ? 'expand-more' : 'chevron-right'"
          data-test="ai-playground-drawer-rendered-toggle"
          @click="promptOpen = !promptOpen"
        >
          {{ t("aiObservability.playground.drawerRenderedPrompt") }}
        </OButton>
        <p class="text-text-secondary text-2xs m-0">
          {{ t("aiObservability.playground.drawerRenderedPromptHelp") }}
        </p>

        <template v-if="promptOpen">
          <div v-if="draft.variants.length > 1" class="flex flex-wrap gap-1.5">
            <OButton
              v-for="(variant, index) in draft.variants"
              :key="variant.id"
              :variant="index === promptVariantIndex ? 'primary' : 'outline'"
              size="xs"
              :data-test="`ai-playground-drawer-prompt-variant-${variantLabel(index)}`"
              @click="promptVariantIndex = index"
            >
              {{ variantLabel(index) }}
            </OButton>
          </div>

          <div class="flex flex-col gap-2">
            <div v-for="message in renderedPrompt" :key="message.id" class="flex flex-col gap-1">
              <span class="text-text-secondary text-2xs font-semibold tracking-wide uppercase">
                {{ message.role }}
              </span>
              <div
                class="border-border-default bg-code-bg rounded-default text-text-body border px-3 py-2 font-mono text-xs wrap-break-word whitespace-pre-wrap"
              >
                <span v-if="message.content">{{ message.content }}</span>
                <span v-else class="text-text-secondary italic">
                  {{ t("aiObservability.playground.drawerEmptyMessage") }}
                </span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="flex flex-col gap-2">
        <h4 class="text-compact text-text-heading m-0 font-semibold">
          {{ t("aiObservability.playground.drawerOutputs", { count: draft.variants.length }) }}
        </h4>
        <div class="grid gap-3" :class="outputGridClass">
          <div
            v-for="(variant, index) in draft.variants"
            :key="variant.id"
            class="flex flex-col gap-1.5"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="border-border-default bg-surface-secondary text-text-secondary rounded-default text-2xs inline-flex h-4 w-4 shrink-0 items-center justify-center border font-mono font-bold"
              >
                {{ variantLabel(index) }}
              </span>
              <span class="text-text-heading text-2xs truncate font-mono">{{ variant.model }}</span>
              <OBadge
                v-if="variant.stale"
                variant="warning"
                size="sm"
                :label="t('aiObservability.playground.stale')"
              />
            </div>
            <PlaygroundOutputCell
              :cell="cellFor(variant.id)"
              :stale="variant.stale"
              :data-test="`ai-playground-drawer-output-${variantLabel(index)}`"
            />
          </div>
        </div>
      </section>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import PlaygroundOutputCell from "./PlaygroundOutputCell.vue";
import {
  cellAt,
  renderedMessages,
  rowVars,
  variantLabel,
  type PlaygroundDraft,
  type PlaygroundResults,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = defineProps<{
  open: boolean;
  draft: PlaygroundDraft;
  results: PlaygroundResults;
  rowIndex: number;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  navigate: [delta: number];
}>();

const { t } = useI18nTyped();

const promptOpen = ref(false);
const promptVariantIndex = ref(0);

const total = computed(() => props.draft.rows?.length ?? 0);
const row = computed(() => props.draft.rows?.[props.rowIndex] ?? null);

// Moving to another row keeps the panel open but resets which variant it shows,
// so the comparison always starts from A.
watch(
  () => props.rowIndex,
  () => {
    promptVariantIndex.value = 0;
  },
);

const renderedPrompt = computed(() => {
  const variant = props.draft.variants[promptVariantIndex.value] ?? props.draft.variants[0];
  if (!variant || !row.value) return [];
  return renderedMessages(variant, rowVars(row.value));
});

const outputGridClass = computed(() =>
  props.draft.variants.length > 1 ? "grid-cols-2" : "grid-cols-1",
);

function cellFor(variantId: string) {
  return row.value ? cellAt(props.results, variantId, row.value.id) : undefined;
}
</script>
