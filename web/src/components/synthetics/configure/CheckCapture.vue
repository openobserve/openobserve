<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck } from '@/types/synthetics'
import OSelect from '@/lib/forms/Select/OSelect.vue'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const captureOptions = [
  { label: 'Always', value: 'always' },
  { label: 'On fail', value: 'on-fail' },
  { label: 'Off', value: 'off' },
]

const screenshot = computed({
  get: () => props.check.capture.screenshot,
  set: (v: BrowserCheck['capture']['screenshot']) =>
    emit('update:check', {
      ...props.check,
      capture: { ...props.check.capture, screenshot: v },
    }),
})
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:pb-4">Capture</h3>
    <div class="tw:flex tw:flex-col tw:gap-4">

      <div class="tw:flex tw:items-center tw:gap-4">
        <label class="tw:text-sm tw:text-[var(--o2-text-primary)] tw:w-24 tw:shrink-0">Screenshot</label>
        <OSelect
          v-model="screenshot"
          :options="captureOptions"
          class="tw:w-40"
          data-test="synthetics-check-capture-screenshot"
        />
        <p class="tw:text-xs tw:text-[var(--o2-text-secondary)]">
          Capture a full-page screenshot at each step.
        </p>
      </div>

    </div>
  </div>
</template>
