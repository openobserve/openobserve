<script setup lang="ts">
import type { CodeProps, CodeSlots } from "./OCode.types";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { ref } from "vue";

withDefaults(defineProps<CodeProps>(), {
  copyable: false,
  truncate: false,
  tooltip: undefined,
});

defineSlots<CodeSlots>();

// The copy reads the rendered text, so any slot content (spans, highlights) copies as shown.
const codeRef = ref<HTMLElement | null>(null);
const renderedText = () => codeRef.value?.textContent?.trim() ?? "";
</script>

<template>
  <span
    v-if="copyable"
    :class="['inline-flex items-center gap-0.5', truncate ? 'max-w-full min-w-0' : '']"
  >
    <code
      ref="codeRef"
      :class="[
        'rounded-chip border-code-border bg-code-bg text-code-text inline-flex items-center border px-1 py-px font-mono text-xs leading-none',
        truncate ? 'max-w-full min-w-0' : '',
      ]"
    >
      <OTruncatedText v-if="truncate" class="-my-px py-px" :tooltip="tooltip"
        ><slot
      /></OTruncatedText>
      <slot v-else />
    </code>
    <OCopyButton :value="renderedText" size="xs" data-test="o-code-copy" />
  </span>
  <code
    v-else
    ref="codeRef"
    :class="[
      'rounded-chip border-code-border bg-code-bg text-code-text inline-flex items-center border px-1 py-px font-mono text-xs leading-none',
      truncate ? 'max-w-full min-w-0' : '',
    ]"
  >
    <!-- An inline-flex chip clips its text with no "…", so the text cuts inside its own box. -->
    <OTruncatedText v-if="truncate" class="-my-px py-px" :tooltip="tooltip"
      ><slot
    /></OTruncatedText>
    <slot v-else />
  </code>
</template>
