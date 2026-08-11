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
  DbmCoverageLine — how much of this database's time you are actually looking
  at, as ONE quiet line.

  Two rules it holds to:

  1. QUIET WHEN FINE. A permanent row of qualifier chips ("estimated", "live",
     "traces ~") fires on nearly every view, so it reads as a standing warning
     that says neither what is wrong nor why to care — and costs the table its
     space to say nothing. Healthy is one grey sentence. Colour appears only
     when something actually changes how the numbers should be read: a genuine
     uncovered gap (red — data is MISSING), or a reading caveat (amber — read
     this differently).

  2. ONE state, never an inventory. The reader needs the worst problem, not a
     list. `summary` returns the most degrading sentence only, and every
     sentence carries a number — a caveat with a number attached is a
     disclosure; one without is a disclaimer nobody reads.

  No term of art survives. "The 200 heaviest kinds of query" rather than
  "top-N"; "still coming in" rather than "live tail"; "close, not exact" rather
  than "estimated".
-->
<template>
  <div class="flex flex-col" data-test="dbm-coverage">
    <!-- The line itself. `min-h-6.5` holds the 26px budget the space plan
         allocates it, so a healthy page spends no more than that. -->
    <div
      class="px-page-edge flex min-h-[1.625rem] min-w-0 items-center gap-2 py-1"
      :class="toneSurface"
      data-test="dbm-coverage-line"
    >
      <span class="size-1.5 shrink-0 rounded-full" :class="dotTone" aria-hidden="true"></span>

      <span class="text-2xs min-w-0 truncate" :class="toneText" data-test="dbm-coverage-text">
        {{ summary }}
      </span>

      <!-- The bar is the same claim as the number beside it, drawn. It appears
           only when there IS a share to draw. -->
      <span
        v-if="showBar"
        class="bg-surface-subtle h-1 w-12 shrink-0 overflow-hidden rounded-full"
        data-test="dbm-coverage-bar"
      >
        <span
          class="block h-full rounded-full"
          :class="barTone"
          :style="{ width: barWidth }"
        ></span>
      </span>

      <template v-if="countedTo">
        <span class="text-text-muted text-2xs shrink-0" aria-hidden="true">·</span>
        <span class="text-2xs shrink-0" :class="toneText">{{ countedTo }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import type { Freshness, QueryStatsRow } from "@/services/db_monitoring";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount, formatPercent } from "@/utils/dbm/format";

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
    /** How many rows the server ranks individually, for the plain sentence. */
    trackedCount?: number;
    /** Errors carrying a driver status code, over all errors, `0`–`1`. */
    codedErrorShare?: number;
    /** Total failures in scope, so the uncoded-failures line has a denominator. */
    errorCount?: number;
    /**
     * A scope filter narrowing the page, named in plain words ("checkout-service").
     * Set only when the reader should know the percentages describe a subset.
     */
    filterLabel?: string | null;
    /**
     * This grain measures every call rather than ranking a subset, so it can
     * speak about the whole database. Whether the SPEEDS are exact is a
     * separate question the response answers via `percentiles_estimated`.
     */
    exactPercentiles?: boolean;
    /**
     * What these rows ARE. `list` (default) is a ranked table, where the share
     * of total time is the headline claim. `query` is one statement, where that
     * claim would be nonsense and the honest thing to report is how the
     * measurement was taken.
     */
    subject?: "list" | "query";
  }>(),
  {
    hits: () => [],
    other: () => [],
    topNSubset: false,
    exactPercentiles: false,
    filterLabel: null,
    subject: "list",
  },
);

const { t } = useI18nTyped();

const MINUTE_MS = 60_000;
/** Beyond this our counting is behind far enough to change what a chart shows. */
const STALE_MINUTES = 30;
/**
 * Beyond this the "the last half-minute is still coming in" trailer is no longer
 * true, so the line reports the real lag instead. Well under {@link STALE_MINUTES}
 * on purpose: this is not a second staleness threshold, it is the point past
 * which the EXISTING sentence stops being honest. A rollup that has merely not
 * fired yet leaves a few minutes of lag on a healthy page, so the floor sits
 * above that rather than correcting a page that is fine.
 */
const BEHIND_NOTE_MINUTES = 4;
/**
 * A remainder under this does not change how any row's share reads. Above it,
 * "31% of database time" is measured against a total with a meaningful unshown
 * part, and the reader should know before acting on the number.
 */
const NOISY_REMAINDER = 0.2;

const sumTime = (rows: Pick<QueryStatsRow, "total_time_ns">[]) =>
  rows.reduce((acc, row) => acc + (row.total_time_ns ?? 0), 0);

const shownTime = computed(() => sumTime(props.hits));
const otherTime = computed(() => sumTime(props.other));
const totalTime = computed(() => shownTime.value + otherTime.value);

const coverage = computed(() => (totalTime.value > 0 ? shownTime.value / totalTime.value : null));

const pct = (part: number) =>
  totalTime.value > 0 ? Math.round((part / totalTime.value) * 100) : 0;

/** `0` = we have never finished counting, which is distinct from "behind". */
const neverAggregated = computed(() => !!props.freshness && props.freshness.data_through === 0);

const behindMinutes = computed(() => {
  const through = props.freshness?.data_through ?? 0;
  if (through <= 0) return null;
  return Math.max(0, Math.round((Date.now() - through / 1000) / MINUTE_MS));
});

/**
 * The genuine coverage gap: counting stalled beyond the reach of the most
 * recent stretch, so part of the range is covered by nothing at all. This is
 * the ONLY state that earns red, because it is the only one where data is
 * missing rather than merely qualified — which is exactly why it needs a
 * tolerance.
 *
 * The two boundaries are produced by different clocks a few seconds apart, so a
 * strict `>` fires on a routine skew of a few seconds and renders it as "1
 * minutes are missing" — crying wolf in red on a healthy page, and rounding a
 * 10-second overlap up to a whole minute while doing it. Nothing shorter than
 * one aggregation interval can be a real stall, so that is the floor.
 */
const GAP_TOLERANCE_US = 60_000_000;

const hasGap = computed(() => {
  const f = props.freshness;
  if (!f || f.tail_covers_from === null || f.data_through === 0) return false;
  return f.tail_covers_from - f.data_through > GAP_TOLERANCE_US;
});

const isStale = computed(() => (behindMinutes.value ?? 0) > STALE_MINUTES);
const bigRemainder = computed(
  () => coverage.value !== null && 1 - coverage.value >= NOISY_REMAINDER,
);
const truncated = computed(() => !!props.freshness?.tail_truncated);

/**
 * The server fused speeds across stretches of time by weighting them per call,
 * which averages rather than re-measures. Any sentence below claiming exactness
 * has to answer to this, or the page contradicts the summary copied off it.
 */
const estimatedSpeeds = computed(() => !!props.freshness?.percentiles_estimated);

/**
 * No rows at all. Every qualifier below describes rows the reader can see, so
 * with none of them on screen the whole apparatus has nothing to qualify —
 * and a red "data is missing" banner over an empty table caused by a search
 * term is the worst kind of false alarm.
 */
const isEmpty = computed(() => !props.hits.length && !props.other.length);

/**
 * Failures the driver gave us no reason code for. This one earns a place in the
 * summary chain because an empty Failed column otherwise cannot be told apart
 * from "we could not tell" — and unlike the structural caveats it disappears the
 * moment every failure is explained.
 */
const uncodedErrorShare = computed(() => {
  if (props.codedErrorShare === undefined || (props.errorCount ?? 0) <= 0) return null;
  const uncoded = 1 - props.codedErrorShare;
  return uncoded > 0 ? uncoded : null;
});

/** Anything here changes how the numbers should be read. Everything else is fine. */
const degraded = computed(
  () =>
    !isEmpty.value &&
    (hasGap.value ||
      neverAggregated.value ||
      isStale.value ||
      truncated.value ||
      bigRemainder.value ||
      uncodedErrorShare.value !== null ||
      props.topNSubset ||
      !!props.filterLabel),
);

const toneText = computed(() => {
  if (hasGap.value || neverAggregated.value) return "text-banner-error-soft-text";
  if (degraded.value) return "text-banner-warning-text";
  return "text-text-secondary";
});

/**
 * The line takes a surface wash only when it is degraded. A healthy page keeps
 * the table's own background, so coverage reads as a footnote rather than a
 * banner. Red is reserved for the one case where data is genuinely MISSING;
 * amber means "read this differently".
 */
const toneSurface = computed(() => {
  if (hasGap.value || neverAggregated.value)
    return "bg-banner-error-soft-bg border-banner-error-soft-border border-b";
  if (degraded.value) return "bg-banner-warning-bg border-banner-warning-border border-b";
  return "border-border-subtle border-b";
});

const dotTone = computed(() => {
  if (hasGap.value || neverAggregated.value) return "bg-status-error-text";
  if (degraded.value) return "bg-status-warning-text";
  return "bg-status-success-text";
});

const barTone = computed(() =>
  degraded.value ? "bg-status-warning-text" : "bg-status-success-text",
);

const showBar = computed(() => !degraded.value && coverage.value !== null);
const barWidth = computed(() => `${Math.round((coverage.value ?? 0) * 100)}%`);

/** Wall-clock time our counting reaches, for "counted up to 16:11:53". */
const countedTo = computed<I18nText | null>(() => {
  if (degraded.value) return null;
  const through = props.freshness?.data_through ?? 0;
  if (through <= 0) return null;
  const time = new Date(through / 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  // "The last half-minute is still coming in" is true only while the counting
  // really is current. Under the stale threshold but past ordinary rollup
  // delay, that sentence asserts a freshness the data does not support — at 25
  // minutes behind it is simply false — so the line states the real lag
  // instead. It stays the quiet grey trailer either way: this is a correction
  // to a claim, not a promotion to a warning.
  const behind = behindMinutes.value ?? 0;
  return behind > BEHIND_NOTE_MINUTES
    ? t("dbm.coverage.lineCountedToBehind", { time, minutes: behind })
    : t("dbm.coverage.lineCountedTo", { time });
});

/**
 * One sentence, most-degrading first. Only one is shown: the reader needs the
 * worst problem and a way in, not a full inventory of qualifiers.
 */
const summary = computed<I18nText>(() => {
  // Nothing on screen: a caveat about "the rows shown" describes no rows, and
  // "you're seeing 95% of this database's time" is actively wrong. The empty
  // state is doing the explaining here, so coverage says the one thing that is
  // still true and gets out of the way.
  if (isEmpty.value) return t("dbm.coverage.unknownNote");
  if (neverAggregated.value) return t("dbm.freshness.neverAggregated");
  if (hasGap.value) {
    const f = props.freshness;
    const fmt = (us: number) =>
      new Date(us / 1000).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    const from = f?.data_through ?? 0;
    const to = f?.tail_covers_from ?? 0;
    // Rounded DOWN, not to nearest: this sentence is a claim about how much
    // data is missing, and rounding it up overstates the outage.
    return t("dbm.coverage.lineGap", {
      minutes: Math.floor((to - from) / 60_000_000),
      stopped: fmt(from),
      reach: Math.max(1, Math.floor(((f?.tail_through ?? to) - to) / 60_000_000)),
      from: fmt(from),
      to: fmt(f?.tail_covers_from ?? to),
    });
  }
  // Named filter first: "you've filtered to checkout-service" is actionable in
  // a way the generic form is not. `top_n_subset` with no name to give means
  // the scope is narrower than these totals reconcile at, so it says that
  // rather than borrowing the toolbar button's label — which read as "You've
  // filtered to Filters".
  //
  // But a filter must never EVICT the staleness warning: a filtered table
  // during an incident is exactly when the reader most needs to know the
  // numbers are behind. So when both hold, the two facts share one sentence
  // rather than one silencing the other — the filter still leads, keeping the
  // actionable half in front, and the lag rides along behind the dash.
  if (props.filterLabel) {
    return isStale.value
      ? t("dbm.coverage.lineSubsetStale", {
          filter: props.filterLabel,
          minutes: behindMinutes.value ?? 0,
        })
      : t("dbm.coverage.lineSubset", { filter: props.filterLabel });
  }
  if (props.topNSubset) {
    return isStale.value
      ? t("dbm.coverage.lineSubsetUnnamedStale", { minutes: behindMinutes.value ?? 0 })
      : t("dbm.coverage.lineSubsetUnnamed");
  }
  // Same rule as the filter branches above: a truncated tail must not evict the
  // staleness warning. The two undercount for unrelated reasons — the stretch
  // was bigger than we could take in, AND the counting is behind — so reporting
  // only the first lets a reader believe the shortfall is bounded and already
  // accounted for.
  if (truncated.value) {
    return isStale.value
      ? t("dbm.coverage.lineTruncatedStale", { minutes: behindMinutes.value ?? 0 })
      : t("dbm.coverage.lineTruncated");
  }
  if (isStale.value) return t("dbm.coverage.lineStale", { minutes: behindMinutes.value ?? 0 });
  if (bigRemainder.value) return t("dbm.coverage.lineRemainder", { percent: pct(shownTime.value) });
  if (uncodedErrorShare.value !== null) {
    return t("dbm.coverage.lineUncodedErrors", {
      percent: formatPercent(uncodedErrorShare.value, 0),
    });
  }
  if (coverage.value === null) return t("dbm.coverage.unknownNote");
  // A single-query page has no share-of-the-list to report — "you're seeing
  // 95% of this database's time" is a claim about a LIST, and stating it over
  // one query reads as a claim about that query's completeness.
  if (props.subject === "query") return t("dbm.coverage.lineQuery");
  // The Overview grain measures every call, so it states exactness plainly
  // rather than borrowing the per-query "heaviest N" sentence.
  if (props.exactPercentiles) {
    return estimatedSpeeds.value
      ? t("dbm.coverage.lineExactEstimated")
      : t("dbm.coverage.lineExact");
  }
  if (otherTime.value <= 0) {
    return estimatedSpeeds.value
      ? t("dbm.coverage.lineHealthyAllEstimated")
      : t("dbm.coverage.lineHealthyAll");
  }
  return t("dbm.coverage.lineHealthy", {
    percent: pct(shownTime.value),
    count: formatCount(props.trackedCount ?? 200),
  });
});
</script>
