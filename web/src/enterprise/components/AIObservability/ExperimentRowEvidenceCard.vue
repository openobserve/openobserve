<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <article class="border-border-default bg-code-bg rounded border p-3">
    <h4 class="text-text-secondary text-xs font-medium">{{ label }}</h4>
    <pre class="text-text-primary mt-2 overflow-auto text-xs whitespace-pre-wrap">{{
      rendered
    }}</pre>
  </article>
</template>
<script setup lang="ts">
import { computed } from "vue";
import type { I18nText } from "@/types/i18n";

const props = defineProps<{ label: I18nText; value: unknown; emptyLabel?: I18nText }>();
const rendered = computed(() => {
  if (props.value === null || props.value === undefined) return props.emptyLabel ?? "—";
  return typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2);
});
</script>
