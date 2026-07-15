<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import type { BrowserCheck, SyntheticsLocation, SyntheticsFolder, SyntheticsDevice } from '@/types/synthetics'
import CheckDetails from './CheckDetails.vue'
import CheckAuthNetwork from './CheckAuthNetwork.vue'
import CheckSchedule from './CheckSchedule.vue'
import CheckAlerts from './CheckAlerts.vue'
import CheckLocations from './CheckLocations.vue'
import CheckBrowserDevices from './CheckBrowserDevices.vue'
import CheckRUM from './CheckRUM.vue'
import CheckCapture from './CheckCapture.vue'

const props = defineProps<{
  check: BrowserCheck
  checkType?: 'browser' | 'api'
  locations?: SyntheticsLocation[]
  browsers?: string[]
  devices?: SyntheticsDevice[]
  destinations?: string[]
  folders?: SyntheticsFolder[]
  validationErrors?: Record<string, string>
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
  <div class="w-full px-6 py-4">
    <div class="max-w-[53.75rem]">
      <CheckDetails
        :check="check"
        :folders="folders ?? []"
        :validation-errors="props.validationErrors ?? {}"
        data-test="synthetics-check-configure-details"
        @update:check="handleUpdate"
      />
      <CheckAuthNetwork
        :check="check"
        data-test="synthetics-check-configure-auth-network"
        @update:check="handleUpdate"
      />
      <CheckSchedule
        :check="check"
        data-test="synthetics-check-configure-schedule"
        @update:check="handleUpdate"
      />
      <CheckAlerts
        :check="check"
        :destinations="destinations ?? []"
        data-test="synthetics-check-configure-alerts"
        @update:check="handleUpdate"
        @refresh:destinations="emit('refresh:destinations')"
      />
      <CheckLocations
        :check="check"
        :locations="locations ?? []"
        data-test="synthetics-check-configure-locations"
        @update:check="handleUpdate"
      />
      <CheckBrowserDevices
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        :browsers="browsers"
        :devices="devices"
        data-test="synthetics-check-configure-browser-devices"
        @update:check="handleUpdate"
      />
      <!-- <CheckRUM
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        :check-type="checkType"
        data-test="synthetics-check-configure-rum"
        @update:check="handleUpdate"
      /> -->
      <CheckCapture
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        data-test="synthetics-check-configure-capture"
        @update:check="handleUpdate"
      />
    </div>
  </div>
</template>
