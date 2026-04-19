<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
/**
 * O2Color — thin design-token wrapper around q-color.
 *
 * All props and events are passed through via v-bind="$attrs" (inheritAttrs: true).
 * Overrides Quasar's internal color variables to match the O2 token system.
 *
 * Usage:
 *   <O2Color v-model="hex" />
 *   <O2Color v-model="hex" no-header />
 */
defineOptions({ inheritAttrs: true });
</script>

<template>
  <q-color class="o2-color" v-bind="$attrs" />
</template>

<style lang="scss">
// Copyright 2026 OpenObserve Inc.
//
// O2Color styles — global (non-scoped), scoped to .o2-color.
// Overrides Quasar q-color internals with O2 design tokens.

.o2-color {
  // ─── Layer 3: Component Tokens ──────────────────────────────────────────────
  --o2-color-bg: var(--o2-card-background, var(--o2-secondary-background));
  --o2-color-text: var(--o2-text-primary);
  --o2-color-border: var(--o2-border);
  --o2-color-radius: 0.25rem;

  // ─── Structure ─────────────────────────────────────────────────────────────
  border-radius: var(--o2-color-radius);
  border: 1px solid var(--o2-color-border);
  background: var(--o2-color-bg);

  // ─── Header (color preview strip) ─────────────────────────────────────────
  .q-color-picker__header {
    background: var(--o2-primary-btn-bg) !important;
    border-radius: var(--o2-color-radius) var(--o2-color-radius) 0 0;
  }

  // ─── Tab bar (spectrum / tune / palette) ──────────────────────────────────
  .q-color-picker__header-tabs {
    background: var(--o2-secondary-background);
  }

  .q-tab--active {
    color: var(--o2-primary-color) !important;
  }

  .q-tab__indicator {
    background: var(--o2-primary-color) !important;
  }

  // ─── Input fields within color picker ─────────────────────────────────────
  .q-color-picker__footer {
    background: var(--o2-color-bg);
    color: var(--o2-color-text);
    border-top: 1px solid var(--o2-color-border);
  }

  .q-color-picker__footer input {
    color: var(--o2-text-primary);
    background: var(--o2-secondary-background);
    border: 1px solid var(--o2-border-input, var(--o2-border));
    border-radius: 0.1875rem;
    font-size: 0.75rem;
  }

  // ─── Slider / spectrum thumb ───────────────────────────────────────────────
  .q-color-picker__cube {
    border-radius: 0.1875rem;
  }
}
</style>
