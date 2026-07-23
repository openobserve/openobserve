<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { useI18n } from "vue-i18n";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";

const { t } = useI18n();

withDefaults(
  defineProps<{
    rows?: number;
  }>(),
  {
    rows: 5,
  },
);
</script>

<template>
  <div
    role="status"
    :aria-label="t('synthetics.createBrowserTest.loading')"
    aria-live="polite"
    class="bg-surface-base flex min-h-0 flex-1 flex-col"
    data-test="synthetics-createBrowserTest-skeleton"
  >
    <!--
      ── OStepper horizontal header bar ──
      Real: sticky top-0 z-10 flex items-start w-full pb-2 bg-background!
      Each step: flex flex-col items-center shrink-0
        button: flex flex-row items-center gap-2 px-2 py-1.5
          span: size-8(2rem) rounded-full
          span: flex flex-col → title(text-xs) + desc(11px)
      Connector: h-px flex-1 shrink mt-5.5 mx-1 min-w-2
    -->
    <div class="flex shrink-0 items-start gap-1 px-4 pt-0 pb-2">
      <!-- Step 1: Journey (active) -->
      <div class="flex shrink-0 items-center gap-2 px-2 py-1.5">
        <div style="width: 2rem; height: 2rem">
          <OSkeleton type="circle" animation="wave" />
        </div>
        <div style="width: 3rem; height: 0.75rem">
          <OSkeleton type="text" animation="wave" />
        </div>
      </div>
      <!-- Connector line (mt-5.5=1.375rem) -->
      <div class="bg-border-default mx-1 mt-5.5 mb-0 h-px min-w-2 flex-1 shrink"></div>
      <!-- Step 2: Configure (inactive) -->
      <div class="flex shrink-0 items-center gap-2 px-2 py-1.5">
        <div style="width: 2rem; height: 2rem">
          <OSkeleton type="circle" animation="wave" />
        </div>
        <div style="width: 4.5rem; height: 0.75rem">
          <OSkeleton type="text" animation="wave" />
        </div>
      </div>
    </div>

    <!-- ── Journey tab content (OStep panel) ── -->
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <!--
        BrowserJourney Toolbar
        Real: flex items-center gap-4 mb-3 ml-5.5 px-3
        ml-5.5 = 1.375rem, px-3 = 0.75rem
      -->
      <div class="flex items-center gap-4 px-3 py-0" style="margin: 0 0 0.75rem 1.375rem">
        <!-- Select-all checkbox -->
        <div class="shrink-0" style="width: 1rem; height: 1rem">
          <OSkeleton type="rect" animation="wave" />
        </div>
        <!-- "Steps" h3 + OBadge -->
        <div class="flex shrink-0 items-center gap-1">
          <div style="width: 2.5rem; height: 1.25rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <div style="width: 1.5rem; height: 1.25rem; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
        </div>
        <!-- Filter OInput -->
        <div class="flex-1" style="height: 2rem; min-width: 8rem">
          <OSkeleton type="rect" animation="wave" />
        </div>
        <!-- Button cluster: Add Step | Replay | Record (OButton size="sm") -->
        <div class="flex shrink-0 items-center gap-2">
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
      <div class="flex flex-1 flex-col">
        <div
          v-for="i in rows"
          :key="i"
          class="border-border-default flex items-center gap-2 border-b px-3 py-1.5"
        >
          <!-- OTable expand toggle (built-in) -->
          <div class="shrink-0" style="width: 1rem; height: 1rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Step number (w-6=1.5rem, text-sm) -->
          <div class="shrink-0" style="width: 1.5rem; height: 0.875rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Action icon chip: bg-primary-50, rounded, p-1 -->
          <div class="shrink-0" style="width: 1.75rem; height: 1.75rem; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Action badge pill -->
          <div class="shrink-0" style="width: 3.5rem; height: 1.25rem; border-radius: 0.25rem">
            <OSkeleton type="rect" animation="wave" />
          </div>
          <!-- Step name (flex-1, truncate, min-w-0) -->
          <div class="flex-1" style="height: 0.875rem; min-width: 5rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Selector/value (font-mono, text-xs, text-secondary, max-w-[25%]) -->
          <div class="shrink-0" style="width: 20%; height: 0.75rem; min-width: 4rem">
            <OSkeleton type="text" animation="wave" />
          </div>
          <!-- Action buttons: insert(+) | duplicate | delete (3 x OButton ghost xs) -->
          <div class="flex shrink-0 items-center gap-0.5">
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
      class="border-border-default bg-surface-base flex shrink-0 items-center gap-2 border-t px-3 py-2.5"
    >
      <div class="flex-1"></div>
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
