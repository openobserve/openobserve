<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OSeverity — a log level as mono text, optionally led by a 3 px mark in the solid colour.

import { computed } from "vue";
import { raw } from "@/types/i18n";
import type { SeverityLevel, SeverityProps } from "./OSeverity.types";

const props = withDefaults(defineProps<SeverityProps>(), { mark: false, label: undefined });

const textClasses: Record<SeverityLevel, string> = {
  fatal: "text-badge-purple-soft-text",
  error: "text-badge-error-soft-text",
  warn: "text-badge-warning-soft-text",
  info: "text-text-secondary",
  debug: "text-text-muted",
};

const markClasses: Record<SeverityLevel, string> = {
  fatal: "bg-badge-purple-solid-bg",
  error: "bg-badge-error-solid-bg",
  warn: "bg-badge-warning-solid-bg",
  info: "bg-badge-blue-solid-bg",
  debug: "bg-border-strong",
};

// Level words are log tokens, identical in every locale.
const text = computed(() => props.label ?? raw(props.level));
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1.5" :data-level="level">
    <span
      v-if="mark"
      class="inline-block h-3.5 w-0.75 shrink-0 rounded-xs"
      data-test="o-severity-mark"
      :class="markClasses[level]"
      aria-hidden="true"
    />
    <span class="text-2xs font-mono leading-none font-semibold" :class="textClasses[level]">{{
      text
    }}</span>
  </span>
</template>
