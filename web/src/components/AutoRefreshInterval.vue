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
  <div class="flex items-center" data-test="auto-refresh-state" :data-state="refreshState">
    <OPopover
      v-model:open="btnRefreshInterval"
      side="bottom"
      align="center"
      content-class="w-80"
      :aria-label="t('search.autoRefreshTitle')"
    >
      <template #trigger>
        <OButton
          v-if="isCompact"
          data-test="logs-search-bar-refresh-interval-btn"
          size="icon-toolbar"
          :variant="variant"
          :active="isAnimating"
          :aria-label="triggerAriaLabel"
          :data-state="refreshState"
          @pointerenter="tickClock"
        >
          <OIcon
            :name="triggerIcon"
            :class="isAnimating || isWaiting ? 'auto-refresh-icon--spinning' : ''"
            size="sm"
          />
          <OTooltip :content="triggerTooltip" />
        </OButton>
        <OButton
          v-else
          data-test="logs-search-bar-refresh-interval-btn-dropdown"
          :variant="isOn && !isPaused ? 'outline-primary' : variant"
          size="sm-toolbar"
          :aria-label="triggerAriaLabel"
          :data-state="refreshState"
          @pointerenter="tickClock"
        >
          <div class="flex flex-nowrap items-center">
            <OIcon
              :name="triggerIcon"
              size="sm"
              class="me-1"
              :class="isWaiting ? 'auto-refresh-icon--spinning' : ''"
            />
            <div class="text-compact text-center leading-4">{{ triggerLabel }}</div>
            <OIcon name="arrow-drop-down" size="sm" class="ms-0.5" />
          </div>
        </OButton>
      </template>
      <div data-test="auto-refresh-panel">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <h4 class="text-text-heading text-sm font-semibold">
              {{ t("search.autoRefreshTitle") }}
            </h4>
            <p class="text-text-secondary text-xs italic" data-test="auto-refresh-subtitle">
              {{ subtitle }}
            </p>
          </div>
          <OSwitch
            data-test="logs-search-off-refresh-interval"
            :model-value="isOn"
            :disabled="switchDisabled"
            :aria-label="t('search.autoRefreshTitle')"
            @update:model-value="onSwitch"
          />
        </div>
        <div
          v-if="rangeEnded"
          data-test="auto-refresh-fixed-reason"
          class="bg-warning-surface text-text-body flex flex-col items-start gap-2 px-4 py-3 text-xs"
        >
          <span>{{ endedReason }}</span>
          <OButton
            data-test="auto-refresh-switch-relative"
            variant="primary"
            size="sm"
            @click="onSwitchRelative"
          >
            {{ switchLabel }}
          </OButton>
        </div>
        <hr class="border-border-default my-0 border-0 border-t border-solid" />
        <div class="flex flex-col gap-3 px-4 py-3">
          <section v-for="section in refreshSections" :key="section.key">
            <h5 class="text-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">
              {{ section.label }}
            </h5>
            <div class="grid grid-cols-4 gap-2">
              <OButton
                v-for="item in section.items"
                :key="item.value"
                :data-test="`logs-search-bar-refresh-time-${item.value}`"
                :variant="Number(modelValue) === item.value ? 'primary' : 'outline'"
                size="sm"
                :block="true"
                :disabled="item.disabled"
                :aria-pressed="Number(modelValue) === item.value"
                :aria-label="item.label"
                @click="onPick(item)"
              >
                <OTooltip
                  v-if="item.disabled"
                  side="right"
                  align="center"
                  max-width="18.75rem"
                  :content="raw(minRangeRestrictionMessageVal)"
                />
                {{ item.shortLabel }}
              </OButton>
            </div>
          </section>
        </div>
        <div
          v-if="!hideRelativeNote"
          class="bg-surface-subtle border-border-default text-text-secondary flex items-center gap-2 border-0 border-t border-solid px-4 py-2 text-xs italic"
          data-test="auto-refresh-footer"
        >
          <OIcon name="info" size="sm" />
          {{ footerText }}
        </div>
      </div>
    </OPopover>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  type PropType,
} from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import { useStore } from "vuex";
import { formatInTimeZone } from "date-fns-tz";
import { localeFileMap } from "@/locales";
import { safeTimezone } from "@/utils/dashboard/calendarPeriods";
import { isTabHidden, suggestRelativePeriod } from "@/composables/useAutoRefreshGate";
import { useRouter } from "vue-router";
import { generateDurationLabel } from "../utils/date";
import {
  AUTO_REFRESH_INTERVALS,
  autoRefreshLabel,
  autoRefreshShortLabel,
} from "@/utils/dashboard/autoRefresh";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

export default defineComponent({
  name: "AutoRefreshInterval",
  components: { OButton, OPopover, OSwitch, OTooltip, OIcon },
  props: {
    modelValue: {
      type: Number,
      default: 0,
    },
    trigger: {
      type: Boolean,
      default: false,
    },
    minRangeRestrictionMessage: {
      type: String,
      default: "",
    },
    minRefreshInterval: {
      type: Number,
      default: 0,
    },
    isCompact: {
      type: Boolean,
      default: false,
    },
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
    hideRelativeNote: {
      type: Boolean,
      default: false,
    },
    /** Start of a range that does not follow now (µs); only used to suggest a relative period. */
    rangeStartUs: {
      type: Number,
      default: 0,
    },
    /** End of a range that does not follow now (µs); 0 while the range is relative. */
    rangeEndUs: {
      type: Number,
      default: 0,
    },
    /** A query of the page is running, so the next tick waits for it; null on hosts that do not report runs. */
    busy: {
      type: Boolean as PropType<boolean | null>,
      default: null,
    },
    /** The page's query-range limit in hours; 0 for none. Caps the "Switch to Past N" suggestion. */
    maxRangeHours: {
      type: Number,
      default: 0,
    },
  },
  emits: ["update:modelValue", "trigger", "switch-relative"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const store = useStore();
    const { t, locale } = useI18nTyped();
    const nowMs = ref(Date.now());
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    let clockTimer: ReturnType<typeof setInterval> | null = null;
    const lastRunMs = ref<number | null>(null);
    // A tick that found the tab hidden or a query running; it fires (or reschedules) when that ends.
    let missedWhileHidden = false;
    // A deactivated (kept-alive) instance arms no timer; onActivated re-arms it.
    let isActive = true;
    const waitingForRun = ref(false);

    const btnRefreshInterval = ref(false);
    let intervalInstance = 0;

    const isDisabled = (value: number) => {
      return value < props.minRefreshInterval;
    };

    const refreshTimes = computed(() =>
      [
        AUTO_REFRESH_INTERVALS.filter((v) => v < 60),
        AUTO_REFRESH_INTERVALS.filter((v) => v >= 60 && v < 3600),
        AUTO_REFRESH_INTERVALS.filter((v) => v >= 3600),
      ].map((values) =>
        values.map((value) => ({
          label: autoRefreshLabel(value, t),
          shortLabel: autoRefreshShortLabel(value, t),
          value: value as number,
          disabled: isDisabled(value),
        })),
      ),
    );

    const refreshSections = computed(() => {
      const keys = [
        ["seconds", t("search.autoRefreshSeconds")],
        ["minutes", t("search.autoRefreshMinutes")],
        ["hours", t("search.autoRefreshHours")],
      ] as const;
      return keys.map(([key, label], i) => ({ key, label, items: refreshTimes.value[i] }));
    });

    // v-model computed value
    const selectedValue = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        if (isDisabled(value)) {
          emit("update:modelValue", 0);
        }

        emit("update:modelValue", Number(value));
      },
    });

    // computed label based on the selected value
    const selectedLabel = computed(() => {
      // Handle "Off" case (value 0)
      if (selectedValue.value === 0) {
        return t("common.off");
      }

      // Find the label from refreshTimes
      const found = refreshTimes.value.flat().find((it: any) => it.value == selectedValue.value);
      return found?.label || generateDurationLabel(selectedValue.value);
    });

    const isOn = computed(() => selectedValue.value > 0);

    const rangeEnded = computed(
      () => props.rangeEndUs > 0 && props.rangeEndUs <= nowMs.value * 1000,
    );

    // Only a range that has ended pauses; one ending later keeps refreshing until it does.
    const isPaused = computed(() => isOn.value && rangeEnded.value);

    const isWaiting = computed(() => isOn.value && !isPaused.value && waitingForRun.value);

    const refreshState = computed(() => {
      if (!isOn.value) return "off";
      if (isPaused.value) return "paused";
      return isWaiting.value ? "waiting" : "on";
    });

    const triggerIcon = computed(() => {
      if (!isOn.value) return "sync-disabled";
      if (isPaused.value) return "pause";
      return isWaiting.value ? "progress-activity" : "update";
    });

    // Check if animation should be active
    const isAnimating = computed(() => {
      return props.isCompact && isOn.value && !isPaused.value;
    });

    const intlLocale = computed(() => localeFileMap[String(locale.value)] ?? "en-US");

    const formatEnd = (pattern: string) =>
      formatInTimeZone(
        Math.floor(props.rangeEndUs / 1000),
        safeTimezone(store.state.timezone),
        pattern,
      );

    const endDateText = computed(() =>
      new Intl.DateTimeFormat(intlLocale.value, {
        month: "short",
        day: "numeric",
        timeZone: safeTimezone(store.state.timezone),
        calendar: "gregory",
        numberingSystem: "latn",
      }).format(Math.floor(props.rangeEndUs / 1000)),
    );

    // With refresh off nothing is paused, so the reason says refresh will not run instead.
    const endedReason = computed(() =>
      t(isOn.value ? "common.autoRefreshEnded" : "common.autoRefreshEndedNoRun", {
        date: endDateText.value,
        time: formatEnd("HH:mm"),
      }),
    );

    const PAST_KEYS: Record<string, I18nKey> = {
      m: "common.pastMinute",
      h: "common.pastHour",
      d: "common.pastDay",
      w: "common.pastWeek",
      M: "common.pastMonth",
    };

    const suggestedPeriod = computed(() =>
      suggestRelativePeriod(
        Math.max(0, props.rangeEndUs - props.rangeStartUs),
        props.maxRangeHours > 0 ? props.maxRangeHours * 3_600_000_000 : 0,
      ),
    );

    const switchLabel = computed(() => {
      const match = suggestedPeriod.value.match(/^(\d+)([mhdwM])$/);
      const count = Number(match?.[1] ?? 15);
      const unit = match?.[2] ?? "m";
      if (unit === "m" && count > 60 && count % 60 !== 0) {
        const duration = `${t("common.hrCompact", { count: Math.floor(count / 60) })} ${t(
          "common.minCompact",
          { count: count % 60 },
        )}`;
        return t("common.autoRefreshSwitchTo", { period: t("common.pastDuration", { duration }) });
      }
      const key = PAST_KEYS[unit] ?? "common.pastMinute";
      return t("common.autoRefreshSwitchTo", { period: t(key, { count }) });
    });

    const onSwitchRelative = () => {
      emit("switch-relative", suggestedPeriod.value);
      btnRefreshInterval.value = false;
    };

    const triggerLabel = computed(() =>
      isOn.value ? autoRefreshShortLabel(selectedValue.value, t) : t("common.off"),
    );

    const lastRunAge = computed(() => {
      if (lastRunMs.value === null) return null;
      const seconds = Math.max(0, Math.floor((nowMs.value - lastRunMs.value) / 1000));
      if (seconds < 60) return t("common.secCompact", { count: seconds });
      if (seconds < 3600) return t("common.minCompact", { count: Math.floor(seconds / 60) });
      return t("common.hrCompact", { count: Math.floor(seconds / 3600) });
    });

    const triggerAriaLabel = computed(() => {
      if (isPaused.value) return t("common.autoRefreshPausedAria");
      if (isWaiting.value) return t("search.autoRefreshWaiting", { value: triggerLabel.value });
      return isOn.value
        ? t("search.autoRefreshAriaOn", { value: triggerLabel.value })
        : t("search.autoRefreshAriaOff");
    });

    const triggerTooltip = computed(() => {
      if (isPaused.value) return t("common.autoRefreshPausedAria");
      if (isWaiting.value) return t("search.autoRefreshWaiting", { value: triggerLabel.value });
      if (isOn.value && lastRunAge.value !== null) {
        return t("search.autoRefreshTooltipLastRun", {
          value: triggerLabel.value,
          age: lastRunAge.value,
        });
      }
      return t("search.autoRefreshWithValue", { value: triggerLabel.value });
    });

    const subtitle = computed(() => {
      if (rangeEnded.value) {
        return t(isOn.value ? "common.autoRefreshPausedEnded" : "common.autoRefreshOffEnded");
      }
      if (!isOn.value) return t("search.autoRefreshPaused");
      if (props.rangeEndUs > 0 && !isPaused.value) {
        return t("common.autoRefreshUntil", {
          interval: triggerLabel.value,
          time: formatEnd("HH:mm"),
        });
      }
      if (!isPaused.value && lastRunAge.value !== null) {
        return t("search.autoRefreshEveryLastRun", {
          value: triggerLabel.value,
          age: lastRunAge.value,
        });
      }
      return t("search.autoRefreshEvery", { value: triggerLabel.value });
    });

    const footerText = computed(() => {
      if (isPaused.value) return t("search.autoRefreshResumeNote", { value: triggerLabel.value });
      return props.busy === null
        ? t("search.autoRefreshRulesHidden")
        : t("search.autoRefreshRules");
    });

    let lastSelectedInterval = 0;
    const DEFAULT_INTERVAL = 30;

    // The remembered interval may fall below a minimum raised since it was picked.
    const resumeInterval = () => {
      if (lastSelectedInterval && !isDisabled(lastSelectedInterval)) return lastSelectedInterval;
      if (!isDisabled(DEFAULT_INTERVAL)) return DEFAULT_INTERVAL;
      return refreshTimes.value.flat().find((it) => !it.disabled)?.value ?? 0;
    };

    const onSwitch = (on: unknown) => {
      if (!on) {
        lastSelectedInterval = selectedValue.value || lastSelectedInterval;
        selectedValue.value = 0;
        return;
      }
      selectedValue.value = resumeInterval();
    };

    // Switching on is impossible when no interval satisfies the minimum.
    const switchDisabled = computed(() => !isOn.value && resumeInterval() === 0);

    const onItemClick = (item: { value: number }) => {
      selectedValue.value = item.value;
      if (item.value > 0) {
        lastSelectedInterval = item.value;
      }
    };

    const onPick = (item: { value: number }) => {
      onItemClick(item);
      btnRefreshInterval.value = false;
    };

    // watch on the selected value and update the timers
    watch(selectedValue, () => {
      resetTimers();
    });

    // Flips to paused the moment a range that ends later reaches its end, not on the next tick.
    const armEndTimer = () => {
      if (endTimer !== null) clearTimeout(endTimer);
      endTimer = null;
      nowMs.value = Date.now();
      const wait = props.rangeEndUs / 1000 - nowMs.value;
      if (props.rangeEndUs > 0 && wait > 0 && wait < 2_147_483_647) {
        endTimer = setTimeout(() => {
          nowMs.value = Date.now();
        }, wait + 50);
      }
    };

    watch(() => [props.rangeStartUs, props.rangeEndUs], armEndTimer, { immediate: true });
    const tickClock = () => {
      nowMs.value = Date.now();
    };

    // The open panel shows the last-run age, so it counts while it is visible.
    watch(btnRefreshInterval, (open) => {
      tickClock();
      if (clockTimer !== null) clearInterval(clockTimer);
      clockTimer = open ? setInterval(tickClock, 1000) : null;
    });

    // Any finished run of the page, a refresh or not, is the last run; a tick that waited on it restarts from here.
    watch(
      () => props.busy,
      (busy, wasBusy) => {
        if (busy || !wasBusy) return;
        lastRunMs.value = Date.now();
        if (!waitingForRun.value) return;
        waitingForRun.value = false;
        resetTimers();
      },
    );

    const fireTrigger = () => {
      lastRunMs.value = Date.now();
      emit("trigger");
    };

    const onTimerTick = () => {
      tickClock();
      if (isPaused.value) return;
      if (isTabHidden()) {
        missedWhileHidden = true;
        return;
      }
      if (props.busy) {
        waitingForRun.value = true;
        clearInterval(intervalInstance);
        return;
      }
      fireTrigger();
    };

    // One refresh on return, then the normal cadence counted from it.
    const onVisibilityChange = () => {
      if (isTabHidden() || !missedWhileHidden) return;
      missedWhileHidden = false;
      if (!props.trigger || !isOn.value) return;
      resetTimers();
      onTimerTick();
    };

    const resetTimers = () => {
      // first reset the current interval callback
      clearInterval(intervalInstance);
      waitingForRun.value = false;

      // return if the interval value is zero
      if (!isActive || selectedValue.value == 0 || !props.trigger) {
        return;
      }

      // if we have the value, continue and set the interval
      intervalInstance = window?.setInterval(onTimerTick, selectedValue.value * 1000);
    };

    const minRangeRestrictionMessageVal = computed(() =>
      t("common.minRefreshIntervalMessage", { interval: props.minRefreshInterval }),
    );

    // on component mount and unmount, update the intervals
    onMounted(() => {
      document.addEventListener("visibilitychange", onVisibilityChange);
    });

    onActivated(() => {
      isActive = true;
      document.addEventListener("visibilitychange", onVisibilityChange);
      resetTimers();
    });

    onDeactivated(() => {
      isActive = false;
      waitingForRun.value = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalInstance);
    });

    onUnmounted(() => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalInstance);
      if (endTimer !== null) clearTimeout(endTimer);
      if (clockTimer !== null) clearInterval(clockTimer);
    });

    return {
      raw,
      t,
      router,
      btnRefreshInterval,
      selectedLabel,
      triggerLabel,
      isOn,
      switchDisabled,
      triggerAriaLabel,
      refreshTimes,
      refreshSections,
      onItemClick,
      onPick,
      onSwitch,
      minRangeRestrictionMessageVal,
      isAnimating,
      selectedValue,
      isPaused,
      rangeEnded,
      isWaiting,
      refreshState,
      triggerIcon,
      triggerTooltip,
      footerText,
      tickClock,
      subtitle,
      endedReason,
      switchLabel,
      onSwitchRelative,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): scoped compiler renames the keyframe and this reference together, which a template utility cannot. */
.auto-refresh-icon--spinning {
  display: inline-block !important;
  transform-origin: center center !important;
  animation: rotate 2s linear infinite !important;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
