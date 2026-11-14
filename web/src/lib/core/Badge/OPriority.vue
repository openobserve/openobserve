<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OPriority — P1–P3 by weight, not hue: P1 solid, P2 outlined, P3 quiet.

import { computed } from "vue";
import { raw } from "@/types/i18n";
import type { PriorityLevel, PriorityProps } from "./OPriority.types";

const props = defineProps<PriorityProps>();

const levelClasses: Record<PriorityLevel, string> = {
  1: "bg-text-heading text-surface-base",
  2: "bg-surface-base text-text-heading ring-1 ring-text-secondary ring-inset",
  3: "bg-surface-subtle text-text-secondary",
};

const text = computed(() => raw(`P${props.level}`));
</script>

<template>
  <span
    class="rounded-chip text-2xs inline-grid h-4.5 min-w-6 shrink-0 place-items-center px-1 font-mono leading-none font-semibold"
    :class="levelClasses[level]"
    :data-level="level"
    >{{ text }}</span
  >
</template>
