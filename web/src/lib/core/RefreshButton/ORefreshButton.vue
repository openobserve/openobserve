<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, useId, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "../Button/OButton.vue";
import OIcon from "../Icon/OIcon.vue";
import OTruncatedText from "../Typography/OTruncatedText.vue";
import OTooltip from "../../overlay/Tooltip/OTooltip.vue";
import { formatDataAge, formatRefreshFailed } from "@/utils/formatters";
import type { RefreshButtonProps, RefreshButtonEmits } from "./ORefreshButton.types";

const { t } = useI18nTyped();

const props = withDefaults(defineProps<RefreshButtonProps>(), {
  lastRunAt: null,
  loading: false,
  spinner: true,
  disabled: false,
  variant: "ghost",
  layout: "split",
  dataTest: "refresh-button",
  shortcutId: undefined,
  tooltip: undefined,
  size: "toolbar",
  ageFormat: "relative",
  timeZone: undefined,
  failedAt: null,
  dataFrom: null,
});

const emit = defineEmits<RefreshButtonEmits>();

const relativeTime = ref("");
let intervalId: ReturnType<typeof setInterval> | null = null;

const diffSeconds = (): number => {
  if (!props.lastRunAt) return Infinity;
  return Math.floor((Date.now() - props.lastRunAt) / 1000);
};

const getRelativeTime = (ts: number): string => {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return t("refreshButton.justNow");
  if (sec < 60) return t("refreshButton.secondsAgo", { sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("refreshButton.minutesAgo", { min });
  return t("refreshButton.hoursAgo", { h: Math.floor(min / 60) });
};

const updateRelativeTime = () => {
  if (!props.lastRunAt) {
    relativeTime.value = "";
    return;
  }
  relativeTime.value = getRelativeTime(props.lastRunAt);
};

// green < 30s, amber 30s–5min, red > 5min
const dotColor = computed(() => {
  if (props.loading) return "bg-refresh-dot-idle";
  const s = diffSeconds();
  if (s === Infinity) return "bg-refresh-dot-idle";
  if (s < 30) return "bg-refresh-dot-fresh";
  if (s < 300) return "bg-refresh-dot-stale";
  return "bg-refresh-dot-critical";
});

const dotTitle = computed(() => {
  const s = diffSeconds();
  if (s === Infinity) return t("refreshButton.notYetRefreshed");
  if (s < 30) return t("refreshButton.dataFresh");
  if (s < 300) return t("refreshButton.dataGettingStale");
  return t("refreshButton.dataStale");
});

const clockAge = computed(() =>
  props.ageFormat === "clock" && props.lastRunAt
    ? formatDataAge(t, { at: props.lastRunAt, timeZone: props.timeZone })
    : null,
);

const failedText = computed(() => {
  const dataFrom = props.dataFrom ?? props.lastRunAt;
  return props.failedAt && dataFrom
    ? formatRefreshFailed(t, { failedAt: props.failedAt, dataFrom, timeZone: props.timeZone })
    : null;
});

const ageLabel = computed(
  () => clockAge.value?.text ?? (relativeTime.value || t("refreshButton.justNow")),
);

const failedId = useId();

// Clock and failed modes put the icon in the slot, so a leading tooltip binds to the whole button; relative mode keeps today's binding.
const ownsTooltip = computed(() => !!failedText.value || !!clockAge.value);

// The age alone is the inline label, so the name leads with the action a screen reader should announce.
const buttonName = computed(() => {
  if (failedText.value) return t("common.retry");
  if (clockAge.value) return clockAge.value.refreshName;
  return props.lastRunAt
    ? t("refreshButton.refreshWithAge", { age: relativeTime.value || t("refreshButton.justNow") })
    : t("refreshButton.refresh");
});

const exactTime = computed(() => {
  if (failedText.value) return failedText.value;
  if (props.tooltip) return props.tooltip;
  if (clockAge.value) return clockAge.value.full;
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
  <!-- A failed refresh restyles this same button rather than swapping it, so focus stays on it. -->
  <OButton
    v-if="layout === 'inline'"
    :variant="failedText ? 'outline-destructive' : variant"
    size="sm-toolbar"
    :class="
      failedText
        ? 'border-status-error-text! bg-status-error-bg! h-6! max-w-full pe-0! sm:min-w-0'
        : size === 'header'
          ? 'h-8.5!'
          : undefined
    "
    :icon-left="ownsTooltip ? undefined : 'refresh'"
    :loading="loading"
    :spinner="spinner"
    :disabled="disabled"
    :data-test="dataTest"
    :data-state="failedText ? 'failed' : undefined"
    :aria-label="buttonName"
    :aria-describedby="failedText ? failedId : undefined"
    @click="handleClick"
  >
    <!-- First child, so the tooltip binds to the button, not to the icon or label before it. -->
    <OTooltip v-if="ownsTooltip" :content="exactTime" :shortcut-id="shortcutId" />
    <template v-if="failedText">
      <OIcon name="error-outline" size="xs" class="text-status-error-text shrink-0" />
      <OTruncatedText
        :id="failedId"
        class="text-status-error-text min-w-0 text-xs font-normal max-sm:hidden"
        :tooltip="false"
        :data-test="`${dataTest}-failed`"
        >{{ failedText }}</OTruncatedText
      >
      <span
        class="text-status-error-text text-xs font-normal whitespace-nowrap sm:hidden"
        aria-hidden="true"
        >{{ t("dataAge.refreshFailedShort") }}</span
      >
      <span class="bg-status-error-text h-3 w-px shrink-0 opacity-40" aria-hidden="true" />
      <span class="inline-flex shrink-0 items-center gap-1.5 px-2.5">
        <OIcon name="refresh" size="sm" class="shrink-0" />
        <span class="text-xs whitespace-nowrap">{{ t("common.retry") }}</span>
      </span>
    </template>
    <template v-else>
      <OIcon v-if="clockAge" name="refresh" size="sm" />
      <!-- The relative age drops below md so a toolbar keeps search, columns and refresh on one phone row; a clock age keeps its time. -->
      <span
        v-if="lastRunAt"
        :class="['bg-border-default h-4 w-px shrink-0', !clockAge && 'max-md:hidden']"
        aria-hidden="true"
      />
      <!-- No colour class: here the age is the button's label, not the loose caption `split` renders. -->
      <span
        v-if="lastRunAt"
        :class="[
          'inline-block min-w-12 text-left text-xs tabular-nums',
          !clockAge && 'max-md:hidden',
        ]"
      >
        <template v-if="clockAge">
          <span class="max-md:hidden">{{ clockAge.text }}</span>
          <span class="md:hidden" :data-test="`${dataTest}-age-short`">{{ clockAge.time }}</span>
        </template>
        <template v-else>{{ ageLabel }}</template>
      </span>
    </template>
    <OTooltip v-if="!ownsTooltip" :content="exactTime" :shortcut-id="shortcutId" />
  </OButton>

  <div v-else :class="['inline-flex items-center gap-1.5', failedText && 'sm:min-w-0']">
    <span
      v-if="failedText"
      class="text-status-error-text inline-flex items-center gap-1 text-xs sm:min-w-0"
      :data-test="`${dataTest}-failed`"
    >
      <!-- First child, so the full sentence opens from the sentence and from the short marker alike. -->
      <OTooltip :content="failedText" />
      <OIcon name="error-outline" size="xs" class="shrink-0" />
      <OTruncatedText :id="failedId" class="min-w-0 max-sm:hidden" :tooltip="false">{{
        failedText
      }}</OTruncatedText>
      <span class="whitespace-nowrap sm:hidden" aria-hidden="true">{{
        t("dataAge.refreshFailedShort")
      }}</span>
    </span>
    <template v-else>
      <!-- staleness dot -->
      <span :class="['size-2 shrink-0 rounded-full transition-colors duration-700', dotColor]">
        <OTooltip :content="dotTitle" />
      </span>
      <!-- relative timestamp -->
      <span
        v-if="lastRunAt"
        :class="[
          'text-text-secondary text-xs whitespace-nowrap tabular-nums select-none',
          !clockAge && 'max-md:hidden',
        ]"
      >
        <!-- First child, so it binds to this label at every width, not to a responsive span before it. -->
        <OTooltip :content="exactTime" />
        <template v-if="clockAge">
          <span class="max-md:hidden">{{ clockAge.text }}</span>
          <span class="md:hidden" :data-test="`${dataTest}-age-short`">{{ clockAge.time }}</span>
        </template>
        <template v-else>{{ ageLabel }}</template>
      </span>
    </template>
    <OButton
      :variant="variant"
      :size="size === 'inset' ? 'icon' : 'icon-toolbar'"
      :class="size === 'inset' ? 'size-5.5!' : undefined"
      icon-left="refresh"
      :loading="loading"
      :spinner="spinner"
      :disabled="disabled"
      :data-test="dataTest"
      :data-state="failedText ? 'failed' : undefined"
      :aria-label="buttonName"
      :aria-describedby="failedText ? failedId : undefined"
      @click="handleClick"
    >
      <OTooltip :content="exactTime" :shortcut-id="shortcutId" />
    </OButton>
  </div>
</template>
