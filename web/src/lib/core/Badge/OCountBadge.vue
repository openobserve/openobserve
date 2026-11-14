<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OCountBadge — a 16 px round count; red only for firing counts.

import { computed } from "vue";
import { raw } from "@/types/i18n";
import type { CountBadgeProps, CountBadgeTone } from "./OCountBadge.types";

const props = withDefaults(defineProps<CountBadgeProps>(), { tone: "neutral", max: 99 });

const toneClasses: Record<CountBadgeTone, string> = {
  err: "bg-badge-error-solid-bg text-badge-error-solid-text",
  neutral: "bg-surface-subtle-hover text-text-heading",
  accent: "bg-badge-primary-solid-bg text-badge-primary-solid-text",
};

const text = computed(() => raw(props.count > props.max ? `${props.max}+` : String(props.count)));
</script>

<template>
  <span
    class="text-2xs inline-grid h-4 min-w-4 shrink-0 place-items-center rounded-full px-1 leading-none font-semibold tabular-nums"
    :class="toneClasses[tone]"
    :data-tone="tone"
    >{{ text }}</span
  >
</template>
