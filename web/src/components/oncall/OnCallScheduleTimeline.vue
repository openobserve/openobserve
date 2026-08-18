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
  The schedule as it will actually resolve — one lane per rotation, and each
  rotation on the screen exactly once.

  It used to be twice: a card in a rail beside the chart restated the name, the
  cadence, who was on and how long was left, all of which the lane already
  draws. Two renderings of one fact is two chances to disagree, and the reader
  had to check which one was right. The card's job survives as the LANE HEADER —
  the header carries the cadence, the band carries who and for how long.

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
    <!-- Where you are, and how to move. Paging the window is the thing done
         most often here, so it leads rather than sitting under a menu. -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="flex items-center gap-1">
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="chevron-left"
          :aria-label="t('oncall.calendarPrev')"
          data-test="oncall-timeline-prev"
          @click="offsetDays -= days"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="chevron-right"
          :aria-label="t('oncall.calendarNext')"
          data-test="oncall-timeline-next"
          @click="offsetDays += days"
        />
      </span>

      <OText variant="panel-title" data-test="oncall-timeline-range">{{ rangeLabel }}</OText>

      <OButton
        variant="outline"
        size="xs"
        :disabled="offsetDays === 0"
        data-test="oncall-timeline-today"
        @click="offsetDays = 0"
      >
        {{ t("oncall.calendarToday") }}
      </OButton>

      <!-- The team's zone AND the reader's, because the two are usually
           different and a handover time is meaningless until you know which. -->
      <OText variant="meta" data-test="oncall-timeline-zone">{{ zoneLine }}</OText>

      <span class="ms-auto flex flex-wrap items-center gap-2">
        <OToggleGroup
          :model-value="rangeKey"
          type="single"
          data-test="oncall-timeline-range-group"
          @update:model-value="onRangeChange"
        >
          <OToggleGroupItem
            v-for="option in RANGES"
            :key="option.key"
            :value="option.key"
            size="sm"
            :data-test="`oncall-timeline-range-${option.key}`"
          >
            {{ t(option.labelKey) }}
          </OToggleGroupItem>
        </OToggleGroup>

        <OButton
          variant="outline"
          size="sm-action"
          icon-left="add"
          data-test="oncall-timeline-add"
          @click="emit('add')"
        >
          {{ t("oncall.addRotation") }}
        </OButton>

        <!-- Beside Add, not under it: hand-building follow-the-sun out of
             restriction windows is the thing a preset saves you from, so the
             choice belongs where the adding is decided. -->
        <ODropdown align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="expand-more"
              :aria-label="t('oncall.presetsTitle')"
              data-test="oncall-timeline-add-menu"
            />
          </template>
          <ODropdownItem data-test="oncall-timeline-presets" @select="emit('presets')">
            {{ t("oncall.presetsTitle") }}
          </ODropdownItem>
        </ODropdown>
      </span>
    </div>

    <OInnerLoading v-if="loading" showing />

    <OEmptyState
      v-else-if="!tracks.length"
      size="inline"
      preset="no-data"
      :description="t('oncall.calendarEmpty')"
      :action-label="t('oncall.addRotation')"
      data-test="oncall-timeline-empty"
      @action="emit('add')"
    />

    <OScheduleTimeline
      v-else
      lane-headers
      :tracks="tracks"
      :axis-ticks="axisTicks"
      :now-offset="nowOffset"
      :now-label="nowLabel"
      :hover-label="hoverLabel"
      data-test="oncall-timeline-chart"
      @hover="hoverAt = $event"
    >
      <!-- What the rail's cards used to say, on the row they describe: what
           this rotation is, when it turns over, and how many people carry it. -->
      <template #track-header="{ track }">
        <div
          class="flex flex-wrap items-center gap-x-2 gap-y-1"
          :data-test="`oncall-lane-header-${track.key}`"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="dotClass(laneOf(track).index)"
            aria-hidden="true"
          />
          <OText variant="section">{{ track.label }}</OText>
          <OText variant="meta" :data-test="`oncall-lane-cadence-${track.key}`">
            {{ laneOf(track).cadence }}
          </OText>

          <span class="ms-auto flex items-center gap-1">
            <!-- Stated in the words that describe the consequence, not as a
                 load figure somebody has to convert into one. -->
            <OTag
              v-if="laneOf(track).notPaging"
              variant="error-soft"
              size="sm"
              :data-test="`oncall-lane-not-paging-${track.key}`"
            >
              {{ t("oncall.laneNotPaging") }}
              <OTooltip side="bottom" :content="t('oncall.laneNotPagingWhy')" />
            </OTag>

            <OButton
              variant="outline"
              size="xs"
              :data-test="`oncall-lane-edit-${track.key}`"
              @click="emit('edit', laneOf(track).name)"
            >
              {{ t("oncall.edit") }}
            </OButton>

            <!-- Edit is the one act worth a button of its own; the rest are
                 rarer and would each cost a lane's width every row. -->
            <ODropdown align="end">
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="more-horiz"
                  :aria-label="t('oncall.laneMore', { name: track.label })"
                  :data-test="`oncall-lane-menu-${track.key}`"
                />
              </template>
              <ODropdownItem
                :data-test="`oncall-lane-override-${track.key}`"
                @select="emit('override', laneOf(track).name)"
              >
                {{ t("oncall.railOverride") }}
              </ODropdownItem>
              <ODropdownItem
                :data-test="`oncall-lane-duplicate-${track.key}`"
                @select="emit('duplicate', laneOf(track).name)"
              >
                {{ t("oncall.railDuplicate") }}
              </ODropdownItem>
              <ODropdownItem
                variant="destructive"
                :data-test="`oncall-lane-delete-${track.key}`"
                @select="emit('delete', laneOf(track).name)"
              >
                {{ t("oncall.laneDelete") }}
              </ODropdownItem>
            </ODropdown>
          </span>
        </div>
      </template>

      <!-- An empty lane is the loudest answer on the chart, and it was a blank
           strip. It says what the emptiness costs, and offers the one act that
           ends it. -->
      <template #track-empty="{ track }">
        <div
          class="border-border-default rounded-default flex min-h-7 flex-wrap items-center gap-2 border border-dashed px-3 py-2"
          :data-test="`oncall-lane-empty-${track.key}`"
        >
          <span class="text-text-secondary text-sm">{{ emptyLine(track) }}</span>
          <OButton
            v-if="laneOf(track).notPaging"
            variant="primary"
            size="xs"
            class="ms-auto"
            :data-test="`oncall-lane-assign-${track.key}`"
            @click="emit('assign-people', laneOf(track).name)"
          >
            {{ t("oncall.laneEmptyAssign") }}
          </OButton>
        </div>
      </template>

      <!-- Three entries, and every one of them means something. The old key
           explained that a six-colour ramp meant nothing on its own, which is
           an argument for a different ramp rather than a longer caption: hue is
           now the ROTATION, and the three fills are the three kinds of span. -->
      <template #legend>
        <span class="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
          <span class="text-text-secondary flex items-center gap-1.5 text-xs">
            <span class="bg-schedule-band-1-solid-bg size-2 rounded-full" aria-hidden="true" />
            {{ t("oncall.legendOnShift") }}
          </span>
          <span class="text-text-secondary flex items-center gap-1.5 text-xs">
            <span
              class="border-schedule-band-1-border size-2 rounded-full border"
              aria-hidden="true"
            />
            {{ t("oncall.legendOverride") }}
          </span>
          <span class="text-text-secondary flex items-center gap-1.5 text-xs">
            <span
              class="bg-schedule-gap-bg border-schedule-gap-border size-2 rounded-full border border-dashed"
              aria-hidden="true"
            />
            {{ t("oncall.legendNobody") }}
          </span>

          <!-- The gap is the only thing on this chart worth acting on, so it is
               the only legend entry that carries its own sentence and a way to
               fix it. -->
          <template v-if="firstGap">
            <span
              class="text-status-error-text flex flex-wrap items-center gap-1.5 text-xs"
              data-test="oncall-timeline-gap"
            >
              {{ gapLabel }}
            </span>
            <OButton
              variant="outline"
              size="xs"
              class="ms-auto"
              data-test="oncall-timeline-fill-gap"
              @click="emit('fill-gap', firstGap)"
            >
              {{ t("oncall.timelineFillGap") }}
            </OButton>
          </template>
        </span>
      </template>
    </OScheduleTimeline>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useOnCallClock } from "@/composables/useOnCallClock";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OScheduleTimeline from "@/lib/data/ScheduleTimeline/OScheduleTimeline.vue";
import type {
  ScheduleAxisTick,
  ScheduleBand,
  ScheduleTrack,
} from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import { SCHEDULE_BAND_TONE_COUNT } from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ResolvedSegment, Rotation, TimeWindow } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatInZone } from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";

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

const emit = defineEmits<{
  (e: "fill-gap", gap: ResolvedSegment): void;
  (e: "add"): void;
  (e: "presets"): void;
  (e: "edit" | "duplicate" | "override" | "delete" | "assign-people", name: string): void;
}>();

/** The window the parent must fetch, whenever the reader changes it. */
const window = defineModel<{ from: number; to: number }>("window", { required: true });

const { t } = useI18nTyped();

const nowMicros = useOnCallClock();

/// The lane dots, spelled out rather than built from the index: Tailwind reads
/// class names as literal text, so a template-built `bg-schedule-band-${n}-...`
/// produces no CSS and a row of blank dots.
const DOT_TONES = [
  "bg-schedule-band-1-solid-bg",
  "bg-schedule-band-2-solid-bg",
  "bg-schedule-band-3-solid-bg",
  "bg-schedule-band-4-solid-bg",
  "bg-schedule-band-5-solid-bg",
  "bg-schedule-band-6-solid-bg",
];

const dotClass = (index: number) => DOT_TONES[index % DOT_TONES.length];

const RANGES = [
  { key: "day", days: 1, labelKey: "oncall.calendarDay" },
  { key: "week", days: 7, labelKey: "oncall.calendarWeek" },
  { key: "fortnight", days: 14, labelKey: "oncall.calendarFortnight" },
] as const satisfies ReadonlyArray<{ key: string; days: number; labelKey: I18nKey }>;

type RangeKey = (typeof RANGES)[number]["key"];

// A week, because a rotation is usually weekly and a week is the span somebody
// can hold in their head.
const rangeKey = ref<RangeKey>("week");
const offsetDays = ref(0);

function onRangeChange(value: unknown) {
  // reka-ui clears a single-select group when the active item is re-pressed.
  // A range is not something a schedule can be without, so a null is ignored
  // rather than collapsing the chart to no window at all.
  if (typeof value === "string" && RANGES.some((r) => r.key === value)) {
    rangeKey.value = value as RangeKey;
  }
}

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

const localZone = computed(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

/// Said the short way when the two zones agree, because "your local time is
/// 09:59" under a clock reading 09:59 is a sentence that costs a read and
/// carries nothing.
const zoneLine = computed<I18nText>(() =>
  localZone.value === props.timezone
    ? t("oncall.schedZoneSame", { zone: raw(props.timezone) })
    : t("oncall.schedZoneDiff", {
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

const share = (micros: number) => (micros - from.value) / span.value;

/// Which pools the segments actually answer for.
///
/// `resolved-schedule` resolves **one slot** — a team with a staffed
/// `secondary` gets no `secondary` segments back. Drawing that rotation a lane
/// and filling it from these left a blank week under the word "Secondary",
/// which reads as "nobody is backing you up" when the truth is "this view did
/// not ask". Lanes for an unanswered slot say so instead.
const answeredSlots = computed(
  () => new Set(props.segments.map((segment) => (segment.slot ?? DEFAULT_SLOT).toLowerCase())),
);

/// Weekday names starting at MONDAY, matching `TimeWindow.days` (which the
/// engine indexes from Monday, not from Sunday).
const WEEKDAYS = computed(() => {
  const format = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
});

const minuteLabel = (minute: number) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/// "Mon–Fri" for a run, "Sat, Tue" for anything else. A seven-day window is the
/// same as no window and says nothing, so it is dropped.
function dayRange(window: TimeWindow): string {
  const days = [...new Set(window.days ?? [])].sort((a, b) => a - b);
  if (!days.length || days.length === 7) return "";
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const name = (d: number) => WEEKDAYS.value[d] ?? String(d);
  return contiguous && days.length > 1
    ? `${name(days[0])}–${name(days[days.length - 1])}`
    : days.map(name).join(", ");
}

function cadenceWord(shiftMicros: number): string {
  if (shiftMicros === MICROS_PER_DAY) return String(t("oncall.laneCadenceDaily"));
  if (shiftMicros === 7 * MICROS_PER_DAY) return String(t("oncall.laneCadenceWeekly"));
  return String(
    t("oncall.laneCadenceEvery", { duration: raw(formatMicrosDuration(shiftMicros)) }),
  );
}

/// The next instant this rotation hands the pool to somebody else, taken from
/// the SEGMENTS rather than from `anchor + n * shift`: a cover or a restriction
/// ends the current shift somewhere the cadence alone would not put it.
function nextHandover(name: string): number | null {
  const current = props.segments.find(
    (segment) =>
      segment.rotation === name &&
      segment.from <= nowMicros.value &&
      segment.to > nowMicros.value,
  );
  return current?.to ?? null;
}

/// Everything the lane header says about a rotation, computed once per lane.
interface Lane {
  index: number;
  name: string;
  cadence: I18nText;
  /** Nobody is in it, so no rung that names it can page. */
  notPaging: boolean;
  /** The endpoint did not resolve this rotation's pool at all. */
  unanswered: boolean;
}

const lanes = computed<Lane[]>(() => {
  const source: Array<{ name: string; rotation: Rotation | null }> = props.rotations.length
    ? props.rotations.map((rotation) => ({ name: rotation.name, rotation }))
    : [...new Set(props.segments.map((segment) => segment.rotation))].map((name) => ({
        name,
        rotation: null,
      }));

  return source.map(({ name, rotation }, index) => {
    const parts: string[] = [];
    const window = rotation?.restrictions?.[0];

    if (window) {
      const range = dayRange(window);
      if (range) parts.push(range);
      parts.push(String(t("oncall.laneShifts", { duration: raw(formatMicrosDuration(rotation.shift_micros)) })));
      parts.push(`${minuteLabel(window.start_minute)} / ${minuteLabel(window.end_minute)}`);
    } else if (rotation) {
      parts.push(cadenceWord(rotation.shift_micros));
      const handover = nextHandover(name);
      if (handover) {
        parts.push(
          String(
            t("oncall.laneHandsOver", {
              when: raw(fmt(handover, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
            }),
          ),
        );
      }
    }

    const count = rotation?.members?.length ?? 0;
    if (rotation) parts.push(String(t("oncall.lanePeople", { count }, count)));

    return {
      index,
      name,
      cadence: raw(parts.join(" · ")),
      notPaging: !!rotation && count === 0,
      unanswered: !answeredSlots.value.has((rotation?.slot ?? DEFAULT_SLOT).toLowerCase()),
    };
  });
});

const laneByKey = computed(() => new Map(lanes.value.map((lane) => [lane.name, lane])));

/// The primitive hands back a `ScheduleTrack`; the header needs the lane behind
/// it. Keyed on the track key, which IS the rotation name.
function laneOf(track: ScheduleTrack): Lane {
  return (
    laneByKey.value.get(track.key) ?? {
      index: 0,
      name: track.key,
      cadence: raw(""),
      notPaging: false,
      unanswered: false,
    }
  );
}

/// Why this lane is empty — three different facts that all render as blank
/// track, and which the reader cannot tell apart without being told.
function emptyLine(track: ScheduleTrack): I18nText {
  const lane = laneOf(track);
  if (lane.notPaging) return t("oncall.laneEmptyNoMembers");
  if (lane.unanswered) {
    const rotation = props.rotations.find((r) => r.name === lane.name);
    // Names the pool that is MISSING. An earlier wording put that same pool
    // after "this calendar resolves", which said the opposite of the truth
    // about the one lane whose whole problem is that it was not resolved.
    return t("oncall.timelineSlotNotResolved", { slot: raw(rotation?.slot ?? DEFAULT_SLOT) });
  }
  return t("oncall.laneEmptyNeverWins");
}

const tracks = computed<ScheduleTrack[]>(() =>
  lanes.value.map((lane) => ({
    key: lane.name,
    label: raw(lane.name),
    bands: props.segments
      .filter(
        (segment) =>
          segment.rotation === lane.name && segment.to > from.value && segment.from < to.value,
      )
      .map<ScheduleBand>((segment) => {
        const start = Math.max(segment.from, from.value);
        const end = Math.min(segment.to, to.value);
        const who = segment.user_email ?? "";
        const isNow = segment.from <= nowMicros.value && segment.to > nowMicros.value;

        // The band the reader is actually looking for says so, and says when it
        // ends — the two facts they came to the tab for, on the span itself
        // rather than only in the line above the chart.
        let label: I18nText = raw(who);
        if (who && segment.override_id) {
          label = t("oncall.schedBandOverride", { who: raw(who) });
        } else if (who && isNow) {
          label = t("oncall.schedBandOnNow", {
            who: raw(who),
            when: raw(fmt(segment.to, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
          });
        }

        return {
          key: `${lane.name}-${segment.from}`,
          offset: share(start),
          width: (end - start) / span.value,
          label,
          ariaLabel: t(
            segment.override_id ? "oncall.timelineCoverAria" : "oncall.timelineBandAria",
            {
              who: who ? raw(who) : t("oncall.calendarNobody"),
              rotation: raw(lane.name),
              from: raw(fmt(start, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
              to: raw(fmt(end, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
            },
          ),
          // Hue is the ROTATION, not the person: the question this chart is read
          // for is "which layer decided this", and a colour per person answered
          // a question nobody was asking while making two lanes look alike.
          tone: who
            ? (((lane.index % SCHEDULE_BAND_TONE_COUNT) + 1) as ScheduleBand["tone"])
            : "gap",
          // A cover keeps the lane's hue — it is still that rotation's time —
          // but hollow, because the roster did not produce it.
          variant: segment.override_id ? "outline" : "solid",
        };
      }),
  })),
);

/// One tick per day boundary, skipped on the fortnight view where fourteen
/// labels collide into a smear.
///
/// Date over weekday, in two lines: the axis labels COLUMNS of a week, and a
/// reader scanning for "which day is that band on" reads the number. Today is
/// called out, because every other instant on the chart is read relative to it.
const axisTicks = computed<ScheduleAxisTick[]>(() => {
  const step = days.value > 7 ? 2 : 1;
  const today = Math.floor(nowMicros.value / MICROS_PER_DAY) * MICROS_PER_DAY;
  const ticks: ScheduleAxisTick[] = [];
  for (let day = 0; day < days.value; day += step) {
    const at = from.value + day * MICROS_PER_DAY;
    ticks.push({
      offset: share(at),
      label: raw(fmt(at, { day: "numeric" })),
      sublabel:
        at === today
          ? t("oncall.schedAxisToday", { weekday: raw(fmt(at, { weekday: "short" })) })
          : raw(fmt(at, { weekday: "short" })),
      emphasis: at === today,
    });
  }
  return ticks;
});

/// Null when the window does not contain the present, which is the common case
/// once somebody pages forward.
const nowOffset = computed(() =>
  nowMicros.value >= from.value && nowMicros.value < to.value ? share(nowMicros.value) : null,
);

/// Date AND time, not just the clock. On a week or a fortnight the hour alone
/// does not say which column the line is standing in, which is the only thing
/// the marker is there to answer.
const stamp = (micros: number) =>
  raw(fmt(micros, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));

const nowLabel = computed(() => stamp(nowMicros.value));

/// Where the pointer is, as a share of the window — the chart owns the
/// geometry and hands the share over; only this side knows what instant the
/// share lands on, because only this side knows `from` and `to`.
const hoverAt = ref<number | null>(null);

const hoverLabel = computed(() =>
  hoverAt.value === null ? undefined : stamp(from.value + hoverAt.value * span.value),
);

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
