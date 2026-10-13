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
  <OScheduleTimeline
    v-if="track.bands.length"
    :tracks="[track]"
    :axis-ticks="ticks"
    :now-offset="nowOffset"
    :now-label="t('alerts.downtimes.band.now')"
    label-width="sm"
    data-test="downtime-schedule-band"
  />
  <p v-else class="text-text-muted text-xs" data-test="downtime-schedule-band-empty">
    {{ t("alerts.downtimes.band.none") }}
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { DowntimeWindow } from "@/services/downtimes";
import { formatWindowTime } from "@/utils/downtimes/schedule";
import type {
  ScheduleAxisTick,
  ScheduleBand,
  ScheduleBandTone,
  ScheduleBandVariant,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import OScheduleTimeline from "@/lib/data/ScheduleTimeline/OScheduleTimeline.vue";

const props = withDefaults(
  defineProps<{
    /** Windows that already ended, oldest first. */
    past?: DowntimeWindow[];
    active?: DowntimeWindow | null;
    next?: DowntimeWindow | null;
    timezone: string;
    /** Microseconds UTC; the page passes its clock so the band and the text agree. */
    nowMicros: number;
  }>(),
  { past: () => [], active: null, next: null },
);

const { t } = useI18nTyped();

type Kind = "past" | "active" | "next";

const STYLE: Record<Kind, { tone: ScheduleBandTone; variant: ScheduleBandVariant }> = {
  past: { tone: 6, variant: "soft" },
  active: { tone: "partial", variant: "solid" },
  next: { tone: 1, variant: "outline" },
};

const windows = computed(() => {
  const list: { kind: Kind; w: DowntimeWindow }[] = props.past.map((w) => ({ kind: "past", w }));
  if (props.active) list.push({ kind: "active", w: props.active });
  if (props.next) list.push({ kind: "next", w: props.next });
  return list;
});

// The visible span runs from the first window to the last, padded by a tenth each side.
const span = computed(() => {
  const all = windows.value;
  if (!all.length) return null;
  const first = Math.min(props.nowMicros, ...all.map((x) => x.w.start));
  const last = Math.max(props.nowMicros, ...all.map((x) => x.w.end));
  const pad = Math.max((last - first) / 10, 3600 * 1_000_000);
  return { from: first - pad, length: last - first + 2 * pad };
});

const share = (micros: number) =>
  span.value ? Math.min(1, Math.max(0, (micros - span.value.from) / span.value.length)) : 0;

const label = (kind: Kind): I18nText =>
  kind === "active"
    ? t("alerts.downtimes.band.active")
    : kind === "next"
      ? t("alerts.downtimes.band.next")
      : t("alerts.downtimes.band.past");

const track = computed<ScheduleTrack>(() => ({
  key: "occurrences",
  label: t("alerts.downtimes.band.track"),
  bands: windows.value.map(({ kind, w }, i): ScheduleBand => {
    const offset = share(w.start);
    return {
      key: `${kind}-${i}`,
      offset,
      width: Math.max(share(w.end) - offset, 0.005),
      label: label(kind),
      ariaLabel: t("alerts.downtimes.band.aria", {
        kind: label(kind),
        start: formatWindowTime(w.start, props.timezone),
        end: formatWindowTime(w.end, props.timezone),
      }),
      ...STYLE[kind],
    };
  }),
}));

const ticks = computed<ScheduleAxisTick[]>(() =>
  windows.value.map(({ w }) => ({
    offset: share(w.start),
    label: raw(formatWindowTime(w.start, props.timezone).split(",")[0]),
  })),
);

const nowOffset = computed(() => {
  if (!span.value) return null;
  const s = share(props.nowMicros);
  return s > 0 && s < 1 ? s : null;
});
</script>
