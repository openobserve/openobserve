<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  The scrollable content box used for a row's input / expected output / output.
  Same chrome as DatasetItemDetail, so an item reads identically in the dataset,
  in an experiment row, and in a comparison.
-->
<template>
  <div
    class="border-border-default bg-code-bg rounded-default text-text-body h-40 overflow-auto border px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap"
  >
    <div v-if="absent" class="text-text-secondary p-8 text-center text-sm italic">
      {{ t("aiObservability.experiments.comparePage.rowDrawer.absentSide") }}
    </div>
    <div v-else-if="!hasContent(value)" class="text-text-secondary p-8 text-center text-sm italic">
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
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import LLMContentRenderer from "@/plugins/traces/LLMContentRenderer.vue";
import { hasContent, isPlainText, pretty } from "./experimentRowContent";

defineProps<{
  value: unknown;
  /** The whole side is missing from this run, which is not the same as empty. */
  absent?: boolean;
}>();

const { t } = useI18nTyped();
</script>
