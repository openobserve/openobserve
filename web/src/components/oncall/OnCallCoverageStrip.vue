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
  The next fortnight of cover, as one strip.

  Gaps are the only thing worth looking at here, so they are the only bands that
  get an alarming colour — everything else is a calm block whose job is to make
  the holes obvious by contrast. Resolved with the same rotation arithmetic the
  engine uses, so a span this calls covered is one that would actually page.
-->
<template>
  <div class="flex flex-col gap-2" data-test="oncall-coverage-strip">
    <!-- The sentence the picture cannot say on its own. A strip answers "is
         there a hole" at a glance; the one thing a reader actually acts on is
         WHEN, and a fortnight of green looks identical whether the hole is
         tomorrow or never. -->
    <p
      class="text-xs"
      :class="firstGap ? 'text-status-warning-text' : 'text-text-secondary'"
      data-test="oncall-coverage-summary"
    >
      {{ summary }}
    </p>

    <OScheduleTimeline
      :tracks="tracks"
      :axis-ticks="axisTicks"
      :day-columns="dayColumns"
      :now-offset="0"
      :now-label="t('oncall.calendarToday')"
    >
      <!-- Bands stay merged into the three calm blocks; hovering one is how a
           reader gets to WHO without the strip fragmenting into a name per
           shift. -->
      <template #band="{ band }">
        <OTooltip v-if="tooltipFor(band.key).length" side="top">
          <OScheduleBand :band="band" />
          <template #content>
            <div class="flex flex-col">
              <template v-for="(segment, index) in tooltipFor(band.key)" :key="segment.key">
                <!-- One rule per handover, not around every segment: a
                     single-segment tooltip is one block, and the rule is only
                     meaningful as a boundary BETWEEN two date ranges. -->
                <hr v-if="index > 0" class="border-border-default my-1" />
                <div class="flex flex-col gap-0.5">
                  <span v-if="segment.range" class="text-text-secondary text-2xs">{{
                    segment.range
                  }}</span>
                  <span>{{ segment.primary }}</span>
                  <span v-if="segment.secondary">{{ segment.secondary }}</span>
                </div>
              </template>
            </div>
          </template>
        </OTooltip>
        <OScheduleBand v-else :band="band" />
      </template>

      <template #legend>
        <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span
            v-for="entry in legend"
            :key="entry.key"
            class="text-text-secondary flex items-center gap-1.5 text-xs"
          >
            <span class="size-2 rounded-full" :class="entry.swatch" aria-hidden="true" />
            {{ entry.label }}
          </span>
        </span>
      </template>
    </OScheduleTimeline>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OScheduleBand from "@/lib/data/ScheduleTimeline/OScheduleBand.vue";
import OScheduleTimeline from "@/lib/data/ScheduleTimeline/OScheduleTimeline.vue";
import type {
  ScheduleAxisTick,
  ScheduleBand,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import {
  formatInZone,
  resolveHolder,
  wallTimeInZone,
} from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    rotations?: Rotation[];
    timezone?: string;
    /** How far ahead to draw, in days. */
    days?: number;
    /** Instant the strip starts from, in micros. Defaults to now. */
    fromMicros?: number | null;
  }>(),
  { rotations: () => [], timezone: "UTC", days: 14, fromMicros: null },
);

const { t } = useI18nTyped();

/** One sample per hour: fine enough to catch an hour-long hole. */
const STEP_MICROS = 60 * 60 * 1_000_000;

const start = computed(() => props.fromMicros ?? Date.now() * 1000);
const end = computed(() => start.value + props.days * MICROS_PER_DAY);
const span = computed(() => end.value - start.value);

type Cover = "both" | "primary" | "none";

interface Sample {
  cover: Cover;
  /** First staffed rotation's holder, in rotation order. */
  primary: string | null;
  /** Second staffed rotation's holder, if any — the "behind them" of `coverAt`. */
  secondary: string | null;
}

/// Three states rather than a person per band: at a fortnight's zoom the
/// question is "is anybody on, and is anybody behind them", not "who". The
/// holders are still resolved here so a hovered band can answer "who" without
/// a second pass over the rotations.
///
/// "Behind them" counts a SECOND STAFFED ROTATION. It used to count the next
/// person in the same rotation, which is nobody's backup — they are not on call
/// until the handover, and reading them as cover is how a team with one
/// rotation looked doubly covered while a single gap would page no one.
function sampleAt(at: number): Sample {
  const staffed = props.rotations
    .map((rotation) => resolveHolder(rotation, at, props.timezone).member)
    .filter((member): member is string => Boolean(member));
  const cover: Cover = staffed.length === 0 ? "none" : staffed.length > 1 ? "both" : "primary";
  return { cover, primary: staffed[0] ?? null, secondary: staffed[1] ?? null };
}

const TONE: Record<Cover, ScheduleBand["tone"]> = {
  both: "covered",
  primary: "partial",
  none: "gap",
};

const COVER_LABEL: Record<Cover, string> = {
  both: "oncall.coverTwoRotations",
  primary: "oncall.coverOneRotation",
  none: "oncall.coverNobody",
};

const clock = (micros: number) =>
  formatInZone(micros, props.timezone, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/// Weekday AND date, unlike `clock`: a tooltip segment can be the same
/// weekday a week apart, and "Fri – Fri" only reads as a length once the
/// date tells the two apart.
const rangeStamp = (micros: number) =>
  formatInZone(micros, props.timezone, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** One unbroken stretch of a single cover state. */
interface Run {
  from: number;
  to: number;
  cover: Cover;
}

/// Adjacent samples of the same state merge, so a covered fortnight is one band
/// rather than 336 slivers the browser has to lay out.
const runs = computed<Run[]>(() => {
  if (span.value <= 0) return [];

  const out: Run[] = [];
  let runStart = start.value;
  let runCover = sampleAt(start.value).cover;

  for (let at = start.value + STEP_MICROS; at < end.value; at += STEP_MICROS) {
    const cover = sampleAt(at).cover;
    if (cover === runCover) continue;
    out.push({ from: runStart, to: at, cover: runCover });
    runStart = at;
    runCover = cover;
  }
  out.push({ from: runStart, to: end.value, cover: runCover });
  return out;
});

/** One unbroken stretch of a single primary/secondary pairing. */
interface HolderRun {
  from: number;
  to: number;
  primary: string | null;
  secondary: string | null;
}

const holderKey = (s: Sample) => `${s.primary ?? ""}|${s.secondary ?? ""}`;

/// Merged on WHO is on call rather than on cover state — finer-grained than
/// `runs`, and used only to answer a hovered band's tooltip. The strip itself
/// stays three calm blocks; a run spanning a rotation handover still needs
/// this to avoid crediting the whole stretch to whoever started it.
const holderRuns = computed<HolderRun[]>(() => {
  if (span.value <= 0) return [];

  const out: HolderRun[] = [];
  let runStart = start.value;
  let runSample = sampleAt(start.value);
  let runKey = holderKey(runSample);

  for (let at = start.value + STEP_MICROS; at < end.value; at += STEP_MICROS) {
    const sample = sampleAt(at);
    const key = holderKey(sample);
    if (key === runKey) continue;
    out.push({
      from: runStart,
      to: at,
      primary: runSample.primary,
      secondary: runSample.secondary,
    });
    runStart = at;
    runSample = sample;
    runKey = key;
  }
  out.push({ from: runStart, to: end.value, primary: runSample.primary, secondary: runSample.secondary });
  return out;
});

/** One row of a band's tooltip. */
interface TooltipSegment {
  key: string;
  /** The stretch this row covers, shown only when the band holds more than one. */
  range: I18nText | null;
  primary: I18nText;
  /** Omitted, not blank, when nobody backs this stretch up. */
  secondary: I18nText | null;
}

/// A gap already says "Nobody" on the band itself; a tooltip would repeat it.
/// Covered/partial bands get one row per handover inside them, so a run that
/// merges several days of "somebody's on call" still names the right somebody
/// for the stretch under the pointer. Primary and secondary are separate
/// fields, not one joined sentence, so the template can put them on their own
/// lines and rule off one handover from the next.
function tooltipFor(bandKey: string): TooltipSegment[] {
  const run = runs.value.find((r) => `${r.from}` === bandKey);
  if (!run || run.cover === "none") return [];

  const segments = holderRuns.value.filter((h) => h.from < run.to && h.to > run.from);
  const showRange = segments.length > 1;

  return segments.map((segment) => ({
    key: `${segment.from}`,
    range: showRange
      ? raw(
          `${rangeStamp(Math.max(segment.from, run.from))} – ${rangeStamp(Math.min(segment.to, run.to))}`,
        )
      : null,
    primary: t("oncall.coveragePrimaryOnly", { primary: raw(segment.primary ?? "") }),
    secondary: segment.secondary
      ? t("oncall.coverageSecondaryOnly", { secondary: raw(segment.secondary) })
      : null,
  }));
}

const tracks = computed<ScheduleTrack[]>(() => {
  if (!runs.value.length) return [];

  const bands: ScheduleBand[] = runs.value.map((run) => {
    const label = t(COVER_LABEL[run.cover] as "oncall.coverNobody");
    return {
      key: `${run.from}`,
      offset: (run.from - start.value) / span.value,
      width: (run.to - run.from) / span.value,
      // Only the gap carries text: a fortnight of cover labelled fourteen times
      // is noise, and the band a reader is hunting for is the empty one.
      label: run.cover === "none" ? label : raw(""),
      ariaLabel: t("oncall.coverageStripAria", {
        who: label,
        from: raw(clock(run.from)),
        to: raw(clock(run.to)),
      }),
      tone: TONE[run.cover],
    };
  });

  return [{ key: "coverage", label: raw(""), bands }];
});

/// The first stretch with nobody on call. Read off the SAME runs the bands are
/// drawn from, never resolved a second way: a sentence that disagreed with the
/// picture above it would be worse than no sentence.
const firstGap = computed<Run | null>(
  () => runs.value.find((run) => run.cover === "none") ?? null,
);

/// Cover the moment the strip starts, which is now.
const coveredNow = computed(() => runs.value[0]?.cover !== "none");

/// "Cover drops in 5d 3h — Fri 22 Aug 18:00, for 12h", or the calm version.
///
/// The duration is what somebody acts on; the instant is what they put in a
/// calendar; the length is how much of a hole it is. A gap already in progress
/// says so instead, because "drops in 0m" is a sentence about the future for a
/// thing that has already happened.
const summary = computed<I18nText>(() => {
  const gap = firstGap.value;
  if (!gap) return t("oncall.coverageNoGap", { days: props.days });

  const at = raw(
    formatInZone(gap.from, props.timezone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  const length = formatMicrosDuration(gap.to - gap.from);

  if (!coveredNow.value) {
    // A hole that runs to the end of the window has no known return: saying
    // cover comes back at the edge of what we drew would invent a shift.
    return gap.to >= end.value
      ? t("oncall.coverageGapNowOpen", { days: props.days })
      : t("oncall.coverageGapNow", {
          when: raw(
            formatInZone(gap.to, props.timezone, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          ),
        });
  }

  return t("oncall.coverageDropsIn", {
    duration: formatMicrosDuration(gap.from - start.value),
    when: at,
    length,
  });
});

/// Roughly this many labelled marks across the window — enough to place a band
/// within a day, few enough that the labels do not collide.
const TICK_TARGET = 7;

/// The next local midnight at or after `at`.
///
/// Snapped by re-reading the wall clock rather than trusting the arithmetic: a
/// DST change moves the boundary by an hour, and a tick labelled Tuesday that
/// sits an hour inside Monday is the kind of error nobody catches by eye.
function nextLocalMidnight(at: number): number {
  const wall = wallTimeInZone(at, props.timezone);
  if (!wall) return at + MICROS_PER_DAY;
  const candidate = at + (1440 - wall.minuteOfDay) * 60 * 1_000_000;
  const landed = wallTimeInZone(candidate, props.timezone);
  if (!landed || landed.minuteOfDay === 0) return candidate;
  return landed.minuteOfDay > 720
    ? candidate + (1440 - landed.minuteOfDay) * 60 * 1_000_000
    : candidate - landed.minuteOfDay * 60 * 1_000_000;
}

/// Every local midnight in the window — the guides a reader counts days along.
const dayBoundaries = computed<number[]>(() => {
  if (span.value <= 0) return [];
  const out: number[] = [];
  // Bounded by the day count, so a bad timezone cannot spin here.
  for (
    let at = nextLocalMidnight(start.value);
    at < end.value && out.length <= props.days + 1;
    at = nextLocalMidnight(at)
  ) {
    out.push(at);
  }
  return out;
});

const dayColumns = computed(() =>
  dayBoundaries.value.map((at) => (at - start.value) / span.value),
);

/// Dates on the axis. Every day's label would collide at a fortnight's zoom, so
/// they thin out — but always onto real midnights, never onto even fractions of
/// the window, which would put "Mon 18" at half past two on the Monday.
const axisTicks = computed<ScheduleAxisTick[]>(() => {
  const step = Math.max(1, Math.ceil(props.days / TICK_TARGET));
  return dayBoundaries.value
    .filter((_, index) => index % step === 0)
    .map((at) => ({
      offset: (at - start.value) / span.value,
      label: raw(formatInZone(at, props.timezone, { weekday: "short", day: "numeric" })),
    }));
});

interface LegendEntry {
  key: Cover;
  label: I18nText;
  swatch: string;
}

const legend = computed<LegendEntry[]>(() => [
  {
    key: "both",
    label: t("oncall.coverTwoRotations"),
    swatch: "bg-badge-success-solid-bg",
  },
  { key: "primary", label: t("oncall.coverOneRotation"), swatch: "bg-badge-warning-solid-bg" },
  { key: "none", label: t("oncall.coverNobody"), swatch: "bg-schedule-gap-bg" },
]);
</script>
