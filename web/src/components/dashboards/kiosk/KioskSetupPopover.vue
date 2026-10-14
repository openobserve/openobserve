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
        :size="compact ? 'icon-toolbar' : 'sm-toolbar'"
        icon-left="tv"
        :active="open"
        :aria-label="t('dashboard.kiosk.tvMode')"
        data-test="dashboard-kiosk-btn"
      >
        <template v-if="!compact">{{ t("dashboard.kiosk.tvMode") }}</template>
        <OTooltip v-if="!open" :content="t('dashboard.kiosk.tvModeTooltip')" />
      </OButton>
    </template>

    <div
      class="flex w-[min(19rem,calc(100vw-1.5rem))] flex-col gap-3 p-3"
      data-test="dashboard-kiosk-popover"
    >
      <div class="flex flex-col gap-0.5">
        <p class="text-text-heading flex items-center gap-1.5 text-sm font-semibold">
          <OIcon name="tv" size="sm" class="text-accent" />
          {{ t("dashboard.kiosk.tvMode") }}
        </p>
        <p class="text-text-secondary text-xs">{{ t("dashboard.kiosk.setupHint") }}</p>
      </div>

      <OSelect
        :label="t('dashboard.kiosk.refresh')"
        :model-value="refreshSeconds"
        :options="refreshOptions"
        size="md"
        :searchable="false"
        :help-text="refreshSeconds === 0 ? t('dashboard.kiosk.refreshOffHint') : undefined"
        data-test="dashboard-kiosk-refresh"
        @update:model-value="(value) => (refreshSeconds = Number(value) || 0)"
      />

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

      <OSwitch v-model="fit" :label="t('dashboard.kiosk.fit')" data-test="dashboard-kiosk-fit" />

      <dl
        class="bg-surface-subtle rounded-default text-text-secondary grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 p-2 text-xs"
        data-test="dashboard-kiosk-summary"
      >
        <dt class="text-text-heading font-medium">{{ t("dashboard.kiosk.timeRange") }}</dt>
        <dd class="min-w-0">
          <OTruncatedText>{{ timeRangeLabel }}</OTruncatedText>
        </dd>
        <template v-if="tabName">
          <dt class="text-text-heading font-medium">{{ t("dashboard.kiosk.tab") }}</dt>
          <dd class="min-w-0">
            <OTruncatedText>{{ tabName }}</OTruncatedText>
          </dd>
        </template>
        <dt class="text-text-heading font-medium">{{ t("dashboard.kiosk.variables") }}</dt>
        <dd class="min-w-0" data-test="dashboard-kiosk-summary-variables">
          <OTruncatedText>{{ variablesLabel }}</OTruncatedText>
        </dd>
      </dl>

      <div class="flex gap-2">
        <OButton
          variant="outline"
          size="sm"
          icon-left="link"
          class="flex-1"
          data-test="dashboard-kiosk-copy-link"
          @click="emit('copy', currentOptions())"
        >
          {{ t("dashboard.kiosk.copyLink") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm"
          icon-left="tv"
          class="flex-1"
          data-test="dashboard-kiosk-open"
          @click="openKiosk"
        >
          {{ t("dashboard.kiosk.open") }}
        </OButton>
      </div>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
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
    timeRangeLabel: I18nText;
    tabName?: string | null;
    variables?: string[];
    /** Icon-only trigger, for narrow toolbars. */
    compact?: boolean;
  }>(),
  {
    currentRefreshSeconds: 0,
    minRefreshSeconds: DEFAULT_MIN_REFRESH_SECONDS,
    tabName: null,
    variables: () => [],
    compact: false,
  },
);

const emit = defineEmits<{
  copy: [options: KioskLinkOptions];
  open: [options: KioskLinkOptions];
}>();

const { t } = useI18nTyped();

const open = ref(false);
const refreshSeconds = ref(0);
const theme = ref<KioskThemeChoice>("current");
const fit = ref(false);

const defaultRefresh = () => {
  const current = props.currentRefreshSeconds;
  if (current > 0) return Math.max(current, props.minRefreshSeconds);
  return Math.max(KIOSK_DEFAULT_REFRESH_SECONDS, props.minRefreshSeconds);
};

// Each opening starts from the dashboard as it is now, not from the last edit.
watch(open, (isOpen) => {
  if (!isOpen) return;
  refreshSeconds.value = defaultRefresh();
  theme.value = "current";
  // A TV has no scrollbar user, so a new link fits every panel on screen unless switched off.
  fit.value = true;
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

const variablesLabel = computed(() =>
  props.variables.length ? raw(props.variables.join(", ")) : t("dashboard.kiosk.noVariables"),
);

const currentOptions = (): KioskLinkOptions => ({
  refreshSeconds: refreshSeconds.value,
  theme: theme.value,
  fit: fit.value,
});

const openKiosk = () => {
  const options = currentOptions();
  open.value = false;
  emit("open", options);
};
</script>
