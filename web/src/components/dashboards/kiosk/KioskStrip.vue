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
      class="bg-surface-panel border-border-default px-page-edge flex h-11 min-w-0 items-center gap-3 border-b text-sm"
    >
      <span class="text-text-heading flex min-w-0 items-center gap-2 text-xl font-semibold">
        <OIcon name="dashboard" size="md" class="text-accent shrink-0" />
        <OTruncatedText data-test="dashboard-kiosk-title">{{ title }}</OTruncatedText>
      </span>
      <OBadge
        v-if="position"
        variant="default-outline"
        size="lg"
        class="shrink-0 tabular-nums"
        data-test="dashboard-kiosk-position"
        >{{ position }}</OBadge
      >
      <span class="flex-1" />
      <OBadge
        v-if="status"
        :variant="status.variant"
        size="lg"
        dot
        class="shrink-0"
        data-test="dashboard-kiosk-health"
        :data-health="status.kind"
        >{{ status.text }}</OBadge
      >
      <div
        class="bg-surface-subtle rounded-surface flex shrink-0 items-center gap-3 px-3 py-0.5"
        data-test="dashboard-kiosk-meta"
      >
        <span
          v-if="timeRangeLabel"
          class="text-text-secondary flex items-center gap-1.5 whitespace-nowrap max-md:hidden"
          data-test="dashboard-kiosk-time-range"
        >
          <OIcon name="schedule" size="sm" />
          {{ timeRangeLabel }}
        </span>
        <span class="flex items-center gap-2">
          <KioskCountdownRing
            :progress="ringProgress"
            :state="ringState"
            :tooltip="ringTooltip"
            data-test="dashboard-kiosk-refresh"
          >
            <OIcon
              :name="ringState === 'off' ? 'sync-disabled' : 'refresh'"
              size="sm"
              :class="ringState === 'spinning' ? 'text-accent' : undefined"
            />
          </KioskCountdownRing>
          <KioskUpdatedAt
            :last-success-at="lastSuccessAt"
            :timezone="timezone"
            data-test="dashboard-kiosk-updated"
          />
        </span>
      </div>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('dashboard.kiosk.exit')"
        data-test="dashboard-kiosk-exit-btn"
        @click="emit('exit')"
      >
        <OTooltip :content="t('dashboard.kiosk.exit')" shortcut-id="dashboardKioskExit" />
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { KioskCountdown, KioskHealth } from "@/composables/dashboard/useKioskRefresh";
import { formatClockTime } from "@/utils/dashboard/kiosk";
import KioskCountdownRing from "./KioskCountdownRing.vue";
import KioskUpdatedAt from "./KioskUpdatedAt.vue";

const props = withDefaults(
  defineProps<{
    title?: string;
    timeRangeLabel: I18nText;
    refreshSeconds?: number;
    health: KioskHealth;
    lastSuccessAt?: number | null;
    timezone?: string;
    loading?: boolean;
    countdown?: KioskCountdown | null;
    /** "2 of 5" when this screen is one slide of a TV playlist. */
    position?: I18nText | null;
  }>(),
  {
    title: "",
    refreshSeconds: 0,
    lastSuccessAt: null,
    timezone: undefined,
    loading: false,
    countdown: null,
    position: null,
  },
);

const emit = defineEmits<{ exit: [] }>();

const { t } = useI18nTyped();

const formatTime = (ms: number) => formatClockTime(ms, props.timezone);

type RingState = "running" | "spinning" | "paused" | "off";

const ringState = computed<RingState>(() => {
  if (props.loading) return "spinning";
  if (!(props.refreshSeconds > 0)) return "off";
  return props.countdown ? "running" : "paused";
});

const ringProgress = computed(() => {
  const countdown = props.countdown;
  if (!countdown || !(countdown.totalMs > 0)) return 0;
  return 1 - countdown.remainingMs / countdown.totalMs;
});

const ringTooltip = computed(() => {
  if (ringState.value === "spinning") return t("common.loading");
  if (ringState.value === "off") return t("dashboard.kiosk.refreshOff");
  if (ringState.value === "paused") return t("dashboard.kiosk.paused");
  const time = formatTime(props.countdown?.at ?? Date.now());
  return props.countdown?.retrying
    ? t("dashboard.kiosk.nextRetryAt", { time })
    : t("dashboard.kiosk.nextRefreshAt", { time });
});

interface StripStatus {
  kind: string;
  variant: BadgeVariant;
  text: I18nText;
}

const healthStatus = (health: KioskHealth): StripStatus | null => {
  if (health.level === "paused") {
    return { kind: "paused", variant: "default-soft", text: t("dashboard.kiosk.paused") };
  }
  if (health.level === "warn" && health.kind === "hung") {
    return { kind: "warn", variant: "warning-soft", text: t("dashboard.kiosk.hung") };
  }
  if (health.level === "warn") {
    const text = t("dashboard.kiosk.panelsFailing", { count: health.count }, health.count);
    return { kind: "warn", variant: "warning-soft", text };
  }
  if (health.level === "bad" && health.kind === "stale") {
    const text = t("dashboard.kiosk.staleSince", { time: formatTime(health.since) });
    return { kind: "bad", variant: "error-soft", text };
  }
  if (health.level === "bad") {
    const text = t("dashboard.kiosk.unreachable", { seconds: health.retryInSeconds });
    return { kind: "bad", variant: "error-soft", text };
  }
  return null;
};

// A TV that never refreshes goes stale silently, so "off" is a warning, not a caption.
const status = computed<StripStatus | null>(
  () =>
    healthStatus(props.health) ??
    (props.refreshSeconds > 0
      ? null
      : { kind: "refresh-off", variant: "warning-soft", text: t("dashboard.kiosk.refreshOff") }),
);
</script>
