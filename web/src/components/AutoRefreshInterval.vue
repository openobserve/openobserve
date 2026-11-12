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
  <div class="flex items-center gap-1">
    <OPopover
      v-model:open="btnRefreshInterval"
      side="bottom"
      align="center"
      content-class="w-80"
      :aria-label="t('search.autoRefreshTitle')"
      @close-auto-focus="onCloseAutoFocus"
    >
      <template #trigger>
        <OButton
          v-if="isCompact"
          data-test="logs-search-bar-refresh-interval-btn"
          size="icon-toolbar"
          :variant="variant"
          :active="isAnimating"
          :aria-label="triggerAriaLabel"
        >
          <OIcon
            :name="isPausedEnded ? 'pause' : 'update'"
            :class="
              isPausedEnded
                ? 'text-status-warning-text'
                : isAnimating
                  ? 'auto-refresh-icon--spinning'
                  : ''
            "
            size="sm"
          />
          <OTooltip :content="compactTooltip" />
        </OButton>
        <OButton
          v-else
          data-test="logs-search-bar-refresh-interval-btn-dropdown"
          :variant="isOn ? 'outline-primary' : variant"
          size="sm-toolbar"
          :aria-label="triggerAriaLabel"
        >
          <div class="flex flex-nowrap items-center">
            <OIcon
              :name="isPausedEnded ? 'pause' : 'update'"
              size="sm"
              class="me-1"
              :class="isPausedEnded ? 'text-status-warning-text' : ''"
            />
            <div class="text-compact text-center leading-4" data-test="auto-refresh-trigger-label">
              {{
                isPausedEnded
                  ? t("dateTime.refreshPausedRangeEnded")
                  : t("search.autoRefreshTrigger", { interval: triggerLabel })
              }}
            </div>
            <OIcon name="arrow-drop-down" size="sm" class="ms-0.5" />
          </div>
          <OTooltip
            :content="caughtUp ? t('dateTime.refreshCaughtUp') : t('search.autoRefreshTitle')"
          />
        </OButton>
      </template>
      <div data-test="auto-refresh-panel">
        <div class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <h4 class="text-text-heading text-sm font-semibold">
              {{ t("search.autoRefreshTitle") }}
            </h4>
            <p class="text-text-secondary text-xs italic" data-test="auto-refresh-subtitle">
              {{
                isOn
                  ? t("search.autoRefreshEvery", { value: triggerLabel })
                  : t("search.autoRefreshPaused")
              }}
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
          {{ t("search.autoRefreshRelativeOnly") }}
        </div>
      </div>
    </OPopover>
    <OButton
      v-if="isPausedEnded"
      data-test="auto-refresh-go-live-btn"
      variant="outline"
      size="sm-toolbar"
      icon-left="play-arrow"
      class="shrink-0"
      @click="$emit('live')"
      >{{ t("dateTime.goLive") }}<OTooltip :content="goLiveTooltip"
    /></OButton>
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
import { autoRefreshState, fixedRangeEnded, owesCatchUp } from "@/utils/autoRefreshPause";
import { formatRangeDuration } from "@/utils/timeRangeLabel";
import { raw, useI18nTyped } from "@/types/i18n";
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
    /** End (µs) of the page's range when it is fixed; null while it rolls. Refresh pauses once it has passed. */
    rangeEndUs: {
      type: Number as PropType<number | null>,
      default: null,
    },
    /** Start (µs) of that fixed range, so `Go live` can name the length it switches to. */
    rangeStartUs: {
      type: Number as PropType<number | null>,
      default: null,
    },
  },
  emits: ["update:modelValue", "trigger", "live"],
  setup(props: any, { emit }) {
    const router = useRouter();
    const { t } = useI18nTyped();

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

    const triggerLabel = computed(() =>
      isOn.value ? autoRefreshShortLabel(selectedValue.value, t) : t("common.off"),
    );

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

    // A pointer pick closes the menu without handing focus back, so the trigger is not left ringed beside the lit choice.
    let closedByPick = false;
    const onPick = (item: { value: number }) => {
      onItemClick(item);
      closedByPick = true;
      btnRefreshInterval.value = false;
    };
    const onCloseAutoFocus = (event: Event) => {
      if (closedByPick) event.preventDefault();
      closedByPick = false;
    };

    const pageHidden = ref(
      typeof document !== "undefined" && document.visibilityState === "hidden",
    );
    const clock = ref(Date.now());
    const caughtUp = ref(false);
    let lastTickMs: number | null = null;

    const rangeEnded = computed(() => fixedRangeEnded(props.rangeEndUs, clock.value));
    const refreshState = computed(() =>
      autoRefreshState({
        intervalSeconds: Number(selectedValue.value),
        hidden: pageHidden.value,
        rangeEnded: rangeEnded.value,
      }),
    );
    const isPausedEnded = computed(() => refreshState.value === "paused-ended");

    const isAnimating = computed(
      () => props.isCompact && selectedValue.value > 0 && !isPausedEnded.value,
    );

    const triggerAriaLabel = computed(() => {
      if (isPausedEnded.value) return t("dateTime.refreshPausedAria");
      return isOn.value
        ? t("search.autoRefreshAriaOn", { value: triggerLabel.value })
        : t("search.autoRefreshAriaOff");
    });

    const goLiveTooltip = computed(() => {
      const start = props.rangeStartUs;
      const end = props.rangeEndUs;
      if (!(typeof start === "number" && typeof end === "number" && end > start)) {
        return t("dateTime.goLiveResumeTooltipNoDuration");
      }
      return t("dateTime.goLiveResumeTooltip", { duration: formatRangeDuration(start, end) });
    });

    const compactTooltip = computed(() => {
      if (isPausedEnded.value) return t("dateTime.refreshPausedRangeEnded");
      if (caughtUp.value) return t("dateTime.refreshCaughtUp");
      return t("search.autoRefreshWithValue", { value: triggerLabel.value });
    });

    // A kept-alive page in the background must not tick, whatever its range or the tab does.
    let inactive = false;

    const resetTimers = () => {
      clearInterval(intervalInstance);
      clock.value = Date.now();
      if (inactive) return;
      if (selectedValue.value == 0 || !props.trigger || refreshState.value !== "running") return;
      lastTickMs = Date.now();
      intervalInstance = window?.setInterval(() => {
        lastTickMs = Date.now();
        clock.value = lastTickMs;
        if (refreshState.value !== "running") {
          clearInterval(intervalInstance);
          return;
        }
        caughtUp.value = false;
        emit("trigger");
      }, selectedValue.value * 1000);
    };

    // A hidden tab stops the timer; coming back runs one catch-up query if a tick fell due meanwhile.
    const onVisibilityChange = () => {
      pageHidden.value = document.visibilityState === "hidden";
      if (pageHidden.value || inactive) {
        clearInterval(intervalInstance);
        return;
      }
      const owed =
        props.trigger &&
        owesCatchUp({
          intervalSeconds: Number(selectedValue.value),
          lastTickMs,
          nowMs: Date.now(),
          rangeEnded: fixedRangeEnded(props.rangeEndUs, Date.now()),
        });
      if (owed) {
        caughtUp.value = true;
        emit("trigger");
      }
      resetTimers();
    };

    watch(selectedValue, () => {
      caughtUp.value = false;
      resetTimers();
    });

    watch(
      () => props.rangeEndUs,
      () => resetTimers(),
    );

    onMounted(() => document.addEventListener("visibilitychange", onVisibilityChange));

    const minRangeRestrictionMessageVal = computed(() =>
      t("common.minRefreshIntervalMessage", { interval: props.minRefreshInterval }),
    );

    // on component mount and unmount, update the intervals
    onActivated(() => {
      inactive = false;
      resetTimers();
    });

    onDeactivated(() => {
      inactive = true;
      clearInterval(intervalInstance);
    });

    onUnmounted(() => {
      clearInterval(intervalInstance);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
      isPausedEnded,
      caughtUp,
      compactTooltip,
      goLiveTooltip,
      onCloseAutoFocus,
    };
  },
});
</script>

<style scoped>
/* keep(keyframes): scoped compiler renames the keyframe and this reference together, which a template utility cannot. */
@media (prefers-reduced-motion: no-preference) {
  .auto-refresh-icon--spinning {
    display: inline-block !important;
    transform-origin: center center !important;
    animation: rotate 2s linear infinite !important;
  }
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
