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
  <section
    class="tw:grid tw:grid-cols-2 tw:lg:grid-cols-5 tw:gap-2 tw:p-2"
    data-test="rum-sessions-metrics-strip"
    aria-label="Session metrics summary"
  >
    <button
      v-for="card in cards"
      :key="card.key"
      type="button"
      class="metric-card tw:flex tw:flex-col tw:items-start tw:gap-0.5 tw:text-left tw:rounded-lg tw:border tw:p-3 tw:transition-colors"
      :class="
        card.key === activeCard
          ? 'tw:border-[var(--o2-primary-color)]'
          : 'tw:border-border-default'
      "
      :aria-pressed="card.key === activeCard"
      :disabled="!card.selectable"
      :data-test="`rum-sessions-metric-${card.key}-card`"
      @click="card.selectable && emit('select', card.key)"
    >
      <span
        class="tw:text-xs tw:font-medium tw:uppercase tw:tracking-wide tw:text-[var(--o2-text-label)]"
      >{{ card.label }}</span>
      <span class="tw:flex tw:items-baseline tw:gap-1.5">
        <span
          class="tw:text-2xl tw:font-semibold tw:tabular-nums"
          :class="card.valueClass"
          :data-test="`rum-sessions-metric-${card.key}-value`"
        >{{ card.value }}</span>
        <span
          v-if="card.rate"
          class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:tabular-nums"
        >· {{ card.rate }}</span>
      </span>
      <small class="tw:text-[var(--o2-text-caption)]">{{ card.caption }}</small>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { durationFormatter } from "@/utils/zincutils";

export type SessionsMetricCardKey =
  | "sessions"
  | "errors"
  | "frustrated"
  | "duration"
  | "bounced";

const props = defineProps<{
  total: number;
  errorSessions: number;
  frustratedSessions: number;
  bouncedSessions: number;
  avgDurationMs: number;
  medianDurationMs: number;
  /** Card whose segment filter is currently applied ("" when none). */
  activeCard: string;
}>();

const emit = defineEmits<{
  select: [card: SessionsMetricCardKey];
}>();

const { t } = useI18n();

const rate = (count: number) =>
  props.total > 0 ? `${((count / props.total) * 100).toFixed(1)}%` : "";

const formatMs = (ms: number) => {
  if (!ms || ms <= 0) return "0s";
  if (ms < 1000) return "<1s";
  return durationFormatter(Math.round(ms / 1000));
};

const cards = computed(() => [
  {
    key: "sessions" as const,
    label: t("rum.sessions"),
    value: props.total.toLocaleString(),
    valueClass: "tw:text-[var(--o2-text-heading)]",
    rate: "",
    caption: t("rum.inTimeRange"),
    selectable: true,
  },
  {
    key: "errors" as const,
    label: t("rum.withErrors"),
    value: props.errorSessions.toLocaleString(),
    valueClass:
      props.errorSessions > 0
        ? "tw:text-[var(--o2-status-error-text)]"
        : "tw:text-[var(--o2-text-heading)]",
    rate: rate(props.errorSessions),
    caption: t("rum.sessionsWithErrors"),
    selectable: true,
  },
  {
    key: "frustrated" as const,
    label: t("rum.frustrated"),
    value: props.frustratedSessions.toLocaleString(),
    valueClass:
      props.frustratedSessions > 0
        ? "tw:text-[var(--o2-status-warning-text)]"
        : "tw:text-[var(--o2-text-heading)]",
    rate: rate(props.frustratedSessions),
    caption: t("rum.rageDeadClicks"),
    selectable: true,
  },
  {
    key: "duration" as const,
    label: t("rum.avgDuration"),
    value: formatMs(props.avgDurationMs),
    valueClass: "tw:text-[var(--o2-text-heading)]",
    rate: "",
    caption: `${t("rum.median")} ${formatMs(props.medianDurationMs)}`,
    selectable: false,
  },
  {
    key: "bounced" as const,
    label: t("rum.bounceRate"),
    value: props.total > 0 ? rate(props.bouncedSessions) : "0%",
    valueClass: "tw:text-[var(--o2-text-heading)]",
    rate: "",
    caption: t("rum.ofTotal", {
      count: props.bouncedSessions,
      total: props.total,
    }),
    selectable: true,
  },
]);
</script>

<style scoped lang="scss">
.metric-card {
  background: var(--o2-card-bg);

  &:not(:disabled) {
    cursor: pointer;

    &:hover {
      border-color: var(--o2-primary-color);
    }
  }

  &:disabled {
    cursor: default;
  }
}
</style>
