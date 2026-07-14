<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck } from '@/types/synthetics'
import OSelect from '@/lib/forms/Select/OSelect.vue'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()

const captureOptions = computed(() => [
  { label: t('synthetics.capture.options.always'), value: 'always' },
  { label: t('synthetics.capture.options.onFail'), value: 'on-fail' },
  { label: t('synthetics.capture.options.off'), value: 'off' },
])

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
  <div class="rounded-lg border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] mb-4">
    <div class="flex items-center border-b border-[var(--color-border-default)] py-[10px] px-3">
      <div class="w-[3px] h-4 rounded-sm mr-2 shrink-0 bg-[var(--color-primary-600)]" />
      <h3 class="text-base font-semibold text-[var(--o2-text-heading)]">{{ t('synthetics.capture.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">

      <div class="flex items-center gap-4">
        <label class="text-sm text-[var(--o2-text-label)] w-24 shrink-0">{{ t('synthetics.capture.screenshot') }}</label>
        <OSelect
          v-model="screenshot"
          :options="captureOptions"
          class="w-40!"
          data-test="synthetics-check-capture-screenshot"
        />
        <p class="text-xs text-[var(--o2-text-secondary)]">
          {{ t('synthetics.capture.screenshotDescription') }}
        </p>
      </div>

    </div>
    </div>
  </div>
</template>
