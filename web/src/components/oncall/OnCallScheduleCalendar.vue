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
  <OCard data-test="oncall-schedule-calendar">
    <OCardSection>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-text-heading text-lg">{{ t("oncall.calendar") }}</h2>

        <div class="flex flex-wrap items-center gap-2">
          <OToggleGroup v-model="range" data-test="oncall-calendar-range">
            <OToggleGroupItem
              v-for="opt in RANGES"
              :key="opt.key"
              :value="opt.key"
              size="sm"
              :data-test="`oncall-calendar-range-${opt.key}`"
            >
              {{ t(opt.labelKey) }}
            </OToggleGroupItem>
          </OToggleGroup>

          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="chevron-left"
            :aria-label="t('oncall.calendarPrev')"
            data-test="oncall-calendar-prev"
            @click="shift(-1)"
          />
          <OButton
            variant="outline"
            size="sm-action"
            data-test="oncall-calendar-today"
            @click="goToday"
          >
            {{ t("oncall.calendarToday") }}
          </OButton>
          <OButton
            variant="outline"
            size="icon-sm"
            icon-left="chevron-right"
            :aria-label="t('oncall.calendarNext')"
            data-test="oncall-calendar-next"
            @click="shift(1)"
          />
        </div>
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p class="text-text-muted text-xs" data-test="oncall-calendar-window">
          {{ raw(windowLabel) }}
        </p>
        <!-- Which clock the columns are drawn against. Without it a schedule
             read from another country looks like it hands over at the wrong
             hour, because the viewer assumes their own midnight. -->
        <span class="text-text-muted text-xs" data-test="oncall-calendar-zone">
          {{ zoneLabel }}
        </span>
        <OToggleGroup
          v-if="timezone !== browserZone"
          v-model="zoneMode"
          data-test="oncall-calendar-zone-mode"
        >
          <OToggleGroupItem value="team" size="sm" data-test="oncall-calendar-zone-team">
            {{ t("oncall.calendarTeamTime") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="local" size="sm" data-test="oncall-calendar-zone-local">
            {{ t("oncall.calendarMyTime") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </div>

      <div v-if="!rotations.length" class="text-text-muted text-sm">
        {{ t("oncall.calendarEmpty") }}
      </div>

      <div v-else class="overflow-x-auto">
        <div class="min-w-160">
          <!-- Without a date axis this is a bar, not a calendar: you could
               learn WHO by hovering and never WHEN. -->
          <div class="mb-1 flex items-end gap-2">
            <span class="w-28 shrink-0" />
            <div class="relative h-5 flex-1">
              <div
                v-for="tick in axisTicks"
                :key="tick.at"
                class="text-text-muted absolute top-0 text-2xs"
                :style="{ left: `${tick.offset * 100}%` }"
                :data-test="`oncall-calendar-tick-${tick.at}`"
              >
                {{ raw(tick.label) }}
              </div>
              <span
                v-if="nowOffset !== null"
                class="bg-status-error-text text-text-inverse absolute top-0 rounded-default px-1.5 py-0.5 text-2xs font-medium"
                :style="{ left: `${nowOffset * 100}%` }"
                data-test="oncall-calendar-now-label"
              >
                {{ raw(nowLabel) }}
              </span>
            </div>
          </div>
          <!-- One track per rotation, then the computed Final track. The split
               is what makes "what is actually in force" readable when two
               rotations overlap. -->
          <div
            v-for="track in tracks"
            :key="track.name"
            class="flex items-stretch gap-3"
            :data-test="`oncall-calendar-track-${track.name}`"
          >
            <!-- A fixed-width gutter and a rotation name of any length: the
                 bands already carry their full text, and the row label was the
                 one string on this chart with nothing behind it. -->
            <span class="text-text-secondary flex w-28 shrink-0 items-center truncate text-xs">
              {{ raw(track.name) }}
              <OTooltip side="right" :content="raw(track.name)" />
            </span>
            <div class="border-border-subtle relative h-12 flex-1 border-b">
              <!-- Weekends shaded and day boundaries ruled, so a band spanning
                   Tue noon to Thu noon is readable rather than a floating bar. -->
              <div
                v-for="col in dayColumns"
                :key="col.at"
                class="absolute inset-y-0"
                :class="col.weekend ? 'bg-surface-panel' : ''"
                :style="{ left: `${col.offset * 100}%`, width: `${col.width * 100}%` }"
              />
              <div
                v-for="col in dayColumns.slice(1)"
                :key="`rule-${col.at}`"
                class="bg-border-subtle absolute inset-y-0 w-px"
                :style="{ left: `${col.offset * 100}%` }"
              />
              <div
                v-for="(band, i) in track.bands"
                :key="i"
                class="absolute inset-y-2 flex items-center overflow-hidden rounded-default px-2.5"
                :class="bandClass(band)"
                :style="bandStyle(band)"
                :title="raw(band.user_email || t('oncall.calendarNobody'))"
                :data-test="`oncall-calendar-band-${track.name}-${i}`"
              >
                <span class="truncate text-compact font-medium">
                  {{ band.user_email ? raw(band.user_email) : t("oncall.calendarNobody") }}
                </span>
              </div>

              <!-- Where "now" falls, so the whole chart reads against it. -->
              <div
                v-if="nowOffset !== null"
                class="bg-status-error-text absolute inset-y-0 w-px"
                :style="{ left: `${nowOffset * 100}%` }"
                data-test="oncall-calendar-now"
              />
            </div>
          </div>

          <!-- This grid paints four things and used to explain none of them.
               The important one is the first: the band colours are DECORATIVE
               — they separate one person from the next and carry no status —
               while the Overview's coverage bar uses colour to mean covered,
               partial or nobody. Two vocabularies on one screen, so each chart
               has to say which it speaks or the reader assumes the louder one.
               Deliberately not unified: making the ramp mean status would need
               a status per person, which does not exist. -->
          <div
            class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1"
            data-test="oncall-calendar-legend"
          >
            <span class="text-text-secondary flex items-center gap-1.5 text-xs">
              <span class="flex items-center gap-0.5" aria-hidden="true">
                <span
                  v-for="tone in PERSON_TONES"
                  :key="tone"
                  class="size-2 rounded-full"
                  :class="tone"
                />
              </span>
              {{ t("oncall.legendPersonRamp") }}
            </span>
            <!-- The one colour here that IS a status, and the only thing on the
                 chart worth acting on. -->
            <span
              class="text-status-error-text flex items-center gap-1.5 text-xs"
              data-test="oncall-calendar-legend-gap"
            >
              <span
                class="border-status-error-text size-2 rounded-full border border-dashed"
                aria-hidden="true"
              />
              {{ t("oncall.calendarNobody") }}
            </span>
            <span
              v-if="nowOffset !== null"
              class="text-text-secondary flex items-center gap-1.5 text-xs"
              data-test="oncall-calendar-legend-now"
            >
              <span class="bg-status-error-text h-3 w-px" aria-hidden="true" />
              {{ t("oncall.legendNow") }}
            </span>
            <!-- Only when the window actually contains one; a day view showing
                 a key for shading it does not draw is noise. -->
            <span
              v-if="hasWeekend"
              class="text-text-secondary flex items-center gap-1.5 text-xs"
              data-test="oncall-calendar-legend-weekend"
            >
              <span class="bg-surface-panel border-border-subtle size-2 rounded-default border" aria-hidden="true" />
              {{ t("oncall.legendWeekend") }}
            </span>
          </div>
        </div>
      </div>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_MINUTE } from "@/ts/interfaces/oncall";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import type { CalendarBand } from "@/utils/oncall";
import {
  colorIndexFor,
  formatInZone,
  resolveHolder,
  shiftBands,
  wallTimeInZone,
} from "@/utils/oncall";

/// The zone restriction windows are read in. Without it a follow-the-sun
/// layer cannot be evaluated at all, and every hour looks covered.
const props = defineProps<{ rotations: Rotation[]; timezone: string }>();

const { t } = useI18nTyped();

const RANGES = [
  { key: "day", days: 1, labelKey: "oncall.calendarDay" },
  { key: "week", days: 7, labelKey: "oncall.calendarWeek" },
  { key: "fortnight", days: 14, labelKey: "oncall.calendarFortnight" },
] as const satisfies ReadonlyArray<{ key: string; days: number; labelKey: I18nKey }>;

// Week, because a rotation is usually weekly and a week is the span somebody
// can actually plan against.
const range = ref<string>("week");
const offsetDays = ref(0);

const days = computed(() => RANGES.find((r) => r.key === range.value)?.days ?? 7);

/// The schedule is WRITTEN in the team's zone — restrictions are minutes past
/// midnight there — so that is the frame the chart is drawn in by default.
/// Rendering the axis in the viewer's zone instead put the day columns and the
/// weekend shading out of step with the windows the bands actually obey.
const zoneMode = ref<string>("team");
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const activeZone = computed(() => (zoneMode.value === "team" ? props.timezone : browserZone));

const zoneLabel = computed(() =>
  t("oncall.calendarShownIn", { zone: raw(activeZone.value) }),
);

/// Start of the day containing `atMicros`, in `zone`.
function zoneMidnight(atMicros: number, zone: string): number {
  const wall = wallTimeInZone(atMicros, zone);
  const flooredToMinute = Math.floor(atMicros / MICROS_PER_MINUTE) * MICROS_PER_MINUTE;
  if (!wall) return flooredToMinute;
  return flooredToMinute - wall.minuteOfDay * MICROS_PER_MINUTE;
}

const windowStart = computed(
  () => zoneMidnight(Date.now() * 1000, activeZone.value) + offsetDays.value * MICROS_PER_DAY,
);
const windowEnd = computed(() => windowStart.value + days.value * MICROS_PER_DAY);

const windowLabel = computed(() => {
  const fmt = (micros: number) =>
    formatInZone(micros, activeZone.value, { dateStyle: "medium" });
  return `${fmt(windowStart.value)} – ${fmt(windowEnd.value - 1)}`;
});

// Null when today is off screen, so the marker is not pinned to an edge and
// read as "now" when it is nothing of the sort.
const nowOffset = computed(() => {
  const now = Date.now() * 1000;
  if (now < windowStart.value || now >= windowEnd.value) return null;
  return (now - windowStart.value) / (windowEnd.value - windowStart.value);
});

/**
 * The computed truth: which rotation actually holds each slice.
 *
 * Sampled rather than derived from the rotations directly, because with two
 * overlapping rotations the answer is a precedence decision, not a union. This
 * is the row somebody checks when they want to know who really gets paged.
 */
/// One column per day in the window: the frame the bands are read against.
const dayColumns = computed(() => {
  const span = windowEnd.value - windowStart.value;
  if (span <= 0) return [];
  const zone = activeZone.value;

  // Each boundary is resolved from the middle of its own day rather than by
  // adding 24 hours repeatedly: across a DST change a day is 23 or 25 hours,
  // and stepping in fixed days would slide every later column off midnight.
  const starts: number[] = [];
  for (let i = 0; i < days.value; i++) {
    const noonish = windowStart.value + i * MICROS_PER_DAY + MICROS_PER_DAY / 2;
    starts.push(Math.max(windowStart.value, zoneMidnight(noonish, zone)));
  }

  return starts.map((at, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : windowEnd.value;
    const day = wallTimeInZone(at, zone)?.dayFromMonday ?? 0;
    return {
      at,
      offset: (at - windowStart.value) / span,
      width: (end - at) / span,
      // 0 = Monday, so Saturday and Sunday are 5 and 6.
      weekend: day >= 5,
    };
  });
});

/// Labelled per day up to a fortnight; past that a label per day is unreadable
/// so it thins out rather than overlapping itself.
const axisTicks = computed(() => {
  const every = days.value > 14 ? 7 : 1;
  return dayColumns.value
    .filter((_, i) => i % every === 0)
    .map((col) => ({
      at: col.at,
      offset: col.offset,
      label: formatInZone(col.at, activeZone.value, {
        weekday: "short",
        day: "numeric",
      }),
    }));
});

const nowLabel = computed(() =>
  formatInZone(Date.now() * 1000, activeZone.value, { hour: "2-digit", minute: "2-digit" }),
);

const finalBands = computed<CalendarBand[]>(() => {
  const span = windowEnd.value - windowStart.value;
  if (span <= 0 || !props.rotations.length) return [];

  // Sampled finely enough that a short gap is drawn where it happens rather
  // than swallowed by a wide slice: a fortnight at 96 slices put every edge
  // inside a three-and-a-half-hour band.
  const slices = Math.min(2000, Math.max(96, Math.round(span / (15 * MICROS_PER_MINUTE))));
  const step = span / slices;
  const out: CalendarBand[] = [];

  for (let i = 0; i < slices; i++) {
    const at = windowStart.value + i * step;
    // The same resolution the engine uses: highest priority whose restriction
    // window matches wins. Taking the last rotation in the array instead named
    // the wrong person whenever two overlapped, and — because it never asked
    // whether a rotation applied at all — drew a restricted rotation as
    // covering hours it is switched off for, hiding a real gap.
    const holder = resolveHolder(props.rotations, at, props.timezone).member ?? "";
    const previous = out[out.length - 1];
    if (previous && previous.user_email === holder) {
      previous.endMicros = at + step;
      previous.width = (previous.endMicros - previous.startMicros) / span;
      continue;
    }
    out.push({
      user_email: holder,
      startMicros: at,
      endMicros: at + step,
      offset: (at - windowStart.value) / span,
      width: step / span,
    });
  }
  return out;
});

/// With one rotation the "in force" view IS that rotation, so it renders as a
/// single track rather than the same person twice — which is the first thing
/// anybody asked about this screen. It still uses the computed bands so a
/// stretch with nobody on call is drawn as a gap.
///
/// With several, each gets its own track and the computed one goes underneath,
/// because that is the only place the layering resolves to an answer.
const tracks = computed(() => {
  if (props.rotations.length < 2) {
    return props.rotations.map((r) => ({ name: r.name, bands: finalBands.value }));
  }
  return [
    ...props.rotations.map((r) => ({
      name: r.name,
      bands: shiftBands(r, windowStart.value, windowEnd.value),
    })),
    { name: t("oncall.calendarFinal"), bands: finalBands.value },
  ];
});

function shift(direction: number) {
  offsetDays.value += direction * days.value;
}

function goToday() {
  offsetDays.value = 0;
}

/// Whether the drawn window contains a shaded weekend, so the key for it is
/// offered only when there is something to key.
const hasWeekend = computed(() => dayColumns.value.some((col) => col.weekend));

function bandStyle(band: CalendarBand) {
  return { left: `${band.offset * 100}%`, width: `${band.width * 100}%` };
}

// A soft tint with matching text, which is what every calendar of this kind
// looks like: the band IS the person, so it carries their colour rather than
// a stripe on a grey box. `error` is deliberately absent — reserved for the
// one thing here worth alarming about, which is a gap.
const PERSON_TONES = [
  "bg-icon-chip-info-bg text-icon-chip-info-text",
  "bg-icon-chip-primary-bg text-icon-chip-primary-text",
  "bg-icon-chip-success-bg text-icon-chip-success-text",
  "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  "bg-icon-chip-warning-bg text-icon-chip-warning-text",
];

function bandClass(band: CalendarBand): string {
  // A gap is absence, not another person: outlined rather than filled, so it
  // reads as a hole in the row.
  if (!band.user_email) {
    return "border-status-error-text text-status-error-text border border-dashed";
  }
  return PERSON_TONES[colorIndexFor(band.user_email, PERSON_TONES.length)];
}
</script>
