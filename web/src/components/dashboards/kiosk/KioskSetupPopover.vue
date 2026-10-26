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

<template>
  <OPopover v-model:open="open" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="tv"
        :active="open"
        :aria-label="t('dashboard.kiosk.tvMode')"
        data-test="dashboard-kiosk-btn"
      >
        <OTooltip v-if="!open" :content="t('dashboard.kiosk.tvMode')" />
      </OButton>
    </template>

    <div
      class="flex w-[min(18.5rem,calc(100vw-1.5rem))] flex-col gap-3 p-3"
      data-test="dashboard-kiosk-popover"
    >
      <OSelect
        :label="t('dashboard.kiosk.refresh')"
        :model-value="refreshSeconds"
        :options="refreshOptions"
        size="md"
        :searchable="false"
        data-test="dashboard-kiosk-refresh"
        @update:model-value="(value) => (refreshSeconds = Number(value) || 0)"
      >
        <template #tooltip>
          <OTooltip :content="t('dashboard.kiosk.refreshHelp')" />
        </template>
      </OSelect>

      <OToggleGroup
        :model-value="theme"
        type="single"
        :label="t('dashboard.kiosk.theme')"
        label-position="top"
        data-test="dashboard-kiosk-theme"
        @update:model-value="onThemeChange"
      >
        <OToggleGroupItem
          v-for="option in themeOptions"
          :key="option.value"
          :value="option.value"
          size="sm"
          :data-test="`dashboard-kiosk-theme-${option.value}`"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>

      <OSwitch v-model="fit" :label="t('dashboard.kiosk.fit')" data-test="dashboard-kiosk-fit">
        <template #tooltip>
          <OTooltip :content="t('dashboard.kiosk.fitHelp')" />
        </template>
      </OSwitch>

      <OButton
        variant="primary"
        size="sm"
        icon-left="tv"
        block
        data-test="dashboard-kiosk-open"
        @click="openKiosk"
      >
        {{ t("dashboard.kiosk.open") }}
      </OButton>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useI18nTyped } from "@/types/i18n";
import {
  DEFAULT_MIN_REFRESH_SECONDS,
  KIOSK_DEFAULT_REFRESH_SECONDS,
  KIOSK_REFRESH_CHOICES,
  formatRefreshLabel,
  type KioskLinkOptions,
  type KioskThemeChoice,
} from "@/utils/dashboard/kiosk";

const props = withDefaults(
  defineProps<{
    /** The dashboard's current auto-refresh, in seconds (0 = off). */
    currentRefreshSeconds?: number;
    minRefreshSeconds?: number;
  }>(),
  {
    currentRefreshSeconds: 0,
    minRefreshSeconds: DEFAULT_MIN_REFRESH_SECONDS,
  },
);

const emit = defineEmits<{
  open: [options: KioskLinkOptions];
}>();

const { t } = useI18nTyped();

const open = ref(false);
const refreshSeconds = ref(0);
const theme = ref<KioskThemeChoice>("current");
const fit = ref(false);

const SETUP_STORAGE_KEY = "oo_kiosk_setup";

const readSavedSetup = (): { theme: KioskThemeChoice; fit: boolean } => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SETUP_STORAGE_KEY) ?? "{}");
    const savedTheme = ["current", "light", "dark"].includes(saved?.theme)
      ? saved.theme
      : "current";
    return { theme: savedTheme, fit: saved?.fit === true };
  } catch {
    return { theme: "current", fit: false };
  }
};

const saveSetup = () => {
  try {
    sessionStorage.setItem(
      SETUP_STORAGE_KEY,
      JSON.stringify({ theme: theme.value, fit: fit.value }),
    );
  } catch {
    /* storage unavailable: the choice still applies to this link */
  }
};

const defaultRefresh = () => {
  const current = props.currentRefreshSeconds;
  if (current > 0) return Math.max(current, props.minRefreshSeconds);
  return Math.max(KIOSK_DEFAULT_REFRESH_SECONDS, props.minRefreshSeconds);
};

// Refresh follows the dashboard as it is now; theme and fit are what was last chosen in this session.
watch(open, (isOpen) => {
  if (!isOpen) return;
  refreshSeconds.value = defaultRefresh();
  const saved = readSavedSetup();
  theme.value = saved.theme;
  fit.value = saved.fit;
});

const refreshOptions = computed(() => {
  const values = new Set<number>(KIOSK_REFRESH_CHOICES);
  if (refreshSeconds.value > 0) values.add(refreshSeconds.value);
  return [...values]
    .sort((a, b) => a - b)
    .map((value) => ({
      label: formatRefreshLabel(value, t),
      value,
      disabled: value > 0 && value < props.minRefreshSeconds,
    }));
});

const themeOptions = computed(() => [
  { value: "current" as const, label: t("dashboard.kiosk.themeCurrent") },
  { value: "light" as const, label: t("dashboard.kiosk.themeLight") },
  { value: "dark" as const, label: t("dashboard.kiosk.themeDark") },
]);

// Clicking the pressed item emits an empty value; a theme choice is always required.
const onThemeChange = (value: unknown) => {
  if (value === "current" || value === "light" || value === "dark") theme.value = value;
};

const openKiosk = () => {
  saveSetup();
  open.value = false;
  emit("open", { refreshSeconds: refreshSeconds.value, theme: theme.value, fit: fit.value });
};
</script>
