<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * O2Date — thin design-token wrapper around q-date.
 *
 * All props and events are passed through via v-bind="$attrs" (inheritAttrs: true).
 * Overrides Quasar's internal color variables to match the O2 token system.
 *
 * Usage:
 *   <O2Date v-model="date" />
 *   <O2Date v-model="date" mask="YYYY/MM/DD" />
 */
defineOptions({ inheritAttrs: true });
</script>

<template>
  <q-date class="o2-date" v-bind="$attrs" />
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Date styles — global (non-scoped), scoped to .o2-date.
// Overrides Quasar q-date internals with O2 design tokens.

.o2-date {
  // ─── Layer 3: Component Tokens ──────────────────────────────────────────────
  --o2-date-bg: var(--o2-card-background, var(--o2-secondary-background));
  --o2-date-text: var(--o2-text-primary);
  --o2-date-border: var(--o2-border);
  --o2-date-radius: 0.25rem;

  // ─── Structure ─────────────────────────────────────────────────────────────
  border-radius: var(--o2-date-radius);
  border: 1px solid var(--o2-date-border);
  background: var(--o2-date-bg);
  color: var(--o2-date-text);

  // ─── Header (month/year strip) ─────────────────────────────────────────────
  .q-date__header {
    background: var(--o2-primary-btn-bg) !important;
    border-radius: var(--o2-date-radius) var(--o2-date-radius) 0 0;
  }

  // ─── Today highlight ───────────────────────────────────────────────────────
  .q-date__today {
    color: var(--o2-primary-color) !important;
  }

  .q-btn.q-date__today {
    background: none !important;
    font-weight: 600;
  }

  // ─── Selected / active day ─────────────────────────────────────────────────
  .q-btn--active,
  .q-btn--active.q-focusable {
    background: var(--o2-primary-btn-bg) !important;
    color: #fff !important;
  }

  // ─── Navigation arrows ────────────────────────────────────────────────────
  .q-date__arrow {
    color: var(--o2-text-primary);
  }

  // ─── Calendar grid text ───────────────────────────────────────────────────
  .q-date__calendar-days,
  .q-date__years-content,
  .q-date__months-content {
    color: var(--o2-text-primary);
  }

  .q-date__range-from .q-btn--active,
  .q-date__range-to .q-btn--active {
    background: var(--o2-primary-btn-bg) !important;
  }
}
</style>
