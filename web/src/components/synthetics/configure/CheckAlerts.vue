<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import type { BrowserCheck } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import type { SelectModelValue } from '@/lib/forms/Select/OSelect.types'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OButton from '@/lib/core/Button/OButton.vue'

const props = defineProps<{
  check: BrowserCheck
  destinations: string[]
}>()

const emit = defineEmits<{
  'update:check': [value: BrowserCheck]
  'refresh:destinations': []
}>()

const { t } = useI18n()
const store = useStore()
const router = useRouter()

// ─── retries ──────────────────────────────────────────────────────────────────

const retries = computed({
  get: () => props.check.retries ?? 0,
  set: (v: string | number) => emit('update:check', { ...props.check, retries: Number(v) }),
})

const retryDelayMs = computed({
  get: () => props.check.waitBeforeRetrySecs ?? 0,
  set: (v: string | number) => emit('update:check', { ...props.check, waitBeforeRetrySecs: Number(v) }),
})

// ─── alert threshold ──────────────────────────────────────────────────────────

const failureThreshold = computed({
  get: () => props.check.alertIfFails ?? 1,
  set: (v: string | number) => emit('update:check', { ...props.check, alertIfFails: Number(v) }),
})

// ─── destinations ─────────────────────────────────────────────────────────────

const localDestinations = computed({
  get: () => props.check.notifications.destinations,
  set: (v: string[]) => {
    destinationError.value = v.length === 0
    emit('update:check', { ...props.check, notifications: { destinations: v } })
  },
})

const destinationError = ref(false)

function onDestinationsChange(value: SelectModelValue) {
  const v = (Array.isArray(value) ? value : []).filter(
    (d): d is string => typeof d === 'string',
  )
  destinationError.value = v.length === 0
  emit('update:check', { ...props.check, notifications: { destinations: v } })
}

function routeToCreateDestination() {
  const url = router.resolve({
    name: 'alertDestinations',
    query: {
      action: 'add',
      org_identifier: store.state.selectedOrganization.identifier,
    },
  }).href
  window.open(url, '_blank')
}

// ─── cooldown ─────────────────────────────────────────────────────────────────

const silenceMinutes = computed({
  get: () => props.check.cooldownMins ?? 5,
  set: (v: string | number) => emit('update:check', { ...props.check, cooldownMins: Number(v) }),
})
</script>

<template>
  <div class="rounded-default border border-border-default mb-4">
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-primary-600" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t('synthetics.scheduleAlert.alerts') }}
      </h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-4">

      <!-- ── Retries ────────────────────────────────────────────────────── -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 flex-nowrap">
          <label class="text-sm font-medium text-text-body whitespace-nowrap w-32">{{ t('synthetics.scheduleAlert.retriesOnFailure') }}</label>
          <OInput
            v-model="retries"
            type="number"
            class="w-25!"
            placeholder="0"
            data-test="synthetics-check-alerts-retries-input"
          />
          <span class="text-sm text-text-body whitespace-nowrap">{{ t('synthetics.scheduleAlert.retriesOnFailureSuffix') }}</span>
        </div>
        <div class="flex items-center gap-2 flex-nowrap">
          <label class="text-sm font-medium text-text-body whitespace-nowrap w-32">{{ t('synthetics.scheduleAlert.retryDelay') }}</label>
          <OInput
            v-model="retryDelayMs"
            type="number"
            class="w-25!"
            placeholder="0"
            data-test="synthetics-check-alerts-retry-delay-input"
          />
          <span class="text-sm text-text-body whitespace-nowrap">{{ t('synthetics.scheduleAlert.retryDelaySuffix') }}</span>
        </div>

        <!-- ── Failure threshold ────────────────────────────────────────── -->
        <div class="flex items-center gap-2 flex-nowrap">
          <label class="text-sm font-medium text-text-body whitespace-nowrap w-32">{{ t('synthetics.scheduleAlert.alertedIfFails') }}</label>
          <OInput
            v-model="failureThreshold"
            type="number"
            class="w-25!"
            placeholder="1"
            data-test="synthetics-check-alerts-failure-threshold-input"
          />
          <span class="text-sm text-text-body whitespace-nowrap">{{ t('synthetics.scheduleAlert.alertedIfFailsSuffix') }}</span>
        </div>
      </div>

      <!-- ── Destinations ───────────────────────────────────────────────── -->
      <div>
        <div class="flex items-center gap-2">
          <label class="text-sm font-medium text-text-body mb-1 block w-32">
            {{ t('synthetics.scheduleAlert.destinations') }} *
          </label>
          <OSelect
            v-model="localDestinations"
            :options="destinations"
            multiple
            :error="destinationError"
            class="min-w-45 max-w-75"
            data-test="synthetics-check-alerts-destinations-select"
            @update:model-value="onDestinationsChange"
          >
            <template #empty>{{ t('synthetics.scheduleAlert.noDestinations') }}</template>
          </OSelect>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            :title="t('synthetics.scheduleAlert.refreshDestinations')"
            data-test="synthetics-check-alerts-refresh-destinations-btn"
            @click="emit('refresh:destinations')"
          >
            <OIcon name="refresh" size="sm" />
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-check-alerts-add-destination-btn"
            @click="routeToCreateDestination"
          >
            {{ t('synthetics.scheduleAlert.addNewDestination') }}
          </OButton>
        </div>
        <p v-if="destinationError" class="mt-1 text-xs text-status-error-text">
          {{ t('synthetics.scheduleAlert.destinationRequired') }}
        </p>
      </div>

      <!-- ── Cooldown Period ────────────────────────────────────────────── -->
      <div class="flex items-center gap-2">
        <label class="w-32 text-sm font-medium text-text-body flex items-center">
          {{ t('synthetics.scheduleAlert.cooldownPeriod') }} *
        </label>
        <div class="flex items-center">
          <div class="w-21.75">
            <OInput
              v-model="silenceMinutes"
              type="number"
              min="0"
              data-test="synthetics-check-alerts-cooldown-input"
            />
          </div>
          <div
            class="flex justify-center items-center text-text-body pl-2 h-7 text-sm"
          >
            {{ t('synthetics.scheduleAlert.minutes') }}
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
