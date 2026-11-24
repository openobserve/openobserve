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

<!--
  DbmInstanceHealthCell — what the database server says about itself, beside
  what the applications experienced.

  Three rules decide everything this renders:

    • A connection COUNT answers nothing. "412 connections" is fine on one
      instance and an outage on the next, so the cell leads with the RATIO and
      keeps the raw pair behind it. Where no limit arrived it shows the count
      and says why there is no percentage — distinguishing an engine whose
      receiver publishes none (a MySQL instance without the setup card's
      limits recipe) from one whose limit metric simply did not arrive,
      because those are different fixes.

    • Every empty cell states a REASON. This column joins the address the
      client dialled to the host the collector scrapes, and behind a pooler
      those are different strings for the same database. A blank cell reads as
      "this product is broken"; a stated cause reads as "here is what to fix".

    • Replication lag carries its unit from the engine that reported it.
      Postgres sends BYTES of WAL and MySQL sends SECONDS behind the source
      under one role, so a shared formatter would print "4 KB behind" for a
      replica an hour out of date.

  The trend is why this is not four numbers on a list page: the question at 3am
  is whether connections climbed while latency did, and only a shape answers
  that.
-->
<template>
  <div
    class="flex min-h-9 min-w-0 flex-col items-start justify-center gap-0.5"
    :data-test="dataTest"
    :data-test-tone="tone"
    :data-test-unmatched="metrics.unmatchedReason ?? undefined"
  >
    <template v-if="hasReading">
      <!-- Status and its detail on the left; the trend on the right at full cell height, so the detail never wraps under it. -->
      <div class="flex w-full min-w-0 items-center gap-2">
        <div class="flex w-40 min-w-0 shrink-0 flex-col items-start gap-0.5">
          <OTag
            :variant="statusVariant"
            size="xs"
            shape="rounded"
            data-test="dbm-databases-health-status"
          >
            {{ statusLabel }}
          </OTag>
          <div
            v-if="issues.length"
            class="flex min-w-0 items-center gap-x-1 truncate text-xs"
            :class="isCritical ? 'text-status-error-text' : 'text-status-warning-text'"
            data-test="dbm-databases-health-issues"
          >
            <template v-for="(item, index) in issues" :key="item.id">
              <span v-if="index > 0" aria-hidden="true">{{ raw("·") }}</span>
              <span :data-test="`dbm-instance-health-${item.id}`">{{ item.label }}</span>
            </template>
          </div>
          <span v-else class="text-text-secondary text-xs" data-test="dbm-databases-health-fact">
            {{ inlineLabel }}
          </span>
        </div>
        <div v-if="hasTrend" class="w-24 shrink-0">
          <OSparkline
            :points="trendPoints"
            shape="area"
            :tone="tone"
            size="sm"
            :aria-label="t('dbm.instanceMetrics.trendLabel')"
            data-test="dbm-databases-health-trend"
          />
        </div>
      </div>

      <!-- The numbers live here, so the row stays calm. -->
      <OTooltip side="left">
        <template #content>
          <div
            class="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs"
            data-test="dbm-databases-health-tooltip"
          >
            <span class="text-text-secondary">{{ t("dbm.instanceMetrics.rowConnections") }}</span>
            <span class="text-right">{{ connectionsValue }}</span>
            <template v-if="metrics.cacheHitRatio !== null">
              <span class="text-text-secondary">{{ t("dbm.instanceMetrics.rowCacheHit") }}</span>
              <span
                class="text-right"
                :class="cacheIsIssue ? 'text-status-warning-text' : undefined"
                >{{ formatPercent(metrics.cacheHitRatio, 0) }}</span
              >
            </template>
            <template v-if="metrics.deadlocks !== null">
              <span class="text-text-secondary">{{ t("dbm.instanceMetrics.rowDeadlocks") }}</span>
              <span
                class="text-right"
                :class="metrics.deadlocks > 0 ? 'text-status-error-text' : undefined"
                >{{ metrics.deadlocks }}</span
              >
            </template>
            <span class="text-text-secondary">{{ t("dbm.instanceMetrics.lagLabel") }}</span>
            <span class="text-right">{{ lagValue }}</span>
            <span
              v-if="metrics.saturation.state === 'no-limit'"
              class="text-text-secondary col-span-2"
              >{{ noLimitHint }}</span
            >
          </div>
        </template>
      </OTooltip>
    </template>

    <!-- Nothing to show, and always a reason why — in the TOOLTIP, not on the
         row, so a fleet of dashes does not become one sentence repeated. -->
    <template v-else>
      <span
        class="text-text-muted text-xs"
        data-test="dbm-instance-health-reason"
        :data-test-reason-label="absence.label"
        >{{ raw("—") }}</span
      >
      <OTooltip side="left" :content="absenceTooltip" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { SparklinePoint } from "@/lib/data/Sparkline/OSparkline.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, formatLagBytes, formatLagSeconds, formatPercent } from "@/utils/dbm/format";
import type { DbmRowMetrics, DbmUnmatchedReason } from "@/utils/dbm/instanceMetrics";

const props = defineProps<{
  metrics: DbmRowMetrics;
  /** Which engine reported this row — it decides the lag unit and the copy. */
  engine: string;
  dataTest?: string;
}>();

const { t } = useI18nTyped();

/**
 * Where the row stops being ordinary. Postgres refuses connections at the
 * limit, and the last few are reserved for superusers, so the warning has to
 * arrive before the cliff rather than at it.
 */
const SATURATION_DANGER = 0.9;

/**
 * Engines whose RECEIVER publishes no connection limit. Kept for hint CHOICE
 * only: a MySQL row with no limit gets the "install the limits recipe" hint
 * (the setup card's sqlquery/mysql_limits fills `mysql_connection_max`), while
 * a Postgres row with no limit gets "your limit metric did not arrive" — the
 * receiver publishes one, so its absence is a delivery problem. A MySQL row
 * WHOSE LIMIT ARRIVED never reaches either hint: it renders the measured
 * ratio like any Postgres row.
 */
const ENGINES_WITHOUT_LIMIT = new Set(["mysql", "mariadb"]);

/**
 * Engines an OTel receiver recipe exists for — the set the metric catalog
 * (`DBM_INSTANCE_METRICS`) reads. MariaDB rides the mysql receiver.
 */
const SUPPORTED_METRIC_ENGINES = new Set(["postgresql", "mysql", "mariadb"]);

const tone = computed(() => {
  const ratio = props.metrics.saturation.ratio;
  return ratio !== null && ratio >= SATURATION_DANGER ? "danger" : "default";
});

const hasReading = computed(
  () =>
    props.metrics.saturation.state === "measured" || props.metrics.saturation.state === "no-limit",
);

// Gated on the same array `trendPoints` reads: the two must agree, or the
// sparkline could mount over points that cannot draw a line.
/** Two readings make a trend; one is a dot pretending to be a direction. */
const hasTrend = computed(() => props.metrics.connectionPoints.length > 1);

/**
 * The trend, with a break wherever the collector skipped a scrape. A line
 * drawn across a gap says the connections held steady through it, which is the
 * one thing an unobserved interval cannot tell us.
 */
const trendPoints = computed<SparklinePoint[]>(() => {
  const points = props.metrics.connectionPoints;
  if (points.length < 2) return points.map((point) => ({ value: point.value }));
  const gaps = points.slice(1).map((point, index) => point.timestamp - points[index].timestamp);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const out: SparklinePoint[] = [{ value: points[0].value }];
  points.slice(1).forEach((point, index) => {
    // More than double the usual spacing means at least one scrape is missing.
    if (typical > 0 && gaps[index] > typical * 2) out.push({ value: null });
    out.push({ value: point.value });
  });
  return out;
});

const connectionsValue = computed<I18nText>(() => {
  const { used, limit, ratio } = props.metrics.saturation;
  return limit === null || ratio === null
    ? raw(formatCount(used))
    : t("dbm.instanceMetrics.connectionsOfPercent", {
        used: formatCount(used),
        limit: formatCount(limit),
        percent: formatPercent(ratio, 0),
      });
});

const inlineLabel = computed<I18nText>(() =>
  props.metrics.saturation.ratio !== null
    ? t("dbm.instanceMetrics.connectionsIssue", {
        percent: formatPercent(props.metrics.saturation.ratio, 0),
      })
    : t("dbm.instanceMetrics.connectionsNoLimit", {
        used: formatCount(props.metrics.saturation.used),
      }),
);

/**
 * "The receiver publishes no limit — install the limits recipe" is true of a
 * MySQL row and false of a Postgres one, so saying it on a Postgres row whose
 * limit metric merely failed to arrive sends the reader to install something
 * that is not missing.
 */
const noLimitHint = computed<I18nText>(() =>
  ENGINES_WITHOUT_LIMIT.has(props.engine.toLowerCase())
    ? t("dbm.instanceMetrics.noLimitHint")
    : t("dbm.instanceMetrics.limitUnknownHint"),
);

/**
 * Each cause names a different fix, so none may collapse into a generic "no
 * data": a pooler is a topology fact, a loopback is a naming artifact of the
 * collector, a missing receiver is a setup step, an unreadable stream is a
 * permission, and a matched instance with no reading is a metric nobody
 * switched on.
 */
// Resolved INSIDE the computed, not in a module-level table: `t()` captured at
// setup freezes the string, so a locale change would leave this cell in the
// previous language while the labels around it updated.
const absence = computed<{ label: I18nText; hint: I18nText }>(() => {
  const copy: Record<DbmUnmatchedReason, { label: I18nText; hint: I18nText }> = {
    pooler: {
      label: t("dbm.instanceMetrics.unmatched.pooler"),
      hint: t("dbm.instanceMetrics.unmatched.poolerHint"),
    },
    loopback: {
      label: t("dbm.instanceMetrics.unmatched.loopback"),
      hint: t("dbm.instanceMetrics.unmatched.loopbackHint"),
    },
    // "No metrics for this engine" said the same thing to a MySQL fleet
    // missing its receiver (a config step away from data) and to Redis (no
    // receiver recipe exists — nothing to add). One is an instruction, the
    // other is a disclosure, and collapsing them sent Redis users hunting for
    // a receiver they cannot install. MariaDB gets its own instruction: no
    // mariadb receiver exists to add — the fix is pointing the MYSQL receiver
    // at it, and "add the mariadb receiver" would send the reader hunting for
    // a component that is not in the collector.
    "no-receiver":
      props.engine.toLowerCase() === "mariadb"
        ? {
            label: t("dbm.instanceMetrics.unmatched.noReceiver", { engine: props.engine }),
            hint: t("dbm.instanceMetrics.unmatched.noReceiverMariadbHint"),
          }
        : SUPPORTED_METRIC_ENGINES.has(props.engine.toLowerCase())
          ? {
              label: t("dbm.instanceMetrics.unmatched.noReceiver", { engine: props.engine }),
              hint: t("dbm.instanceMetrics.unmatched.noReceiverHint", { engine: props.engine }),
            }
          : {
              label: t("dbm.instanceMetrics.unmatched.engineUnsupported", { engine: props.engine }),
              hint: t("dbm.instanceMetrics.unmatched.engineUnsupportedHint", {
                engine: props.engine,
              }),
            },
    unreadable: {
      label: t("dbm.instanceMetrics.unmatched.unreadable"),
      hint: t("dbm.instanceMetrics.unmatched.unreadableHint"),
    },
  };
  if (props.metrics.unmatchedReason) return copy[props.metrics.unmatchedReason];
  return {
    label: t("dbm.instanceMetrics.noReading"),
    hint: t("dbm.instanceMetrics.noReadingHint"),
  };
});

// One tooltip string: the cause, then what to do about it. Both halves are
// already-translated `I18nText`; the join widens to `string`, so `raw()` marks
// the composition — the em dash is punctuation, not untranslated copy.
const absenceTooltip = computed<I18nText>(() =>
  raw(`${absence.value.label} — ${absence.value.hint}`),
);

/** Below this, the database is going to disk for most of its reads. */
const CACHE_HIT_POOR = 0.9;

const cacheLabel = computed<I18nText>(() =>
  t("dbm.instanceMetrics.cacheHit", { percent: formatPercent(props.metrics.cacheHitRatio, 0) }),
);

const lagValue = computed<string>(() => {
  const lag = props.metrics.replicationLag;
  if (lag === null) return "—";
  return lag.unit === "seconds" ? formatLagSeconds(lag.value) : formatLagBytes(lag.value);
});

const cacheIsIssue = computed(
  () => props.metrics.cacheHitRatio !== null && props.metrics.cacheHitRatio < CACHE_HIT_POOR,
);

const deadlocksLabel = computed<I18nText>(() =>
  t(
    "dbm.instanceMetrics.deadlocks",
    { count: props.metrics.deadlocks ?? 0 },
    props.metrics.deadlocks ?? 0,
  ),
);

/**
 * What is wrong, from the same colour rules this cell always used: connections
 * at the danger line and deadlocks are errors, a poor cache hit is a warning.
 * Replication lag has no threshold, so it is never an issue.
 */
const issues = computed(() => {
  const items: { id: string; label: I18nText; severity: "error" | "warning" }[] = [];
  const { cacheHitRatio, deadlocks, saturation } = props.metrics;
  if (saturation.ratio !== null && saturation.ratio >= SATURATION_DANGER) {
    items.push({
      id: "connections",
      label: t("dbm.instanceMetrics.connectionsIssue", {
        percent: formatPercent(saturation.ratio, 0),
      }),
      severity: "error",
    });
  }
  if (cacheHitRatio !== null && cacheHitRatio < CACHE_HIT_POOR) {
    items.push({ id: "cache", label: cacheLabel.value, severity: "warning" });
  }
  if (deadlocks !== null && deadlocks > 0) {
    items.push({ id: "deadlocks", label: deadlocksLabel.value, severity: "error" });
  }
  return items;
});

const isCritical = computed(() => issues.value.some((item) => item.severity === "error"));

const statusVariant = computed(() =>
  isCritical.value ? "error-soft" : issues.value.length ? "warning-soft" : "success-soft",
);

const statusLabel = computed<I18nText>(() => {
  if (!issues.value.length) return t("dbm.instanceMetrics.status.healthy");
  const word = isCritical.value
    ? t("dbm.instanceMetrics.status.critical")
    : t("dbm.instanceMetrics.status.warning");
  const count = issues.value.length;
  return raw(`${word} · ${t("dbm.instanceMetrics.status.issues", { count }, count)}`);
});
</script>
