<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- A SIEM dashboard card: tone chip + title header over a body that fills the card. -->
<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

const props = withDefaults(
  defineProps<{
    title: string;
    hint?: string;
    icon?: IconName;
    tone?: "primary" | "error" | "warning" | "orange" | "neutral";
    /** Optional count shown beside the title. */
    count?: number | string | null;
    dataTest?: string;
  }>(),
  { tone: "primary", count: null },
);

const chip = computed(
  () =>
    ({
      primary: "bg-icon-chip-primary-bg text-icon-chip-primary-text",
      error: "bg-icon-chip-error-bg text-icon-chip-error-text",
      warning: "bg-icon-chip-warning-bg text-icon-chip-warning-text",
      orange: "bg-icon-chip-orange-bg text-icon-chip-orange-text",
      neutral: "bg-surface-subtle text-text-secondary",
    })[props.tone],
);
</script>

<template>
  <section
    class="bg-card-glass-bg border-border-default rounded-surface flex min-h-0 flex-col overflow-hidden border"
    :data-test="dataTest"
  >
    <header
      class="border-border-default px-page-edge flex shrink-0 items-center gap-2.5 border-b py-2.5"
    >
      <span
        v-if="icon"
        class="rounded-default inline-flex size-7 shrink-0 items-center justify-center"
        :class="chip"
      >
        <OIcon :name="icon" size="sm" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-text-heading truncate text-sm font-semibold">{{ title }}</span>
          <span
            v-if="count !== null && count !== undefined"
            class="bg-surface-subtle text-text-secondary text-2xs rounded-full px-1.5 font-semibold tabular-nums"
            >{{ count }}</span
          >
        </div>
        <span v-if="hint" class="text-text-secondary text-2xs truncate">{{ hint }}</span>
      </div>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-1">
        <slot name="actions" />
      </div>
    </header>
    <div class="flex min-h-0 flex-1 flex-col">
      <slot />
    </div>
  </section>
</template>
