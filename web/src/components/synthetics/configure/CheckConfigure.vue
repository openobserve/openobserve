<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import type { BrowserCheck } from '@/types/synthetics'
import CheckDetails from './CheckDetails.vue'
import CheckSchedule from './CheckSchedule.vue'
import CheckNotifications from './CheckNotifications.vue'
import CheckRUM from './CheckRUM.vue'
import CheckAuthNetwork from './CheckAuthNetwork.vue'

const props = defineProps<{
  check: BrowserCheck
  checkType?: 'browser' | 'api'
}>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

function handleUpdate(value: BrowserCheck) {
  emit('update:check', value)
}
</script>

<template>
  <div class="tw:w-full tw:max-w-[53.75rem] tw:px-6 tw:py-4">
    <CheckDetails
      :check="check"
      data-test="synthetics-check-configure-details"
      @update:check="handleUpdate"
    />
    <CheckSchedule
      :check="check"
      data-test="synthetics-check-configure-schedule"
      @update:check="handleUpdate"
    />
    <CheckNotifications
      :check="check"
      data-test="synthetics-check-configure-notifications"
      @update:check="handleUpdate"
    />
    <CheckRUM
      v-if="(checkType ?? 'browser') === 'browser'"
      :check="check"
      :check-type="checkType"
      data-test="synthetics-check-configure-rum"
      @update:check="handleUpdate"
    />
    <CheckAuthNetwork
      :check="check"
      data-test="synthetics-check-configure-auth-network"
      @update:check="handleUpdate"
    />
  </div>
</template>
