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
    class="grid grid-cols-2 lg:grid-cols-5 gap-2 p-2"
    data-test="rum-sessions-metrics-strip"
    aria-label="Session metrics summary"
  >
    <button
      v-for="card in cards"
      :key="card.key"
      type="button"
      class="metric-card flex flex-col items-start gap-0.5 text-left rounded-default border p-3 transition-colors bg-card-glass-bg enabled:cursor-pointer enabled:hover:border-accent disabled:cursor-default"
      :class="card.key === activeCard ? 'border-accent' : 'border-border-default'"
      :aria-pressed="card.key === activeCard"
      :disabled="!card.selectable"
      :data-test="`rum-sessions-metric-${card.key}-card`"
      @click="card.selectable && emit('select', card.key)"
    >
      <span class="text-xs font-medium uppercase tracking-wide text-text-label">{{
        card.label
      }}</span>
      <span class="flex items-baseline gap-1.5">
        <span
          class="text-2xl font-semibold tabular-nums"
          :class="card.valueClass"
          :data-test="`rum-sessions-metric-${card.key}-value`"
          >{{ card.value }}</span
        >
        <span v-if="card.rate" class="text-sm text-text-secondary tabular-nums"
          >· {{ card.rate }}</span
        >
      </span>
      <small :class="card.captionClass || 'text-text-secondary'">{{ card.caption }}</small>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { durationFormatter } from "@/utils/zincutils";

export type SessionsMetricCardKey = "sessions" | "errors" | "frustrated" | "duration" | "bounced";

const props = defineProps<{
  total: number;
  errorSessions: number;
  frustratedSessions: number;
  bouncedSessions: number;
  /** Denominator for the bounce rate (page-scoped total). Defaults to total. */
  bounceBase?: number;
  avgDurationMs: number;
  medianDurationMs: number;
  /** Change vs the previous window — null hides the delta line. */
  sessionsDeltaPct?: number | null;
  errorsDelta?: number | null;
  frustratedDelta?: number | null;
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

// Bounce rate is computed over the loaded page (needs per-session data),
// so its denominator can differ from the window-accurate `total`.
const bounceRate = computed(() => {
  const base = props.bounceBase ?? props.total;
  return base > 0 ? `${((props.bouncedSessions / base) * 100).toFixed(1)}%` : "0%";
});

const signed = (value: number, suffix = "") =>
  `${value > 0 ? "+" : ""}${value.toFixed(suffix === "%" ? 1 : 0)}${suffix}`;

/** Delta caption vs the previous window; null delta → fallback caption. */
const deltaCaption = (delta: number | null | undefined, fallback: string, suffix = "") => {
  if (delta === null || delta === undefined || delta === 0)
    return { caption: fallback, captionClass: "" };
  return {
    caption: `${signed(delta, suffix)} ${t("rum.vsPreviousPeriod")}`,
    // More sessions is neutral; more errors/frustration is bad, fewer is good.
    captionClass:
      suffix === "%"
        ? "text-text-secondary"
        : delta > 0
          ? "text-status-error-text"
          : "text-status-success-text",
  };
};

const cards = computed(() => [
  {
    key: "sessions" as const,
    label: t("rum.sessions"),
    value: props.total.toLocaleString(),
    valueClass: "text-text-body",
    rate: "",
    ...deltaCaption(props.sessionsDeltaPct, t("rum.inTimeRange"), "%"),
    selectable: true,
  },
  {
    key: "errors" as const,
    label: t("rum.withErrors"),
    value: props.errorSessions.toLocaleString(),
    valueClass: props.errorSessions > 0 ? "text-severity-error-color" : "text-text-body",
    rate: rate(props.errorSessions),
    ...deltaCaption(props.errorsDelta, t("rum.sessionsWithErrors")),
    selectable: true,
  },
  {
    key: "frustrated" as const,
    label: t("rum.frustrated"),
    value: props.frustratedSessions.toLocaleString(),
    valueClass: props.frustratedSessions > 0 ? "text-severity-warning-color" : "text-text-body",
    rate: rate(props.frustratedSessions),
    ...deltaCaption(props.frustratedDelta, t("rum.rageDeadClicks")),
    selectable: true,
  },
  {
    key: "duration" as const,
    label: t("rum.avgDuration"),
    value: formatMs(props.avgDurationMs),
    valueClass: "text-text-body",
    rate: "",
    caption: `${t("rum.median")} ${formatMs(props.medianDurationMs)}`,
    captionClass: "",
    selectable: false,
  },
  {
    key: "bounced" as const,
    label: t("rum.bounceRate"),
    value: bounceRate.value,
    valueClass: "text-text-body",
    rate: "",
    caption: t("rum.ofTotal", {
      count: props.bouncedSessions,
      total: props.bounceBase ?? props.total,
    }),
    captionClass: "",
    selectable: true,
  },
]);
</script>
