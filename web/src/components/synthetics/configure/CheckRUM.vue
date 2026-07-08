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
  <div class="rounded-lg border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] p-6 mb-4">
    <h3 class="text-base font-semibold text-[var(--o2-text-heading)] pb-4">RUM &amp; Session Replay</h3>
    <div class="flex flex-col gap-4">
      <div>
        <OSwitch
          v-model="collectRUM"
          label="Collect RUM data"
          data-test="synthetics-check-rum-collect-switch"
        />
        <p class="mt-1 text-xs! text-[var(--o2-text-secondary)] pl-9">
          Captures Web Vitals, resource waterfall, console errors, and a full session for each run.
        </p>
      </div>

      <div :class="!check.rum.collect ? 'opacity-50' : ''">
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
