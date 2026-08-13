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
    <OScheduleTimeline :tracks="tracks" :now-offset="0" :now-label="t('oncall.calendarToday')">
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

import OScheduleTimeline from "@/lib/data/ScheduleTimeline/OScheduleTimeline.vue";
import type {
  ScheduleBand,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import type { Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone, resolveHolder, resolveNextHolder } from "@/utils/oncall";

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

/// Three states rather than a person per band: at a fortnight's zoom the
/// question is "is anybody on, and is anybody behind them", not "who".
function coverAt(at: number): Cover {
  const holder = resolveHolder(props.rotations, at, props.timezone).member;
  if (!holder) return "none";
  return resolveNextHolder(props.rotations, at, props.timezone) ? "both" : "primary";
}

const TONE: Record<Cover, ScheduleBand["tone"]> = {
  both: "covered",
  primary: "partial",
  none: "gap",
};

const COVER_LABEL: Record<Cover, string> = {
  both: "oncall.coverPrimaryAndSecondary",
  primary: "oncall.coverPrimaryOnly",
  none: "oncall.coverNobody",
};

const clock = (micros: number) =>
  formatInZone(micros, props.timezone, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/// Adjacent samples of the same state merge, so a covered fortnight is one band
/// rather than 336 slivers the browser has to lay out.
const tracks = computed<ScheduleTrack[]>(() => {
  if (span.value <= 0) return [];

  const bands: ScheduleBand[] = [];
  let runStart = start.value;
  let runCover = coverAt(start.value);

  const push = (from: number, to: number, cover: Cover) => {
    const label = t(COVER_LABEL[cover] as "oncall.coverNobody");
    bands.push({
      key: `${from}`,
      offset: (from - start.value) / span.value,
      width: (to - from) / span.value,
      // Only the gap carries text: a fortnight of cover labelled fourteen times
      // is noise, and the band a reader is hunting for is the empty one.
      label: cover === "none" ? label : raw(""),
      ariaLabel: t("oncall.coverageStripAria", {
        who: label,
        from: raw(clock(from)),
        to: raw(clock(to)),
      }),
      tone: TONE[cover],
    });
  };

  for (let at = start.value + STEP_MICROS; at < end.value; at += STEP_MICROS) {
    const cover = coverAt(at);
    if (cover === runCover) continue;
    push(runStart, at, runCover);
    runStart = at;
    runCover = cover;
  }
  push(runStart, end.value, runCover);

  return [{ key: "coverage", label: raw(""), bands }];
});

interface LegendEntry {
  key: Cover;
  label: I18nText;
  swatch: string;
}

const legend = computed<LegendEntry[]>(() => [
  {
    key: "both",
    label: t("oncall.coverPrimaryAndSecondary"),
    swatch: "bg-badge-success-solid-bg",
  },
  { key: "primary", label: t("oncall.coverPrimaryOnly"), swatch: "bg-badge-warning-solid-bg" },
  { key: "none", label: t("oncall.coverNobody"), swatch: "bg-schedule-gap-bg" },
]);
</script>
