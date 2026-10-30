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

<!-- The rotation's one "Who's on call" area: the server's preview of the draft, as a picture or a list. -->
<template>
  <section class="flex flex-col gap-4" data-test="oncall-draft-preview">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h3 class="text-base font-semibold">{{ t("oncall.previewHeading") }}</h3>
      <OText variant="meta" data-test="oncall-draft-preview-zone">{{ rangeLine }}</OText>
      <span class="ms-auto flex items-center gap-2">
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="chevron-left"
          :disabled="page === 0"
          :aria-label="t('oncall.calendarPrev')"
          data-test="oncall-draft-preview-prev"
          @click="page -= 1"
        />
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="chevron-right"
          :aria-label="t('oncall.calendarNext')"
          data-test="oncall-draft-preview-next"
          @click="page += 1"
        />
        <OToggleGroup
          :model-value="view"
          type="single"
          data-test="oncall-draft-preview-view"
          @update:model-value="onViewChange"
        >
          <OToggleGroupItem value="picture" size="sm" data-test="oncall-draft-preview-picture">
            {{ t("oncall.previewPicture") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="list" size="sm" data-test="oncall-draft-preview-list">
            {{ t("oncall.previewList") }}
          </OToggleGroupItem>
        </OToggleGroup>
      </span>
    </div>

    <template v-if="view === 'picture'">
      <p
        v-if="error"
        class="text-status-error-text text-xs"
        data-test="oncall-schedule-preview-error"
      >
        {{ error }}
      </p>
      <template v-else-if="!segments.length">
        <OText v-if="showEmpty" variant="meta" data-test="oncall-schedule-preview-empty">
          {{ t("oncall.rotationPreviewEmpty") }}
        </OText>
      </template>
      <OScheduleTimeline
        v-else
        label-width="sm"
        :tracks="tracks"
        :axis-ticks="axisTicks"
        :now-offset="nowOffset"
        :now-track-key="today ? String(today.start) : undefined"
        :now-label="nowLabel"
        data-test="oncall-draft-preview-chart"
      >
        <template #legend>
          <span class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>{{ t("oncall.previewLegendActive", { rule: raw(activeRuleName) }) }}</span>
            <span>{{ t("oncall.previewLegendOthers") }}</span>
            <span>{{ t("oncall.legendNobody") }}</span>
          </span>
        </template>
      </OScheduleTimeline>
    </template>

    <OnCallUpcomingList
      v-else
      :segments="stretches"
      :window-from="windowFrom"
      :window-to="windowTo"
      :now-micros="nowMicros"
      :timezone="timezone"
      :multi-rule="multiRule"
      :error="error"
      :show-empty="showEmpty"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
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
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import {
  dayFraction,
  dayRows,
  formatInZone,
  holderStretches,
  rotationMembers,
} from "@/utils/oncall";
import { PREVIEW_DAYS } from "@/composables/useRotationPreview";
import OnCallUpcomingList from "./OnCallUpcomingList.vue";

const props = defineProps<{
  rotation: Rotation;
  activeRuleName: string;
  segments: ResolvedSegment[];
  windowFrom: number;
  windowTo: number;
  nowMicros: number;
  timezone: string;
  error: I18nText | null;
  showEmpty: boolean;
  nameOf: (email: string) => string;
}>();

const page = defineModel<number>("page", { required: true });

const { t } = useI18nTyped();

const view = ref<"picture" | "list">("picture");

function onViewChange(value: unknown) {
  // A re-press clears a single-select group; a view is not something this area can be without.
  if (value === "picture" || value === "list") view.value = value;
}

const multiRule = computed(() => props.rotation.shift_rules.length > 1);

const fmt = (micros: number, opts: Intl.DateTimeFormatOptions) =>
  formatInZone(micros, props.timezone, opts);
const dayLabel = (micros: number) =>
  fmt(micros, { weekday: "short", day: "numeric", month: "short" });
const time = (micros: number) =>
  fmt(micros, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const rangeLine = computed<I18nText>(() =>
  t("oncall.previewRange", {
    from: raw(dayLabel(props.windowFrom)),
    to: raw(dayLabel(rows.value[rows.value.length - 1].start)),
    zone: raw(props.timezone),
  }),
);

// Colour is a hint that cycles; the band's label carries who it is.
const tones = computed(() => {
  const order = rotationMembers(props.rotation);
  return (email: string) => {
    const at = order.indexOf(email);
    return (((at < 0 ? order.length : at) % SCHEDULE_BAND_TONE_COUNT) + 1) as ScheduleBand["tone"];
  };
});

const stretches = computed(() => holderStretches(props.segments));

const rows = computed(() =>
  dayRows(stretches.value, props.windowFrom, PREVIEW_DAYS, props.timezone),
);

const tracks = computed<ScheduleTrack[]>(() =>
  rows.value.map((row) => ({
    key: String(row.start),
    label: raw(dayLabel(row.start)),
    bands: row.pieces.map<ScheduleBand>(({ from, to, segment }) => {
      const who = segment.user_email ?? "";
      const offset = dayFraction(from, row, props.timezone);
      return {
        key: `${row.start}-${from}`,
        offset,
        width: dayFraction(to, row, props.timezone) - offset,
        label: who ? raw(props.nameOf(who)) : t("oncall.calendarNobody"),
        ariaLabel: t("oncall.previewBandAria", {
          who: who ? raw(who) : t("oncall.calendarNobody"),
          from: raw(`${dayLabel(from)} ${time(from)}`),
          to: raw(time(to)),
          rule: raw(segment.rotation ?? ""),
        }),
        tone: who ? tones.value(who) : "gap",
        variant: segment.override_id
          ? "outline"
          : !who || segment.rotation === props.activeRuleName
            ? "solid"
            : "soft",
      };
    }),
  })),
);

// No 24:00 tick: a label centred on the right edge would hang outside the panel.
const axisTicks: ScheduleAxisTick[] = [0, 6, 12, 18].map((hour) => ({
  offset: hour / 24,
  label: raw(`${String(hour).padStart(2, "0")}:00`),
}));

const today = computed(() =>
  rows.value.find((row) => row.start <= props.nowMicros && props.nowMicros < row.end),
);

const nowOffset = computed(() => {
  const row = today.value;
  return row ? dayFraction(props.nowMicros, row, props.timezone) : null;
});

const nowLabel = computed(() => t("oncall.previewNow", { time: raw(time(props.nowMicros)) }));
</script>
