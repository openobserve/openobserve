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
  <div class="shrink-0" data-test="dashboard-playlist-strip">
    <div
      class="bg-surface-panel border-border-default px-page-edge flex h-11 min-w-0 items-center gap-3 border-b text-sm max-md:gap-2"
    >
      <span class="text-text-heading flex min-w-0 items-center gap-2 text-xl font-semibold">
        <OIcon name="dashboard" size="md" class="text-accent shrink-0" />
        <OTruncatedText data-test="dashboard-playlist-title">{{ title }}</OTruncatedText>
      </span>
      <span class="flex-1" />
      <OBadge
        v-if="held"
        variant="error-soft"
        size="lg"
        dot
        class="shrink-0"
        data-test="dashboard-playlist-held"
        >{{ t("dashboard.playlist.unreachable") }}</OBadge
      >
      <div
        class="bg-surface-subtle rounded-surface flex shrink-0 items-center gap-3 px-3 py-0.5"
        data-test="dashboard-playlist-meta"
      >
        <span class="flex items-center gap-2 font-semibold whitespace-nowrap tabular-nums">
          <KioskCountdownRing
            :progress="progress"
            :state="ringState"
            :tooltip="ringTooltip"
            data-test="dashboard-playlist-rotation"
          >
            <OIcon v-if="ringState === 'paused'" name="pause" size="sm" />
            <span
              v-else
              class="text-text-heading text-xs font-semibold"
              data-test="dashboard-playlist-current"
              >{{ current }}</span
            >
          </KioskCountdownRing>
          <span
            class="text-text-heading font-medium"
            :tabindex="skipped.length ? 0 : undefined"
            data-test="dashboard-playlist-position"
          >
            {{ t("dashboard.playlist.ofTotal", { total }) }}
            <OTooltip v-if="skipped.length" :content="skippedText" />
          </span>
        </span>
        <span
          v-if="timeRangeLabel"
          class="text-text-secondary flex items-center gap-1.5 whitespace-nowrap max-md:hidden"
          data-test="dashboard-playlist-time-range"
        >
          <OIcon name="schedule" size="sm" />
          {{ timeRangeLabel }}
        </span>
        <KioskUpdatedAt
          :last-success-at="lastSuccessAt"
          :timezone="timezone"
          class="max-md:hidden"
          data-test="dashboard-playlist-updated"
        />
      </div>
      <span class="flex shrink-0 items-center gap-1.5" data-test="dashboard-playlist-controls">
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="navigate-before"
          :aria-label="t('dashboard.playlist.previous')"
          data-test="dashboard-playlist-prev"
          @click="emit('prev')"
        >
          <OTooltip
            :content="t('dashboard.playlist.previous')"
            shortcut-id="dashboardPlaylistPrev"
          />
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          :icon-left="paused ? 'play-arrow' : 'pause'"
          :aria-label="paused ? t('dashboard.playlist.resume') : t('dashboard.playlist.pause')"
          data-test="dashboard-playlist-pause"
          @click="emit('toggle-pause')"
        >
          <OTooltip
            :content="paused ? t('dashboard.playlist.resume') : t('dashboard.playlist.pause')"
            shortcut-id="dashboardPlaylistPause"
          />
        </OButton>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="navigate-next"
          :aria-label="t('dashboard.playlist.next')"
          data-test="dashboard-playlist-next"
          @click="emit('next')"
        >
          <OTooltip :content="t('dashboard.playlist.next')" shortcut-id="dashboardPlaylistNext" />
        </OButton>
      </span>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="close"
        :aria-label="t('dashboard.playlist.exit')"
        data-test="dashboard-playlist-exit"
        @click="emit('exit')"
      >
        <OTooltip :content="t('dashboard.playlist.exit')" shortcut-id="dashboardPlaylistExit" />
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
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import KioskCountdownRing from "./KioskCountdownRing.vue";
import KioskUpdatedAt from "./KioskUpdatedAt.vue";
import { formatClockTime } from "@/utils/dashboard/kiosk";

const props = withDefaults(
  defineProps<{
    title: I18nText;
    /** 1-based position among the dashboards that can be shown. */
    current: number;
    total: number;
    /** Name of the slide the rotation moves to next. */
    nextName?: I18nText | null;
    /** Share of this slide's dwell already elapsed, 0 to 1. */
    progress?: number;
    /** When the rotation moves on, as epoch ms. */
    nextAt?: number | null;
    /** One line per dashboard that is skipped (deleted or no access). */
    skipped?: I18nText[];
    timeRangeLabel?: I18nText | null;
    held?: boolean;
    paused?: boolean;
    pausedAt?: number | null;
    waiting?: boolean;
    lastSuccessAt?: number | null;
    timezone?: string;
  }>(),
  {
    nextName: null,
    progress: 0,
    nextAt: null,
    skipped: () => [],
    timeRangeLabel: null,
    held: false,
    paused: false,
    pausedAt: null,
    waiting: false,
    lastSuccessAt: null,
    timezone: undefined,
  },
);

const emit = defineEmits<{
  prev: [];
  next: [];
  "toggle-pause": [];
  exit: [];
}>();

const { t } = useI18nTyped();

const skippedText = computed(() => raw(props.skipped.join(" · ")));

type RingState = "running" | "spinning" | "paused";

const ringState = computed<RingState>(() => {
  if (props.paused || props.held) return "paused";
  return props.waiting ? "spinning" : "running";
});

const ringTooltip = computed(() => {
  if (props.held) return t("dashboard.playlist.held");
  if (props.paused) {
    return t("dashboard.playlist.pausedSince", {
      time: formatClockTime(props.pausedAt ?? Date.now(), props.timezone, false),
    });
  }
  if (props.waiting) return t("dashboard.playlist.waiting");
  const time = formatClockTime(props.nextAt ?? Date.now(), props.timezone);
  return t("dashboard.playlist.nextAt", { name: props.nextName ?? raw(""), time });
});
</script>
