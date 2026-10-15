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
  <div class="shrink-0" data-test="dashboard-kiosk-strip">
    <div
      class="bg-surface-panel border-border-default px-page-edge flex h-14 min-w-0 items-center gap-5 border-b text-lg"
    >
      <span class="text-text-heading flex min-w-0 items-center gap-2 text-2xl font-semibold">
        <OIcon name="dashboard" size="md" class="text-accent shrink-0" />
        <OTruncatedText data-test="dashboard-kiosk-title">{{ title }}</OTruncatedText>
      </span>
      <span
        v-if="tabName"
        class="text-text-secondary min-w-0 max-md:hidden"
        data-test="dashboard-kiosk-tab"
      >
        <OTruncatedText>{{ tabName }}</OTruncatedText>
      </span>
      <span
        v-if="timeRangeLabel"
        class="text-text-secondary flex shrink-0 items-center gap-1.5 max-md:hidden"
        data-test="dashboard-kiosk-time-range"
      >
        <OIcon name="schedule" size="sm" />
        {{ timeRangeLabel }}
      </span>
      <span
        v-if="refreshSeconds > 0"
        class="text-text-secondary shrink-0 max-lg:hidden"
        data-test="dashboard-kiosk-refresh"
      >
        {{ t("dashboard.kiosk.refreshEvery", { interval: formatRefreshLabel(refreshSeconds, t) }) }}
      </span>
      <!-- A TV that never refreshes goes stale silently, so "off" is a warning, not a caption. -->
      <OBadge
        v-else
        variant="warning-soft"
        size="lg"
        dot
        class="shrink-0"
        data-test="dashboard-kiosk-refresh"
        data-health="refresh-off"
        >{{ t("dashboard.kiosk.refreshOff") }}</OBadge
      >
      <span class="flex-1" />
      <OBadge
        v-if="health.level !== 'ok'"
        :variant="badgeVariant"
        size="lg"
        dot
        data-test="dashboard-kiosk-health"
        :data-health="health.level"
        >{{ healthText }}</OBadge
      >
      <span
        class="text-text-heading flex shrink-0 items-center gap-1.5 font-medium tabular-nums"
        data-test="dashboard-kiosk-updated"
      >
        <OIcon
          :name="health.level === 'ok' && lastSuccessAt ? 'check-circle' : 'schedule'"
          size="sm"
          :class="health.level === 'ok' && lastSuccessAt ? 'text-status-success-text' : undefined"
        />
        {{ updatedText }}
      </span>
      <!-- Lives in the strip so it can never cover a panel; hidden, not removed, so the strip does not reflow. -->
      <OButton
        variant="outline"
        size="sm-toolbar"
        icon-left="close"
        class="shrink-0 transition-opacity duration-200"
        :class="exitVisible ? 'opacity-100' : 'pointer-events-none invisible opacity-0'"
        :tabindex="exitVisible ? 0 : -1"
        data-test="dashboard-kiosk-exit-btn"
        @click="emit('exit')"
      >
        {{ t("dashboard.kiosk.exit") }}
        <OShortcut id="dashboardKioskExit" class="ms-1" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { KioskHealth } from "@/composables/dashboard/useKioskRefresh";
import { formatRefreshLabel } from "@/utils/dashboard/kiosk";

const props = withDefaults(
  defineProps<{
    title?: string;
    tabName?: string | null;
    timeRangeLabel: I18nText;
    refreshSeconds?: number;
    health: KioskHealth;
    lastSuccessAt?: number | null;
    timezone?: string;
    exitVisible?: boolean;
  }>(),
  {
    title: "",
    tabName: null,
    refreshSeconds: 0,
    lastSuccessAt: null,
    timezone: undefined,
    exitVisible: false,
  },
);

const emit = defineEmits<{ exit: [] }>();

const { t } = useI18nTyped();

const formatTime = (ms: number) => {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: props.timezone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(ms);
  }
};

const updatedText = computed(() =>
  props.lastSuccessAt
    ? t("dashboard.kiosk.updatedAt", { time: formatTime(props.lastSuccessAt) })
    : t("common.loading"),
);

const badgeVariant = computed<BadgeVariant>(() => {
  if (props.health.level === "bad") return "error-soft";
  if (props.health.level === "warn") return "warning-soft";
  return "default-soft";
});

const healthText = computed(() => {
  const health = props.health;
  if (health.level === "paused") return t("dashboard.kiosk.paused");
  if (health.level === "warn" && health.kind === "hung") return t("dashboard.kiosk.hung");
  if (health.level === "warn") {
    return t("dashboard.kiosk.panelsFailing", { count: health.count }, health.count);
  }
  if (health.level === "bad" && health.kind === "stale") {
    return t("dashboard.kiosk.staleSince", { time: formatTime(health.since) });
  }
  if (health.level === "bad") {
    return t("dashboard.kiosk.unreachable", { seconds: health.retryInSeconds });
  }
  return raw("");
});
</script>
