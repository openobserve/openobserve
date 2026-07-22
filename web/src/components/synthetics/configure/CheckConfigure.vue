<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck, SyntheticCheckType, SyntheticsLocation, SyntheticsFolder, SyntheticsDevice } from '@/types/synthetics'
import CheckDetails from './CheckDetails.vue'
import CheckAuthNetwork from './CheckAuthNetwork.vue'
import CheckSchedule from './CheckSchedule.vue'
import CheckRetries from './CheckRetries.vue'
import CheckAlerts from './CheckAlerts.vue'
import CheckLocations from './CheckLocations.vue'
import CheckBrowserDevices from './CheckBrowserDevices.vue'
import CheckRUM from './CheckRUM.vue'
import CheckCapture from './CheckCapture.vue'

const props = defineProps<{
  check: BrowserCheck
  checkType?: SyntheticCheckType | 'api'
  locations?: SyntheticsLocation[]
  browsers?: string[]
  devices?: SyntheticsDevice[]
  destinations?: string[]
  folders?: SyntheticsFolder[]
  validationErrors?: Record<string, string>
  /** Protocol checks show the private-locations subsection + setup CTA. */
  allowPrivateLocations?: boolean
}>()

const { t } = useI18n()

// Browser/http take a full URL; tcp/tls/ssh take a bare host (the server
// rejects URLs for those types — validate_host_target).
const isHostTarget = computed(() => ['tcp', 'tls', 'ssh'].includes(props.checkType ?? 'browser'))
// Target field wording: browser keeps "Starting URL"; http is a plain "URL".
const targetLabel = computed(() => {
  if (isHostTarget.value) return t('synthetics.checkDetails.hostTarget')
  if (props.checkType === 'http' || props.checkType === 'api') return t('synthetics.checkDetails.urlTarget')
  return undefined
})
const targetPlaceholder = computed(() => {
  if (isHostTarget.value) return t('synthetics.checkDetails.hostTargetPlaceholder')
  if (props.checkType === 'http' || props.checkType === 'api') return t('synthetics.checkDetails.urlTargetPlaceholder')
  return undefined
})
// Basic auth + variables only make sense where the probe sends them today.
const showAuthNetwork = computed(() => ['browser', 'http', 'api'].includes(props.checkType ?? 'browser'))
const emit = defineEmits<{
  'update:check': [value: BrowserCheck]
  'refresh:destinations': []
  'setup-agent': []
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
        :target-label="targetLabel"
        :target-placeholder="targetPlaceholder"
        data-test="synthetics-check-configure-details"
        @update:check="handleUpdate"
      />
      <!-- Per-type request/config card (protocol checks) — filled by the parent view -->
      <slot name="type-config" />
      <CheckAuthNetwork
        v-if="showAuthNetwork"
        :check="check"
        data-test="synthetics-check-configure-auth-network"
        @update:check="handleUpdate"
      />
      <CheckSchedule
        :check="check"
        :validation-errors="props.validationErrors ?? {}"
        data-test="synthetics-check-configure-schedule"
        @update:check="handleUpdate"
      />
      <CheckRetries
        :check="check"
        :validation-errors="props.validationErrors ?? {}"
        data-test="synthetics-check-configure-retries"
        @update:check="handleUpdate"
      />
      <CheckAlerts
        :check="check"
        :destinations="destinations ?? []"
        :validation-errors="props.validationErrors ?? {}"
        data-test="synthetics-check-configure-alerts"
        @update:check="handleUpdate"
        @refresh:destinations="emit('refresh:destinations')"
      />
      <CheckLocations
        :check="check"
        :locations="locations ?? []"
        :allow-private="allowPrivateLocations"
        :validation-errors="props.validationErrors ?? {}"
        data-test="synthetics-check-configure-locations"
        @update:check="handleUpdate"
        @setup-agent="emit('setup-agent')"
      />
      <CheckBrowserDevices
        v-if="(checkType ?? 'browser') === 'browser'"
        :check="check"
        :browsers="browsers"
        :devices="devices"
        :validation-errors="props.validationErrors ?? {}"
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
