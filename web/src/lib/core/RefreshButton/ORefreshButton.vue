<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, useId, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "../Button/OButton.vue";
import OButtonGroup from "../Button/OButtonGroup.vue";
import OIcon from "../Icon/OIcon.vue";
import OTooltip from "../../overlay/Tooltip/OTooltip.vue";
import ODropdown from "../../overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "../../overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "../../overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "../../overlay/Dropdown/ODropdownSeparator.vue";
import { formatRefreshFailed } from "@/utils/formatters";
import {
  AUTO_REFRESH_INTERVALS,
  autoRefreshLabel,
  autoRefreshShortLabel,
  minAutoRefreshSeconds,
} from "@/utils/dashboard/autoRefresh";
import type { RefreshButtonProps, RefreshButtonEmits } from "./ORefreshButton.types";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<RefreshButtonProps>(), {
  lastRunAt: null,
  loading: false,
  disabled: false,
  disabledReason: null,
  failedAt: null,
  autoRefresh: undefined,
  intervals: () => AUTO_REFRESH_INTERVALS,
  minInterval: undefined,
  autoRefreshNote: undefined,
  pendingLabel: undefined,
  size: "md",
  shortcut: undefined,
  dataTest: "refresh-button",
  tooltip: undefined,
  timeZone: undefined,
});

const emit = defineEmits<RefreshButtonEmits>();

// `useStore()` is an inject(), so a storeless mount gets the built-in floor.
const store = useStore() as { state?: { zoConfig?: Record<string, unknown> } } | undefined;

const relativeTime = ref<I18nText | "">("");
let intervalId: ReturnType<typeof setInterval> | null = null;

const getRelativeTime = (ts: number): I18nText => {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return t("refreshButton.justNow");
  if (sec < 60) return t("refreshButton.secondsAgo", { sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("refreshButton.minutesAgo", { min });
  return t("refreshButton.hoursAgo", { h: Math.floor(min / 60) });
};

const updateRelativeTime = () => {
  relativeTime.value = props.lastRunAt ? getRelativeTime(props.lastRunAt) : "";
};

// With no age yet the button names its action, so it never reads as an empty field.
const ageLabel = computed<I18nText>(() => relativeTime.value || t("refreshButton.refresh"));

const minSeconds = computed(
  () =>
    props.minInterval ?? minAutoRefreshSeconds(store?.state?.zoConfig?.min_auto_refresh_interval),
);

const autoInterval = computed(() =>
  props.autoRefresh && props.autoRefresh > 0 ? props.autoRefresh : 0,
);

const intervalSections = computed(() => {
  const ranges: [I18nText, (s: number) => boolean][] = [
    [t("search.autoRefreshSeconds"), (s) => s < 60],
    [t("search.autoRefreshMinutes"), (s) => s >= 60 && s < 3600],
    [t("search.autoRefreshHours"), (s) => s >= 3600],
  ];
  return ranges
    .map(([label, inRange]) => ({
      label,
      items: props.intervals.filter(inRange).map((seconds) => ({
        seconds,
        label: autoRefreshLabel(seconds, t),
        disabled: seconds < minSeconds.value,
      })),
    }))
    .filter((section) => section.items.length > 0);
});

const hasDisabledInterval = computed(() => props.intervals.some((s) => s < minSeconds.value));

const failedText = computed<I18nText | null>(() => {
  if (!props.failedAt) return null;
  if (!props.lastRunAt) return t("dataAge.refreshFailedShort");
  return formatRefreshFailed(t, {
    failedAt: props.failedAt,
    dataFrom: props.lastRunAt,
    timeZone: props.timeZone,
  });
});

const failedId = useId();

const visibleLabel = computed<I18nText>(() => {
  if (props.pendingLabel && !props.loading) return props.pendingLabel;
  if (autoInterval.value) {
    return t("refreshButton.autoOn", { interval: autoRefreshShortLabel(autoInterval.value, t) });
  }
  return props.loading ? t("refreshButton.refreshing") : ageLabel.value;
});

// The age alone is the visible label, so the name leads with the action a screen reader announces.
const buttonName = computed(() => {
  if (failedText.value) return t("common.retry");
  if (props.pendingLabel) return props.pendingLabel;
  return props.lastRunAt
    ? t("refreshButton.refreshWithAge", { age: ageLabel.value })
    : t("refreshButton.refresh");
});

const tooltipText = computed(() => {
  if (failedText.value) return failedText.value;
  if (props.tooltip) return props.tooltip;
  if (!props.lastRunAt) return t("refreshButton.notYetRefreshed");
  return t("refreshButton.lastRefreshed", {
    time: new Date(props.lastRunAt).toLocaleTimeString(),
  });
});

onMounted(() => {
  updateRelativeTime();
  intervalId = setInterval(updateRelativeTime, 10_000);
});

onBeforeUnmount(() => {
  if (intervalId) clearInterval(intervalId);
});

watch(() => props.lastRunAt, updateRelativeTime, { immediate: true });

function handleClick(e: MouseEvent) {
  if (props.loading || props.disabled) return;
  emit("click", e);
}
</script>

<template>
  <OButtonGroup :size="size">
    <!-- A failed refresh restyles this same button rather than swapping it, so focus stays on it. -->
    <OButton
      :variant="pendingLabel && !failedText ? 'primary' : 'secondary'"
      :disabled="disabled"
      :disabled-reason="disabled ? (disabledReason ?? undefined) : undefined"
      :aria-busy="loading || undefined"
      :data-test="dataTest"
      :data-state="failedText ? 'failed' : loading ? 'loading' : undefined"
      :aria-label="buttonName"
      :aria-describedby="failedText ? failedId : undefined"
      @click="handleClick"
    >
      <!-- First child with no element before it, so the tooltip binds to the button itself. -->
      <OTooltip v-if="!(disabled && disabledReason)" :content="tooltipText" :shortcut="shortcut" />
      <OIcon
        v-if="loading"
        name="progress-activity"
        size="sm"
        class="o2-motion-keep animate-spin"
        :data-test="`${dataTest}-spinner`"
      />
      <OIcon v-else name="refresh" size="sm" />
      <template v-if="failedText">
        <span class="bg-warning-500 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
        <span :id="failedId" class="sr-only" aria-hidden="true">{{ failedText }}</span>
        <span
          class="text-text-secondary text-xs font-normal whitespace-nowrap max-lg:hidden"
          :data-test="`${dataTest}-failed`"
          aria-hidden="true"
          >{{ t("refreshButton.failed") }}</span
        >
      </template>
      <!-- The hidden labels reserve the widest steady text, so a load or a refresh never resizes the button. -->
      <span
        v-else
        class="inline-grid text-xs whitespace-nowrap max-lg:hidden"
        :data-test="`${dataTest}-label`"
        aria-hidden="true"
      >
        <span class="invisible col-start-1 row-start-1">{{ t("refreshButton.refreshing") }}</span>
        <span class="invisible col-start-1 row-start-1">{{ t("refreshButton.justNow") }}</span>
        <span v-if="pendingLabel" class="invisible col-start-1 row-start-1">{{
          pendingLabel
        }}</span>
        <!-- No colour class: the age is the button's label, so it takes the button's ink. -->
        <span
          class="col-start-1 row-start-1 text-start tabular-nums"
          :data-test="autoInterval ? `${dataTest}-auto` : `${dataTest}-age`"
          >{{ visibleLabel }}</span
        >
      </span>
    </OButton>
    <ODropdown v-if="autoRefresh !== undefined" align="end">
      <template #trigger>
        <OButton
          variant="secondary"
          icon-only
          icon="arrow-drop-down"
          :disabled="disabled"
          :disabled-reason="disabled ? (disabledReason ?? undefined) : undefined"
          :aria-label="t('refreshButton.autoRefresh')"
          :data-test="`${dataTest}-auto-menu`"
        />
      </template>
      <ODropdownGroup :label="t('refreshButton.autoRefresh')">
        <ODropdownItem
          :data-test="`${dataTest}-auto-0`"
          :checked="autoInterval === 0"
          @select="emit('update:autoRefresh', 0)"
        >
          {{ t("common.off") }}
        </ODropdownItem>
      </ODropdownGroup>
      <template v-for="section in intervalSections" :key="section.label">
        <ODropdownSeparator />
        <ODropdownGroup :label="section.label">
          <ODropdownItem
            v-for="item in section.items"
            :key="item.seconds"
            :data-test="`${dataTest}-auto-${item.seconds}`"
            :checked="autoInterval === item.seconds"
            :disabled="item.disabled"
            @select="emit('update:autoRefresh', item.seconds)"
          >
            {{ item.label }}
          </ODropdownItem>
        </ODropdownGroup>
      </template>
      <slot name="menu" />
      <template v-if="hasDisabledInterval || autoRefreshNote">
        <ODropdownSeparator />
        <div
          class="text-text-muted text-2xs flex flex-col gap-0.5 px-2 py-1.5"
          :data-test="`${dataTest}-auto-note`"
        >
          <span v-if="hasDisabledInterval">{{
            t("common.minRefreshIntervalMessage", { interval: minSeconds })
          }}</span>
          <span v-if="autoRefreshNote">{{ autoRefreshNote }}</span>
        </div>
      </template>
    </ODropdown>
  </OButtonGroup>
</template>
