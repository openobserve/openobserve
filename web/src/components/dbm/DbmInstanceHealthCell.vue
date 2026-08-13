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
    class="flex min-w-0 flex-col items-end gap-0.5"
    :data-test="dataTest"
    :data-test-tone="tone"
    :data-test-unmatched="metrics.unmatchedReason ?? undefined"
  >
    <template v-if="metrics.saturation.state === 'measured'">
      <div class="flex items-center gap-1.5">
        <OSparkline
          v-if="hasTrend"
          :points="trendPoints"
          shape="area"
          :tone="tone"
          size="xs"
          :aria-label="t('dbm.instanceMetrics.trendLabel')"
          data-test="dbm-instance-health-trend"
        />
        <span class="font-mono text-xs font-medium tabular-nums" :class="ratioToneClass">
          {{ formatPercent(metrics.saturation.ratio, 0) }}
        </span>
      </div>
      <span class="text-text-label text-3xs font-mono tabular-nums">
        {{ connectionsLabel }}
      </span>
    </template>

    <!-- A count with no denominator. Shown, but never as a share of anything. -->
    <template v-else-if="metrics.saturation.state === 'no-limit'">
      <div class="flex items-center gap-1.5">
        <OSparkline
          v-if="hasTrend"
          :points="trendPoints"
          shape="area"
          tone="default"
          size="xs"
          :aria-label="t('dbm.instanceMetrics.trendLabel')"
          data-test="dbm-instance-health-trend"
        />
        <span class="text-text-body font-mono text-xs tabular-nums">
          {{ formatCount(metrics.saturation.used) }}
        </span>
      </div>
      <span class="text-text-label text-3xs">{{ connectionsLabel }}</span>
      <OTooltip side="left" :content="noLimitHint" />
    </template>

    <!-- Nothing to show, and always a reason why — in the TOOLTIP, not on the
         row. A visible sentence under every dash would, on the common fleets
         (a pooler, one engine with no receiver), turn the whole column into
         one truncated sentence repeated per row: noise wearing the costume of
         honesty. The dash keeps the per-row hover explanation, and the column
         header's own hint carries the fresh-install story once. -->
    <template v-else>
      <span
        class="text-text-muted font-mono text-xs"
        data-test="dbm-instance-health-reason"
        :data-test-reason-label="absence.label"
        >{{ raw("—") }}</span
      >
      <OTooltip side="left" :content="absenceTooltip" />
    </template>

    <!-- The rest of what the receiver sent. Each appears only when it says
         something: a cache ratio nobody measured, a replica with no lag metric
         and a database with no deadlocks are all silence, not zeroes. -->
    <div
      v-if="secondary.length"
      class="text-text-label text-3xs flex flex-wrap items-center justify-end gap-1.5"
    >
      <span
        v-for="item in secondary"
        :key="item.id"
        :class="item.tone"
        :data-test="`dbm-instance-health-${item.id}`"
      >
        {{ item.label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OSparkline from "@/lib/data/Sparkline/OSparkline.vue";
import type { SparklinePoint } from "@/lib/data/Sparkline/OSparkline.types";
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

const ratioToneClass = computed(() =>
  tone.value === "danger" ? "text-status-error-text" : "text-text-heading",
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

const connectionsLabel = computed<I18nText>(() =>
  props.metrics.saturation.limit === null
    ? t("dbm.instanceMetrics.connectionsNoLimit", {
        used: formatCount(props.metrics.saturation.used),
      })
    : t("dbm.instanceMetrics.connectionsOf", {
        used: formatCount(props.metrics.saturation.used),
        limit: formatCount(props.metrics.saturation.limit),
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
 * permission, a matched instance with no reading is a metric nobody switched
 * on, and the join being off is a setting on THIS product rather than anything
 * wrong with the database at all.
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
    // a receiver they cannot install.
    "no-receiver": SUPPORTED_METRIC_ENGINES.has(props.engine.toLowerCase())
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
  // The join was never switched on, so nothing was read and there is nothing
  // to blame. This is the state EVERY row is in on a fresh install — the knob
  // is off by default — which is why the column stands here saying it rather
  // than being hidden: a column that disappears reads as a feature nobody
  // built, and an em dash with no sentence reads as one that is broken. The
  // hint names the setting, because an empty state that cannot be acted on is
  // just a nicer blank.
  if (props.metrics.state === "disabled") {
    return {
      label: t("dbm.instanceMetrics.disabled"),
      hint: t("dbm.instanceMetrics.disabledHint"),
    };
  }
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

/**
 * Cache hit, replication lag and deadlocks. Each is read from its own stream
 * and each is opt-in upstream, so most rows show none of them — which is why
 * they are a wrapping list rather than three fixed slots.
 */
const secondary = computed(() => {
  const items: { id: string; label: I18nText; tone: string }[] = [];
  const { cacheHitRatio, replicationLag, deadlocks } = props.metrics;

  if (cacheHitRatio !== null) {
    items.push({
      id: "cache",
      label: t("dbm.instanceMetrics.cacheHit", { percent: formatPercent(cacheHitRatio, 0) }),
      // A database reading most of its blocks from disk is the finding here.
      tone: cacheHitRatio < CACHE_HIT_POOR ? "text-status-warning-text" : "",
    });
  }
  if (replicationLag !== null) {
    items.push({
      id: "lag",
      label:
        replicationLag.unit === "seconds"
          ? t("dbm.instanceMetrics.lagSeconds", { value: formatLagSeconds(replicationLag.value) })
          : t("dbm.instanceMetrics.lagBytes", { value: formatLagBytes(replicationLag.value) }),
      tone: "",
    });
  }
  // Zero deadlocks is the ordinary state of a healthy database, and a chip on
  // every row is noise rather than signal.
  if (deadlocks !== null && deadlocks > 0) {
    items.push({
      id: "deadlocks",
      label: t("dbm.instanceMetrics.deadlocks", { count: deadlocks }, deadlocks),
      tone: "text-status-error-text",
    });
  }
  return items;
});
</script>
