<!-- Copyright 2026 OpenObserve Inc.
//
// PanelSectionHeader — the one title (+ optional hint / icon) header for the AI
// Observability card/panel/drawer sections. Every one of these panels wraps an
// OTable, so the header insets to the SAME `px-page-edge` grid line the table
// content uses — the hand-rolled `px-4` blocks these replaced sat a hair off
// the columns, which read as "bad header spacing".
//
// Pass `icon` + `tone` to tie a section to its summary tile and its detail
// drawer: the same glyph + colour on the tile, the table header, and the drawer
// makes "this number → this table → this drawer" obvious at a glance. Optional
// `#actions` slot for a trailing control.
-->
<script setup lang="ts">
import type { I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  /** Optional one-line explanation under the title. */
  hint?: I18nText;
}>();
</script>

<template>
  <div class="flex items-start justify-between gap-2 pb-2" data-test="ai-panel-section-header">
    <div class="flex min-w-0 flex-col">
      <div class="text-text-heading truncate text-sm font-semibold">
        {{ title }}
      </div>
      <div v-if="hint" class="text-text-secondary text-xs">
        {{ hint }}
      </div>
    </div>
    <div v-if="$slots.actions" class="shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
