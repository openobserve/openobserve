<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import type { BrowserCheck, SyntheticsDevice } from '@/types/synthetics'

const props = defineProps<{
  check: BrowserCheck
  browsers?: string[]
  devices?: SyntheticsDevice[]
}>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const DEFAULT_BROWSERS = ['chromium', 'firefox']
const DEFAULT_DEVICES: SyntheticsDevice[] = [
  { id: 'laptop_large', label: 'Desktop', width: 1440, height: 900 },
  { id: 'tablet',       label: 'Tablet',  width: 768,  height: 1024 },
  { id: 'mobile_small', label: 'Mobile',  width: 375,  height: 667 },
]

const DEVICE_ICONS: Record<string, string> = {
  laptop_large: 'laptop',
  tablet:       'tablet_mac',
  mobile_small: 'smartphone',
}

const activeBrowsers = computed(() =>
  (props.browsers && props.browsers.length > 0 ? props.browsers : DEFAULT_BROWSERS).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  })),
)

const activeDevices = computed(() =>
  props.devices && props.devices.length > 0 ? props.devices : DEFAULT_DEVICES,
)

const selected = computed<{ browser: string; device: string }[]>(
  () => props.check.browserDevices ?? [{ browser: 'chromium', device: 'laptop_large' }],
)

function isChecked(browserId: string, deviceId: string) {
  return selected.value.some((e) => e.browser === browserId && e.device === deviceId)
}

function toggle(browserId: string, deviceId: string) {
  const current = selected.value
  const exists = current.some((e) => e.browser === browserId && e.device === deviceId)
  let next: { browser: string; device: string }[]

  if (exists) {
    if (current.length === 1) return
    next = current.filter((e) => !(e.browser === browserId && e.device === deviceId))
  } else {
    next = [...current, { browser: browserId, device: deviceId }]
  }
  emit('update:check', { ...props.check, browserDevices: next })
}
</script>

<template>
  <div class="rounded-lg border border-[var(--o2-border-color)] bg-[var(--o2-card-bg)] p-6 mb-4">
    <h3 class="text-base font-semibold text-[var(--o2-text-heading)] mb-1">
      Browsers &amp; Devices
    </h3>
    <p class="text-xs text-[var(--o2-text-muted)] mb-5">
      Each selected combination runs as a separate execution per check. At least one must be selected.
    </p>

    <!-- Grid: rows = browsers, cols = devices -->
    <div class="overflow-x-auto">
      <table class="device-grid w-full">
        <thead>
          <tr>
            <th class="w-28" />
            <th
              v-for="device in activeDevices"
              :key="device.id"
              class="text-xs font-semibold text-[var(--o2-text-muted)] uppercase tracking-wide text-center pb-2"
            >
              <div class="flex flex-col items-center gap-1">
                <span class="material-symbols-outlined text-base text-[var(--o2-text-muted)] normal-case not-italic">{{ DEVICE_ICONS[device.id] ?? 'devices' }}</span>
                {{ device.label }}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="browser in activeBrowsers" :key="browser.id">
            <td class="py-2 pr-4 text-sm font-medium text-[var(--o2-text-primary)] capitalize">
              {{ browser.label }}
            </td>
            <td
              v-for="device in activeDevices"
              :key="device.id"
              class="text-center py-2"
            >
              <button
                class="device-cell"
                :class="isChecked(browser.id, device.id) ? 'device-cell--on' : 'device-cell--off'"
                :title="`${browser.label} · ${device.label}`"
                :aria-pressed="isChecked(browser.id, device.id)"
                @click="toggle(browser.id, device.id)"
              >
                <span
                  v-if="isChecked(browser.id, device.id)"
                  class="material-symbols-outlined text-sm"
                >check</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Selected combos summary -->
    <div class="flex flex-wrap gap-2 mt-4">
      <span
        v-for="combo in selected"
        :key="`${combo.browser}-${combo.device}`"
        class="inline-flex items-center gap-1.5 text-xs font-medium bg-[var(--o2-surface-secondary)] border border-[var(--o2-border-color)] rounded-full px-2.5 py-1 text-[var(--o2-text-secondary)] capitalize"
      >
        {{ combo.browser }} · {{ combo.device.replace('_', ' ') }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.device-cell {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.375rem;
  border: 1.5px solid var(--o2-border-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, border-color 0.15s;
  cursor: pointer;

  &--on {
    background: var(--o2-primary-color, #6366f1);
    border-color: var(--o2-primary-color, #6366f1);
    color: white;
  }

  &--off {
    background: var(--o2-card-bg);
    color: transparent;

    &:hover {
      border-color: var(--o2-primary-color, #6366f1);
      background: color-mix(in srgb, var(--o2-primary-color, #6366f1) 10%, transparent);
    }
  }
}

.device-grid td,
.device-grid th {
  padding-left: 0.75rem;
  padding-right: 0.75rem;
}
</style>
