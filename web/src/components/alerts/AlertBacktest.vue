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
import { computed, onBeforeUnmount, watch } from "vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import { useI18nTyped } from "@/types/i18n";
import { useAlertStreamQuery } from "@/composables/alerts/useAlertStreamQuery";
import { backtestWindows, windowedCountSql } from "@/utils/alerts/alertBacktest";

const props = defineProps<{
  /** The builder's count-per-bucket SQL; its histogram is re-bucketed to the look-back. */
  query: string;
  streamType: string;
  /** Look-back in minutes. */
  period: number;
  operator: string;
  threshold: number;
}>();

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = 24;
// Typing in a filter re-runs the query, so wait for a pause.
const DEBOUNCE_MS = 700;
const NOISY_SHARE = 0.25;

const { t } = useI18nTyped();
const search = useAlertStreamQuery();

const sql = computed(() => windowedCountSql(props.query, props.period));

let startMs = Date.now() - DAY_MS;
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [sql.value, props.streamType],
  () => {
    clearTimeout(timer);
    if (!sql.value) return;
    timer = setTimeout(() => {
      const endMs = Date.now();
      startMs = endMs - DAY_MS;
      search.run({
        sql: sql.value!,
        streamType: props.streamType,
        startTime: startMs * 1000,
        endTime: endMs * 1000,
        size: -1,
      });
    }, DEBOUNCE_MS);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));

const result = computed(() =>
  backtestWindows(search.hits.value, {
    startMs,
    hours: HOURS,
    period: props.period,
    operator: props.operator,
    threshold: props.threshold,
  }),
);

const hint = computed(() => {
  if (result.value.fired === 0) return t("alerts.sections.backtest.never");
  if (result.value.fired / result.value.total > NOISY_SHARE)
    return t("alerts.sections.backtest.noisy");
  return null;
});
</script>

<template>
  <OSettingRow
    :label="t('alerts.sections.backtest.label')"
    :description="t('alerts.sections.backtest.help')"
    fill
    data-test="add-alert-backtest"
  >
    <p
      v-if="search.state.value !== 'ready'"
      class="text-text-secondary m-0 pt-2 text-xs"
      data-test="add-alert-backtest-status"
    >
      {{
        search.state.value === "failed"
          ? t("alerts.sections.backtest.failed")
          : t("alerts.sections.backtest.loading")
      }}
    </p>
    <template v-else>
      <p class="text-text-body m-0 text-sm" data-test="add-alert-backtest-result">
        {{
          t("alerts.sections.backtest.result", {
            count: result.fired,
            total: result.total,
            period,
          })
        }}
      </p>
      <div class="mt-2 grid grid-cols-24 gap-0.5" aria-hidden="true">
        <span
          v-for="(fired, hour) in result.hours"
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
        v-if="hint"
        class="text-text-secondary m-0 mt-2 text-xs"
        data-test="add-alert-backtest-hint"
      >
        {{ hint }}
      </p>
    </template>
  </OSettingRow>
</template>
