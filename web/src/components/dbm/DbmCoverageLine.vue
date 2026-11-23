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
     space to say nothing. A healthy page renders nothing. A banner appears only
     when something changes how the numbers should be read: a warning (data is
     missing or behind) or an info note (read the numbers this way).

  2. ONE state, never an inventory. The reader needs the worst problem, not a
     list. `summary` returns the most degrading sentence only, and every
     sentence carries a number — a caveat with a number attached is a
     disclosure; one without is a disclaimer nobody reads.

  No term of art survives. "The 200 heaviest kinds of query" rather than
  "top-N"; "still coming in" rather than "live tail"; "close, not exact" rather
  than "estimated".
-->
<template>
  <!-- Inline: one toolbar note, hidden while empty because the empty state already says so. -->
  <DbmToolbarNote
    v-if="inline && !isEmpty"
    :tone="noteTone"
    :icon="noteTone === 'neutral' ? 'data-usage' : undefined"
    :text="summary"
    :detail="noteDetail"
    data-test="dbm-coverage"
  />
  <OBanner
    v-else-if="!inline && !isEmpty && entry.variant"
    :variant="entry.variant"
    :icon="entry.variant === 'warning' ? 'warning-amber' : 'info-outline'"
    bar
    dense
    data-test="dbm-coverage"
  >
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

import DbmToolbarNote, { type DbmToolbarNoteTone } from "./DbmToolbarNote.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { Freshness, QueryStatsRow } from "@/services/db_monitoring";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
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
    /** Some row folds several schemas, so its speeds are its slowest schema's, not its own. */
    slowestSchemaSpeeds?: boolean;
    /**
     * What these rows ARE. `list` (default) is a ranked table, where the share
     * of total time is the headline claim. `query` is one statement, where that
     * claim would be nonsense and the honest thing to report is how the
     * measurement was taken.
     */
    subject?: "list" | "query";
    /** The selected window, microseconds; a data gap is counted only inside it. */
    windowStart?: number;
    windowEnd?: number;
    /** Renders as a toolbar note instead of a full-width line. */
    inline?: boolean;
    /** With `inline`, the icon alone, for a toolbar with no room left for text. */
    compact?: boolean;
  }>(),
  {
    hits: () => [],
    other: () => [],
    topNSubset: false,
    exactPercentiles: false,
    slowestSchemaSpeeds: false,
    filterLabel: null,
    subject: "list",
    inline: false,
    compact: false,
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

const MIN_US = 60_000_000;

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

const hasGap = computed(() => gap.value !== null);

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

/** Wall-clock time the counting reaches; `behind` is set only past {@link BEHIND_NOTE_MINUTES}, where the "still coming in" phrasing would assert a freshness the lag no longer supports. */
const countedTo = computed<{ time: string; behind: number | null } | null>(() => {
  if (degraded.value) return null;
  const through = props.freshness?.data_through ?? 0;
  if (through <= 0) return null;
  const time = new Date(through / 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const behind = behindMinutes.value ?? 0;
  return { time, behind: behind > BEHIND_NOTE_MINUTES ? behind : null };
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

type CoverageVariant = "warning" | "info";
interface CoverageEntry {
  /** `null` = nothing to say, so no banner. */
  variant: CoverageVariant | null;
  short: I18nText;
  long: I18nText;
}

/**
 * One entry, most-degrading first. Only one is shown: the reader needs the
 * worst problem and a way in, not a full inventory of qualifiers.
 */
const entry = computed<CoverageEntry>(() => {
  const mk = (variant: CoverageVariant | null, short: I18nText, long: I18nText = short) => ({
    variant,
    short,
    long,
  });
  const minutes = behindMinutes.value ?? 0;
  const stale = isStale.value;
  // Nothing on screen: the empty state is doing the explaining.
  if (isEmpty.value) return mk(null, t("dbm.coverage.unknownNote"));
  if (neverAggregated.value) {
    return mk(
      "warning",
      t("dbm.coverage.bannerNeverAggregated"),
      t("dbm.freshness.neverAggregated"),
    );
  }
  const g = gap.value;
  if (g) {
    const f = props.freshness;
    const reach = Math.max(1, Math.floor(((f?.tail_through ?? g.to) - g.to) / MIN_US));
    const today = dayOffset(g.from) === 0 && dayOffset(g.to) === 0;
    return mk(
      "warning",
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
          "warning",
          t("dbm.coverage.bannerStale", { minutes }),
          t("dbm.coverage.lineSubsetStale", { filter: props.filterLabel, minutes }),
        )
      : mk(
          "info",
          t("dbm.coverage.bannerSubset", { filter: props.filterLabel }),
          t("dbm.coverage.lineSubset", { filter: props.filterLabel }),
        );
  }
  if (props.topNSubset) {
    return stale
      ? mk(
          "warning",
          t("dbm.coverage.bannerStale", { minutes }),
          t("dbm.coverage.lineSubsetUnnamedStale", { minutes }),
        )
      : mk("info", t("dbm.coverage.bannerSubsetUnnamed"), t("dbm.coverage.lineSubsetUnnamed"));
  }
  // Same rule: a truncated tail must not evict the staleness warning.
  if (truncated.value) {
    return stale
      ? mk(
          "warning",
          t("dbm.coverage.bannerTruncatedStale", { minutes }),
          t("dbm.coverage.lineTruncatedStale", { minutes }),
        )
      : mk("warning", t("dbm.coverage.bannerTruncated"), t("dbm.coverage.lineTruncated"));
  }
  if (stale) {
    return mk(
      "warning",
      t("dbm.coverage.bannerStale", { minutes }),
      t("dbm.coverage.lineStale", { minutes }),
    );
  }
  if (bigRemainder.value) {
    return mk(
      "info",
      t("dbm.coverage.bannerShare", { percent: pct(shownTime.value) }),
      t("dbm.coverage.lineRemainder", { percent: pct(shownTime.value) }),
    );
  }
  if (uncodedErrorShare.value !== null) {
    const percent = formatPercent(uncodedErrorShare.value, 0);
    return mk(
      "warning",
      t("dbm.coverage.bannerUncodedErrors", { percent }),
      t("dbm.coverage.lineUncodedErrors", { percent }),
    );
  }
  if (coverage.value === null) return mk(null, t("dbm.coverage.unknownNote"));
  // A single-query page has no share-of-the-list to report.
  if (props.subject === "query") {
    return mk("info", t("dbm.coverage.bannerQuery"), t("dbm.coverage.lineQuery"));
  }
  const estimated = (long: I18nText) => mk("info", t("dbm.coverage.bannerEstimated"), long);
  if (props.exactPercentiles) {
    if (estimatedSpeeds.value) return estimated(t("dbm.coverage.lineExactEstimated"));
    return props.slowestSchemaSpeeds
      ? mk("info", t("dbm.coverage.bannerSlowestSchema"), t("dbm.coverage.lineExactSlowestSchema"))
      : mk(null, t("dbm.coverage.lineExact"));
  }
  if (otherTime.value <= 0) {
    return estimatedSpeeds.value
      ? estimated(t("dbm.coverage.lineHealthyAllEstimated"))
      : mk(null, t("dbm.coverage.lineHealthyAll"));
  }
  const percent = pct(shownTime.value);
  return mk(
    "info",
    t("dbm.coverage.bannerShare", { percent }),
    t("dbm.coverage.lineHealthy", { percent, count: formatCount(props.trackedCount ?? 200) }),
  );
});

const summary = computed(() => entry.value.long);

const noteTone = computed<DbmToolbarNoteTone>(() => {
  return degraded.value || hasGap.value || neverAggregated.value ? "warning" : "neutral";
});

// The line shows "counted up to" beside the sentence; the note has one tooltip, so it rides there.
const noteDetail = computed<I18nText>(() => {
  const c = countedTo.value;
  if (!c) return summary.value;
  const counted =
    c.behind !== null
      ? t("dbm.coverage.lineCountedToBehind", { time: c.time, minutes: c.behind })
      : t("dbm.coverage.lineCountedTo", { time: c.time });
  return raw(`${summary.value} ${counted}`);
});
</script>
