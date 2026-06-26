<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck } from '@/types/synthetics'
import OSwitch from '@/lib/forms/Switch/OSwitch.vue'

const props = defineProps<{
  check: BrowserCheck
  checkType?: 'browser' | 'api'
}>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const collectRUM = computed({
  get: () => props.check.rum.collect,
  set: (v: boolean) =>
    emit('update:check', {
      ...props.check,
      rum: { ...props.check.rum, collect: v },
    }),
})

const sessionReplay = computed({
  get: () => props.check.rum.sessionReplay,
  set: (v: boolean) =>
    emit('update:check', {
      ...props.check,
      rum: { ...props.check.rum, sessionReplay: v },
    }),
})
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:pb-4">RUM &amp; Session Replay</h3>
    <div class="tw:flex tw:flex-col tw:gap-4">
      <div>
        <OSwitch
          v-model="collectRUM"
          label="Collect RUM data"
          data-test="synthetics-check-rum-collect-switch"
        />
        <p class="tw:mt-1 tw:text-xs! tw:text-[var(--o2-text-secondary)] tw:pl-9">
          Captures Web Vitals, resource waterfall, console errors, and a full session for each run.
        </p>
      </div>

      <div :class="!check.rum.collect ? 'tw:opacity-50' : ''">
        <OSwitch
          v-model="sessionReplay"
          label="Capture session replay"
          :disabled="!check.rum.collect"
          data-test="synthetics-check-rum-session-replay-switch"
        />
      </div>
    </div>
  </div>
</template>
