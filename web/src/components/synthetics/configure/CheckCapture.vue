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

const screenshotDescription = computed(() => {
  switch (screenshot.value) {
    case 'always': return t('synthetics.capture.screenshotDescriptionAlways')
    case 'on-fail': return t('synthetics.capture.screenshotDescriptionOnFail')
    case 'off': return t('synthetics.capture.screenshotDescriptionOff')
    default: return ''
  }
})
</script>

<template>
  <div class="rounded-lg border border-[var(--color-border-default)] mb-4">
    <div class="flex items-center border-b border-[var(--color-border-default)] py-[10px] px-3">
      <div class="w-[3px] h-4 rounded-sm mr-2 shrink-0 bg-[var(--color-primary-600)]" />
      <h3 class="text-base font-semibold text-[var(--color-text-heading)]">{{ t('synthetics.capture.title') }}</h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">

      <div class="flex items-center gap-4">
        <label class="text-sm font-medium text-[var(--color-text-body)] w-24 shrink-0">{{ t('synthetics.capture.screenshot') }}</label>
        <OSelect
          v-model="screenshot"
          :options="captureOptions"
          class="w-40!"
          data-test="synthetics-check-capture-screenshot"
        />
        <p class="text-sm text-[var(--color-text-secondary)]">
          {{ screenshotDescription }}
        </p>
      </div>

    </div>
  </div>
</template>
