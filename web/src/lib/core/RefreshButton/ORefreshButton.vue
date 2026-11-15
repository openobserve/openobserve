<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, useId, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "../Button/OButton.vue";
import OButtonGroup from "../Button/OButtonGroup.vue";
import OIcon from "../Icon/OIcon.vue";
import OTooltip from "../../overlay/Tooltip/OTooltip.vue";
import ODropdown from "../../overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "../../overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "../../overlay/Dropdown/ODropdownItem.vue";
import { formatRefreshFailed } from "@/utils/formatters";
import {
  AUTO_REFRESH_INTERVALS,
  type AutoRefreshInterval,
  type RefreshButtonProps,
  type RefreshButtonEmits,
} from "./ORefreshButton.types";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<RefreshButtonProps>(), {
  lastRunAt: null,
  loading: false,
  disabled: false,
  failedAt: null,
  autoRefresh: undefined,
  size: "md",
  shortcut: undefined,
  dataTest: "refresh-button",
  tooltip: undefined,
  timeZone: undefined,
});

const emit = defineEmits<RefreshButtonEmits>();

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

const ageLabel = computed(() => relativeTime.value || t("refreshButton.justNow"));

const INTERVAL_LABELS: Record<Exclude<AutoRefreshInterval, "off">, () => I18nText> = {
  "10s": () => t("refreshButton.interval.10s"),
  "30s": () => t("refreshButton.interval.30s"),
  "1m": () => t("refreshButton.interval.1m"),
  "5m": () => t("refreshButton.interval.5m"),
  "15m": () => t("refreshButton.interval.15m"),
};

const intervalLabel = (value: AutoRefreshInterval): I18nText =>
  value === "off" ? t("common.off") : INTERVAL_LABELS[value]();

const autoInterval = computed(() =>
  props.autoRefresh && props.autoRefresh !== "off" ? props.autoRefresh : null,
);

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

// With visible text it is a labelled, bordered button; a bare ↻ is a toolbar icon and has no edge.
const variant = computed(() =>
  failedText.value || autoInterval.value || props.lastRunAt ? "secondary" : "ghost",
);

// The age alone is the visible label, so the name leads with the action a screen reader announces.
const buttonName = computed(() => {
  if (failedText.value) return t("common.retry");
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
      :variant="variant"
      :disabled="disabled"
      :aria-busy="loading || undefined"
      :data-test="dataTest"
      :data-state="failedText ? 'failed' : loading ? 'loading' : undefined"
      :aria-label="buttonName"
      :aria-describedby="failedText ? failedId : undefined"
      @click="handleClick"
    >
      <!-- First child with no element before it, so the tooltip binds to the button itself. -->
      <OTooltip :content="tooltipText" :shortcut="shortcut" />
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
      <template v-else-if="autoInterval || lastRunAt">
        <!-- No colour class: the age is the button's label, so it takes the button's ink. -->
        <span
          v-if="autoInterval"
          class="inline-block min-w-12 text-left text-xs whitespace-nowrap tabular-nums max-lg:hidden"
          :data-test="`${dataTest}-auto`"
          aria-hidden="true"
          >{{ t("refreshButton.autoOn", { interval: intervalLabel(autoInterval) }) }}</span
        >
        <span
          v-else
          class="inline-block min-w-12 text-left text-xs whitespace-nowrap tabular-nums max-lg:hidden"
          :data-test="`${dataTest}-age`"
          aria-hidden="true"
          >{{ loading ? t("refreshButton.refreshing") : ageLabel }}</span
        >
      </template>
    </OButton>
    <ODropdown v-if="autoRefresh !== undefined" align="end">
      <template #trigger>
        <OButton
          :variant="variant"
          icon-only
          icon="arrow-drop-down"
          :disabled="disabled"
          :aria-label="t('refreshButton.autoRefresh')"
          :data-test="`${dataTest}-auto-menu`"
        />
      </template>
      <ODropdownGroup :label="t('refreshButton.autoRefresh')">
        <ODropdownItem
          v-for="value in AUTO_REFRESH_INTERVALS"
          :key="value"
          :data-test="`${dataTest}-auto-${value}`"
          :checked="value === autoRefresh"
          @select="emit('update:autoRefresh', value)"
        >
          {{
            value === "off"
              ? t("common.off")
              : t("refreshButton.every", { interval: intervalLabel(value) })
          }}
        </ODropdownItem>
      </ODropdownGroup>
    </ODropdown>
  </OButtonGroup>
</template>
