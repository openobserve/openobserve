<!-- Copyright 2026 OpenObserve Inc.
//
// PanelSectionHeader — the one title (+ optional hint / icon) header for the AI
// Observability card/panel/drawer sections. Every one of these panels wraps an
// OTable, so the header insets to the SAME `px-page-edge` grid line the table
// content uses — the hand-rolled `px-4` blocks these replaced sat 2px off the
// columns, which read as "bad header spacing".
//
// Pass `icon` + `tone` to tie a section to its summary tile and its detail
// drawer: the same glyph + colour on the tile, the table header, and the drawer
// makes "this number → this table → this drawer" obvious at a glance. Optional
// `#actions` slot for a trailing control.
-->
<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

const props = defineProps<{
  title: string;
  /** Optional one-line explanation under the title. */
  hint?: string;
  /** Optional leading glyph — use the SAME one as the section's summary tile. */
  icon?: IconName;
  /** Icon colour — match the summary tile's tone so the two read as one thing. */
  tone?: "warning" | "error" | "primary" | "neutral";
}>();

// Soft tone chip — same rounded-square treatment as the OPageHeader module tile,
// one size down (w-7 vs w-9.5), and identical to the detail drawer's header chip
// so tile → section header → drawer read as one thing.
const iconWrap = computed(() => {
  switch (props.tone) {
    case "warning":
      return "bg-badge-warning-soft-bg text-badge-warning-soft-text";
    case "error":
      return "bg-badge-error-soft-bg text-badge-error-soft-text";
    case "primary":
      return "bg-badge-primary-soft-bg text-badge-primary-soft-text";
    default:
      return "bg-surface-subtle text-text-secondary";
  }
});
</script>

<template>
  <div
    class="flex items-start justify-between gap-2 px-page-edge pt-3 pb-2"
    data-test="ai-panel-section-header"
  >
    <div class="flex items-center gap-2.5 min-w-0">
      <span
        v-if="icon"
        class="inline-flex items-center justify-center shrink-0 w-8.5 h-8.5 rounded-default"
        :class="iconWrap"
      >
        <OIcon :name="icon" size="md" />
      </span>
      <div class="flex flex-col min-w-0">
        <div class="text-sm font-semibold text-text-heading truncate">
          {{ title }}
        </div>
        <div
          v-if="hint"
          class="text-2xs leading-normal text-text-secondary"
        >
          {{ hint }}
        </div>
      </div>
    </div>
    <div v-if="$slots.actions" class="shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
