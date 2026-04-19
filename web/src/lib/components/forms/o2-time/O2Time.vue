<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * O2Time — thin design-token wrapper around q-time.
 *
 * All props and events are passed through via v-bind="$attrs" (inheritAttrs: true).
 * Overrides Quasar's internal color variables to match the O2 token system.
 *
 * Usage:
 *   <O2Time v-model="time" />
 *   <O2Time v-model="time" format24h />
 */
defineOptions({ inheritAttrs: true });
</script>

<template>
  <q-time class="o2-time" v-bind="$attrs" />
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Time styles — global (non-scoped), scoped to .o2-time.
// Overrides Quasar q-time internals with O2 design tokens.

.o2-time {
  // ─── Layer 3: Component Tokens ──────────────────────────────────────────────
  --o2-time-bg: var(--o2-card-background, var(--o2-secondary-background));
  --o2-time-text: var(--o2-text-primary);
  --o2-time-border: var(--o2-border);
  --o2-time-radius: 0.25rem;

  // ─── Structure ─────────────────────────────────────────────────────────────
  border-radius: var(--o2-time-radius);
  border: 1px solid var(--o2-time-border);
  background: var(--o2-time-bg);
  color: var(--o2-time-text);

  // ─── Header (hour/minute display) ─────────────────────────────────────────
  .q-time__header {
    background: var(--o2-primary-btn-bg) !important;
    border-radius: var(--o2-time-radius) var(--o2-time-radius) 0 0;
    color: #fff;
  }

  // ─── Clock face active indicator ──────────────────────────────────────────
  .q-time__clock-position--active,
  .q-time__clock-pointer {
    background: var(--o2-primary-btn-bg) !important;
  }

  .q-time__clock-position--active {
    color: #fff !important;
  }

  // ─── Active buttons (AM/PM, etc.) ─────────────────────────────────────────
  .q-btn--active {
    background: var(--o2-primary-btn-bg) !important;
    color: #fff !important;
  }

  // ─── Clock face text ──────────────────────────────────────────────────────
  .q-time__clock-position {
    color: var(--o2-text-primary);
  }

  // ─── Now link ─────────────────────────────────────────────────────────────
  .q-time__link {
    color: var(--o2-primary-color);
  }
}
</style>
