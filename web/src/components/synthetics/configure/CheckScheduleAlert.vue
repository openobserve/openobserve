<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import type { BrowserCheck, BrowserCheckSchedule } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue'
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OButton from '@/lib/core/Button/OButton.vue'
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue'
import ODate from '@/lib/forms/Date/ODate.vue'
import OTime from '@/lib/forms/Time/OTime.vue'

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

// ─── helpers ──────────────────────────────────────────────────────────────────

function updateSchedule(patch: Partial<BrowserCheckSchedule>) {
  emit('update:check', {
    ...props.check,
    schedule: { ...props.check.schedule, ...patch },
  })
}


// ─── frequency preset ─────────────────────────────────────────────────────────

type FrequencyPreset = '1min' | '5min' | '15min' | '30min' | '1hour' | 'cron' | 'custom'

const frequencyOptions: { label: string; value: FrequencyPreset }[] = [
  { label: t('synthetics.scheduleAlert.frequencyOptions.1min'), value: '1min' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.5min'), value: '5min' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.15min'), value: '15min' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.30min'), value: '30min' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.1hour'), value: '1hour' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.cron'), value: 'cron' },
  { label: t('synthetics.scheduleAlert.frequencyOptions.custom'), value: 'custom' },
]

function scheduleToPreset(s: BrowserCheckSchedule): FrequencyPreset {
  if (s.type === 'cron') return 'cron'
  // Explicit "Custom" selection persists regardless of interval values
  if (s.isCustomFrequency) return 'custom'
  const mins =
    s.intervalUnit === 'hours'
      ? (s.intervalValue ?? 1) * 60
      : (s.intervalValue ?? 5)
  if (mins === 1) return '1min'
  if (mins === 5) return '5min'
  if (mins === 15) return '15min'
  if (mins === 30) return '30min'
  if (mins === 60) return '1hour'
  return 'custom'
}

const frequencyPreset = computed<FrequencyPreset>({
  get: () => scheduleToPreset(props.check.schedule),
  set: (v: FrequencyPreset) => {
    if (v === 'cron') {
      const patch: Partial<BrowserCheckSchedule> = { type: 'cron', isCustomFrequency: false }
      if (!props.check.schedule.timezone) {
        try {
          patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        } catch {
          patch.timezone = 'UTC'
        }
      }
      updateSchedule(patch)
    } else if (v === 'custom') {
      const cur = props.check.schedule
      updateSchedule({
        type: 'interval',
        intervalValue: cur.intervalValue ?? 10,
        intervalUnit: cur.intervalUnit ?? 'minutes',
        cron: '',
        isCustomFrequency: true,
      })
    } else {
      const map: Record<Exclude<FrequencyPreset, 'custom'>, { intervalValue: number; intervalUnit: 'minutes' | 'hours' }> = {
        '1min':  { intervalValue: 1,  intervalUnit: 'minutes' },
        '5min':  { intervalValue: 5,  intervalUnit: 'minutes' },
        '15min': { intervalValue: 15, intervalUnit: 'minutes' },
        '30min': { intervalValue: 30, intervalUnit: 'minutes' },
        '1hour': { intervalValue: 1,  intervalUnit: 'hours' },
        cron:    { intervalValue: 5,  intervalUnit: 'minutes' },
      }
      updateSchedule({ type: 'interval', ...map[v], isCustomFrequency: false })
    }
  },
})

// ─── cron + timezone ──────────────────────────────────────────────────────────

const cron = computed({
  get: () => props.check.schedule.cron ?? '',
  set: (v: string) => updateSchedule({ cron: v }),
})

function buildTimezoneOptions(): { label: string; value: string }[] {
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const options: { label: string; value: string }[] = [
      { label: `Browser Time (${browserTz})`, value: `Browser Time (${browserTz})` },
      { label: 'UTC', value: 'UTC' },
    ]
    // @ts-ignore - supportedValuesOf not in all TS versions
    if (typeof Intl.supportedValuesOf === 'function') {
      // @ts-ignore
      for (const tz of Intl.supportedValuesOf('timeZone') as string[]) {
        if (tz !== 'UTC') options.push({ label: tz, value: tz })
      }
    }
    return options
  } catch {
    // fall through
  }
  return [{ label: 'UTC', value: 'UTC' }]
}

const timezoneOptions = buildTimezoneOptions()

const timezone = computed({
  get: () => {
    if (props.check.schedule.timezone) return props.check.schedule.timezone
    try {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      return `Browser Time (${browserTz})`
    } catch {
      return 'UTC'
    }
  },
  set: (v: string | number | boolean | null | undefined) =>
    updateSchedule({ timezone: v != null ? String(v) : 'UTC' }),
})

// ─── custom interval inputs (shown when "Custom" frequency selected) ────────────

const customIntervalValue = computed({
  get: () => props.check.schedule.intervalValue ?? 10,
  set: (v: string | number) => updateSchedule({ intervalValue: Number(v) }),
})

const customIntervalUnit = computed({
  get: () => props.check.schedule.intervalUnit ?? 'minutes',
  set: (v: string) => updateSchedule({ intervalUnit: v as BrowserCheckSchedule['intervalUnit'] }),
})

const customIntervalUnitOptions = [
  { label: t('synthetics.scheduleAlert.customIntervalUnit.minutes'), value: 'minutes' },
  { label: t('synthetics.scheduleAlert.customIntervalUnit.hours'), value: 'hours' },
  { label: t('synthetics.scheduleAlert.customIntervalUnit.days'), value: 'days' },
  { label: t('synthetics.scheduleAlert.customIntervalUnit.weeks'), value: 'weeks' },
  { label: t('synthetics.scheduleAlert.customIntervalUnit.months'), value: 'months' },
]

// ─── start type ───────────────────────────────────────────────────────────────

const startType = computed({
  get: () => props.check.schedule.startType ?? 'now',
  set: (v: string) => {
    const patch: Partial<BrowserCheckSchedule> = { startType: v as 'now' | 'later' }
    if (v === 'later' && !props.check.schedule.timezone) {
      try { patch.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone }
      catch { patch.timezone = 'UTC' }
    }
    updateSchedule(patch)
  },
})

const startDate = computed({
  get: () => props.check.schedule.startDate ?? '',
  set: (v: string) => updateSchedule({ startDate: v }),
})

const startTime = computed({
  get: () => props.check.schedule.startTime ?? '',
  set: (v: string) => updateSchedule({ startTime: v }),
})

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

function onDestinationsChange(v: string[]) {
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
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-6">
      {{ t('synthetics.scheduleAlert.title') }}
    </h3>

    <div class="tw:flex tw:flex-col tw:gap-6">

      <!-- ── Frequency + Schedule Now/Later (same row) ───────────────── -->
      <div class="tw:flex tw:items-end tw:gap-8 tw:flex-wrap">
        <!-- Frequency -->
        <div>
          <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">
            {{ t('synthetics.scheduleAlert.frequency') }}
          </label>
          <OToggleGroup
            v-model="frequencyPreset"
            type="single"
            data-test="synthetics-schedule-alert-frequency-toggle"
          >
            <OToggleGroupItem
              v-for="opt in frequencyOptions"
              :key="opt.value"
              :value="opt.value"
              size="sm"
              :data-test="`synthetics-schedule-alert-frequency-${opt.value}-item`"
            >
              {{ opt.label }}
            </OToggleGroupItem>
          </OToggleGroup>
        </div>

        <!-- Schedule Now / Later -->
        <div v-if="check.schedule.type !== 'cron'" class="tw:flex tw:items-center tw:gap-2">
          <OToggleGroup
            v-model="startType"
            type="single"
            data-test="synthetics-schedule-alert-start-type-toggle"
          >
            <OToggleGroupItem value="now" size="sm" data-test="synthetics-schedule-alert-start-now-item">
              {{ t('synthetics.scheduleAlert.scheduleNow') }}
            </OToggleGroupItem>
            <OToggleGroupItem value="later" size="sm" data-test="synthetics-schedule-alert-start-later-item">
              {{ t('synthetics.scheduleAlert.scheduleLater') }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OIcon name="info-outline" size="sm" class="tw:cursor-pointer tw:text-[var(--o2-text-muted)]">
            <OTooltip side="right" align="center">
              <template #content>
                {{ t('synthetics.scheduleAlert.scheduleNowTooltip') }}<br />
                {{ t('synthetics.scheduleAlert.scheduleLaterTooltip') }}
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>

      <!-- Cron inputs (shown below the row when cron selected) -->
      <div v-if="check.schedule.type === 'cron'" class="tw:flex tw:items-start tw:gap-3 tw:flex-wrap">
        <OInput
          v-model="cron"
          :label="t('synthetics.scheduleAlert.cronExpression')"
          :placeholder="t('synthetics.scheduleAlert.cronPlaceholder')"
          class="tw:w-83!"
          data-test="synthetics-schedule-alert-cron-input"
        />
        <OSelect
          v-model="timezone"
          :label="t('synthetics.scheduleAlert.timezone')"
          :options="timezoneOptions"
          class="tw:w-64!"
          data-test="synthetics-schedule-alert-timezone-select"
        />
      </div>

      <!-- Custom interval inputs (shown when "Custom" frequency selected) -->
      <div v-if="frequencyPreset === 'custom'" class="tw:flex tw:items-start tw:gap-3 tw:flex-wrap">
        <OInput
          v-model="customIntervalValue"
          :label="t('synthetics.scheduleAlert.customIntervalValue')"
          type="number"
          min="1"
          class="tw:w-40!"
          data-test="synthetics-schedule-alert-custom-interval-value-input"
        />
        <OSelect
          v-model="customIntervalUnit"
          :label="t('synthetics.scheduleAlert.customIntervalUnit.label')"
          :options="customIntervalUnitOptions"
          class="tw:w-40!"
          data-test="synthetics-schedule-alert-custom-interval-unit-select"
        />
      </div>

      <!-- Schedule Later date/time pickers (shown below the row when later selected) -->
      <div v-if="startType === 'later' && check.schedule.type !== 'cron'" class="tw:flex tw:items-start tw:gap-3 tw:flex-wrap">
        <ODate
          v-model="startDate"
          :label="t('synthetics.scheduleAlert.startDate')"
          data-test="synthetics-schedule-alert-start-date-input"
          class="tw:w-40!"
        />
        <OTime
          v-model="startTime"
          :label="t('synthetics.scheduleAlert.startTime')"
          data-test="synthetics-schedule-alert-start-time-input"
          class="tw:w-40!"
        />
        <OSelect
          v-model="timezone"
          :label="t('synthetics.scheduleAlert.timezone')"
          :options="timezoneOptions"
          class="tw:w-64!"
          data-test="synthetics-schedule-alert-start-timezone-select"
        />
      </div>

      <!-- ── Retries ────────────────────────────────────────────────────── -->
      <div class="tw:flex tw:flex-col tw:gap-2">
        <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap tw:w-32">{{ t('synthetics.scheduleAlert.retriesOnFailure') }}</span>
          <OInput
            v-model="retries"
            type="number"
            class="tw:w-25!"
            placeholder="0"
            data-test="synthetics-schedule-alert-retries-input"
          />
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">{{ t('synthetics.scheduleAlert.retriesOnFailureSuffix') }}</span>
        </div>
        <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap tw:w-32">{{ t('synthetics.scheduleAlert.retryDelay') }}</span>
          <OInput
            v-model="retryDelayMs"
            type="number"
            class="tw:w-25!"
            placeholder="0"
            data-test="synthetics-schedule-alert-retry-delay-input"
          />
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">{{ t('synthetics.scheduleAlert.retryDelaySuffix') }}</span>
        </div>

        <!-- ── Alert (grouped with retries — same failure-behavior section) ── -->
        <div class="tw:flex tw:items-center tw:gap-2 tw:flex-nowrap">
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap tw:w-32">{{ t('synthetics.scheduleAlert.alertedIfFails') }}</span>
          <OInput
            v-model="failureThreshold"
            type="number"
            class="tw:w-25!"
            placeholder="1"
            data-test="synthetics-schedule-alert-failure-threshold-input"
          />
          <span class="tw:text-sm tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">{{ t('synthetics.scheduleAlert.alertedIfFailsSuffix') }}</span>
        </div>
      </div>

      <!-- ── Destinations ───────────────────────────────────────────────── -->
      <div>
        <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">
          {{ t('synthetics.scheduleAlert.destinations') }} *
        </label>
        <div class="tw:flex tw:items-center tw:gap-1">
          <OSelect
            v-model="localDestinations"
            :options="destinations"
            multiple
            :error="destinationError"
            class="tw:min-w-[180px] tw:max-w-[300px]"
            data-test="synthetics-schedule-alert-destinations-select"
            @update:model-value="onDestinationsChange"
          >
            <template #empty>{{ t('synthetics.scheduleAlert.noDestinations') }}</template>
          </OSelect>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            :title="t('synthetics.scheduleAlert.refreshDestinations')"
            data-test="synthetics-schedule-alert-refresh-destinations-btn"
            @click="emit('refresh:destinations')"
          >
            <OIcon name="refresh" size="sm" />
          </OButton>
          <OButton
            variant="outline"
            size="sm"
            data-test="synthetics-schedule-alert-add-destination-btn"
            @click="routeToCreateDestination"
          >
            {{ t('synthetics.scheduleAlert.addNewDestination') }}
          </OButton>
        </div>
        <p v-if="destinationError" class="tw:mt-1 tw:text-xs tw:text-[var(--o2-status-error-text)]">
          {{ t('synthetics.scheduleAlert.destinationRequired') }}
        </p>
      </div>

      <!-- ── Cooldown Period ────────────────────────────────────────────── -->
      <div class="tw:flex tw:items-center tw:gap-0">
        <div class="tw:w-32 tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:flex tw:items-center">
          {{ t('synthetics.scheduleAlert.cooldownPeriod') }} *
        </div>
        <div class="tw:flex tw:items-center">
          <div class="tw:w-[87px]">
            <OInput
              v-model="silenceMinutes"
              type="number"
              min="0"
              data-test="synthetics-schedule-alert-cooldown-input"
            />
          </div>
          <div
            class="tw:flex tw:justify-center tw:items-center tw:text-input-addon-text tw:pl-2 tw:h-7 tw:text-sm"
          >
            {{ t('synthetics.scheduleAlert.minutes') }}
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
