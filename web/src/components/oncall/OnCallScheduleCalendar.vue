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

      <p class="text-text-muted mb-3 text-xs" data-test="oncall-calendar-window">
        {{ raw(windowLabel) }}
      </p>

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
                class="bg-accent text-text-inverse absolute top-0 rounded-full px-1 text-2xs"
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
            class="mb-2 flex items-center gap-2"
            :data-test="`oncall-calendar-track-${track.name}`"
          >
            <span class="text-text-secondary w-28 shrink-0 truncate text-xs">
              {{ raw(track.name) }}
            </span>
            <div class="bg-surface-base border-border-subtle relative h-8 flex-1 rounded-default border">
              <!-- Weekends shaded and day boundaries ruled, so a band spanning
                   Tue noon to Thu noon is readable rather than a floating bar. -->
              <div
                v-for="col in dayColumns"
                :key="col.at"
                class="absolute top-0 h-8"
                :class="col.weekend ? 'bg-surface-panel' : ''"
                :style="{ left: `${col.offset * 100}%`, width: `${col.width * 100}%` }"
              />
              <div
                v-for="col in dayColumns.slice(1)"
                :key="`rule-${col.at}`"
                class="bg-border-subtle absolute top-0 h-8 w-px"
                :style="{ left: `${col.offset * 100}%` }"
              />
              <div
                v-for="(band, i) in track.bands"
                :key="i"
                class="absolute top-0 flex h-8 items-center overflow-hidden rounded-default border-l-2 px-2"
                :class="bandClass(band)"
                :style="bandStyle(band)"
                :title="raw(band.user_email || t('oncall.calendarNobody'))"
                :data-test="`oncall-calendar-band-${track.name}-${i}`"
              >
                <span class="truncate text-2xs">
                  {{ band.user_email ? raw(band.user_email) : t("oncall.calendarNobody") }}
                </span>
              </div>

              <!-- Where "now" falls, so the whole chart reads against it. -->
              <div
                v-if="nowOffset !== null"
                class="bg-accent absolute top-0 h-8 w-px"
                :style="{ left: `${nowOffset * 100}%` }"
                data-test="oncall-calendar-now"
              />
            </div>
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
import type { CalendarBand, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nKey } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { colorIndexFor, memberAt, shiftBands } from "@/utils/oncall";

const props = defineProps<{ rotations: Rotation[] }>();

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

const windowStart = computed(() => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return (startOfDay.getTime() + offsetDays.value * 86_400_000) * 1000;
});
const windowEnd = computed(() => windowStart.value + days.value * MICROS_PER_DAY);

const windowLabel = computed(() => {
  const fmt = (micros: number) => new Date(micros / 1000).toLocaleDateString();
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
  const out: { at: number; offset: number; width: number; weekend: boolean }[] = [];
  for (let i = 0; i < days.value; i++) {
    const at = windowStart.value + i * MICROS_PER_DAY;
    const day = new Date(at / 1000).getDay();
    out.push({
      at,
      offset: (at - windowStart.value) / span,
      width: MICROS_PER_DAY / span,
      weekend: day === 0 || day === 6,
    });
  }
  return out;
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
      label: new Date(col.at / 1000).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
      }),
    }));
});

const nowLabel = computed(() =>
  new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
);

const finalBands = computed<CalendarBand[]>(() => {
  const span = windowEnd.value - windowStart.value;
  if (span <= 0 || !props.rotations.length) return [];

  const slices = 96;
  const step = span / slices;
  const out: CalendarBand[] = [];

  for (let i = 0; i < slices; i++) {
    const at = windowStart.value + i * step;
    // Last rotation wins, matching the server's "more specific / higher
    // priority" resolution closely enough to read; the server remains the
    // authority for who is actually paged.
    let holder = "";
    for (const r of props.rotations) {
      const m = memberAt(r, at);
      if (m) holder = m;
    }
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

const tracks = computed(() => [
  ...props.rotations.map((r) => ({
    name: r.name,
    bands: shiftBands(r, windowStart.value, windowEnd.value),
  })),
  { name: t("oncall.calendarFinal"), bands: finalBands.value },
]);

function shift(direction: number) {
  offsetDays.value += direction * days.value;
}

function goToday() {
  offsetDays.value = 0;
}

function bandStyle(band: CalendarBand) {
  return { left: `${band.offset * 100}%`, width: `${band.width * 100}%` };
}

// Identity rides a coloured cap on a calm surface, not a saturated fill. A
// chart where every block is loud signals nothing, and the old palette spent
// `warning` and `orange` on ordinary shifts — the app's "something is wrong"
// colours, on a rota working exactly as intended.
const PERSON_CAPS = [
  "border-l-status-info-text",
  "border-l-status-success-text",
  "border-l-accent",
  "border-l-icon-chip-purple-text",
  "border-l-icon-chip-orange-text",
];

function bandClass(band: CalendarBand): string {
  // A gap is a hole, not another person's block: hatched, so it reads as
  // absence at a glance and needs no legend.
  if (!band.user_email) {
    return "bg-status-error-bg text-status-error-text border-l-status-error-text";
  }
  const cap = PERSON_CAPS[colorIndexFor(band.user_email, PERSON_CAPS.length)];
  // Exactly one band per track is filled: whoever is on call right now.
  const now = Date.now() * 1000;
  const current = now >= band.startMicros && now < band.endMicros;
  return current
    ? `bg-status-success-bg text-status-success-text ${cap}`
    : `bg-surface-panel text-text-body ${cap}`;
}
</script>
