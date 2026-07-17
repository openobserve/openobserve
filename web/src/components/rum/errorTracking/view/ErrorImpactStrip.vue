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
    class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2"
    data-test="error-impact-strip"
    :aria-label="t('rum.impactMetricsAria')"
  >
    <article
      v-for="tile in tiles"
      :key="tile.key"
      class="card-container flex flex-col items-start rounded-lg border border-border-default px-2.5 py-1.5 min-w-0"
      :data-test="`error-impact-${tile.key}-tile`"
    >
      <span
        class="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-[var(--o2-text-label)]"
      >
        {{ tile.label }}
        <OTag
          v-if="tile.badge"
          :label="tile.badge.label"
          :variant="tile.badge.variant"
          size="xs"
          :data-test="`error-impact-${tile.key}-badge`"
        />
      </span>

      <OSkeleton v-if="loading" variant="title" class="w-16" />
      <span
        v-else
        class="font-semibold tabular-nums truncate max-w-full"
        :class="[tile.valueClass, tile.small ? 'text-base' : 'text-xl']"
        :title="tile.title || tile.value"
        :data-test="`error-impact-${tile.key}-value`"
        >{{ tile.value }}</span
      >

      <small
        v-if="!loading && tile.caption"
        :class="tile.captionClass"
        :data-test="`error-impact-${tile.key}-caption`"
        >{{ tile.caption }}</small
      >
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { addCommasToNumber, formatLargeNumber } from "@/utils/formatters";
import { formatRelativeTime } from "@/utils/rum/errorIssueUtils";

export interface ErrorImpactMetrics {
  occurrences: number;
  usersAffected: number;
  totalUsers: number;
  sessionsAffected: number;
  crashFreePct: number | null;
  /** First / last seen, microsecond timestamps. */
  firstSeen: number;
  lastSeen: number;
  status: "new" | "ongoing";
}

const props = defineProps<{
  metrics: ErrorImpactMetrics;
  /** Post-deploy spike ratio (>= 1.5) or null — annotates occurrences. */
  spikeFactor?: number | null;
  /** Release the error was captured in, shown under "first seen". */
  release?: string | null;
  loading?: boolean;
}>();

const { t } = useI18n();

// Session-health thresholds, in percent crash-free (mirrors ErrorsKpiCards).
const CRASH_FREE_FAIR_MIN = 95;
const CRASH_FREE_GOOD_MIN = 99;

const crashFreeBadge = computed(() => {
  const pct = props.metrics.crashFreePct;
  if (pct === null) return null;
  if (pct < CRASH_FREE_FAIR_MIN) {
    return { label: t("rum.ratingPoor"), variant: "error-soft" as const };
  }
  if (pct < CRASH_FREE_GOOD_MIN) {
    return { label: t("rum.ratingFair"), variant: "warning-soft" as const };
  }
  return { label: t("rum.ratingGood"), variant: "success-soft" as const };
});

// "Still active" when the last occurrence is within the last hour.
const ONE_HOUR_US = 60 * 60 * 1_000_000;
const isActive = computed(
  () =>
    props.metrics.lastSeen > 0 &&
    Date.now() * 1000 - props.metrics.lastSeen < ONE_HOUR_US,
);

const tiles = computed(() => {
  const m = props.metrics;
  const usersPct =
    m.totalUsers > 0 ? Math.round((m.usersAffected / m.totalUsers) * 100) : 0;
  const spike =
    props.spikeFactor && props.spikeFactor >= 1.5
      ? t("rum.spikeVsBaseline", { factor: props.spikeFactor.toFixed(1) })
      : "";

  return [
    {
      key: "occurrences",
      label: t("rum.occurrences"),
      value: formatLargeNumber(m.occurrences),
      title: addCommasToNumber(m.occurrences),
      valueClass: "text-[var(--o2-severity-error-color)]",
      caption: spike,
      captionClass: "font-semibold text-[var(--o2-severity-error-color)]",
      small: false,
      badge: null,
    },
    {
      key: "users-affected",
      label: t("rum.usersAffected"),
      value: formatLargeNumber(m.usersAffected),
      title: addCommasToNumber(m.usersAffected),
      valueClass: "",
      caption:
        m.totalUsers > 0
          ? t("rum.ofActiveUsers", {
              total: addCommasToNumber(m.totalUsers),
              pct: usersPct,
            })
          : "",
      captionClass: "",
      small: false,
      badge: null,
    },
    {
      key: "crash-free",
      label: t("rum.crashFreeSessions"),
      value: m.crashFreePct === null ? "—" : `${m.crashFreePct.toFixed(1)}%`,
      valueClass:
        m.crashFreePct !== null && m.crashFreePct < CRASH_FREE_FAIR_MIN
          ? "text-[var(--o2-severity-error-color)]"
          : "",
      caption: t("rum.impactedSessions", {
        count: addCommasToNumber(m.sessionsAffected),
      }),
      captionClass: "",
      small: false,
      badge: crashFreeBadge.value,
    },
    {
      key: "sessions",
      label: t("rum.impactedSessionsLabel"),
      value: formatLargeNumber(m.sessionsAffected),
      title: addCommasToNumber(m.sessionsAffected),
      valueClass: "",
      caption: "",
      captionClass: "",
      small: false,
      badge: null,
    },
    {
      key: "first-seen",
      label: t("rum.firstSeen"),
      value: formatRelativeTime(m.firstSeen) || "—",
      valueClass: "",
      caption: props.release ? t("rum.inRelease", { version: props.release }) : "",
      captionClass: "",
      small: true,
      badge: null,
    },
    {
      key: "last-seen",
      label: t("rum.lastSeen"),
      value: formatRelativeTime(m.lastSeen) || "—",
      valueClass: "",
      caption: isActive.value ? t("rum.stillActive") : "",
      captionClass: isActive.value
        ? "text-[var(--o2-severity-error-color)]"
        : "",
      small: true,
      badge: null,
    },
  ];
});
</script>
