<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck } from '@/types/synthetics'
import OInput from '@/lib/forms/Input/OInput.vue'
import OIcon from '@/lib/core/Icon/OIcon.vue'

const props = defineProps<{ check: BrowserCheck }>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const SAMPLE_DESTINATIONS = [
  'Email – team@openobserve.ai',
  'Slack – #alerts',
  'PagerDuty – SRE on-call',
]

const selectedDestinations = computed({
  get: () => props.check.notifications.destinations,
  set: (v: string[]) =>
    emit('update:check', {
      ...props.check,
      notifications: { ...props.check.notifications, destinations: v },
    }),
})

const silenceMinutes = computed({
  get: () => props.check.notifications.silenceMinutes,
  set: (v: string | number) =>
    emit('update:check', {
      ...props.check,
      notifications: { ...props.check.notifications, silenceMinutes: Number(v) },
    }),
})

function toggleDestination(dest: string) {
  const current = selectedDestinations.value
  if (current.includes(dest)) {
    selectedDestinations.value = current.filter((d) => d !== dest)
  } else {
    selectedDestinations.value = [...current, dest]
  }
}

function isSelected(dest: string) {
  return selectedDestinations.value.includes(dest)
}
</script>

<template>
  <div class="tw:rounded-lg tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:p-6 tw:mb-4">
    <h3 class="tw:text-base tw:font-semibold tw:text-[var(--o2-text-heading)] tw:mb-4">Notifications</h3>
    <div class="tw:flex tw:flex-col tw:gap-4">
      <div>
        <label class="tw:text-sm tw:font-medium tw:text-[var(--o2-text-label)] tw:mb-2 tw:block">Destinations</label>
        <ul class="tw:flex tw:flex-wrap tw:gap-2">
          <li
            v-for="dest in SAMPLE_DESTINATIONS"
            :key="dest"
          >
            <button
              type="button"
              :data-test="`synthetics-check-notifications-destination-${dest.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-btn`"
              :aria-pressed="isSelected(dest)"
              :class="[
                'tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:px-3 tw:py-1 tw:text-sm tw:border tw:transition-colors tw:cursor-pointer',
                isSelected(dest)
                  ? 'tw:bg-[var(--o2-primary-color)] tw:text-[var(--o2-text-inverse)] tw:border-[var(--o2-primary-color)]'
                  : 'tw:bg-[var(--o2-card-bg)] tw:text-[var(--o2-text-body)] tw:border-[var(--o2-border-color)] tw:hover:border-[var(--o2-primary-color)]',
              ]"
              @click="toggleDestination(dest)"
            >
              <OIcon v-if="isSelected(dest)" name="check" size="xs" />
              <span>{{ dest }}</span>
            </button>
          </li>
        </ul>
        <p class="tw:mt-2 tw:text-sm tw:text-[var(--o2-text-secondary)]">
          {{ selectedDestinations.length }} destination{{ selectedDestinations.length !== 1 ? 's' : '' }} selected
        </p>
      </div>

      <OInput
        v-model="silenceMinutes"
        type="number"
        label="Silence period (minutes)"
        placeholder="0"
        data-test="synthetics-check-notifications-silence-input"
      />
    </div>
  </div>
</template>
