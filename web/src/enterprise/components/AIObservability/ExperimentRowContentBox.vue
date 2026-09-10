<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  The scrollable content box used for a row's input / expected output / output.
  Same chrome as DatasetItemDetail, so an item reads identically in the dataset,
  in an experiment row, and in a comparison.

  Owns its own label + fullscreen button (mirrors ReviewContentBox in the Queue
  Workbench) rather than splitting the header into the parent: the header has to
  travel INTO fullscreen with the box, or the label and the exit control both
  disappear the moment the box fills the screen.
-->
<template>
  <div
    class="flex min-w-0 flex-col gap-1.5"
    :class="fullscreen ? '[&:fullscreen]:bg-surface-base [&:fullscreen]:p-4' : ''"
    ref="rootEl"
  >
    <div class="flex min-h-8 shrink-0 items-center gap-2">
      <h4 class="text-compact text-text-heading m-0 font-semibold">{{ label }}</h4>
      <OTag v-if="tagLabel" size="sm" icon="" variant="default-soft" :label="tagLabel" />
      <div class="grow" />
      <OButton
        variant="outline"
        size="icon-xs"
        :icon-left="fullscreen ? 'fullscreen-exit' : 'fullscreen'"
        :title="
          fullscreen
            ? t('aiObservability.experiments.comparePage.rowDrawer.exitFullscreen')
            : t('aiObservability.experiments.comparePage.rowDrawer.enterFullscreen')
        "
        :data-test="`${dataTest}-fullscreen`"
        @click="handleToggle"
      />
    </div>
    <div
      class="border-border-default bg-code-bg rounded-default text-text-body overflow-auto border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
      :class="fullscreen ? 'min-h-0 flex-1' : 'h-40'"
      :data-test="dataTest"
    >
      <div v-if="absent" class="text-text-secondary p-8 text-center text-sm italic">
        {{ t("aiObservability.experiments.comparePage.rowDrawer.absentSide") }}
      </div>
      <div
        v-else-if="!hasContent(value)"
        class="text-text-secondary p-8 text-center text-sm italic"
      >
        {{ t("aiObservability.experiments.comparePage.rowDrawer.noContent") }}
      </div>
      <!-- LLMContentRenderer only renders plain strings; anything else (an object,
           or a JSON string) falls back to pretty-printed JSON. -->
      <LLMContentRenderer
        v-else-if="isPlainText(value)"
        :content="value as string"
        content-type="output"
        view-mode="formatted"
      />
      <pre v-else class="m-0 font-mono text-xs break-words whitespace-pre-wrap">{{
        pretty(value)
      }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import { hasContent, isPlainText, pretty } from "./experimentRowContent";

defineProps<{
  label: I18nText;
  /** "From Dataset" — only Input and Expected Output carry it. */
  tagLabel?: I18nText;
  value: unknown;
  /** The whole side is missing from this run, which is not the same as empty. */
  absent?: boolean;
  /** Whether THIS box is the current document.fullscreenElement. */
  fullscreen?: boolean;
  dataTest: string;
}>();

const emit = defineEmits<{ "toggle-fullscreen": [element: HTMLElement | null] }>();

const { t } = useI18nTyped();

const rootEl = ref<HTMLElement | null>(null);

function handleToggle() {
  emit("toggle-fullscreen", rootEl.value);
}

// Lets the parent compare `fullscreenEl.value === thisBox.rootEl` without the
// parent needing its own ref on an element this component owns.
defineExpose({ rootEl });
</script>
