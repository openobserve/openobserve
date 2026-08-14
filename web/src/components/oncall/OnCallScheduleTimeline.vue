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
  The schedule as it will actually resolve, one lane per rotation.

  Segments come from the SERVER (`resolved-schedule`), not from rotation
  arithmetic on this side: restrictions, the winning layer and covers all change
  who is on at a given instant, and a preview that recomputed them here would
  eventually disagree with the engine that pages people. The editor's own
  preview still resolves locally, because it has to draw a draft nobody saved.

  A span with nobody in it is a segment like any other, which is what makes a
  gap impossible to miss rather than something inferred from a hole.
-->
<template>
  <div class="flex flex-col gap-3" data-test="oncall-schedule-timeline">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <OText variant="panel-title" data-test="oncall-timeline-range">{{ rangeLabel }}</OText>
      <OText variant="meta">{{ zoneLine }}</OText>

      <!-- Two ways of narrowing what the chart is saying. "Gaps only" is the
           one somebody reaches for when the answer is "where is the hole", and
           it is a filter rather than a separate view so the axis does not move
           underneath them. -->
      <span class="ms-auto flex flex-wrap items-center gap-3">
        <OSwitch
          v-model="gapsOnly"
          size="sm"
          :label="t('oncall.timelineGapsOnly')"
          data-test="oncall-timeline-gaps-only"
        />
        <OSwitch
          v-model="showOverrides"
          size="sm"
          :label="t('oncall.timelineShowOverrides')"
          data-test="oncall-timeline-show-overrides"
        />
      </span>

      <span class="flex items-center gap-1">
        <OButton
          v-for="option in RANGES"
          :key="option.key"
          :variant="option.key === rangeKey ? 'primary' : 'outline'"
          size="xs"
          :data-test="`oncall-timeline-range-${option.key}`"
          @click="rangeKey = option.key"
        >
          {{ t(option.labelKey) }}
        </OButton>
        <OButton
          variant="outline"
          size="xs"
          data-test="oncall-timeline-today"
          @click="offsetDays = 0"
        >
          {{ t("oncall.calendarToday") }}
        </OButton>
      </span>
    </div>

    <OInnerLoading v-if="loading" showing />

    <OScheduleTimeline
      v-else
      :tracks="tracks"
      :axis-ticks="axisTicks"
      :now-offset="nowOffset"
      :now-label="nowLabel"
      data-test="oncall-timeline-chart"
    >
      <template #legend>
        <span class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span class="text-text-secondary flex items-center gap-1.5 text-xs">
            <span class="bg-schedule-band-1-bg size-2 rounded-full" aria-hidden="true" />
            {{ t("oncall.timelineOnShift") }}
          </span>
          <!-- The gap is the only thing on this chart worth acting on, so it is
               the only legend entry that carries its own sentence and a way to
               fix it. -->
          <span
            v-if="firstGap"
            class="text-status-error-text flex flex-wrap items-center gap-1.5 text-xs"
            data-test="oncall-timeline-gap"
          >
            <span class="bg-schedule-gap-bg size-2 rounded-full" aria-hidden="true" />
            {{ gapLabel }}
          </span>
          <OButton
            v-if="firstGap"
            variant="outline"
            size="xs"
            class="ms-auto"
            data-test="oncall-timeline-fill-gap"
            @click="emit('fill-gap', firstGap)"
          >
            {{ t("oncall.timelineFillGap") }}
          </OButton>
        </span>
      </template>
    </OScheduleTimeline>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OScheduleTimeline from "@/lib/data/ScheduleTimeline/OScheduleTimeline.vue";
import type {
  ScheduleAxisTick,
  ScheduleBand,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import { SCHEDULE_BAND_TONE_COUNT } from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { colorIndexFor, formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    /** Lane order and labels. Segments alone would lose an empty rotation. */
    rotations?: Rotation[];
    segments?: ResolvedSegment[];
    timezone?: string;
    loading?: boolean;
  }>(),
  { rotations: () => [], segments: () => [], timezone: "UTC", loading: false },
);

const emit = defineEmits<{ (e: "fill-gap", gap: ResolvedSegment): void }>();
/** The window the parent must fetch, whenever the reader changes it. */
const window = defineModel<{ from: number; to: number }>("window", { required: true });

const { t } = useI18nTyped();

/// Two lenses on the same window rather than two views: the axis, the range and
/// the now-marker stay put, so narrowing to gaps does not cost the reader their
/// place on the chart.
const gapsOnly = ref(false);
const showOverrides = ref(true);
const nowMicros = useOnCallClock();

const RANGES = [
  { key: "day", days: 1, labelKey: "oncall.calendarDay" },
  { key: "week", days: 7, labelKey: "oncall.calendarWeek" },
  { key: "fortnight", days: 14, labelKey: "oncall.calendarFortnight" },
] as const satisfies ReadonlyArray<{ key: string; days: number; labelKey: I18nKey }>;

// A week, because a rotation is usually weekly and a week is the span somebody
// can hold in their head.
const rangeKey = ref<(typeof RANGES)[number]["key"]>("week");
const offsetDays = ref(0);

const days = computed(() => RANGES.find((r) => r.key === rangeKey.value)?.days ?? 7);

/// Anchored to the start of the local day so the axis ticks land on midnights
/// rather than on whatever minute the page was opened.
const from = computed(() => {
  const dayStart = Math.floor(nowMicros.value / MICROS_PER_DAY) * MICROS_PER_DAY;
  return dayStart + offsetDays.value * MICROS_PER_DAY;
});
const to = computed(() => from.value + days.value * MICROS_PER_DAY);
const span = computed(() => to.value - from.value);

// The parent owns the fetch; this only says which window it should ask for.
watch(
  [from, to],
  ([f, t2]) => {
    window.value = { from: f, to: t2 };
  },
  { immediate: true },
);

const fmt = (micros: number, opts: Intl.DateTimeFormatOptions) =>
  formatInZone(micros, props.timezone, opts);

const rangeLabel = computed<I18nText>(() =>
  raw(
    `${fmt(from.value, { day: "numeric", month: "short" })} – ${fmt(to.value - 1, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`,
  ),
);

/// The team's zone AND the reader's, because the two are usually different and
/// a handover time is meaningless until you know which one it is in.
const zoneLine = computed<I18nText>(() =>
  t("oncall.timelineZone", {
    zone: raw(props.timezone),
    local: raw(
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(nowMicros.value / 1000)),
    ),
  }),
);

/// Marks a span somebody is covering rather than one the rotation produced.
const COVER_MARK = "⤺";

const share = (micros: number) => (micros - from.value) / span.value;

/// One lane per rotation, in the order the schedule lists them. Driven by the
/// rotations rather than by the segments so a layer that resolves to nobody all
/// week still gets a lane — an absent lane reads as "no such rotation".
/// Which slots the segments actually answer for.
///
/// `resolved-schedule` resolves **one slot** — a team with a staffed
/// `secondary` gets no `secondary` segments back. Drawing that rotation a lane
/// and filling it from these left a blank week under the word "Secondary",
/// which reads as "nobody is backing you up" when the truth is "this view did
/// not ask". Lanes for an unanswered slot say so instead.
const answeredSlots = computed(
  () => new Set(props.segments.map((segment) => (segment.slot ?? DEFAULT_SLOT).toLowerCase())),
);

const tracks = computed<ScheduleTrack[]>(() => {
  const lanes = props.rotations.length
    ? props.rotations.map((rotation) => ({ name: rotation.name, slot: rotation.slot }))
    : [...new Set(props.segments.map((segment) => segment.rotation))].map((name) => ({
        name,
        slot: undefined as string | undefined,
      }));

  return lanes.map(({ name, slot }) => ({
    key: name,
    label: raw(name),
    // Only for a slot nothing was resolved for — a slot that WAS resolved and
    // genuinely has nobody on it is a coverage gap, and must keep reading as
    // one rather than being excused as "not shown".
    note: answeredSlots.value.has((slot ?? DEFAULT_SLOT).toLowerCase())
      ? undefined
      : t("oncall.timelineSlotNotResolved", { slot: raw(slot ?? DEFAULT_SLOT) }),
    bands: props.segments
      .filter(
        (segment) =>
          segment.rotation === name &&
          segment.to > from.value &&
          segment.from < to.value &&
          // "Gaps only" keeps the axis and the window and drops everything that
          // is not the question being asked.
          (!gapsOnly.value || !segment.user_email),
      )
      .map<ScheduleBand>((segment) => {
        const start = Math.max(segment.from, from.value);
        const end = Math.min(segment.to, to.value);
        const who = segment.user_email ?? "";
        return {
          key: `${name}-${segment.from}`,
          offset: share(start),
          width: (end - start) / span.value,
          // A cover reads as "Sam is covering Tuesday", never as "the rotation
          // changed" — the layer it displaced is still the one it belongs to.
          // With overrides hidden the cover still shows WHO is on — it is the
          // resolved answer either way — it just stops being called out as a
          // departure from the rotation.
          label: raw(showOverrides.value && segment.override_id ? `${who} ${COVER_MARK}` : who),
          ariaLabel: t(segment.override_id ? "oncall.timelineCoverAria" : "oncall.timelineBandAria", {
            who: who ? raw(who) : t("oncall.calendarNobody"),
            rotation: raw(name),
            from: raw(fmt(start, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
            to: raw(fmt(end, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
          }),
          // The decorative ramp is exactly right here: its job is to say "a
          // different person from the one beside you", and it is keyed off the
          // address so somebody keeps their colour as the window scrolls.
          tone: who
            ? ((colorIndexFor(who, SCHEDULE_BAND_TONE_COUNT) + 1) as ScheduleBand["tone"])
            : "gap",
        };
      }),
  }));
});

/// One tick per day boundary, skipped on the fortnight view where fourteen
/// labels collide into a smear.
const axisTicks = computed<ScheduleAxisTick[]>(() => {
  const step = days.value > 7 ? 2 : 1;
  const ticks: ScheduleAxisTick[] = [];
  for (let day = 0; day < days.value; day += step) {
    const at = from.value + day * MICROS_PER_DAY;
    ticks.push({
      offset: share(at),
      label: raw(fmt(at, { weekday: "short", day: "numeric" })),
    });
  }
  return ticks;
});

/// Null when the window does not contain the present, which is the common case
/// once somebody pages forward.
const nowOffset = computed(() =>
  nowMicros.value >= from.value && nowMicros.value < to.value ? share(nowMicros.value) : null,
);

const nowLabel = computed(() => raw(fmt(nowMicros.value, { hour: "2-digit", minute: "2-digit" })));

/// The first stretch nobody covers. One is enough to act on, and a legend
/// listing every gap is one nobody reads.
const firstGap = computed<ResolvedSegment | null>(
  () =>
    props.segments.find(
      (segment) => !segment.user_email && segment.to > from.value && segment.from < to.value,
    ) ?? null,
);

const gapLabel = computed<I18nText>(() => {
  const gap = firstGap.value;
  if (!gap) return raw("");
  return t("oncall.timelineGapAt", {
    rotation: raw(gap.rotation),
    range: raw(
      `${fmt(gap.from, { weekday: "short", hour: "2-digit", minute: "2-digit" })}–${fmt(gap.to, {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    ),
  });
});
</script>
