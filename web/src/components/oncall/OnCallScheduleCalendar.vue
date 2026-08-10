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
            <div class="bg-surface-panel relative h-8 flex-1 rounded-default">
              <div
                v-for="(band, i) in track.bands"
                :key="i"
                class="absolute top-0 flex h-8 items-center overflow-hidden rounded-default px-2"
                :class="bandClass(band.user_email)"
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

// A gap is the one thing on this chart worth a loud colour: alerts routed here
// during it page nobody.
// The five registered chip tones that are not error — error stays reserved
// for a gap, which is the one thing here worth alarming about.
const PERSON_CLASSES = [
  "bg-icon-chip-info-bg text-icon-chip-info-text",
  "bg-icon-chip-success-bg text-icon-chip-success-text",
  "bg-icon-chip-orange-bg text-icon-chip-orange-text",
  "bg-icon-chip-primary-bg text-icon-chip-primary-text",
  "bg-icon-chip-warning-bg text-icon-chip-warning-text",
];

function bandClass(email: string): string {
  if (!email) return "bg-status-error-bg text-status-error-text";
  return PERSON_CLASSES[colorIndexFor(email, PERSON_CLASSES.length)];
}
</script>
