<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import type { BrowserCheck, SyntheticsDevice } from "@/types/synthetics";
import chromiumSvgUrl from "@/assets/images/synthetics/chromium.svg";
import firefoxSvgUrl from "@/assets/images/synthetics/firefox.svg";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const props = defineProps<{
  check: BrowserCheck;
  browsers?: string[];
  devices?: SyntheticsDevice[];
  validationErrors?: Record<string, string>;
}>();
const emit = defineEmits<{ "update:check": [value: BrowserCheck] }>();

const { t } = useI18nTyped();

function deviceLabelKey(label: string): string {
  const map: Record<string, string> = {
    Desktop: "synthetics.browserDevices.desktop",
    Tablet: "synthetics.browserDevices.tablet",
    Mobile: "synthetics.browserDevices.mobile",
  };
  return map[label] ?? label;
}

const DEFAULT_BROWSERS = ["chromium", "firefox"];
const DEFAULT_DEVICES: SyntheticsDevice[] = [
  { id: "desktop", label: t("synthetics.browserDevices.desktop"), width: 1440, height: 900 },
  { id: "tablet", label: t("synthetics.browserDevices.tablet"), width: 768, height: 1024 },
  { id: "mobile", label: t("synthetics.browserDevices.mobile"), width: 375, height: 667 },
];

const DEVICE_ICONS: Record<string, string> = {
  desktop: "computer",
  tablet: "tablet",
  mobile: "smartphone",
  // legacy ids — monitors/records created before the rename
  laptop_large: "computer",
  mobile_small: "smartphone",
};

const BROWSER_ICONS: Record<string, string> = {
  chromium: chromiumSvgUrl,
  firefox: firefoxSvgUrl,
};

const activeBrowsers = computed(() =>
  (props.browsers && props.browsers.length > 0 ? props.browsers : DEFAULT_BROWSERS).map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
  })),
);

const activeDevices = computed(() =>
  props.devices && props.devices.length > 0 ? props.devices : DEFAULT_DEVICES,
);

const selected = computed<{ browser: string; device: string }[]>(
  () => props.check.browserDevices ?? [{ browser: "chromium", device: "desktop" }],
);

function isChecked(browserId: string, deviceId: string) {
  return selected.value.some((e) => e.browser === browserId && e.device === deviceId);
}

function toggle(browserId: string, deviceId: string) {
  const current = selected.value;
  const exists = current.some((e) => e.browser === browserId && e.device === deviceId);
  let next: { browser: string; device: string }[];

  if (exists) {
    if (current.length === 1) return;
    next = current.filter((e) => !(e.browser === browserId && e.device === deviceId));
  } else {
    next = [...current, { browser: browserId, device: deviceId }];
  }
  emit("update:check", { ...props.check, browserDevices: next });
}
</script>

<template>
  <div
    class="rounded-default border-border-default mb-4 border"
    data-test="synthetics-check-browser-devices"
  >
    <div class="border-border-default flex items-center border-b px-3 py-2.5">
      <div class="rounded-default bg-accent mr-2 h-4 w-[0.1875rem] shrink-0" />
      <h3 class="text-text-heading text-base font-semibold">
        {{ t("synthetics.browserDevices.title") }}
      </h3>
    </div>
    <div class="flex flex-col gap-3 px-3 py-2">
      <!-- Device column headers -->
      <div class="flex items-center gap-10 pb-2 pl-36">
        <div
          v-for="device in activeDevices"
          :key="device.id"
          class="text-text-label flex w-20 items-center gap-1 text-xs font-semibold capitalize"
        >
          <OIcon :name="DEVICE_ICONS[device.id] ?? 'devices'" size="sm" />
          {{ t(deviceLabelKey(device.label)) }}
        </div>
      </div>

      <!-- Browser rows -->
      <div v-for="browser in activeBrowsers" :key="browser.id" class="flex items-center gap-10">
        <div class="flex w-32 shrink-0 items-center gap-2">
          <img :src="BROWSER_ICONS[browser.id]" class="size-5" alt="" />
          <span class="text-text-body text-sm font-medium capitalize">{{ browser.label }}</span>
        </div>
        <div v-for="device in activeDevices" :key="device.id" class="w-20">
          <OCheckbox
            :model-value="isChecked(browser.id, device.id)"
            size="md"
            :data-test="`synthetics-check-browser-devices-cell-${browser.id}-${device.id}`"
            @update:model-value="toggle(browser.id, device.id)"
          />
        </div>
      </div>

      <!-- Validation error -->
      <p
        v-if="props.validationErrors?.browserDevices"
        class="text-status-error-text text-xs"
        data-test="synthetics-check-browser-devices-error"
      >
        {{ props.validationErrors.browserDevices }}
      </p>
    </div>
  </div>
</template>
