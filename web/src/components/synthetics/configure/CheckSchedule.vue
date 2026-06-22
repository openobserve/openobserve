<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck, BrowserCheckSchedule } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OSelect from '@/lib/forms/Select/OSelect.vue'
import OToggleGroup from '@/lib/core/ToggleGroup/OToggleGroup.vue'
import OToggleGroupItem from '@/lib/core/ToggleGroup/OToggleGroupItem.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

function updateSchedule(patch: Partial<BrowserCheckSchedule>) {
  emit('update:check', {
    ...props.check,
    schedule: { ...props.check.schedule, ...patch },
  })
}

const scheduleType = computed({
  get: () => props.check.schedule.type,
  set: (v: string) => updateSchedule({ type: v as 'interval' | 'cron' }),
})

const intervalValue = computed({
  get: () => props.check.schedule.intervalValue ?? 5,
  set: (v: string | number) => updateSchedule({ intervalValue: Number(v) }),
})

const intervalUnit = computed({
  get: () => props.check.schedule.intervalUnit ?? 'minutes',
  set: (v: string | number | boolean | null | undefined) =>
    updateSchedule({ intervalUnit: (v as 'minutes' | 'hours') ?? 'minutes' }),
})

const cron = computed({
  get: () => props.check.schedule.cron ?? '',
  set: (v: string) => updateSchedule({ cron: v }),
})

const timezone = computed({
  get: () => props.check.schedule.timezone ?? 'UTC',
  set: (v: string | number | boolean | null | undefined) =>
    updateSchedule({ timezone: v != null ? String(v) : 'UTC' }),
})

const retries = computed({
  get: () => props.check.schedule.retries ?? 0,
  set: (v: string | number) => updateSchedule({ retries: Number(v) }),
})

const intervalUnitOptions = [
  { label: 'Minutes', value: 'minutes' },
  { label: 'Hours', value: 'hours' },
]

const timezoneOptions = [
  { label: 'UTC', value: 'UTC' },
  { label: 'America/New_York', value: 'America/New_York' },
  { label: 'America/Chicago', value: 'America/Chicago' },
  { label: 'America/Denver', value: 'America/Denver' },
  { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
  { label: 'Europe/London', value: 'Europe/London' },
  { label: 'Europe/Paris', value: 'Europe/Paris' },
  { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
  { label: 'Asia/Singapore', value: 'Asia/Singapore' },
  { label: 'Australia/Sydney', value: 'Australia/Sydney' },
]

const cronHint = computed(() => {
  if (!cron.value) return 'e.g. Every 5 minutes · UTC'
  return `Cron: ${cron.value} · ${timezone.value}`
})
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-4">Schedule &amp; Locations</h3>
    <div class="tw:flex tw:flex-col tw:gap-4">
      <div>
        <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">Frequency type</label>
        <OToggleGroup
          v-model="scheduleType"
          type="single"
          data-test="synthetics-check-schedule-type-toggle"
        >
          <OToggleGroupItem
            value="interval"
            data-test="synthetics-check-schedule-interval-item"
          >
            Interval
          </OToggleGroupItem>
          <OToggleGroupItem
            value="cron"
            data-test="synthetics-check-schedule-cron-item"
          >
            Cron
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <template v-if="check.schedule.type === 'interval'">
        <div class="tw:flex tw:items-center tw:gap-3">
          <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:shrink-0">Run every</label>
          <OInput
            v-model="intervalValue"
            type="number"
            placeholder="5"
            class="tw:w-24"
            data-test="synthetics-check-schedule-interval-value-input"
          />
          <OSelect
            v-model="intervalUnit"
            :options="intervalUnitOptions"
            class="tw:w-36"
            data-test="synthetics-check-schedule-interval-unit-select"
          />
        </div>
      </template>

      <template v-else>
        <OInput
          v-model="cron"
          label="Cron expression"
          placeholder="*/5 * * * *"
          :help-text="cronHint"
          data-test="synthetics-check-schedule-cron-input"
        />
        <OSelect
          v-model="timezone"
          label="Timezone"
          :options="timezoneOptions"
          data-test="synthetics-check-schedule-timezone-select"
        />
      </template>

      <OInput
        v-model="retries"
        type="number"
        label="Retries on failure"
        placeholder="0"
        :help-text="`Re-run up to ${retries} times before alerting`"
        data-test="synthetics-check-schedule-retries-input"
      />

      <div>
        <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">Locations</label>
        <div class="tw:flex tw:flex-col tw:gap-2">
          <div class="tw:flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:px-3 tw:py-2">
            <OIcon name="check-circle" size="sm" class="tw:text-[var(--o2-status-success-text)]" />
            <span class="tw:text-sm tw:text-[var(--o2-text-body)]">AWS · us-east-1</span>
          </div>
          <div
            class="tw:flex tw:items-center tw:justify-center tw:rounded-md tw:border tw:border-dashed tw:border-[var(--o2-border-color)] tw:px-3 tw:py-3 tw:text-sm tw:text-[var(--o2-text-muted)]"
          >
            More regions &amp; private locations — Coming soon
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
