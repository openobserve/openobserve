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

<!-- DbmCoverageLine: a banner shown only when counting is behind, missing data, truncated or the scope is narrowed. -->
<template>
  <OBanner v-if="entry" variant="warning" icon="warning-amber" bar dense data-test="dbm-coverage">
    <span data-test="dbm-coverage-text">{{ entry.short }}</span>
    <template #actions>
      <!-- The long sentence lives here so the banner stays one line. -->
      <OPopover side="bottom" align="end">
        <template #trigger>
          <OButton variant="ghost" size="xs" data-test="dbm-coverage-details">
            {{ t("dbm.coverage.details") }}
          </OButton>
        </template>
        <p class="text-text-body max-w-80 p-3 text-sm" data-test="dbm-coverage-detail-text">
          {{ entry.long }}
        </p>
      </OPopover>
    </template>
  </OBanner>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { Freshness, QueryStatsRow } from "@/services/db_monitoring";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatPercent } from "@/utils/dbm/format";

const props = withDefaults(
  defineProps<{
    /** The response's `freshness` block. */
    freshness?: Freshness | null;
    /** Rows currently shown — their `total_time_ns` is the accounted-for share. */
    hits?: Pick<QueryStatsRow, "total_time_ns">[];
    /** The remainder bucket the response returns alongside the listed rows. */
    other?: Pick<QueryStatsRow, "total_time_ns">[];
    /** The response's `top_n_subset` marker. */
    topNSubset?: boolean;
    /** Errors carrying a driver status code, over all errors, `0`–`1`. */
    codedErrorShare?: number;
    /** Total failures in scope, so the uncoded-failures line has a denominator. */
    errorCount?: number;
    /** A scope filter narrowing the page, named in plain words ("checkout-service"). */
    filterLabel?: string | null;
    /** The selected window, microseconds; a data gap is counted only inside it. */
    windowStart?: number;
    windowEnd?: number;
  }>(),
  {
    hits: () => [],
    other: () => [],
    topNSubset: false,
    filterLabel: null,
  },
);

const { t } = useI18nTyped();

const MINUTE_MS = 60_000;
const MIN_US = 60_000_000;
/** Beyond this our counting is behind far enough to change what a chart shows. */
const STALE_MINUTES = 30;
/** The two gap boundaries come from different clocks, so nothing under one aggregation interval is a real stall. */
const GAP_TOLERANCE_US = 60_000_000;

/** `0` = we have never finished counting, which is distinct from "behind". */
const neverAggregated = computed(() => !!props.freshness && props.freshness.data_through === 0);

const behindMinutes = computed(() => {
  const through = props.freshness?.data_through ?? 0;
  if (through <= 0) return null;
  return Math.max(0, Math.round((Date.now() - through / 1000) / MINUTE_MS));
});

/** The uncovered stretch, clipped to the selected window so minutes outside it are not counted. */
const gap = computed<{ from: number; to: number; minutes: number } | null>(() => {
  const f = props.freshness;
  if (!f || f.tail_covers_from === null || f.data_through === 0) return null;
  if (f.tail_covers_from - f.data_through <= GAP_TOLERANCE_US) return null;
  const from = Math.max(f.data_through, props.windowStart ?? f.data_through);
  const to = Math.min(f.tail_covers_from, props.windowEnd ?? f.tail_covers_from);
  // Rounded DOWN: rounding up would overstate the outage.
  const minutes = Math.floor((to - from) / MIN_US);
  return minutes >= 1 ? { from, to, minutes } : null;
});

const isStale = computed(() => (behindMinutes.value ?? 0) > STALE_MINUTES);
const truncated = computed(() => !!props.freshness?.tail_truncated);

/** No rows at all: the empty state explains, so a banner over an empty table would be a false alarm. */
const isEmpty = computed(() => !props.hits.length && !props.other.length);

/** Failures the driver gave us no reason code for. */
const uncodedErrorShare = computed(() => {
  if (props.codedErrorShare === undefined || (props.errorCount ?? 0) <= 0) return null;
  const uncoded = 1 - props.codedErrorShare;
  return uncoded > 0 ? uncoded : null;
});

/** Time of day, with the date when it is not today: "13:00", "yesterday 23:30", "Nov 22, 23:30". */
const dayOffset = (us: number) => {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(us / 1000))) / 86_400_000);
};
const clock = (us: number) =>
  new Date(us / 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const stamp = (us: number) => {
  const days = dayOffset(us);
  if (days === 0) return clock(us);
  if (days === 1) return t("dbm.coverage.bannerYesterday", { time: clock(us) });
  const date = new Date(us / 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date}, ${clock(us)}`;
};

/** A range that crosses midnight names both days, or "yesterday 19:00 to 04:09" reads backwards. */
const spanEnd = (us: number) =>
  dayOffset(us) === 0 ? t("dbm.coverage.bannerToday", { time: clock(us) }) : stamp(us);

/** Minutes up to an hour, then hours, then days from 48 h, so "2400 min" reads as "40 hours". */
const lagText = (minutes: number, short: boolean): I18nText => {
  const suffix = short ? "Short" : "";
  if (minutes <= 60) return t(`dbm.coverage.lagMinutes${suffix}`, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t(`dbm.coverage.lagHours${suffix}`, { n: hours });
  return t(`dbm.coverage.lagDays${suffix}`, { n: Math.round(hours / 24) });
};

interface CoverageEntry {
  short: I18nText;
  long: I18nText;
}

/** The most-degrading warning, most-degrading first; `null` = nothing to warn about. */
const entry = computed<CoverageEntry | null>(() => {
  const mk = (short: I18nText, long: I18nText = short): CoverageEntry => ({ short, long });
  if (isEmpty.value) return null;
  const lagLong = lagText(behindMinutes.value ?? 0, false);
  const lagShort = lagText(behindMinutes.value ?? 0, true);
  const stale = isStale.value;
  if (neverAggregated.value) {
    return mk(t("dbm.coverage.bannerNeverAggregated"), t("dbm.freshness.neverAggregated"));
  }
  const g = gap.value;
  if (g) {
    const f = props.freshness;
    const reach = Math.max(1, Math.floor(((f?.tail_through ?? g.to) - g.to) / MIN_US));
    const today = dayOffset(g.from) === 0 && dayOffset(g.to) === 0;
    return mk(
      today
        ? t("dbm.coverage.bannerGapToday", {
            from: clock(g.from),
            to: clock(g.to),
            minutes: g.minutes,
          })
        : t("dbm.coverage.bannerGap", {
            from: spanEnd(g.from),
            to: spanEnd(g.to),
            minutes: g.minutes,
          }),
      t("dbm.coverage.lineGap", {
        minutes: g.minutes,
        stopped: clock(g.from),
        reach,
        from: clock(g.from),
        to: clock(g.to),
      }),
    );
  }
  // A filter must never EVICT the staleness warning, so both share one entry.
  if (props.filterLabel) {
    return stale
      ? mk(
          t("dbm.coverage.bannerStale", { lag: lagShort }),
          t("dbm.coverage.lineSubsetStale", { filter: props.filterLabel, lag: lagLong }),
        )
      : null;
  }
  if (props.topNSubset) {
    return stale
      ? mk(
          t("dbm.coverage.bannerStale", { lag: lagShort }),
          t("dbm.coverage.lineSubsetUnnamedStale", { lag: lagLong }),
        )
      : null;
  }
  // Same rule: a truncated tail must not evict the staleness warning.
  if (truncated.value) {
    return stale
      ? mk(
          t("dbm.coverage.bannerTruncatedStale", { lag: lagShort }),
          t("dbm.coverage.lineTruncatedStale", { lag: lagLong }),
        )
      : mk(t("dbm.coverage.bannerTruncated"), t("dbm.coverage.lineTruncated"));
  }
  if (stale) {
    return mk(
      t("dbm.coverage.bannerStale", { lag: lagShort }),
      t("dbm.coverage.lineStale", { lag: lagLong }),
    );
  }
  if (uncodedErrorShare.value !== null) {
    const percent = formatPercent(uncodedErrorShare.value, 0);
    return mk(
      t("dbm.coverage.bannerUncodedErrors", { percent }),
      t("dbm.coverage.lineUncodedErrors", { percent }),
    );
  }
  return null;
});
</script>
