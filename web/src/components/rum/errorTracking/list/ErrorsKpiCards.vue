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
    class="grid grid-cols-2 gap-2 h-full"
    data-test="rum-errors-kpi-cards"
    :aria-label="t('rum.errorKpisAria')"
  >
    <article
      v-for="card in cards"
      :key="card.key"
      class="bg-card-glass-bg flex flex-col items-start rounded-default border border-border-default px-2.5 py-1.5 min-w-0"
      :data-test="`rum-errors-kpi-${card.key}-card`"
    >
      <span
        class="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-label"
      >
        {{ card.label }}
        <OTag
          v-if="card.badge"
          :label="card.badge.label"
          :variant="card.badge.variant"
          size="xs"
          data-test="rum-errors-kpi-crash-free-badge"
        />
      </span>

      <OSkeleton v-if="loading" variant="title" class="w-16" />
      <span
        v-else
        class="text-xl font-semibold tabular-nums"
        :class="card.valueClass"
        :data-test="`rum-errors-kpi-${card.key}-value`"
        >{{ card.value }}</span
      >

      <small
        v-if="!loading"
        :data-test="`rum-errors-kpi-${card.key}-caption`"
        >{{ card.caption }}</small
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

export interface ErrorKpis {
  totalErrors: number;
  uniqueIssues: number;
  issuesTruncated: boolean;
  errorSessions: number;
  totalSessions: number;
  crashFreePct: number | null;
  usersAffected: number;
  totalUsers: number;
  newIssues: number;
  deployVersion: string | null;
}

const props = defineProps<{
  kpis: ErrorKpis;
  loading?: boolean;
}>();

const { t } = useI18n();

// Session-health thresholds, in percent crash-free.
const CRASH_FREE_FAIR_MIN = 95;
const CRASH_FREE_GOOD_MIN = 99;

const crashFreeBadge = computed(() => {
  const pct = props.kpis.crashFreePct;
  if (pct === null) return null;
  if (pct < CRASH_FREE_FAIR_MIN) {
    return { label: t("rum.ratingPoor"), variant: "error-soft" as const };
  }
  if (pct < CRASH_FREE_GOOD_MIN) {
    return { label: t("rum.ratingFair"), variant: "warning-soft" as const };
  }
  return { label: t("rum.ratingGood"), variant: "success-soft" as const };
});

const cards = computed(() => {
  const kpis = props.kpis;
  const uniqueIssues = `${addCommasToNumber(kpis.uniqueIssues)}${
    kpis.issuesTruncated ? "+" : ""
  }`;
  const usersPct =
    kpis.totalUsers > 0
      ? Math.round((kpis.usersAffected / kpis.totalUsers) * 100)
      : 0;
  return [
    {
      key: "total-errors",
      label: t("rum.totalErrors"),
      value: formatLargeNumber(kpis.totalErrors),
      valueClass: "",
      caption: t("rum.acrossUniqueIssues", { count: uniqueIssues }),
      badge: null,
    },
    {
      key: "crash-free",
      label: t("rum.crashFreeSessions"),
      value:
        kpis.crashFreePct === null ? "—" : `${kpis.crashFreePct.toFixed(1)}%`,
      valueClass:
        kpis.crashFreePct !== null && kpis.crashFreePct < CRASH_FREE_FAIR_MIN
          ? "text-severity-error-color"
          : "",
      caption: t("rum.sessionsHitError", {
        errorSessions: addCommasToNumber(kpis.errorSessions),
        totalSessions: addCommasToNumber(kpis.totalSessions),
      }),
      badge: crashFreeBadge.value,
    },
    {
      key: "users-affected",
      label: t("rum.usersAffected"),
      value: formatLargeNumber(kpis.usersAffected),
      valueClass: "",
      caption: t("rum.ofActiveUsers", {
        total: addCommasToNumber(kpis.totalUsers),
        pct: usersPct,
      }),
      badge: null,
    },
    {
      key: "new-issues",
      label: t("rum.newIssues"),
      value: String(kpis.newIssues),
      valueClass:
        kpis.newIssues > 0 ? "text-severity-error-color" : "",
      caption: kpis.deployVersion
        ? t("rum.firstSeenSinceDeploy", { version: kpis.deployVersion })
        : t("rum.firstSeenInWindow"),
      badge: null,
    },
  ];
});
</script>
