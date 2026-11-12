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
  eventually disagree with the engine that pages people.

  A span with nobody in it is a segment like any other, which is what makes a
  gap impossible to miss rather than something inferred from a hole.
-->
<template>
  <div class="relative flex flex-col gap-3" data-test="oncall-schedule-timeline">
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
        icon-left="event"
        data-test="oncall-timeline-today"
        @click="offsetDays = 0"
      >
        {{ t("oncall.calendarToday") }}
      </OButton>

      <!-- Only when the reader is elsewhere: a handover time is ambiguous only then. -->
      <OTooltip v-if="zoneDiffers" side="bottom" :content="zoneLine">
        <OTag
          variant="default-outline"
          size="sm"
          icon="schedule"
          tabindex="0"
          class="cursor-help"
          data-test="oncall-timeline-zone"
        >
          {{ raw(timezone) }}
        </OTag>
      </OTooltip>

      <span class="ms-auto flex flex-wrap items-center gap-2 max-md:ms-0 max-md:w-full">
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

        <!-- Both items add a rotation; replacing an existing one's rules lives on its lane. -->
        <ODropdown align="end">
          <template #trigger>
            <OButton
              variant="outline"
              size="sm-action"
              icon-left="add"
              icon-right="arrow-drop-down"
              data-test="oncall-timeline-add"
            >
              {{ t("oncall.addRotation") }}
            </OButton>
          </template>
          <ODropdownItem
            icon-left="dashboard-customize"
            data-test="oncall-timeline-add-template"
            @select="emit('presets')"
          >
            {{ t("oncall.addRotationFromTemplate") }}
          </ODropdownItem>
          <ODropdownItem
            icon-left="edit"
            data-test="oncall-timeline-add-scratch"
            @select="emit('add')"
          >
            {{ t("oncall.addRotationFromScratch") }}
          </ODropdownItem>
        </ODropdown>
      </span>
    </div>

    <OInnerLoading v-if="loading" showing />

    <!-- The only place a template is the main road: a team with nothing to replace. -->
    <OEmptyState
      v-else-if="!rotationTracks.length"
      size="block"
      preset="no-oncall-schedule"
      data-test="oncall-timeline-empty"
      @action="(id) => (id === 'presets' ? emit('presets') : emit('add'))"
    />

    <OScheduleTimeline
      v-else
      lane-headers
      :tracks="tracks"
      :axis-ticks="axisTicks"
      :now-offset="nowOffset"
      :now-label="nowLabel"
      :hover-label="hoverLabel"
      :hide-hover="openMenus.size > 0"
      data-test="oncall-timeline-chart"
      @hover="hoverAt = $event"
    >
      <!-- What the rail's cards used to say, on the row they describe: what
           this rotation is, when it turns over, and how many people carry it. -->
      <template #track-header="{ track }">
        <div
          v-if="track.key === AWAY_TRACK"
          class="flex flex-wrap items-center gap-x-2 gap-y-1"
          data-test="oncall-lane-header-away"
        >
          <span class="bg-badge-warning-solid-bg size-2 shrink-0 rounded-full" aria-hidden="true" />
          <OText variant="section">{{ track.label }}</OText>
        </div>
        <div
          v-else
          class="flex flex-wrap items-center gap-x-2 gap-y-1"
          :data-test="`oncall-lane-header-${track.key}`"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="dotClass(laneOf(track).index)"
            aria-hidden="true"
          />
          <OText variant="section">{{ track.label }}</OText>
          <OText
            variant="meta"
            class="max-md:order-last max-md:basis-full"
            :data-test="`oncall-lane-cadence-${track.key}`"
          >
            {{ laneOf(track).cadence }}
          </OText>
          <OText
            v-if="laneOf(track).alongside"
            variant="meta"
            class="max-md:order-last"
            :data-test="`oncall-lane-alongside-${track.key}`"
          >
            {{ laneOf(track).alongside }}
          </OText>
          <span
            v-if="!laneOf(track).escalated"
            class="text-status-warning-text text-xs max-md:order-last"
            :data-test="`oncall-lane-no-escalation-${track.key}`"
          >
            {{ t("oncall.laneNoEscalation") }}
          </span>

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
              variant="ghost"
              size="icon-sm"
              icon-left="edit"
              :aria-label="t('oncall.edit')"
              :data-test="`oncall-lane-edit-${track.key}`"
              @click="emit('edit', laneOf(track).id)"
            >
              <OTooltip side="bottom" :content="t('oncall.edit')" />
            </OButton>

            <!-- Edit is the one act worth a button of its own; the rest are
                 rarer and would each cost a lane's width every row. -->
            <ODropdown
              align="end"
              @update:open="(isOpen: boolean) => trackMenu(`lane:${track.key}`, isOpen)"
            >
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="icon-sm"
                  icon-left="more-vert"
                  :aria-label="t('oncall.laneMore', { name: track.label })"
                  :data-test="`oncall-lane-menu-${track.key}`"
                />
              </template>
              <ODropdownItem
                icon-left="restart-alt"
                :data-test="`oncall-lane-presets-${track.key}`"
                @select="emit('presets', laneOf(track).id)"
              >
                {{ t("oncall.presetsReplaceRules") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="person-add"
                :data-test="`oncall-lane-override-${track.key}`"
                @select="emit('override', laneOf(track).id)"
              >
                {{ t("oncall.railOverride") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="content-copy"
                :data-test="`oncall-lane-duplicate-${track.key}`"
                @select="emit('duplicate', laneOf(track).id)"
              >
                {{ t("oncall.railDuplicate") }}
              </ODropdownItem>
              <ODropdownItem
                icon-left="delete-outline"
                variant="destructive"
                :data-test="`oncall-lane-delete-${track.key}`"
                @select="emit('delete', laneOf(track).id)"
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
            icon-left="person-add"
            :data-test="`oncall-lane-assign-${track.key}`"
            @click="emit('assign-people', laneOf(track).id)"
          >
            {{ t("oncall.laneEmptyAssign") }}
          </OButton>
        </div>
      </template>

      <!-- The tooltip follows the band, so it anchors to the band itself, not to the menu around it. -->
      <template #band="{ band }">
        <ODropdown
          v-if="bandActions(band.key).length"
          align="start"
          @update:open="(isOpen: boolean) => trackMenu(`band:${band.key}`, isOpen)"
        >
          <template #trigger>
            <OScheduleBand
              :band="band"
              :tooltip="bandTip(band.key) ? false : undefined"
              role="button"
              aria-haspopup="menu"
              class="cursor-pointer"
            />
          </template>
          <ODropdownItem
            v-for="action in bandActions(band.key)"
            :key="action.id"
            :icon-left="action.icon"
            :data-test="`oncall-shift-menu-${action.id}`"
            @select="onBandAction(action.id, band.key)"
          >
            {{ action.label }}
          </ODropdownItem>
        </ODropdown>
        <OScheduleBand v-else :band="band" :tooltip="bandTip(band.key) ? false : undefined" />
        <OTooltip
          v-if="bandTip(band.key)"
          side="top"
          :content="bandTip(band.key)"
          :data-test="`oncall-shift-tip-${band.key}`"
        />
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
          <span
            v-if="hasOff"
            class="text-text-secondary flex items-center gap-1.5 text-xs"
            data-test="oncall-timeline-legend-off"
          >
            <span
              class="bg-surface-subtle border-border-strong size-2 rounded-full border border-dashed"
              aria-hidden="true"
            />
            {{ t("oncall.timelineOff") }}
          </span>
          <span
            v-if="awayTrack"
            class="text-text-secondary flex items-center gap-1.5 text-xs"
            data-test="oncall-timeline-legend-away"
          >
            <span class="bg-badge-warning-solid-bg size-2 rounded-full" aria-hidden="true" />
            {{ t("oncall.timelineAwayLane") }}
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
              v-if="canCover"
              variant="outline"
              size="xs"
              class="ms-auto"
              icon-left="person-add"
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

import useBreakpoint from "@/composables/useBreakpoint";
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
import OScheduleBand from "@/lib/data/ScheduleTimeline/OScheduleBand.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type {
  OnCallPolicy,
  ResolvedSegment,
  Rotation,
  ShiftRule,
  TimeWindow,
  Unavailability,
} from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { I18nKey, I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  formatInZone,
  formatMinuteOfDay,
  MINUTES_PER_DAY,
  rotationMembers,
  zonedMidnight,
  zoneCaption,
} from "@/utils/oncall";
import { formatMicrosDuration } from "@/utils/formatters";
import { useOrgUserNames } from "@/composables/useOrgUserNames";
import { segmentSpanKey } from "./resolvedShifts";
import type { LaneCadence } from "./OnCallScheduleTimeline.lanes";
import {
  isOffStretch,
  laneCadence,
  pagedAlone,
  pagedAtAll,
  pagedTogether,
} from "./OnCallScheduleTimeline.lanes";

export type ShiftAction = "cover" | "swap" | "away";

const props = withDefaults(
  defineProps<{
    /** Lane order and labels. Segments alone would lose an empty rotation. */
    rotations?: Rotation[];
    segments?: ResolvedSegment[];
    timezone?: string;
    loading?: boolean;
    /**
     * Whether there is anybody to hand a cover to.
     *
     * A cover — filling a gap or writing one from the toolbar — assigns a
     * window to a PERSON, so on a team with an empty roster either button
     * opens a picker with no options. Defaults true so a caller that does not
     * know still shows them.
     */
    canCover?: boolean;
    /** Absences overlapping the window, already narrowed to this team's people. */
    absences?: Unavailability[];
    /** May book anybody's absence; without it a reader may still book their own. */
    canMarkAway?: boolean;
    selfEmail?: string;
    /** Rotations with upcoming shifts to trade; a shift of any other offers no swap. */
    swapRotations?: string[];
    /** The whole shift behind a band the window's edges cut, keyed by `segmentSpanKey`. */
    shiftSpans?: Record<string, { from: number; to: number }>;
    /** Decides whether a lane's empty stretch is a gap or Off; null keeps every one a gap. */
    policy?: OnCallPolicy | null;
  }>(),
  {
    rotations: () => [],
    segments: () => [],
    timezone: "UTC",
    loading: false,
    canCover: true,
    absences: () => [],
    canMarkAway: true,
    selfEmail: "",
    swapRotations: () => [],
    shiftSpans: () => ({}),
    policy: null,
  },
);

const emit = defineEmits<{
  (e: "fill-gap", gap: ResolvedSegment): void;
  (e: "add"): void;
  /// Carries the lane's rotation id when its rules are to be replaced; none adds a rotation.
  (e: "presets", rotationId?: string): void;
  (e: "shift-action", action: ShiftAction, segment: ResolvedSegment): void;
  (e: "clear-away", absenceId: string): void;
  /// Carries the rotation's **id**, not its name: a name is renameable and two
  /// rotations may share one, so a name cannot say which row was meant.
  (e: "edit" | "duplicate" | "override" | "delete" | "assign-people", rotationId: string): void;
}>();

/** The window the parent must fetch, whenever the reader changes it. */
const window = defineModel<{ from: number; to: number }>("window", { required: true });

const { t } = useI18nTyped();
const { isMobile } = useBreakpoint();

const nowMicros = useOnCallClock();

// Band labels only: a narrow bar has no room for an email; the aria-label keeps the full address.
const { nameOf, tooltipOf } = useOrgUserNames();

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

/// Anchored to the start of the TEAM's day so the axis ticks land on its
/// midnights rather than on whatever minute the page was opened.
const from = computed(() => zonedMidnight(nowMicros.value, props.timezone, offsetDays.value));
const to = computed(() =>
  zonedMidnight(nowMicros.value, props.timezone, offsetDays.value + days.value),
);
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
  days.value === 1
    ? raw(fmt(from.value, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))
    : raw(
        `${fmt(from.value, { day: "numeric", month: "short" })} – ${fmt(to.value - 1, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`,
      ),
);

const localZone = computed(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

const zoneDiffers = computed(() => props.timezone !== localZone.value);

const zoneLine = computed<I18nText>(() =>
  zoneCaption(props.timezone, localZone.value, nowMicros.value, t),
);

const share = (micros: number) => (micros - from.value) / span.value;

/// Which rotations the segments actually answer for.
///
/// `resolved-schedule` resolves **one rotation** per call. Drawing a rotation a
/// lane and filling it from segments that answer for a different one left a
/// blank week under its name, which reads as "nobody is on call" when the truth
/// is "this view did not ask". Lanes for an unanswered rotation say so instead.
const answeredRotations = computed(
  () => new Set(props.segments.map((segment) => segment.rotation_id)),
);

/// Weekday names starting at MONDAY, matching `TimeWindow.days` (which the
/// engine indexes from Monday, not from Sunday).
const WEEKDAYS = computed(() => {
  // Read in UTC: the dates below are UTC midnights, and a browser west of UTC would name the day before.
  const format = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
});

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

/// The cadence in words; true on any day, unlike a next-handover instant a restriction can make meaningless.
function cadenceWords(cadence: LaneCadence): string {
  switch (cadence.kind) {
    case "weekly":
      return String(
        t("oncall.laneCadenceWeekly", {
          when: raw(`${WEEKDAYS.value[cadence.weekday]} ${formatMinuteOfDay(cadence.minute)}`),
        }),
      );
    case "daily":
      return String(t("oncall.laneCadenceDaily", { time: raw(formatMinuteOfDay(cadence.minute)) }));
    case "days":
      return String(
        t("oncall.laneCadenceDays", {
          count: cadence.days,
          time: raw(formatMinuteOfDay(cadence.minute)),
        }),
      );
    case "every":
      return String(
        t("oncall.laneCadenceEvery", { duration: raw(formatMicrosDuration(cadence.micros)) }),
      );
  }
}

/// The real start and end of the shift behind a segment, which the window's edges may have cut.
function realSpanOf(segment: ResolvedSegment): { from: number; to: number } {
  return props.shiftSpans[segmentSpanKey(segment)] ?? segment;
}

// A segment ending where the fetch stopped was cut there, so its end says nothing about a handover.
function endsInWindow(segment: ResolvedSegment): boolean {
  return segment.to < to.value;
}

/// Everything the lane header says about a rotation, computed once per lane.
interface Lane {
  index: number;
  /** The rotation's id — the lane key, and what a level stores. */
  id: string;
  name: string;
  cadence: I18nText;
  /** Nobody is in any of its rules, so no level that names it can page. */
  notPaging: boolean;
  /** The endpoint did not resolve this rotation at all. */
  unanswered: boolean;
  /** Some level pages this rotation alone, so its empty stretches are gaps rather than Off. */
  alone: boolean;
  /** Some step names this rotation, or no policy is loaded to say otherwise. */
  escalated: boolean;
  /** "paged alongside <first>" when one level pages both; empty otherwise. */
  alongside: I18nText | "";
  /** What an Off band's tooltip says. */
  offTip: I18nText;
}

const lanes = computed<Lane[]>(() =>
  // ONE LANE PER ROTATION, and only from `props.rotations`: a team with no rotations gets no nameless lane to point a menu at.
  props.rotations.map((rotation, index) => {
    const first = props.rotations[0];
    const count = rotationMembers(rotation).length;
    return {
      index,
      id: rotation.id,
      name: rotation.name,
      cadence: raw(
        [...cadenceParts(rotation), String(t("oncall.lanePeople", { count }, count))].join(" · "),
      ),
      notPaging: count === 0,
      unanswered: !answeredRotations.value.has(rotation.id),
      alone: pagedAlone(props.policy, rotation.id),
      escalated: pagedAtAll(props.policy, rotation.id),
      alongside:
        index > 0 && pagedTogether(props.policy, rotation.id, first.id)
          ? t("oncall.lanePagedAlongside", { name: raw(first.name) })
          : "",
      offTip: offTipOf(rotation.shift_rules ?? []),
    };
  }),
);

/// What the rotation's rules say, then the cadence they share; never the current bar, which a cover or absence cuts short.
function cadenceParts(rotation: Rotation): string[] {
  const now = nowMicros.value;
  const all = rotation.shift_rules ?? [];
  const rules = all.filter((rule) => (rule.ends_at ?? Infinity) > now);
  const only = rules.length === 1 ? rules[0] : null;
  const window = only?.restrictions?.[0];
  const parts: string[] = [];
  if (only && window) parts.push(...windowParts(window));
  // Numbered by place in the full list, as the editor names them, so a stopped rule keeps its number.
  else if (!only) parts.push(...rules.map((rule) => ruleName(rule, all.indexOf(rule))));
  const cadence = laneCadence(rules, now, props.timezone);
  if (cadence) parts.push(cadenceWords(cadence));
  return parts;
}

/// A one-rule rotation restricted to a window: its days and its hours.
function windowParts(window: TimeWindow): string[] {
  const parts: string[] = [];
  const range = dayRange(window);
  if (range) parts.push(range);
  // 0 -> 1440 covers the entire day; without this a full-day rule and a zero-length one both read "00:00–00:00".
  if (window.start_minute === 0 && window.end_minute === MINUTES_PER_DAY) {
    parts.push(String(t("oncall.laneAllDay")));
  } else {
    parts.push(`${formatMinuteOfDay(window.start_minute)}–${formatMinuteOfDay(window.end_minute)}`);
  }
  return parts;
}

function ruleName(rule: ShiftRule, index: number): string {
  return rule.name?.trim() || String(t("oncall.shiftRuleNthName", { n: index + 1 }));
}

/// An unrestricted rule holds every hour, so a rotation with one has no hours to be outside of.
function offTipOf(rules: ShiftRule[]): I18nText {
  if (!rules.length || rules.some((rule) => !rule.restrictions?.length)) {
    return t("oncall.timelineOff");
  }
  const hours = rules
    .flatMap((rule) => rule.restrictions ?? [])
    .map((window) => windowParts(window).join(", "))
    .join("; ");
  return t("oncall.timelineOffTip", { hours: raw(hours) });
}

const laneByKey = computed(() => new Map(lanes.value.map((lane) => [lane.id, lane])));

/// The primitive hands back a `ScheduleTrack`; the header needs the lane behind
/// it. Keyed on the track key, which IS the rotation id — a name is renameable
/// and two rotations may share one, so it cannot key a lane.
function laneOf(track: ScheduleTrack): Lane {
  return (
    laneByKey.value.get(track.key) ?? {
      index: 0,
      id: track.key,
      name: track.key,
      cadence: raw(""),
      notPaging: false,
      unanswered: false,
      alone: true,
      escalated: true,
      alongside: "",
      offTip: t("oncall.timelineOff"),
    }
  );
}

/// Why this lane is empty — three different facts that all render as blank
/// track, and which the reader cannot tell apart without being told.
function emptyLine(track: ScheduleTrack): I18nText {
  const lane = laneOf(track);
  if (lane.notPaging) return t("oncall.laneEmptyNoMembers");
  // Names the rotation that is MISSING. An earlier wording put that same name
  // after "this calendar resolves", which said the opposite of the truth about
  // the one lane whose whole problem is that it was not resolved.
  if (lane.unanswered) return t("oncall.timelineRotationNotResolved", { rotation: raw(lane.name) });
  return t("oncall.laneEmptyNeverWins");
}

// By id: two rotations may share a name, and a name-keyed band acted on the other one.
const bandKeyOf = (lane: Lane, segment: ResolvedSegment) => `${lane.id}-${segment.from}`;

const AWAY_TRACK = "__away";

const rotationTracks = computed<ScheduleTrack[]>(() =>
  lanes.value.map((lane) => ({
    key: lane.id,
    label: raw(lane.name),
    bands: props.segments
      .filter(
        (segment) =>
          segment.rotation_id === lane.id && segment.to > from.value && segment.from < to.value,
      )
      .map<ScheduleBand>((segment) => {
        const start = Math.max(segment.from, from.value);
        const end = Math.min(segment.to, to.value);
        const who = segment.user_email ?? "";
        const whoLabel = who ? nameOf(who) : "";
        const isNow = segment.from <= nowMicros.value && segment.to > nowMicros.value;
        const off = isOff(segment, lane);

        // The band the reader is actually looking for says so, and says when it
        // ends — the two facts they came to the tab for, on the span itself
        // rather than only in the line above the chart.
        let label: I18nText = off ? t("oncall.timelineOff") : raw(whoLabel);
        if (who && segment.override_id) {
          label = t("oncall.schedBandOverride", { who: raw(whoLabel) });
        } else if (who && isNow && endsInWindow(segment)) {
          label = t("oncall.schedBandOnNow", {
            who: raw(whoLabel),
            when: raw(fmt(segment.to, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
          });
        } else if (who && isNow) {
          label = t("oncall.schedBandOnNowOpen", { who: raw(whoLabel) });
        }

        return {
          key: bandKeyOf(lane, segment),
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
          tone: bandTone(lane, who, off),
          // A cover keeps the lane's hue — it is still that rotation's time —
          // but hollow, because the roster did not produce it.
          variant: segment.override_id ? "outline" : "solid",
        };
      }),
  })),
);

/// Outside every rule's hours in a lane no level pages alone; an empty stretch inside a rule's hours is always a gap.
function isOff(segment: ResolvedSegment, lane: Lane | undefined): boolean {
  return !!lane && isOffStretch(segment, lane.alone);
}

function bandTone(lane: Lane, who: string, off: boolean): ScheduleBand["tone"] {
  if (who) return ((lane.index % SCHEDULE_BAND_TONE_COUNT) + 1) as ScheduleBand["tone"];
  return off ? "off" : "gap";
}

const bandRange = (start: number, end: number) => ({
  from: raw(fmt(start, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
  to: raw(fmt(end, { weekday: "short", hour: "2-digit", minute: "2-digit" })),
});

/// Its own lane rather than marks on the rotation lanes: an absence is a person's, and a person can sit in several rotations.
const awayTrack = computed<ScheduleTrack | null>(() => {
  const bands = props.absences
    .filter((absence) => absence.end_at > from.value && absence.start_at < to.value)
    .map<ScheduleBand>((absence) => {
      const start = Math.max(absence.start_at, from.value);
      const end = Math.min(absence.end_at, to.value);
      const who = nameOf(absence.user_email);
      return {
        key: `away-${absence.id}`,
        offset: share(start),
        width: (end - start) / span.value,
        label: t("oncall.timelineAwayBand", { who: raw(who) }),
        ariaLabel: t("oncall.timelineAwayAria", {
          who: raw(absence.user_email),
          ...bandRange(start, end),
        }),
        tone: "partial",
      };
    });
  return bands.length ? { key: AWAY_TRACK, label: t("oncall.timelineAwayLane"), bands } : null;
});

const hasOff = computed(() =>
  rotationTracks.value.some((track) => track.bands.some((band) => band.tone === "off")),
);

const tracks = computed<ScheduleTrack[]>(() =>
  awayTrack.value ? [...rotationTracks.value, awayTrack.value] : rotationTracks.value,
);

/// The segment behind each drawn band, so a click on one can act on its rotation, person and window.
const segmentByBand = computed(() => {
  const map = new Map<string, ResolvedSegment>();
  for (const lane of lanes.value) {
    for (const segment of props.segments) {
      if (segment.rotation_id === lane.id) map.set(bandKeyOf(lane, segment), segment);
    }
  }
  return map;
});

const tipRange = (start: number, end: number) =>
  t("oncall.shiftBandTipRangeZoned", {
    from: raw(fmt(start, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
    to: raw(fmt(end, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
    zone: raw(props.timezone),
  });

/// Name and email for a band's person, because the band itself only has room for a name and two people can share one.
function bandTip(bandKey: string): I18nText | undefined {
  const segment = segmentByBand.value.get(bandKey);
  if (segment?.user_email) {
    const whole = realSpanOf(segment);
    const person = tooltipOf(segment.user_email);
    const range = tipRange(whole.from, whole.to);
    return segment.rotation
      ? t("oncall.shiftBandTipRule", { person, rule: raw(segment.rotation), range })
      : t("oncall.shiftBandTip", { person, range });
  }
  const lane = segment ? laneByKey.value.get(segment.rotation_id) : undefined;
  if (segment && lane && isOff(segment, lane)) return lane.offTip;
  const absence = absenceByBand(bandKey);
  if (!absence) return undefined;
  return t("oncall.shiftBandTip", {
    person: tooltipOf(absence.user_email),
    range: tipRange(absence.start_at, absence.end_at),
  });
}

type BandAction = ShiftAction | "clear-away";

interface ShiftMenuItem {
  id: BandAction;
  icon: IconName;
  label: I18nText;
}

const absenceByBand = (bandKey: string) =>
  props.absences.find((one) => `away-${one.id}` === bandKey);

/// A shift's acts, or an absence's undo for whoever could have marked it; anything already over offers nothing.
function bandActions(bandKey: string): ShiftMenuItem[] {
  const absence = absenceByBand(bandKey);
  if (!absence) return shiftActions(bandKey);
  const mayMark =
    props.canMarkAway || absence.user_email.toLowerCase() === props.selfEmail.toLowerCase();
  if (!mayMark || absence.end_at <= nowMicros.value) return [];
  return [{ id: "clear-away", icon: "event-available", label: t("oncall.awayClear") }];
}

/// Only what this reader can do to this shift; a shift that is already over offers nothing.
function shiftActions(bandKey: string): ShiftMenuItem[] {
  const segment = segmentByBand.value.get(bandKey);
  if (!segment || segment.to <= nowMicros.value) return [];
  // Nobody needs an Off stretch covered, as its missing "Fill this gap" says.
  if (isOff(segment, laneByKey.value.get(segment.rotation_id))) return [];
  const who = segment.user_email ?? "";
  const items: ShiftMenuItem[] = [];
  if (props.canCover) {
    items.push({ id: "cover", icon: "person-add", label: t("oncall.shiftMenuCover") });
  }
  // A cover's span is not the roster's, so it has no shift of its own to trade.
  if (
    who &&
    !segment.override_id &&
    props.canCover &&
    props.swapRotations.includes(segment.rotation_id)
  ) {
    items.push({ id: "swap", icon: "swap-horiz", label: t("oncall.shiftMenuSwap") });
  }
  if (who && (props.canMarkAway || who.toLowerCase() === props.selfEmail.toLowerCase())) {
    items.push({
      id: "away",
      icon: "event-busy",
      label: t("oncall.shiftMenuAway", { name: raw(nameOf(who)) }),
    });
  }
  return items;
}

function onBandAction(action: BandAction, bandKey: string) {
  if (action === "clear-away") {
    const absence = absenceByBand(bandKey);
    if (absence) emit("clear-away", absence.id);
    return;
  }
  const segment = segmentByBand.value.get(bandKey);
  if (segment) emit("shift-action", action, segment);
}

/// One tick per day boundary, skipped on the fortnight view where fourteen
/// labels collide into a smear.
///
/// Date over weekday, in two lines: the axis labels COLUMNS of a week, and a
/// reader scanning for "which day is that band on" reads the number. Today is
/// called out, because every other instant on the chart is read relative to it.
const axisTicks = computed<ScheduleAxisTick[]>(() => {
  if (days.value === 1) return hourTicks.value;
  const step = days.value > 7 ? 2 : 1;
  const today = zonedMidnight(nowMicros.value, props.timezone);
  const ticks: ScheduleAxisTick[] = [];
  for (let day = 0; day < days.value; day += step) {
    const at = zonedMidnight(from.value, props.timezone, day);
    ticks.push({
      offset: share(at),
      label: raw(fmt(at, { day: "numeric" })),
      // A phone column is narrower than "Wed · today", which would run into the next day; the emphasis still marks it.
      sublabel:
        at === today && !isMobile.value
          ? t("oncall.schedAxisToday", { weekday: raw(fmt(at, { weekday: "short" })) })
          : raw(fmt(at, { weekday: "short" })),
      emphasis: at === today,
    });
  }
  return ticks;
});

const HOUR_MICROS = MICROS_PER_DAY / 24;

// Stepped from the window's start rather than per wall hour, so a clock-change day keeps evenly spaced ticks.
const hourTicks = computed<ScheduleAxisTick[]>(() => {
  const every = isMobile.value ? 6 : 3;
  const ticks: ScheduleAxisTick[] = [];
  for (let at = from.value; at < to.value; at += every * HOUR_MICROS) {
    ticks.push({
      offset: share(at),
      label: raw(fmt(at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })),
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

/// A menu open over the chart takes the pointer, so the hover line would freeze under it.
const openMenus = ref(new Set<string>());
function trackMenu(key: string, isOpen: boolean) {
  const next = new Set(openMenus.value);
  if (isOpen) next.add(key);
  else next.delete(key);
  openMenus.value = next;
}

const hoverLabel = computed(() =>
  hoverAt.value === null ? undefined : stamp(from.value + hoverAt.value * span.value),
);

/// The first stretch nobody covers that a level needs covered. One is enough to act on, and a legend
/// listing every gap is one nobody reads.
const firstGap = computed<ResolvedSegment | null>(
  () =>
    props.segments.find(
      (segment) =>
        !segment.user_email &&
        segment.to > from.value &&
        segment.from < to.value &&
        !isOff(segment, laneByKey.value.get(segment.rotation_id)),
    ) ?? null,
);

const gapLabel = computed<I18nText>(() => {
  const gap = firstGap.value;
  if (!gap) return raw("");
  // A gap that crosses midnight needs the day at BOTH ends: a week-long hole
  // printed as `Wed 05:30–05:30` reads as one of zero length.
  const sameDay = fmt(gap.from, { weekday: "short" }) === fmt(gap.to, { weekday: "short" });
  const range = raw(
    `${fmt(gap.from, { weekday: "short", hour: "2-digit", minute: "2-digit" })}–${fmt(
      gap.to,
      sameDay
        ? { hour: "2-digit", minute: "2-digit" }
        : { weekday: "short", hour: "2-digit", minute: "2-digit" },
    )}`,
  );
  // Unowned gaps are the whole of an unstaffed team's week, and naming no
  // rotation left the sentence with a hole where the name should be.
  return gap.rotation
    ? t("oncall.timelineGapAt", { rotation: raw(gap.rotation), range })
    : t("oncall.timelineGapUnowned", { range });
});
</script>
