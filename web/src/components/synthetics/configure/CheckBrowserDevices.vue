<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BrowserCheck, SyntheticsDevice } from '@/types/synthetics'
import chromiumSvgUrl from '@/assets/images/synthetics/chromium.svg'
import firefoxSvgUrl from '@/assets/images/synthetics/firefox.svg'
import OIcon from '@/lib/core/Icon/OIcon.vue'
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue'

const props = defineProps<{
  check: BrowserCheck
  browsers?: string[]
  devices?: SyntheticsDevice[]
}>()
const emit = defineEmits<{ 'update:check': [value: BrowserCheck] }>()

const { t } = useI18n()

function deviceLabelKey(label: string): string {
  const map: Record<string, string> = {
    Desktop: 'synthetics.browserDevices.desktop',
    Tablet: 'synthetics.browserDevices.tablet',
    Mobile: 'synthetics.browserDevices.mobile',
  }
  return map[label] ?? label
}

const DEFAULT_BROWSERS = ['chromium', 'firefox']
const DEFAULT_DEVICES: SyntheticsDevice[] = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'tablet',  label: 'Tablet',  width: 768,  height: 1024 },
  { id: 'mobile',  label: 'Mobile',  width: 375,  height: 667 },
]

const DEVICE_ICONS: Record<string, string> = {
  desktop:      'computer',
  tablet:       'tablet',
  mobile:       'smartphone',
  // legacy ids — monitors/records created before the rename
  laptop_large: 'computer',
  mobile_small: 'smartphone',
}

const BROWSER_ICONS: Record<string, string> = {
  chromium: chromiumSvgUrl,
  firefox: firefoxSvgUrl,
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
  () => props.check.browserDevices ?? [{ browser: 'chromium', device: 'desktop' }],
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
  <div
    class="rounded-default border border-border-default mb-4"
    data-test="synthetics-check-browser-devices"
  >
    <div class="flex items-center border-b border-border-default py-2.5 px-3">
      <div class="w-[0.1875rem] h-4 rounded-default mr-2 shrink-0 bg-accent" />
      <h3 class="text-base font-semibold text-text-heading">
        {{ t('synthetics.browserDevices.title') }}
      </h3>
    </div>
    <div class="px-3 py-2 flex flex-col gap-3">
      <!-- Device column headers -->
      <div class="flex items-center gap-10 pl-36 pb-2">
        <div
          v-for="device in activeDevices"
          :key="device.id"
          class="flex items-center gap-1 text-xs font-semibold capitalize w-20 text-text-label"
        >
          <OIcon :name="DEVICE_ICONS[device.id] ?? 'devices'" size="sm" />
          {{ t(deviceLabelKey(device.label)) }}
        </div>
      </div>

      <!-- Browser rows -->
      <div
        v-for="browser in activeBrowsers"
        :key="browser.id"
        class="flex items-center gap-10"
      >
        <div class="flex items-center gap-2 w-32 shrink-0">
          <img :src="BROWSER_ICONS[browser.id]" class="size-5" alt="" />
          <span class="text-sm font-medium text-text-body capitalize">{{ browser.label }}</span>
        </div>
        <div
          v-for="device in activeDevices"
          :key="device.id"
          class="w-20"
        >
          <OCheckbox
            :model-value="isChecked(browser.id, device.id)"
            size="md"
            :data-test="`synthetics-check-browser-devices-cell-${browser.id}-${device.id}`"
            @update:model-value="toggle(browser.id, device.id)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
