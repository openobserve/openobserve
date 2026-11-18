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

<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  watchEffect,
  type ComponentPublicInstance,
} from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useI18nTyped } from "@/types/i18n";
import { isCountLimit } from "@/utils/alerts/alertReadBack";
import { formatNumber } from "@/utils/alerts/alertCopy";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";
import { ALERT_BACKTEST_SIGNAL_KEY } from "@/composables/alerts/useAlertSuggestions";
import {
  backtestBucketMinutes,
  backtestHintKey,
  backtestWindows,
  cronCheckTimes,
  dailyVolume,
  emptyDayHintKey,
  realtimeDay,
  windowedCountSql,
} from "@/utils/alerts/alertBacktest";

const props = defineProps<{
  /** The builder's count-per-bucket SQL; its histogram is re-bucketed to fit every check window. */
  query: string;
  streamType: string;
  /** Look-back in minutes. */
  period: number;
  operator: string;
  threshold: number;
  /** The alert's schedule; read by the replay of real check times. */
  triggerCondition?: {
    frequency: number;
    frequency_type: string;
    cron?: string;
    timezone?: string;
    silence: number;
  };
  /** Real time: every matching event notifies, so the day is counted by the hour. */
  realTime?: boolean;
}>();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = 24;
const REALTIME_BUCKET_MINUTES = 60;
// Typing in a filter re-runs the query, so wait for a pause.
const DEBOUNCE_MS = 700;
// A day of a busy stream can scan for minutes; past this the answer is no longer worth the wait.
const TIMEOUT_MS = 30_000;

const { t } = useI18nTyped();
const search = useAlertStreamQuery();

const signal = inject(ALERT_BACKTEST_SIGNAL_KEY, null);

const isCron = computed(() => props.triggerCondition?.frequency_type === "cron");
// Without a schedule the alert checks once per look-back.
const frequency = computed(() => Number(props.triggerCondition?.frequency) || props.period);
const cronTimes = (endMs: number) =>
  cronCheckTimes(
    props.triggerCondition?.cron ?? "",
    props.triggerCondition?.timezone,
    endMs - DAY_MS,
    endMs,
  );

const sql = computed(() => {
  if (props.realTime) return windowedCountSql(props.query, REALTIME_BUCKET_MINUTES);
  if (isCron.value && !cronTimes(Date.now())?.length) return null;
  const bucket = backtestBucketMinutes({
    period: props.period,
    frequency: frequency.value,
    checkTimesMs: isCron.value ? [] : undefined,
  });
  return windowedCountSql(props.query, bucket);
});
const runKey = computed(() => (sql.value ? `${props.streamType}\u0000${sql.value}` : null));

const rowRef = ref<ComponentPublicInstance | null>(null);
// Without an observer (tests, old browsers) the row counts as on screen.
const onScreen = ref(typeof IntersectionObserver === "undefined");
const ranKey = ref<string | null>(null);
const timedOut = ref(false);

let startMs = Date.now() - DAY_MS;
const checkTimesMs = shallowRef<number[] | undefined>();
let debounce: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;

const stop = () => {
  clearTimeout(deadline);
  search.cancel();
  ranKey.value = null;
};

const start = () => {
  clearTimeout(debounce);
  clearTimeout(deadline);
  if (!sql.value) return;
  const endMs = Date.now();
  startMs = endMs - DAY_MS;
  checkTimesMs.value = isCron.value && !props.realTime ? (cronTimes(endMs) ?? []) : undefined;
  // The oldest check looks back one period before the day starts.
  const queryStartMs = props.realTime ? startMs : startMs - props.period * 60_000;
  const bucketMs =
    (props.realTime
      ? REALTIME_BUCKET_MINUTES
      : backtestBucketMinutes({
          period: props.period,
          frequency: frequency.value,
          checkTimesMs: checkTimesMs.value,
        })) * 60_000;
  timedOut.value = false;
  ranKey.value = runKey.value;
  search.run({
    sql: sql.value,
    streamType: props.streamType,
    startTime: queryStartMs * 1000,
    endTime: endMs * 1000,
    // An explicit size, since -1 stops at the server's default of 1000 rows.
    size: Math.ceil((endMs - queryStartMs) / bucketMs) + 1,
  });
  deadline = setTimeout(() => {
    if (search.state.value !== "loading") return;
    search.cancel();
    timedOut.value = true;
  }, TIMEOUT_MS);
};

watch(
  [runKey, onScreen],
  () => {
    clearTimeout(debounce);
    if (runKey.value === ranKey.value) return;
    // A superseded day scan keeps loading the cluster, so stop it now rather than when the next one starts.
    if (ranKey.value !== null) stop();
    timedOut.value = false;
    if (runKey.value && onScreen.value) debounce = setTimeout(start, DEBOUNCE_MS);
  },
  { immediate: true },
);

const observer =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver((entries) => {
        onScreen.value = entries.some((entry) => entry.isIntersecting);
      });

watch(
  () => rowRef.value?.$el as Element | undefined,
  (el, prev) => {
    if (prev instanceof Element) observer?.unobserve(prev);
    if (el instanceof Element) observer?.observe(el);
  },
);

onBeforeUnmount(() => {
  if (signal) signal.value = null;
  clearTimeout(debounce);
  clearTimeout(deadline);
  observer?.disconnect();
});

const status = computed<"fixLimit" | "loading" | "slow" | "failed" | "ready">(() => {
  if (!props.realTime && !isCountLimit(props.threshold)) return "fixLimit";
  if (runKey.value !== ranKey.value) return "loading";
  if (timedOut.value) return "slow";
  if (search.state.value === "failed") return "failed";
  return search.state.value === "ready" ? "ready" : "loading";
});

const result = computed(() =>
  backtestWindows(search.hits.value, {
    startMs,
    hours: HOURS,
    period: props.period,
    frequency: frequency.value,
    silence: Number(props.triggerCondition?.silence) || 0,
    checkTimesMs: checkTimesMs.value,
    operator: props.operator,
    threshold: props.threshold,
  }),
);

// The smallest gap stands in for "one check" of an irregular cron.
const frequencyMinutes = computed(() => {
  const times = checkTimesMs.value;
  if (!times) return frequency.value;
  const gaps = times.slice(1).map((at, i) => (at - times[i]) / 60_000);
  return gaps.length ? Math.round(Math.min(...gaps)) : 24 * 60;
});

watchEffect(() => {
  if (!signal) return;
  const r = result.value;
  signal.value =
    sql.value && status.value === "ready" && !props.realTime
      ? {
          checks: r.total,
          alerts: r.alerts,
          singleCheckSpikes: r.singleCheckSpikes,
          refires: r.refires,
          frequencyMinutes: frequencyMinutes.value,
        }
      : null;
});

// Without a WHERE, an empty day means the stream itself was quiet, not the filters.
const filtered = computed(() => /\bWHERE\b/i.test(props.query));

const day = computed(() =>
  props.realTime ? realtimeDay(search.hits.value, { startMs, hours: HOURS }) : result.value,
);
const volume = computed(() =>
  dailyVolume(
    props.realTime ? { ...day.value, fired: 0, alerts: 0 } : result.value,
    !!props.realTime,
  ),
);
const volumeText = computed(() =>
  volume.value
    ? t("alerts.guard.volume", { count: formatNumber(volume.value.count) }, volume.value.count)
    : null,
);

const resultText = computed(() => {
  if (props.realTime) return volumeText.value ?? t(emptyDayHintKey(filtered.value));
  return isCron.value
    ? t("alerts.sections.backtest.cronResult", {
        count: result.value.alerts,
        total: result.value.total,
      })
    : t("alerts.sections.backtest.result", {
        count: result.value.alerts,
        total: result.value.total,
        frequency: frequency.value,
      });
});

const hint = computed(() => {
  if (props.realTime) return null;
  const key = backtestHintKey(result.value.alerts, result.value.total, props.operator, {
    events: result.value.events,
    filtered: filtered.value,
  });
  return key ? t(key) : null;
});
</script>

<template>
  <OSettingRow
    v-if="sql"
    ref="rowRef"
    :label="t('alerts.sections.backtest.label')"
    fill
    wide
    data-test="add-alert-backtest"
  >
    <p
      v-if="status !== 'ready'"
      class="text-text-secondary m-0 pt-2 text-xs"
      data-test="add-alert-backtest-status"
    >
      {{
        status === "fixLimit"
          ? t("alerts.sections.condition.fixLimit")
          : status === "slow"
            ? t("alerts.sections.backtest.slow")
            : status === "failed"
              ? t("alerts.sections.backtest.failed")
              : t("alerts.sections.backtest.loading")
      }}
      <OButton
        v-if="status === 'slow' || status === 'failed'"
        variant="link"
        data-test="add-alert-backtest-retry"
        @click="start"
      >
        {{ t("common.retry") }}
      </OButton>
    </p>
    <template v-else>
      <p
        class="m-0 text-sm"
        :class="realTime && volume?.noisy ? 'text-status-warning-text' : 'text-text-body'"
        data-test="add-alert-backtest-result"
      >
        {{ resultText }}
      </p>
      <div class="mt-2 grid grid-cols-24 gap-0.5" aria-hidden="true">
        <span
          v-for="(fired, hour) in day.hours"
          :key="hour"
          class="rounded-default h-4"
          :class="fired ? 'bg-accent' : 'bg-surface-subtle'"
          :data-test="fired ? 'add-alert-backtest-hour-fired' : 'add-alert-backtest-hour'"
        />
      </div>
      <div class="text-text-secondary mt-1 flex justify-between text-xs">
        <span>{{ t("alerts.sections.backtest.dayAgo") }}</span>
        <span>{{ t("alerts.sections.timeline.now") }}</span>
      </div>
      <p
        v-if="!realTime && volumeText"
        class="m-0 mt-2 text-xs"
        :class="volume?.noisy ? 'text-status-warning-text' : 'text-text-secondary'"
        data-test="add-alert-backtest-volume"
      >
        {{ volumeText }}
      </p>
      <p
        v-if="hint"
        class="text-text-secondary m-0 mt-2 text-xs"
        data-test="add-alert-backtest-hint"
      >
        {{ hint }}
      </p>
    </template>
  </OSettingRow>
</template>
