<!-- Copyright 2026 OpenObserve Inc. -->

<!--
  One titled block on the Remote Task detail page. Extracted because the page
  stacks seven of them and a repeated card+header markup block is exactly the
  hand-assembly a component exists to prevent.
-->
<template>
  <section
    class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
  >
    <div class="border-border-default flex items-center justify-between gap-2 border-b px-3 py-2">
      <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">
        {{ title }}
      </span>
      <span v-if="meta" class="text-text-secondary text-2xs font-mono">{{ meta }}</span>
    </div>
    <div class="px-4 py-3">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  /** Right-aligned qualifier, e.g. the content type on the body block. */
  meta?: I18nText;
}>();
</script>
