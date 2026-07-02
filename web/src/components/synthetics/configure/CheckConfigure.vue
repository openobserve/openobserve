<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import type { BrowserCheck, SyntheticsLocation, SyntheticsFolder } from '@/types/synthetics'
import CheckDetails from './CheckDetails.vue'
import CheckScheduleAlert from './CheckScheduleAlert.vue'
import CheckLocations from './CheckLocations.vue'
import CheckRUM from './CheckRUM.vue'
import CheckCapture from './CheckCapture.vue'

defineProps<{
  check: BrowserCheck
  checkType?: 'browser' | 'api'
  locations?: SyntheticsLocation[]
  destinations?: string[]
  folders?: SyntheticsFolder[]
}>()
const emit = defineEmits<{
  'update:check': [value: BrowserCheck]
  'refresh:destinations': []
}>()

function handleUpdate(value: BrowserCheck) {
  emit('update:check', value)
}
</script>

<template>
  <div class="tw:w-full tw:px-6 tw:py-4">
    <div class="tw:max-w-[53.75rem]">
      <CheckDetails
        :check="check"
        :folders="folders ?? []"
        data-test="synthetics-check-configure-details"
        @update:check="handleUpdate"
      />
      <CheckScheduleAlert
        :check="check"
        :destinations="destinations ?? []"
        data-test="synthetics-check-configure-schedule-alert"
        @update:check="handleUpdate"
        @refresh:destinations="emit('refresh:destinations')"
      />
      <CheckLocations
        :check="check"
        :locations="locations ?? []"
        data-test="synthetics-check-configure-locations"
        @update:check="handleUpdate"
      />
      <CheckRUM
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        :check-type="checkType"
        data-test="synthetics-check-configure-rum"
        @update:check="handleUpdate"
      />
      <CheckCapture
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        data-test="synthetics-check-configure-capture"
        @update:check="handleUpdate"
      />
    </div>
  </div>
</template>
