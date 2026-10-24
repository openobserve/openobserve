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
  <div
    v-if="lines.length || showUse"
    class="text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
    data-test="alert-threshold-suggestion"
  >
    <OButton
      v-if="showUse"
      variant="ghost-primary"
      size="xs"
      data-test="alert-threshold-use-suggested"
      @click="emit('use', suggested as number)"
    >
      {{ t("alerts.queryConfig.thresholdSuggestion.useSuggested", { value: suggested }) }}
    </OButton>
    <span v-for="line in lines" :key="line">{{ line }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { resolveBrowserTimezone } from "@/utils/timezone";
import type { BacktestResult, HistoryState } from "@/utils/alerts/backtest";
import OButton from "@/lib/core/Button/OButton.vue";

const props = defineProps<{
  suggested: number | null;
  usualHigh: number | null;
  truncatedDays: number | null;
  history: HistoryState | null;
  backtest: BacktestResult | null;
  loading: boolean;
  error: boolean;
  current: number | null;
}>();

const emit = defineEmits<{ use: [value: number] }>();

const MAX_LISTED_TIMES = 5;

const { t, locale } = useI18nTyped();
const store = useStore();

const timezone = computed(() => {
  const zone = store.state.timezone;
  return zone ? resolveBrowserTimezone(zone) : Intl.DateTimeFormat().resolvedOptions().timeZone;
});

const formatTime = (ms: number): string => {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  try {
    return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: timezone.value }).format(
      ms,
    );
  } catch {
    // An unknown zone name throws; the browser's own zone is still a correct reading.
    return new Intl.DateTimeFormat(locale.value, options).format(ms);
  }
};

const round = (value: number) => Math.round(value * 100) / 100;

const showUse = computed(
  () => props.suggested !== null && !props.error && props.current !== props.suggested,
);

const usualLine = (usual: number): I18nText => {
  const value = round(usual);
  if (props.history === "short") {
    return t("alerts.queryConfig.thresholdSuggestion.usualHighSoFar", { value });
  }
  if (props.truncatedDays !== null) {
    const days = props.truncatedDays;
    return t(
      "alerts.queryConfig.thresholdSuggestion.usualHighLimited",
      { value, days },
      days === 1 ? 1 : 2,
    );
  }
  return t("alerts.queryConfig.thresholdSuggestion.usualHigh", { value });
};

const backtestLine = (result: BacktestResult): I18nText => {
  const count = result.episodes;
  if (count === 0 || count > MAX_LISTED_TIMES) {
    return t("alerts.queryConfig.thresholdSuggestion.wouldHaveFired", { count }, count);
  }
  const times = result.at.map(formatTime).join(", ");
  return t(
    "alerts.queryConfig.thresholdSuggestion.wouldHaveFiredAt",
    { count, times, timezone: timezone.value },
    count === 1 ? 1 : 2,
  );
};

const lines = computed<I18nText[]>(() => {
  if (props.loading) return [t("alerts.queryConfig.thresholdSuggestion.checking")];
  if (props.error) return [t("alerts.queryConfig.thresholdSuggestion.failed")];
  if (props.history === "none") return [t("alerts.queryConfig.thresholdSuggestion.noHistory")];
  if (!props.history) return [];
  const out: I18nText[] = [];
  if (props.usualHigh !== null) out.push(usualLine(props.usualHigh));
  if (props.history === "short") out.push(t("alerts.queryConfig.thresholdSuggestion.notTested"));
  else if (props.backtest) out.push(backtestLine(props.backtest));
  return out;
});
</script>
