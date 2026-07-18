<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { useI18n } from 'vue-i18n'
import OSkeleton from '@/lib/feedback/Skeleton/OSkeleton.vue'

const { t } = useI18n()

withDefaults(defineProps<{
  rows?: number
}>(), {
  rows: 5,
})
</script>

<template>
  <div
    role="status"
    :aria-label="t('synthetics.createBrowserTest.loading')"
    aria-live="polite"
    style="flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--color-surface-base)"
    data-test="synthetics-createBrowserTest-skeleton"
  >
    <!--
      ── OStepper horizontal header bar ──
      Real: sticky top-0 z-10 flex items-start w-full pb-2 bg-background!
      Each step: flex flex-col items-center shrink-0
        button: flex flex-row items-center gap-2 px-2 py-1.5
          span: size-8(2rem) rounded-full
          span: flex flex-col → title(text-xs) + desc(11px)
      Connector: h-px flex-1 shrink mt-[22px] mx-1 min-w-[8px]
    -->
    <div
      style="display: flex; align-items: flex-start; padding: 0 1rem 0.5rem; gap: 0.25rem; flex-shrink: 0"
    >
      <!-- Step 1: Journey (active) -->
      <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; flex-shrink: 0">
        <div style="width: 2rem; height: 2rem">
          <OSkeleton type="circle" animation="wave" />
        </div>
        <div style="width: 3rem; height: 0.75rem">
          <OSkeleton type="text" animation="wave" />
        </div>
      </div>
      <!-- Connector line (mt-[22px]=1.375rem) -->
      <div
        style="flex: 1; height: 0.0625rem; background: var(--color-border-default); margin: 1.375rem 0.25rem 0; min-width: 0.5rem; flex-shrink: 1"
      ></div>
      <!-- Step 2: Configure (inactive) -->
      <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem; flex-shrink: 0">
        <div style="width: 2rem; height: 2rem">
          <OSkeleton type="circle" animation="wave" />
        </div>
        <div style="width: 4.5rem; height: 0.75rem">
          <OSkeleton type="text" animation="wave" />
        </div>
      </div>
    </div>

    <!-- ── Journey tab content (OStep panel) ── -->
    <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-height: 0">

      <!--
        BrowserJourney Toolbar
        Real: flex items-center gap-4 mb-3 ml-5.5 px-3
        ml-5.5 = 1.375rem, px-3 = 0.75rem
      -->
      <div
        style="display: flex; align-items: center; gap: 1rem; margin: 0 0 0.75rem 1.375rem; padding: 0 0.75rem"
      >
        <!-- Select-all checkbox -->
        <div style="width: 1rem; height: 1rem; flex-shrink: 0">
          <OSkeleton type="rect" animation="wave" />
        </div>
        <!-- "Steps" h3 + OBadge -->
        <div style="display: flex; align-items: center; gap: 0.25rem; flex-shrink: 0">
          <div style="width: 2.5rem; height: 1.25rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <div style="width: 1.5rem; height: 1.25rem; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
        </div>
        <!-- Filter OInput -->
        <div style="flex: 1; height: 2rem; min-width: 8rem">
          <OSkeleton type="rect" animation="wave" />
        </div>
        <!-- Button cluster: Add Step | Replay | Record (OButton size="sm") -->
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0">
          <div style="width: 5.5rem; height: 2rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <div style="width: 4.75rem; height: 2rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <div style="width: 5rem; height: 2rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
        </div>
      </div>

      <!--
        Step rows — simulate OTable dense+bordered rows
        Real OTable dense: compact rows, border-bottom per row
        Real JourneySteps columns: details(autoWidth) | actions(128px=8rem)
        Real cell-details: step# | icon-chip(1.75rem) | badge | name(flex-1) | selector(25%)
        Real cell-actions: 3 ghost xs buttons
      -->
      <div style="display: flex; flex-direction: column; flex: 1">
        <div
          v-for="i in rows"
          :key="i"
          style="display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; border-bottom: 0.0625rem solid var(--color-border-default)"
        >
          <!-- OTable expand toggle (built-in) -->
          <div style="width: 1rem; height: 1rem; flex-shrink: 0">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Step number (w-6=1.5rem, text-sm) -->
          <div style="width: 1.5rem; height: 0.875rem; flex-shrink: 0">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Action icon chip: bg-primary-50, rounded, p-1 -->
          <div style="width: 1.75rem; height: 1.75rem; flex-shrink: 0; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Action badge pill -->
          <div style="width: 3.5rem; height: 1.25rem; flex-shrink: 0; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Step name (flex-1, truncate, min-w-0) -->
          <div style="flex: 1; height: 0.875rem; min-width: 5rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Selector/value (font-mono, text-xs, text-secondary, max-w-[25%]) -->
          <div style="width: 20%; height: 0.75rem; flex-shrink: 0; min-width: 4rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Action buttons: insert(+) | duplicate | delete (3 x OButton ghost xs) -->
          <div style="display: flex; align-items: center; gap: 0.125rem; flex-shrink: 0">
            <div style="width: 1.25rem; height: 1.25rem">
              <OSkeleton type="rect" animation="wave" />
            </div>
            <div style="width: 1.25rem; height: 1.25rem">
              <OSkeleton type="rect" animation="wave" />
            </div>
            <div style="width: 1.25rem; height: 1.25rem">
              <OSkeleton type="rect" animation="wave" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!--
      ── Sticky footer ──
      Real: flex items-center px-3 py-2.5 gap-2 border-t shrink-0 bg-background
      Journey tab: Cancel(ghost) | spacer | Continue(primary + chevron-right)
    -->
    <div
      style="display: flex; align-items: center; padding: 0.625rem 0.75rem; gap: 0.5rem; border-top: 0.0625rem solid var(--color-border-default); flex-shrink: 0; background: var(--color-surface-base)"
    >
      <div style="flex: 1"></div>
      <!-- Cancel button (ghost, sm) -->
      <div style="width: 4rem; height: 2rem">
        <OSkeleton type="rect" animation="wave" />
      </div>
      <!-- Continue button (primary, sm, with chevron-right suffix) -->
      <div style="width: 6rem; height: 2rem">
        <OSkeleton type="rect" animation="wave" />
      </div>
    </div>
  </div>
</template>
