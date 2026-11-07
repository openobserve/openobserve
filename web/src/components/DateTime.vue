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
  <div
    ref="rootEl"
    icon="info"
    class="date-time-container inline-flex items-stretch [&_button:focus-visible]:z-1"
    :class="{
      'rounded-default border-button-outline-border min-h-7.5 border': !hideRangeShift,
      'w-full [&>*]:flex-1': fieldAppearance,
      'max-w-full min-w-0': triggerView.kind === 'absolute',
    }"
  >
    <OTooltip v-if="!hideRangeShift" :content="t('common.previous')">
      <OButton
        data-test="date-time-prev-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border h-auto! rounded-e-none! border-e!"
        icon-left="chevron-left"
        :aria-label="t('common.previous')"
        :disabled="disable || disablePrevShift"
        @click.prevent.stop="shiftTimeRange('prev')"
      />
    </OTooltip>
    <OPopover
      v-model:open="menuOpen"
      side="bottom"
      :align="menuAlign"
      :z-index="10001"
      :aria-label="t('common.selectDateRange')"
      :collision-padding="POPOVER_COLLISION_PADDING"
      content-class="border-border-default! overflow-hidden p-0 shadow-lg!"
      @update:open="onMenuOpenChange"
      @open-auto-focus="onPopoverOpenAutoFocus"
      @pointer-down-outside="onPointerDownOutside"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          :variant="variant"
          :size="fieldAppearance ? 'sm' : 'sm-toolbar'"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
            'md:min-w-71.5': !disableRelative && selectedType === 'absolute',
            'w-fit': disableRelative,
            'h-auto! rounded-none! border-0!': !hideRangeShift,
            'border-select-border! enabled:hover:border-select-border-hover! w-full':
              fieldAppearance,
            'max-w-full min-w-0': triggerView.kind === 'absolute',
          }"
          class="max-md:max-w-full max-md:min-w-0"
          :disabled="disable"
          :data-start-us="triggerView.kind === 'absolute' ? triggerView.startUs : undefined"
          :data-end-us="triggerView.kind === 'absolute' ? triggerView.endUs : undefined"
          :aria-describedby="triggerTooltip && !menuOpen ? triggerDescriptionId : undefined"
          @mouseenter="refreshTooltipNow"
        >
          <template #icon-left>
            <OTooltip
              v-if="triggerTooltip && !menuOpen"
              :content="triggerTooltip"
              content-class="whitespace-pre-line"
              max-width="30rem"
            />
            <OIcon name="schedule" size="sm" />
          </template>
          <span
            v-if="triggerView.kind === 'absolute' && !triggerText"
            ref="triggerLabelEl"
            class="date-time-label min-w-0 flex-1 overflow-hidden text-start whitespace-nowrap"
            :class="fieldAppearance ? 'font-normal' : 'font-semibold'"
          >
            <span v-if="ladderStep === 3" data-test="date-time-btn-duration">{{
              triggerView.duration
            }}</span>
            <template v-else>
              <span>{{ ladderStep === 1 ? triggerView.full.range : triggerView.short.range }}</span>
              <span
                v-if="triggerView.full.zone"
                data-test="date-time-btn-tz"
                class="text-text-secondary ms-1 font-normal"
                >{{ triggerView.full.zone }}</span
              >
            </template>
            <span v-if="ladderStep > 1" class="sr-only">{{ triggerAccessibleTail }}</span>
          </span>
          <OTruncatedText
            v-else
            class="date-time-label flex-1 text-start"
            :class="fieldAppearance ? 'font-normal' : 'font-semibold'"
            >{{ triggerLabel }}</OTruncatedText
          >
          <template #icon-right
            ><OIcon
              name="arrow-drop-down"
              size="sm"
              class="date-time-arrow ms-auto text-lg! transition-transform duration-250"
          /></template>
        </OButton>
      </template>
      <div
        id="date-time-menu"
        tabindex="-1"
        class="date-time-dialog z-10001 flex max-h-[calc(var(--reka-popper-available-height,37.5rem)-0.75rem)] max-w-[calc(100vw-1rem)] flex-col overflow-y-auto outline-none"
        :class="hasHelpers ? 'w-180 max-sm:w-[calc(100vw-1rem)]' : 'w-90'"
        @keydown="onPickerKeydown"
        @paste="onPickerPaste"
        @pointerleave="endPreview"
        @focusin="onPanelFocusIn"
      >
        <div class="border-border-default flex flex-col gap-1 border-b px-3 pt-3 pb-2">
          <DateTimeRangeField
            ref="rangeField"
            :model-value="fieldText"
            :placeholder="fieldPlaceholder"
            :show-hint="showFieldHint"
            :error="fieldInvalid"
            :hide-clipboard="hideClipboard"
            :described-by="lineNote ? noteId : undefined"
            :relative="!disableRelative && !hideRelativeTime"
            :calendar="calendarPresets"
            @update:model-value="onFieldInput"
            @draft="onFieldDraft"
            @submit="onFieldSubmit"
            @paste-text="onFieldPaste"
            @copy="copyRange"
            @paste="pasteRange"
          />
          <DateTimeResolvedLine
            :view="lineView"
            :note="lineNote"
            :note-id="noteId"
            :zoom-disabled="zoomDisabled"
            :live-text="liveText"
            @zoom-out="zoomOut"
            @freeze="freezeCalendar"
            @note-action="onNoteAction"
          >
            <template v-if="!hideRelativeTimezone && lineView.mode !== 'preview'" #zone>
              <OSelect
                data-test="datetime-timezone-select"
                v-model="timezone"
                appearance="inline"
                :options="timezoneSelectOptions"
                searchable
                :aria-label="t('common.timezone')"
                :dropdown-style="{ minWidth: 'min(24rem, calc(100vw - 2rem))' }"
                class="text-text-link max-w-full min-w-0"
                @update:model-value="onTimezoneChange"
                @open="isTimezoneSelectOpen = true"
                @close="isTimezoneSelectOpen = false"
              >
                <template #icon-left><OIcon name="globe" size="xs" /></template>
                <template #trigger
                  ><OTruncatedText class="min-w-0">{{
                    isMobile ? zoneAbbreviationText : zoneLinkText
                  }}</OTruncatedText></template
                >
              </OSelect>
            </template>
          </DateTimeResolvedLine>
          <div
            v-if="instantDraft"
            data-test="date-time-instant"
            role="group"
            :aria-label="t('common.rangeInstantRead')"
            class="flex flex-col gap-1"
          >
            <div
              v-for="choice in instantChoices"
              :key="choice.id"
              class="rounded-default flex min-h-8 items-center gap-2 border pe-2"
              :class="
                choice.chosen
                  ? 'border-input-border-focus bg-surface-tint-accent'
                  : 'border-input-border'
              "
            >
              <OButton
                :data-test="`date-time-instant-${choice.id}`"
                variant="ghost"
                size="xs"
                class="min-w-0 flex-1 justify-start! font-normal tabular-nums"
                :aria-pressed="choice.chosen"
                data-instant-choice
                @click="pickInstantChoice(choice.id)"
                @keydown="onInstantKeydown($event, choice.id)"
                >{{ choice.label }}</OButton
              >
              <OToggleGroup
                v-if="choice.id === 'around'"
                type="single"
                :model-value="String(instantDraft.window)"
                :aria-label="t('common.rangeInstantWindow')"
                @update:model-value="setInstantWindow"
              >
                <OToggleGroupItem
                  v-for="minutes in INSTANT_WINDOWS"
                  :key="minutes"
                  :value="String(minutes)"
                  size="xs"
                  :data-test="`date-time-instant-window-${windowLabel(minutes)}`"
                  ><span class="text-2xs">{{
                    raw(`±${windowLabel(minutes)}`)
                  }}</span></OToggleGroupItem
                >
              </OToggleGroup>
              <span v-else class="text-text-secondary text-xs whitespace-nowrap">{{
                choice.detail
              }}</span>
            </div>
          </div>
        </div>
        <div
          class="grid min-h-0"
          :class="hasHelpers ? 'grid-cols-[1fr_18.5rem] max-sm:grid-cols-1' : 'grid-cols-1'"
        >
          <DateTimeHelpers
            v-if="hasHelpers"
            ref="helpers"
            :relative="relativeRows"
            :calendar-rows="calendarRows"
            :recent="recentRailItems"
            :show-recent="showRail"
            :restriction-msg="raw(queryRangeRestrictionMsg)"
            @select="onHelperSelect"
            @preview="onHelperPreview"
            @freeze="freezeCalendarItem"
            @remove-recent="removeRecentRange"
          />
          <section
            data-test="date-time-custom-range"
            class="flex min-w-0 flex-col gap-2 p-3"
            :aria-labelledby="customBodyShown ? customHeadingId : undefined"
            :aria-label="customBodyShown ? undefined : t('common.rangeCustomRange')"
          >
            <OButton
              v-if="isMobile"
              data-test="date-time-custom-toggle"
              variant="ghost"
              size="sm"
              class="w-full justify-start!"
              icon-left="calendar-month"
              :aria-expanded="customOpen"
              @click="customOpen = !customOpen"
              >{{ t("common.rangePickOnCalendar") }}
              <template #icon-right
                ><OIcon
                  :name="customOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'"
                  size="sm"
                  class="ms-auto"
              /></template>
            </OButton>
            <div v-if="customBodyShown" class="flex h-7 items-center gap-2">
              <h3
                :id="customHeadingId"
                class="text-text-heading text-compact font-semibold whitespace-nowrap"
              >
                {{ t("common.rangeCustomRange") }}
              </h3>
              <div v-if="!hideRelativeTime" class="ms-auto flex items-center gap-1">
                <span class="text-text-secondary text-2xs">{{ t("common.clockFormat") }}</span>
                <OToggleGroup
                  data-test="date-time-hour-format"
                  type="single"
                  :model-value="hourFormat"
                  :aria-label="t('common.clockFormatAria')"
                  @update:model-value="onHourFormat"
                >
                  <OToggleGroupItem value="24h" size="xs" data-test="date-time-hour-format-24h"
                    ><span class="text-2xs">{{ raw("24h") }}</span></OToggleGroupItem
                  >
                  <OToggleGroupItem value="12h" size="xs" data-test="date-time-hour-format-12h"
                    ><span class="text-2xs">{{ raw("12h") }}</span></OToggleGroupItem
                  >
                </OToggleGroup>
              </div>
            </div>
            <div v-if="customBodyShown" class="flex justify-center">
              <ODateRangeCalendar
                :start-date="toSlashDate(draft.start.date)"
                :end-date="pendingEnd ? '' : toSlashDate(draft.end.date)"
                :min-date="calendarMinDate"
                :max-date="maxDate || undefined"
                :month="calendarMonth || undefined"
                :invalid-dates="calendarInvalidDates"
                :preview-range="calendarPreview"
                @update:start-date="onCalendarStart"
                @update:end-date="onCalendarEnd"
                @update:pending-date="onCalendarPending"
                @update:month="calendarMonth = $event"
              />
            </div>
            <DateTimeRangeFields
              v-if="customBodyShown"
              ref="rangeFields"
              :start="draft.start"
              :end="pendingEnd ? EMPTY_EDGE : draft.end"
              :hour-format="hourFormat"
              :start-error="draftErrors.start"
              :end-error="draftErrors.end"
              :start-error-part="draftErrors.startPart"
              :end-error-part="draftErrors.endPart"
              :start-offsets="draftOffsets.start"
              :end-offsets="draftOffsets.end"
              :pasted="pasted"
              :pending-end="pendingEnd"
              :date-only="hideRelativeTime"
              :min-date="toIsoDate(calendarMinDate)"
              :max-date="maxDate ? toIsoDate(maxDate) : undefined"
              :apply-disabled="applyDisabled"
              @update:start="onDraftEdge('start', $event)"
              @update:end="onDraftEdge('end', $event)"
              @status="onFieldStatus"
              @submit="submitDraft"
              @paste-text="onFieldPaste"
              @start-of-day="setEdgeTime('start', START_OF_DAY)"
              @end-of-day="setEdgeTime('end', END_OF_DAY)"
              @now="setEndNow"
              @apply="applyAndClose"
            />
            <OButton
              v-else
              data-test="date-time-apply-btn"
              variant="primary"
              size="sm-action"
              class="mt-auto self-end"
              :disabled="applyDisabled"
              @click="applyAndClose"
              >{{ t("common.apply") }}</OButton
            >
          </section>
        </div>
      </div>
    </OPopover>
    <OTooltip v-if="!hideRangeShift" :content="t('common.next')">
      <OButton
        data-test="date-time-next-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border h-auto! rounded-s-none! border-s!"
        icon-left="chevron-right"
        :aria-label="t('common.next')"
        :disabled="disable || isNextShiftDisabled()"
        @click.prevent.stop="shiftTimeRange('next')"
      />
    </OTooltip>
    <span v-if="triggerTooltip" :id="triggerDescriptionId" class="sr-only">{{
      triggerTooltip
    }}</span>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import DateTimeRangeField from "@/components/DateTimeRangeField.vue";
import DateTimeResolvedLine, {
  type ResolvedLineAction,
  type ResolvedLineNote,
  type ResolvedLineView,
} from "@/components/DateTimeResolvedLine.vue";
import DateTimeHelpers, {
  type CalendarRow,
  type HelperItem,
  type RelativeRow,
} from "@/components/DateTimeHelpers.vue";
import DateTimeRangeFields, { type RangeFieldPart } from "@/components/DateTimeRangeFields.vue";
import type { SegmentedFieldStatus } from "@/lib/forms/SegmentedField/OSegmentedField.types";
import {
  ref,
  defineComponent,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  nextTick,
  useId,
  type PropType,
} from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import {
  useLocalTimezone,
  convertToUtcTimestamp,
  timestampToTimezoneDate,
} from "../utils/zincutils";
import { subtractRelativeTime } from "@/utils/date";
import {
  formatCalendarLabel,
  formatCalendarTooltip,
  formatRangeTooltip,
  formatResolvedCalendarTooltip,
  parseCalendarToken,
  resolveCalendarPeriod,
  shiftCalendarToken,
} from "@/utils/dashboard/calendarPeriods";
import {
  CALENDAR_RAIL_ITEMS,
  exceedsRangeRestriction,
  formatAbsoluteInstant,
  formatCopyRange,
  formatInstantFull,
  formatRecentRange,
  formatCalendarRailHint,
  formatRangeFull,
  formatRangeLabel,
  formatRecentDuration,
  formatRecentRangeLabel,
  joinRangeLabel,
  RELATIVE_UNIT_SECONDS,
  zoomOutRange,
  type RangeLabel,
  type RelativeUnit,
  type RelativeWindow,
  type TimeRangeRailItem,
  type ZoomRange,
} from "@/utils/timeRangeRail";
import {
  describeDstTransition,
  displayEndUs,
  formatRangeTooltipLines,
  formatUtcOffsetAt,
  formatZoneName,
} from "@/utils/rangeText";
import {
  END_OF_DAY,
  START_OF_DAY,
  draftFromRange,
  edgeInstant,
  emptyDraft,
  emptyEdge,
  emptyFieldStatus,
  sameDraft,
  toIsoDate,
  toSlashDate,
  validateDraft,
  type DraftEdge,
  type DraftEdgeError,
  type DraftEdgeName,
  type DraftFieldStatus,
  type RangeDraft,
} from "@/utils/dateTimeDraft";
import useTimeRangeHistory from "@/composables/useTimeRangeHistory";
import { localeFileMap } from "@/locales";
import {
  parseRangeInput,
  zoneAbbreviation,
  type NamedZone,
  type PasteParsed,
  type RangeInputFailed,
  type RangeInputFailReason,
  type RangeInputResult,
} from "@/utils/dateTimeRangeParse";
import { copyToClipboard } from "@/utils/clipboard";
import { timezoneSearchMatcher } from "@/utils/timezoneSearch";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { useLocalHourFormat } from "@/utils/storage";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import type { Shortcut } from "@/lib/vue-shortcut-manager/types";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";

const MICROS_PER_SECOND = 1_000_000;
const EMPTY_EDGE: DraftEdge = Object.freeze(emptyEdge());
const READ_FAIL_KEYS: Record<Exclude<RangeInputFailReason, "not-allowed">, I18nKey> = {
  empty: "common.dateRangePasteEmpty",
  "no-date": "common.pasteNoDate",
  "invalid-part": "common.pasteInvalidPart",
  "mixed-offset": "common.pasteMixedOffset",
  unknown: "common.rangeReadError",
  "no-seconds": "common.rangeNoSeconds",
};
const PASTE_FORMAT_KEYS: Record<PasteParsed["format"], I18nKey> = {
  copied: "common.pasteFormatCopied",
  iso: "common.pasteFormatIso",
  log: "common.pasteFormatLog",
  epoch: "common.pasteFormatEpochUs",
  slashed: "common.pasteFormatSlashed",
  label: "common.pasteFormatLabel",
};
const POPOVER_COLLISION_PADDING = { top: 48, right: 8, bottom: 8, left: 8 };
// The twelve one-click windows, as unit rows.
const RELATIVE_CHIPS: readonly [RelativeUnit, readonly number[]][] = [
  ["m", [5, 15, 30]],
  ["h", [1, 2, 4, 6, 12]],
  ["d", [1, 2, 7, 30]],
];
const RELATIVE_ROW_KEYS: Partial<Record<RelativeUnit, I18nKey>> = {
  m: "common.rangeUnitMinutes",
  h: "common.rangeUnitHours",
  d: "common.rangeUnitDays",
};
const CALENDAR_ROW_KEYS: readonly [I18nKey, readonly string[]][] = [
  ["common.rangePeriodDay", ["today", "yesterday"]],
  ["common.rangePeriodWeek", ["this-week", "last-week"]],
  ["common.rangePeriodMonth", ["this-month", "last-month"]],
  ["common.rangePeriodQuarter", ["this-quarter", "last-quarter"]],
];
const ROLLS_KEYS: Record<string, I18nKey> = {
  day: "common.rangeRollsDaily",
  week: "common.rangeRollsWeekly",
  month: "common.rangeRollsMonthly",
  quarter: "common.rangeRollsQuarterly",
  year: "common.rangeRollsYearly",
};
const INSTANT_WINDOWS = [5, 15, 60] as const;
const MICROS_PER_MINUTE = 60 * MICROS_PER_SECOND;
// An absolute range that ended within this long reads as just Fixed, not "ended 0m ago".
const ENDED_AGO_MIN_MS = 60_000;

interface CalendarPresetState {
  tooltip: I18nText | undefined;
  disabled: boolean;
}

interface TriggerSource {
  type: string;
  calendarToken: string | null;
  relativePeriod: string;
  relativeValue: number;
  startUs: number;
  endUs: number;
}

/** What the trigger shows: a relative or calendar text, or an absolute range with its ladder steps. */
type TriggerView =
  | { kind: "text"; text: string }
  | {
      kind: "absolute";
      full: RangeLabel;
      short: RangeLabel;
      duration: string;
      startUs: number;
      endUs: number;
    };

interface ConsumableDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string | null;
  selectedDate?: unknown;
  selectedTime?: unknown;
  valueType?: string;
  userChangedValue?: boolean;
}

type InstantWindow = (typeof INSTANT_WINDOWS)[number];

/** Where a draft came from: typed or pasted text, a helper on a non-applying host, or the calendar and fields. */
type DraftSource = "text" | "paste" | "helper" | "fields";

/** The one unapplied range the panel holds; its window always fills the calendar and Start/End. */
type PanelDraft =
  | ({ kind: "relative"; source: DraftSource; typed?: RelativeWindow } & RelativeWindow)
  | { kind: "calendar"; source: DraftSource; token: string }
  | {
      kind: "absolute";
      source: DraftSource;
      zoneAssumed: boolean;
      format?: PasteParsed["format"];
      namedZone?: NamedZone;
    }
  | {
      kind: "instant";
      source: DraftSource;
      us: number;
      choice: "around" | "since";
      window: InstantWindow;
      zoneAssumed: boolean;
      namedZone?: NamedZone;
    };

/** The panel's draft state as a whole, so Esc and Undo can put it back. */
interface PanelSnapshot {
  panelDraft: PanelDraft | null;
  draft: RangeDraft;
  pendingEnd: boolean;
  fieldText: string;
  shownText: string;
  pasted: boolean;
  readNote: ResolvedLineNote | null;
}

/** A window the line shows, and what kind of range it is. */
interface LineWindow {
  startUs: number;
  endUs: number;
  kind: "relative" | "calendar" | "absolute";
  token?: string;
}

// One offset lookup per zone for the whole app, not per picker instance.
const zoneOffsets = new Map<string, string>();

export default defineComponent({
  components: {
    OButton,
    OIcon,
    OToggleGroup,
    OToggleGroupItem,
    OTooltip,
    OTruncatedText,
    OSelect,
    ODateRangeCalendar,
    OPopover,
    DateTimeRangeField,
    DateTimeResolvedLine,
    DateTimeHelpers,
    DateTimeRangeFields,
  },
  props: {
    defaultType: {
      type: String,
      default: "relative",
    },
    defaultAbsoluteTime: {
      type: Object,
      default: null,
    },
    defaultRelativeTime: {
      type: String,
      default: "15m",
    },
    autoApply: {
      type: Boolean,
      default: false,
    },
    initialTimezone: {
      type: String as PropType<string | null>,
      required: false,
      default: null,
    },
    disable: {
      type: Boolean,
      default: false,
    },
    queryRangeRestrictionMsg: {
      type: String,
      default: "",
    },
    queryRangeRestrictionInHour: {
      type: Number,
      default: 0,
    },
    dataTestName: {
      type: String,
      default: "date-time-btn",
    },
    disableRelative: {
      type: Boolean,
      default: false,
    },
    hideRelativeTime: {
      type: Boolean,
      default: false,
    },
    hideRelativeTimezone: {
      type: Boolean,
      default: false,
    },
    /** Starts the picker on this IANA zone and keeps zone changes local to it instead of writing the app's timezone. */
    pickerTimezone: {
      type: String,
      default: "",
    },
    /** Drops the copy and paste range buttons; a date-only picker then loses its whole top row. */
    hideClipboard: {
      type: Boolean,
      default: false,
    },
    hideRangeShift: {
      type: Boolean,
      default: false,
    },
    /** Turns off the ‹ shift, for a parent that knows there is nothing earlier to show. */
    disablePrevShift: {
      type: Boolean,
      default: false,
    },
    minDate: {
      type: String,
      default: null,
    },
    /** The last pickable calendar day (yyyy/MM/dd); absent means today, for a caller that schedules ahead. */
    maxDate: {
      type: String,
      default: null,
    },
    menuAlign: {
      type: String as PropType<"center" | "start" | "end">,
      default: "end",
    },
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "outline",
    },
    /** Offers Today … Last year; off where the backend only parses rolling `<n><unit>` periods. */
    calendarPresets: {
      type: Boolean,
      default: false,
    },
    /** Sizes the trigger like a form field (full width, field height and border) instead of a toolbar button. */
    fieldAppearance: {
      type: Boolean,
      default: false,
    },
    /** Opens the picker as soon as it mounts, for a range the user just asked to add. */
    defaultOpen: {
      type: Boolean,
      default: false,
    },
    /** Drops the relative Seconds unit, for a caller that accepts only whole minutes. */
    hideSeconds: {
      type: Boolean,
      default: false,
    },
    /** Replaces the trigger's range text, for a caller that states the range on its own clock; empty keeps the picker's. */
    triggerText: {
      type: String,
      default: "",
    },
    /** Binds `t` (open) and, with the range shift shown, `[` `]` `-` on the page; for one main picker per page. */
    pageShortcuts: {
      type: Boolean,
      default: false,
    },
  },

  emits: ["on:date-change", "on:timezone-change", "hide", "show"],

  setup(props, { emit }) {
    const store = useStore();
    const pickerZone = ref(props.pickerTimezone);
    const zone = computed<string>(() =>
      props.pickerTimezone ? pickerZone.value : store.state.timezone,
    );
    const { t, locale } = useI18nTyped();
    const selectedType = ref("relative");
    const selectedTime = ref({
      startTime: "00:00:00",
      endTime: "23:59:59",
    });
    const selectedDate = ref({
      from: "",
      to: "",
    });
    const relativePeriod = ref("m");
    const relativeValue = ref(15);
    // A selected calendar period overrides relativePeriod/relativeValue while the type is relative.
    const calendarToken = ref<string | null>(null);
    const appliedCalendarToken = ref<string | null>(null);
    // Type and relative selection last applied; closing without Apply restores these, not the absolute fields.
    let appliedSelection = {
      selectedType: "relative",
      calendarToken: null as string | null,
      relativePeriod: "m",
      relativeValue: 15,
    };
    // Offset-0 tooltips end at now, so they read a clock refreshed on hover rather than a stale render time.
    const tooltipNow = ref(Date.now());
    const timeRangeHistory = useTimeRangeHistory();
    // Fields written by the picker itself (a Recent pick, a zoom, an applied draft) are not user edits for auto-apply.
    let isSeedingAbsolute = false;
    // Date-only pickers cannot show the times a recent range carries.
    const showRail = computed(() => !props.disableRelative);
    // The Custom range fields edit this draft; selectedDate/selectedTime change only when it is applied.
    const draft = ref<RangeDraft>(emptyDraft());
    const seededDraft = ref<RangeDraft>(emptyDraft());
    const fieldStatus = ref<DraftFieldStatus>(emptyFieldStatus());
    // A first calendar click gave Start its day; End waits for the second click.
    const pendingEnd = ref(false);
    const pasted = ref(false);
    // Null while the panel shows the applied range; set by text, a paste, a helper on a non-applying host, or an edit.
    const panelDraft = ref<PanelDraft | null>(null);
    const fieldText = ref("");
    // What the field last showed for the applied range or the draft; Enter on it unchanged re-applies with no parsing.
    const shownText = ref("");
    // Text typed by hand since the field last showed a value; an outside close discards it.
    const fieldEdited = ref(false);
    // Between a keystroke and its debounced read the hint and the error stay hidden.
    const fieldTyping = ref(false);
    const parseError = ref<RangeInputFailed | null>(null);
    // How the last text was read (assumed zone, named zone, rounded end), with Undo for a paste.
    const readNote = ref<ResolvedLineNote | null>(null);
    const zoneNote = ref<ResolvedLineNote | null>(null);
    const previewItem = ref<HelperItem | null>(null);
    const liveText = ref("");
    const customOpen = ref(false);
    const menuOpen = ref(false);
    let beforeTyping: PanelSnapshot | null = null;
    let beforePaste: PanelSnapshot | null = null;
    let beforeZoneChange: (PanelSnapshot & { zone: string }) | null = null;
    // Set while Undo switches the zone back, so that switch does not re-read the draft again.
    let restoringZone = false;
    const calendarMonth = ref("");
    const hourFormat = ref<"24h" | "12h">(useLocalHourFormat() === "12h" ? "12h" : "24h");
    // Offsets a repeated hour was applied with; the wall-clock fields alone cannot tell the two apart.
    let appliedOffsets = { start: "", end: "" };
    // The End date whose 23:59:59 arrived as an exact instant (URL, zoom, shift), so it is sent unwidened.
    let exactEndDate: string | null = null;
    const triggerDescriptionId = useId();
    const rootEl = ref<HTMLElement | null>(null);
    const triggerLabelEl = ref<HTMLElement | null>(null);
    const rangeField = ref<InstanceType<typeof DateTimeRangeField> | null>(null);
    const rangeFields = ref<InstanceType<typeof DateTimeRangeFields> | null>(null);
    const helpers = ref<InstanceType<typeof DateTimeHelpers> | null>(null);
    const noteId = useId();
    const customHeadingId = useId();
    const ladderStep = ref<1 | 2 | 3>(1);
    // Esc, the shift arrows and a commit close the panel without applying the draft, unlike an outside click.
    let closeReason: "escape" | "shift" | "commit" | null = null;
    const currentTimezone = useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = ref(props.pickerTimezone || currentTimezone);
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
      return tz;
    });
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTime = raw("Browser Time (" + browserTz + ")");

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);
    if (props.pickerTimezone && !timezoneOptions.includes(props.pickerTimezone)) {
      timezoneOptions.unshift(props.pickerTimezone);
    }

    const onTimezoneChange = async () => {
      let selectedTimezone = timezone.value;
      if (selectedTimezone.toLowerCase() == browserTime.toLowerCase()) {
        selectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      const previousZone = zone.value;
      const openDraft =
        !restoringZone && menuOpen.value && panelDraft.value !== null ? snapshotPanel() : null;
      if (props.pickerTimezone) {
        pickerZone.value = selectedTimezone;
      } else {
        useLocalTimezone(selectedTimezone);
        store.dispatch("setTimezone", selectedTimezone);
      }
      await nextTick();
      if (openDraft && previousZone !== zone.value) reResolveDraft(openDraft, previousZone);
      if (props.autoApply) {
        if (selectedType.value == "absolute") saveDate("absolute");
        else saveDate("relative");
      }

      emit("on:timezone-change", selectedTimezone);
    };

    // if initial timezone is provided
    if (props.initialTimezone) {
      // check if it is a valid timezone
      // ignore case
      timezone.value =
        timezoneOptions.find((tz) => tz.toLowerCase() === props.initialTimezone?.toLowerCase()) ||
        currentTimezone;

      // call onTimezoneChange to set the timezone in the store
      onTimezoneChange();
    }

    const filteredTimezone: any = ref(timezoneOptions);
    const isTimezoneSelectOpen = ref(false);

    // longOffset throws on engines that lack it, so the label falls back to no offset.
    const zoneOffset = (zone: string): string => {
      const cached = zoneOffsets.get(zone);
      if (cached !== undefined) return cached;
      let offset = "";
      try {
        const name = new Intl.DateTimeFormat("en-US", {
          timeZone: zone,
          timeZoneName: "longOffset",
        })
          .formatToParts(new Date())
          .find((part) => part.type === "timeZoneName")?.value;
        offset = name?.replace("GMT", "") || "+00:00";
      } catch {
        offset = "";
      }
      zoneOffsets.set(zone, offset);
      return offset;
    };

    const timezoneSelectOptions = computed(() =>
      timezoneOptions.map((tz: string) => {
        const isBrowser = tz === browserTime;
        const zone = isBrowser ? browserTz : tz;
        const offset = zoneOffset(zone);
        const suffix = offset ? raw(`UTC${offset}`) : undefined;
        if (isBrowser) {
          const label = t("common.browserTimeWithZone", { zone: browserTz });
          return { label, suffix, value: tz, matchSearch: timezoneSearchMatcher(zone, label) };
        }
        if (tz === "UTC") {
          return { label: raw(tz), suffix, value: tz, matchSearch: timezoneSearchMatcher(tz, tz) };
        }
        return {
          label: raw(offset ? `${tz} (UTC${offset})` : tz),
          listLabel: raw(tz),
          suffix,
          value: tz,
          matchSearch: timezoneSearchMatcher(tz, tz),
        };
      }),
    );

    let relativePeriods = [
      { label: t("common.seconds"), value: "s" },
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
      { label: t("common.days"), value: "d" },
      { label: t("common.weeks"), value: "w" },
      { label: t("common.months"), value: "M" },
    ].filter((period) => !props.hideSeconds || period.value !== "s");

    let relativePeriodsSelect = ref([...relativePeriods]);

    const relativeDates: Record<string, number[]> = {
      s: [1, 5, 10, 15, 30, 45],
      m: [1, 5, 10, 15, 30, 45],
      h: [1, 2, 3, 6, 8, 12],
      d: [1, 2, 3, 4, 5, 6],
      w: [1, 2, 3, 4, 5, 6],
      M: [1, 2, 3, 4, 5, 6],
    };

    let relativePeriodsMaxValue = ref<Record<string, number>>({
      s: 0,
      m: 0,
      h: 0,
      d: 0,
      w: 0,
      M: 0,
    });

    const intlLocale = computed(() => localeFileMap[String(locale.value)] ?? "en-US");

    const refreshTooltipNow = () => {
      tooltipNow.value = Date.now();
    };

    const calendarTooltip = (token: string | null) =>
      token === null
        ? undefined
        : (formatCalendarTooltip(token, zone.value, tooltipNow.value) ?? undefined);

    const calendarExceedsRestriction = (token: string | null) => {
      const range = resolveCalendarPeriod(token, zone.value, tooltipNow.value);
      return (
        !!range &&
        exceedsRangeRestriction(range.startTime, range.endTime, props.queryRangeRestrictionInHour)
      );
    };

    // Each token is resolved once; tooltip and restriction both read that one range.
    const resolvePresetState = (token: string, nowMs: number): CalendarPresetState => {
      const range = resolveCalendarPeriod(token, zone.value, nowMs);
      if (!range) return { tooltip: undefined, disabled: false };
      return {
        tooltip: formatResolvedCalendarTooltip(token, range, zone.value),
        disabled: exceedsRangeRestriction(
          range.startTime,
          range.endTime,
          props.queryRangeRestrictionInHour,
        ),
      };
    };

    // A finished period only moves when the picker's day changes, so a hover that bumps the clock keeps it cached.
    const pickerDay = computed(() =>
      timestampToTimezoneDate(tooltipNow.value, zone.value, "yyyy/MM/dd"),
    );

    const pastPresetStates = computed(() => {
      void pickerDay.value;
      const now = Date.now();
      return new Map(
        CALENDAR_RAIL_ITEMS.filter((preset) => !preset.soFar).map((preset) => [
          preset.id,
          resolvePresetState(preset.token, now),
        ]),
      );
    });

    const currentPresetStates = computed(
      () =>
        new Map(
          CALENDAR_RAIL_ITEMS.filter((preset) => preset.soFar).map((preset) => [
            preset.id,
            resolvePresetState(preset.token, tooltipNow.value),
          ]),
        ),
    );

    const visibleCalendarPresets = computed(() => {
      if (!props.calendarPresets) return null;
      return CALENDAR_RAIL_ITEMS.map((preset) => ({ preset, label: t(preset.labelKey) }));
    });

    const calendarRailItems = computed<TimeRangeRailItem[] | null>(() => {
      const visible = visibleCalendarPresets.value;
      if (visible === null) return null;
      return visible.map(({ preset, label }) => {
        const state = (preset.soFar ? currentPresetStates : pastPresetStates).value.get(preset.id);
        return {
          id: preset.id,
          label,
          tooltip: state?.tooltip,
          hint:
            formatCalendarRailHint(preset.token, zone.value, tooltipNow.value, intlLocale.value) ??
            undefined,
          selected: selectedCalendarToken.value === preset.token,
          disabled: state?.disabled ?? false,
        };
      });
    });

    // The calendar chip in force: the draft's, else the applied one while there is no draft.
    const selectedCalendarToken = computed<string | null>(() => {
      const pending = panelDraft.value;
      if (pending) return pending.kind === "calendar" ? pending.token : null;
      return selectedType.value === "relative" ? calendarToken.value : null;
    });

    const recentRailItems = computed<TimeRangeRailItem[]>(() => {
      const current =
        panelDraft.value === null && selectedType.value === "absolute" ? getUTCTimeStamp() : null;
      return timeRangeHistory.entries.value.map((entry, index) => ({
        id: String(index),
        label: formatRecentRange(entry.startUs, entry.endUs, zone.value),
        compact: {
          label: formatRecentRangeLabel(
            entry.startUs,
            entry.endUs,
            zone.value,
            Date.now(),
            intlLocale.value,
          ),
          duration: formatRecentDuration(entry.startUs, entry.endUs),
        },
        tooltip: formatRangeTooltip(entry.startUs, entry.endUs, zone.value),
        selected:
          current !== null && current.startUTC === entry.startUs && current.endUTC === entry.endUs,
        disabled: exceedsRangeRestriction(
          entry.startUs,
          entry.endUs,
          props.queryRangeRestrictionInHour,
        ),
        zoneTag:
          entry.zone && entry.zone !== zone.value
            ? formatUtcOffsetAt(Math.floor(entry.startUs / 1000), entry.zone)
            : undefined,
      }));
    });

    const periodUnits = ["s", "m", "h", "d", "w", "M"];

    const datetimeBtn = ref(null);

    const displayValue = ref("");

    // The selection as of the last apply; the trigger shows it whenever the panel holds an unapplied edit.
    const appliedSource = ref<TriggerSource>({
      type: "relative",
      calendarToken: null,
      relativePeriod: "m",
      relativeValue: 15,
      startUs: 0,
      endUs: 0,
    });

    const datePayload = ref({});

    const dateLocale = {
      daysShort: ["S", "M", "T", "W", "T", "F", "S"],
    };

    const calendarMinDate = computed(() => {
      if (props.disableRelative && props.minDate) return props.minDate;
      return "1999/01/01";
    });

    onMounted(() => {
      // updateDisplayValue();
      try {
        resetTime("", "");

        let startTime = (new Date().getTime() - 900000) * 1000;
        let endTime = new Date().getTime() * 1000;

        if (props.defaultAbsoluteTime?.startTime) {
          startTime =
            props.defaultAbsoluteTime?.startTime.toString().length > 13
              ? props.defaultAbsoluteTime?.startTime
              : props.defaultAbsoluteTime?.startTime * 1000;
        }

        if (props.defaultAbsoluteTime?.endTime) {
          endTime =
            props.defaultAbsoluteTime?.endTime.toString().length > 13
              ? props.defaultAbsoluteTime?.endTime
              : props.defaultAbsoluteTime?.endTime * 1000;
        }

        const initialType = props.disableRelative ? "absolute" : props.defaultType;
        selectedType.value = initialType;

        setAbsoluteTime(startTime, endTime);

        setRelativeTime(props.defaultRelativeTime);

        if (props.queryRangeRestrictionInHour) computeRelativePeriod();
        // displayValue.value = getDisplayValue();
        // NOTE: the emit below is already stamped programmatic — `setAbsoluteTime`
        // above calls `markProgrammaticDateChange()`, and its nextTick reset has
        // not run yet. Consumers must therefore treat `userChangedValue === false`
        // as "do not fetch": the parent's own `onMounted` covers the first load.
        saveDate(selectedType.value);
      } catch (e) {
        console.log(e);
      }
    });

    watch(
      () => {
        selectedTime.value.startTime;
        selectedTime.value.endTime;
        selectedDate.value?.from;
        selectedDate.value?.to;
      },
      () => {
        if (
          props.autoApply &&
          selectedType.value === "absolute" &&
          !isSeedingAbsolute &&
          store.state.savedViewFlag == false
        ) {
          saveDate("absolute");
        }
      },
      { deep: true },
    );

    watch(
      () => props.defaultType,
      () => {
        if (props.defaultType !== selectedType.value) {
          selectedType.value = props.defaultType;
        }
      },
    );

    const setRelativeDate = (period: string, value: number) => {
      selectedType.value = "relative";
      calendarToken.value = null;
      relativePeriod.value = period;
      relativeValue.value = value;
      if (props.autoApply) saveDate("relative");
    };

    const isValidCustomValue = (value: unknown) =>
      value !== "" && value !== null && Number.isFinite(Number(value));

    // A finished calendar period ends at the next one's start; second-precision fields show its last second, as its tooltip does.
    const lastInstant = (token: string | null, endUs: number) =>
      (parseCalendarToken(token)?.offset ?? 0) < 0 ? endUs - 1 : endUs;

    const setRelativeTime = (period: string) => {
      const calendarRange = resolveCalendarPeriod(period, zone.value);
      if (calendarRange && props.calendarPresets) {
        calendarToken.value = period;
        return;
      }
      if (calendarRange) {
        // A stale token beside an applied absolute range is not the range in force, so it must not replace it.
        if (selectedType.value !== "relative") return;
        // A picker without calendar presets keeps a shared calendar range as its dates instead of dropping it.
        selectedType.value = "absolute";
        calendarToken.value = null;
        setAbsoluteTime(calendarRange.startTime, lastInstant(period, calendarRange.endTime));
        return;
      }

      const periodString = period?.match(/(\d+)([smhdwM])/);

      if (periodString) {
        calendarToken.value = null;
        const periodValue = periodString[1];
        const periodUnit = periodString[2];

        if (periodUnits.includes(periodUnit)) {
          relativePeriod.value = periodUnit;
        }

        if (periodValue) {
          relativeValue.value = parseInt(periodValue);
        }
      }
    };

    const resetTime = (startTime: string, endTime: string) => {
      if (!startTime || !endTime) {
        var dateString = new Date().toLocaleDateString("en-ZA");

        if (!selectedDate.value.from) selectedDate.value.from = dateString;

        if (!selectedDate.value.to) selectedDate.value.to = dateString;

        if (!startTime) selectedTime.value.startTime = "00:00:00";

        if (!endTime) {
          const endDateTime = convertUnixTime(new Date().getTime() * 1000);

          // If the selected date is today, set the end time to the current time
          if (selectedDate.value.to === endDateTime.date) {
            selectedTime.value.endTime = endDateTime.time;
          } else selectedTime.value.endTime = "23:59:59";
        }

        return;
      }
      return;
    };

    const setAbsoluteTime = (startTime: number, endTime: number) => {
      // Parent-invoked setter — the resulting auto-apply emit is programmatic.
      markProgrammaticDateChange();
      appliedOffsets = { start: "", end: "" };
      if (!startTime || !endTime) {
        var dateString = new Date().toLocaleDateString("en-ZA");
        selectedDate.value.from = dateString;
        selectedDate.value.to = dateString;
        return;
      }

      const startDateTime = convertUnixTime(startTime);
      // An end at an exclusive midnight reads back as the day before's 23:59:59, which sends that midnight again.
      const endDateTime = convertUnixTime(displayEndUs(startTime, endTime, zone.value));

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;

      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
      rememberEndInstant(endTime, displayEndUs(startTime, endTime, zone.value));
    };

    // A whole-second 23:59:59 end is that exact instant; one read back from a midnight or sub-second end is inclusive.
    const rememberEndInstant = (endUs: number, shownEndUs: number) => {
      const exact = shownEndUs === endUs && endUs % MICROS_PER_SECOND === 0;
      exactEndDate =
        exact && selectedTime.value.endTime === END_OF_DAY ? selectedDate.value.to : null;
    };

    function convertUnixTime(unixTimeMicros: number) {
      return formatAbsoluteInstant(unixTimeMicros, zone.value);
    }

    const refresh = () => {
      // Parent-invoked (e.g. on tab re-activation / auto-refresh) — programmatic.
      markProgrammaticDateChange();
      saveDate();
    };

    // Distinguishes genuine user-driven date changes from programmatic ones
    // (parent-invoked setters, mount replay). Stamped onto each `on:date-change`
    // payload as `userChangedValue` so consumers (e.g. traces live-mode auto-run)
    // can ignore programmatic changes instead of relying on value-diff heuristics.
    let isUserInitiated = true;
    const markProgrammaticDateChange = () => {
      isUserInitiated = false;
      // Reset after the current flush. Default ('pre') watchers — including the
      // deep selectedDate/selectedTime watcher that drives auto-apply — run before
      // nextTick callbacks, so the watch-triggered saveDate still reads `false`.
      nextTick(() => {
        isUserInitiated = true;
      });
    };

    /**
     * Promote the pending selection to the applied one, so the trigger button
     * starts advertising it. Called from every path that actually puts a range
     * into force — Apply, `refresh()`, mount, and the parent-invoked setters.
     * NOT called from `setRelativeDate` / `onCustomPeriodSelect` / the popup's
     * absolute inputs when `autoApply` is off: those stay pending until Apply.
     */
    const markApplied = () => {
      appliedSource.value = liveSource.value;
      appliedCalendarToken.value = selectedType.value === "relative" ? calendarToken.value : null;
      appliedSelection = {
        selectedType: selectedType.value,
        calendarToken: calendarToken.value,
        relativePeriod: relativePeriod.value,
        relativeValue: relativeValue.value,
      };
    };

    const restoreAppliedSelection = () => {
      selectedType.value = appliedSelection.selectedType;
      calendarToken.value = appliedSelection.calendarToken;
      relativePeriod.value = appliedSelection.relativePeriod;
      relativeValue.value = appliedSelection.relativeValue;
    };

    const saveDate = (dateType?: string | null) => {
      markApplied();
      const date = getConsumableDateTime();
      // if (isNaN(date.endTime) || isNaN(date.startTime)) {
      //   // return false;
      // }
      datePayload.value = date;
      date["valueType"] = dateType || selectedType.value;
      date["userChangedValue"] = isUserInitiated;
      // date["relativeTimePeriod"] = "";
      if (store.state.savedViewFlag == false) {
        emit("on:date-change", date);
      }
    };

    function formatDate(d: Date) {
      var year = d.getFullYear();
      var month = ("0" + (d.getMonth() + 1)).slice(-2); // Months are zero-based
      var day = ("0" + d.getDate()).slice(-2);
      var hours = ("0" + d.getHours()).slice(-2);
      var minutes = ("0" + d.getMinutes()).slice(-2);
      var seconds = ("0" + d.getSeconds()).slice(-2);

      return {
        date: year + "/" + month + "/" + day,
        time: hours + ":" + minutes + ":" + seconds,
      };
    }

    const applyCustomDate = (dateType: string, dateobj: { start: number; end: number }) => {
      var start_date = new Date(Math.floor(dateobj.start));
      const startObj = formatDate(start_date);

      var end_date = new Date(Math.floor(dateobj.end));
      const endObj = formatDate(end_date);

      selectedDate.value.from = startObj.date;
      selectedDate.value.to = endObj.date;
      selectedTime.value.startTime = startObj.time;
      selectedTime.value.endTime = endObj.time;
      appliedOffsets = { start: "", end: "" };
      rememberEndInstant(dateobj.end * 1000, dateobj.end * 1000);

      selectedType.value = dateType;
      markProgrammaticDateChange();
      markApplied();
    };

    // Parent-invoked setter for a chart drag-zoom — programmatic, but a range the user picked.
    const setCustomDate = (dateType: string, dateobj: { start: number; end: number }) => {
      applyCustomDate(dateType, dateobj);
      recordAbsoluteRange();
    };

    const onBeforeShow = () => {
      // if (props.modelValue) selectedDate.value = cloneDeep(props.modelValue);
    };

    const onBeforeHide = () => {
      if (selectedType.value === "absolute")
        resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    // Arithmetic unit consumed by getConsumableDateTime's `subtractObject` —
    // a code token, never rendered, so it must stay English regardless of locale.
    const PERIOD_ARITHMETIC_UNIT: Record<string, string> = {
      s: "seconds",
      m: "minutes",
      h: "hours",
      d: "days",
      w: "weeks",
      M: "months",
    };

    // Weeks are subtracted as days, since the date helper has no week unit.
    const relativeStartMs = (value: number, unit: string, endMs: number): number => {
      let period = PERIOD_ARITHMETIC_UNIT[unit];
      let amount = value;
      if (unit === "w") {
        period = "days";
        amount = value * 7;
      }
      const subtractObject: Record<string, number> = {};
      if (period && amount) subtractObject[period] = amount;
      else {
        console.error("getConsumableDateTime: Invalid relative period");
        subtractObject["Minutes"] = 15;
      }
      return new Date(subtractRelativeTime(new Date(endMs), subtractObject)).getTime();
    };

    function isValidDateTimeString(dateStr: string, timeStr: string): boolean {
      return !isNaN(Date.parse(`${dateStr} ${timeStr}`));
    }

    const getConsumableDateTime = (): ConsumableDateTime => {
      const calendarRange =
        selectedType.value === "relative"
          ? resolveCalendarPeriod(calendarToken.value, zone.value)
          : null;
      if (calendarRange) {
        return { ...calendarRange, relativeTimePeriod: calendarToken.value };
      }
      if (selectedType.value == "relative") {
        const endMs = Date.now();
        return {
          startTime: relativeStartMs(relativeValue.value, relativePeriod.value, endMs) * 1000,
          endTime: endMs * 1000,
          relativeTimePeriod: relativeValue.value + relativePeriod.value,
        };
      } else {
        if (typeof selectedDate.value === "string") {
          selectedDate.value = {
            from: selectedDate.value,
            to: selectedDate.value,
          };
        }

        const startDateStr = selectedDate.value.from + " " + selectedTime.value.startTime;
        if (!isValidDateTimeString(selectedDate.value.from, selectedTime.value.startTime)) {
          // console.warn(`Invalid start date/time: ${startDateStr}`);
          // return new Date();
        }

        const endDateStr = selectedDate.value.to + " " + selectedTime.value.endTime;
        if (!isValidDateTimeString(selectedDate.value.to, selectedTime.value.endTime)) {
          // console.error(`Invalid end date/time: ${endDateStr}`);
          // return new Date();
        }

        let start, end;
        if (!selectedDate.value?.from && !selectedTime.value?.startTime) {
          start = new Date();
        } else {
          start = new Date(startDateStr);
        }

        if (selectedDate.value?.to == "" && selectedTime.value?.endTime == "") {
          end = new Date();
        } else {
          end = new Date(endDateStr);
        }

        if (start.toString() === "Invalid Date" && end.toString() === "Invalid Date") {
          start = selectedDate.value + " " + selectedTime.value.startTime;
          end = selectedDate.value + " " + selectedTime.value.endTime;
        }
        const absoluteUTCTimestamp = getUTCTimeStamp();
        const rVal = {
          startTime: absoluteUTCTimestamp.startUTC,
          endTime: absoluteUTCTimestamp.endUTC,
          relativeTimePeriod: null,
          selectedDate: JSON.parse(JSON.stringify(selectedDate.value)),
          selectedTime: JSON.parse(JSON.stringify(selectedTime.value)),
        };
        return rVal;
      }
    };

    // A chosen offset picks one of a repeated hour's two instants; otherwise luxon reads the wall time.
    const wallToMicros = (date: string, time: string, offset: string): number => {
      if (offset) {
        const { us } = edgeInstant({ date: toIsoDate(date), time, offset }, zone.value);
        if (us !== null) return us;
      }
      return convertToUtcTimestamp(`${date} ${time}`, zone.value);
    };

    const getUTCTimeStamp = () => {
      const startUTC = wallToMicros(
        selectedDate.value.from,
        selectedTime.value.startTime,
        appliedOffsets.start,
      );
      const endWall = wallToMicros(
        selectedDate.value.to,
        selectedTime.value.endTime,
        appliedOffsets.end,
      );
      // An End reading 23:59:59 includes that whole second, and the backend end is exclusive.
      const inclusive =
        selectedTime.value.endTime === END_OF_DAY && exactEndDate !== selectedDate.value.to;
      const endUTC = endWall + (inclusive ? MICROS_PER_SECOND : 0);
      return { startUTC, endUTC };
    };

    const setSavedDate = (dateobj: any) => {
      timezone.value = zone.value;
      selectedType.value = dateobj.type;

      if (dateobj.type === "relative") {
        selectedType.value = "relative";
        setRelativeTime(dateobj.relativeTimePeriod);
      } else {
        if (
          Object.prototype.hasOwnProperty.call(dateobj, "selectedDate") &&
          Object.prototype.hasOwnProperty.call(dateobj, "selectedTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "from") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "to") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "startTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "endTime")
        ) {
          selectedDate.value = dateobj.selectedDate;
          selectedTime.value = dateobj.selectedTime;
          appliedOffsets = { start: "", end: "" };
          exactEndDate = null;
        } else {
          applyCustomDate(dateobj.type, {
            start: dateobj.startTime / 1000,
            end: dateobj.endTime / 1000,
          });
        }
      }

      markApplied();
    };

    const { isMobile } = useBreakpoint();

    // Absolute ranges shorten through the width ladder instead, so only the relative form is compacted here.
    const compactRangeLabel = (label: string) => {
      const REL_UNIT: Record<string, string> = {
        second: "s",
        minute: "m",
        hour: "h",
        day: "d",
        week: "w",
        month: "M",
      };
      const rel = label.match(/^Past (\d+) ([A-Za-z]+?)s?$/);
      if (rel) return `Past ${rel[1]}${REL_UNIT[rel[2].toLowerCase()] ?? ` ${rel[2]}`}`;
      return label;
    };

    const pastKeyFor = (period: string): I18nKey => {
      const keys: Record<string, I18nKey> = {
        s: "common.pastSecond",
        m: "common.pastMinute",
        h: "common.pastHour",
        d: "common.pastDay",
        w: "common.pastWeek",
        M: "common.pastMonth",
      };
      return keys[period] ?? "common.pastMinute";
    };

    const rangeLabelOptions = computed(() => ({
      locale: intlLocale.value,
      hourCycle: hourFormat.value === "12h" ? ("h12" as const) : ("h23" as const),
      browserZone: browserTz,
      nowMs: tooltipNow.value,
    }));

    // Date-only pickers name whole days, whatever times their fields carry.
    const dateOnlyRange = (startUs: number, endUs: number): { startUs: number; endUs: number } => {
      const from = toIsoDate(convertUnixTime(startUs).date);
      const to = toIsoDate(convertUnixTime(displayEndUs(startUs, endUs, zone.value)).date);
      const start = edgeInstant({ date: from, time: START_OF_DAY, offset: "" }, zone.value).us;
      const end = edgeInstant({ date: to, time: END_OF_DAY, offset: "" }, zone.value).us;
      if (start === null || end === null) return { startUs, endUs };
      return { startUs: start, endUs: end + MICROS_PER_SECOND };
    };

    const liveSource = computed<TriggerSource>(() => {
      const { startUTC, endUTC } = getUTCTimeStamp();
      return {
        type: selectedType.value,
        calendarToken: calendarToken.value,
        relativePeriod: relativePeriod.value,
        relativeValue: isValidCustomValue(relativeValue.value) ? Number(relativeValue.value) : 15,
        startUs: startUTC,
        endUs: endUTC,
      };
    });

    const viewFor = (source: TriggerSource): TriggerView => {
      const relative = !props.disableRelative && source.type === "relative";
      if (relative && source.calendarToken !== null) {
        const label = formatCalendarLabel(
          source.calendarToken,
          zone.value,
          t,
          intlLocale.value,
          tooltipNow.value,
        );
        if (label) return { kind: "text", text: label };
      }
      if (relative) {
        return {
          kind: "text",
          text: t(pastKeyFor(source.relativePeriod), { count: source.relativeValue }),
        };
      }
      const span = props.disableRelative
        ? dateOnlyRange(source.startUs, source.endUs)
        : { startUs: source.startUs, endUs: source.endUs };
      if (!Number.isFinite(span.startUs) || !Number.isFinite(span.endUs)) {
        return { kind: "text", text: "" };
      }
      const options = rangeLabelOptions.value;
      return {
        kind: "absolute",
        full: formatRangeLabel(span.startUs, span.endUs, zone.value, options),
        short: formatRangeLabel(span.startUs, span.endUs, zone.value, {
          ...options,
          precision: "minutes",
        }),
        duration: formatRecentDuration(span.startUs, span.endUs),
        startUs: source.startUs,
        endUs: source.endUs,
      };
    };

    const textOf = (view: TriggerView): string =>
      view.kind === "text" ? view.text : joinRangeLabel(view.full);

    // The panel never edits what the trigger shows: while it is open, or until Apply, the trigger keeps the applied range.
    const triggerView = computed<TriggerView>(() => {
      const showsApplied =
        (!props.autoApply && !menuOpen.value) ||
        (menuOpen.value && selectedType.value === "absolute");
      return viewFor(showsApplied ? appliedSource.value : liveSource.value);
    });

    const triggerLabel = computed(() => {
      if (props.triggerText) return props.triggerText;
      const view = triggerView.value;
      if (view.kind === "absolute") return textOf(view);
      return isMobile.value ? compactRangeLabel(view.text) : view.text;
    });

    // At ladder steps 2 and 3 the name still starts with what is seen, then gives the whole range.
    const triggerAccessibleTail = computed(() => {
      const view = triggerView.value;
      return view.kind === "absolute" ? `, ${joinRangeLabel(view.full)}` : "";
    });

    const triggerTooltip = computed<I18nText | undefined>(() => {
      const view = triggerView.value;
      if (view.kind === "absolute") {
        const lines = formatRangeTooltipLines(view.startUs, view.endUs, zone.value);
        return raw(`${lines.range}\n${lines.detail}`);
      }
      const showsApplied = !props.autoApply && !menuOpen.value;
      if (showsApplied) return calendarTooltip(appliedCalendarToken.value);
      return selectedType.value === "relative" ? calendarTooltip(calendarToken.value) : undefined;
    });

    const getDisplayValue = computed(() => textOf(viewFor(liveSource.value)));

    const parseContext = () => ({
      zone: zone.value,
      nowMs: Date.now(),
      locale: intlLocale.value,
      t: (key: I18nKey, named?: Record<string, unknown>): string =>
        named ? t(key, named) : t(key),
      calendarPresets: props.calendarPresets && !props.disableRelative,
      disableRelative: props.disableRelative,
      hideRelativeTime: props.hideRelativeTime,
      hideSeconds: props.hideSeconds,
      queryRangeRestrictionInHour: props.queryRangeRestrictionInHour,
    });

    const relativeLabel = (window: RelativeWindow): string =>
      t(pastKeyFor(window.unit), { count: window.value });

    const calendarLabel = (token: string): string =>
      formatCalendarLabel(token, zone.value, t, intlLocale.value, tooltipNow.value) ?? token;

    const appliedText = (): string => textOf(viewFor(appliedSource.value));

    // The field's text for a draft that did not come from typing; an unreadable draft keeps the current text.
    const draftText = (): string => {
      const pending = panelDraft.value;
      if (pending?.kind === "relative") return relativeLabel(pending);
      if (pending?.kind === "calendar") return calendarLabel(pending.token);
      const result = validation.value;
      if (!result.valid || result.startUs === null || result.endUs === null) return fieldText.value;
      return joinRangeLabel(
        formatRangeLabel(result.startUs, result.endUs, zone.value, rangeLabelOptions.value),
      );
    };

    const showText = (text: string) => {
      rangeField.value?.cancelPending();
      fieldText.value = text;
      shownText.value = text;
      fieldEdited.value = false;
      fieldTyping.value = false;
      beforeTyping = null;
    };

    const cloneDraft = (value: RangeDraft): RangeDraft => ({
      start: { ...value.start },
      end: { ...value.end },
    });

    const snapshotPanel = (): PanelSnapshot => ({
      panelDraft: panelDraft.value ? { ...panelDraft.value } : null,
      draft: cloneDraft(draft.value),
      pendingEnd: pendingEnd.value,
      fieldText: fieldText.value,
      shownText: shownText.value,
      pasted: pasted.value,
      readNote: readNote.value,
    });

    const restorePanel = (snapshot: PanelSnapshot) => {
      panelDraft.value = snapshot.panelDraft;
      draft.value = cloneDraft(snapshot.draft);
      pendingEnd.value = snapshot.pendingEnd;
      pasted.value = snapshot.pasted;
      readNote.value = snapshot.readNote;
      fieldStatus.value = emptyFieldStatus();
      parseError.value = null;
      showText(snapshot.fieldText);
      shownText.value = snapshot.shownText;
      showDraftMonth();
    };

    const instantWindow = (
      pending: Extract<PanelDraft, { kind: "instant" }>,
      nowMs: number,
    ): { startUs: number; endUs: number } => {
      if (pending.choice === "since") {
        const nowUs = Math.floor(nowMs / 1000) * MICROS_PER_SECOND;
        return { startUs: pending.us, endUs: Math.max(pending.us + MICROS_PER_SECOND, nowUs) };
      }
      const half = pending.window * MICROS_PER_MINUTE;
      return { startUs: pending.us - half, endUs: pending.us + half };
    };

    // A relative or calendar draft resolves at now; an instant fills the window of its highlighted choice.
    const syncDraftWindow = () => {
      const pending = panelDraft.value;
      if (!pending || pending.kind === "absolute") return;
      const nowMs = Date.now();
      let range: { startUs: number; endUs: number } | null = null;
      if (pending.kind === "relative") {
        range = {
          startUs: relativeStartMs(pending.value, pending.unit, nowMs) * 1000,
          endUs: nowMs * 1000,
        };
      } else if (pending.kind === "calendar") {
        const resolved = resolveCalendarPeriod(pending.token, zone.value, nowMs);
        if (resolved) range = { startUs: resolved.startTime, endUs: resolved.endTime };
      } else {
        range = instantWindow(pending, nowMs);
      }
      if (!range) return;
      draft.value = draftFromRange(range.startUs, range.endUs, zone.value);
      pendingEnd.value = false;
      fieldStatus.value = emptyFieldStatus();
      showDraftMonth();
    };

    const setPanelDraft = (next: PanelDraft) => {
      panelDraft.value = next;
      parseError.value = null;
      syncDraftWindow();
    };

    const undoAction = (): ResolvedLineAction => ({
      id: "undo",
      label: t("common.rangeUndo"),
      dataTest: "date-time-range-note-undo",
    });

    const formatKeyFor = (format: PasteParsed["format"], epochUnit?: PasteParsed["epochUnit"]) =>
      format === "epoch"
        ? (
            {
              s: "common.pasteFormatEpochS",
              ms: "common.pasteFormatEpochMs",
              us: "common.pasteFormatEpochUs",
            } as const
          )[epochUnit ?? "us"]
        : PASTE_FORMAT_KEYS[format];

    // The wall-clock times a zone-less text was read at, which a zone switch keeps.
    const draftClockText = (): string => {
      const { start, end } = draft.value;
      const startText = start.time.slice(0, 5);
      return panelDraft.value?.kind === "instant"
        ? startText
        : `${startText} – ${end.time.slice(0, 5)}`;
    };

    // How a text was read: the zone it named, the zone it was assumed to be in, and a rounded end.
    const readNoteFor = (
      result: Extract<RangeInputResult, { kind: "absolute" | "instant" }>,
      source: DraftSource,
    ): ResolvedLineNote | null => {
      const parts: string[] = [];
      const startMs = Math.floor(result.startUs / 1000);
      if (result.namedZone?.abbr) {
        parts.push(
          t("common.rangeZoneAbbrev", {
            abbr: result.namedZone.abbr,
            zoneName: result.namedZone.zone,
            offset: formatUtcOffsetAt(startMs, result.namedZone.zone),
          }),
        );
      } else if (result.zoneAssumed && source === "paste") {
        // Typed text in the picker's zone needs no note; a paste from elsewhere may have meant another zone.
        parts.push(
          t("common.pasteAssumedZone", {
            zone: formatZoneName(zone.value, startMs),
            range: draftClockText(),
          }),
        );
      } else if (source === "paste") {
        parts.push(
          t("common.pasteReadAs", { format: t(formatKeyFor(result.format, result.epochUnit)) }),
        );
      }
      if (result.kind === "absolute" && result.endRoundedUp) {
        parts.push(t("common.pasteEndRoundedUp", { time: draft.value.end.time }));
      }
      if (parts.length === 0) return null;
      return {
        kind: "info",
        reason: result.format,
        text: raw(parts.join(" ")),
        actions: source === "paste" ? [undoAction()] : undefined,
      };
    };

    // The zone a text carried, for the note after a zone switch: its name, abbreviation or offset.
    const textZoneLabel = (text: string, named?: NamedZone): string | undefined => {
      if (named) return named.abbr ?? named.zone;
      const offset = text.trim().match(/(Z|[+-]\d{2}:?\d{2}|(?:UTC|GMT)(?:[+-][\d:]+)?)$/i)?.[1];
      if (!offset) return undefined;
      return /^z$/i.test(offset) ? "UTC" : offset;
    };

    // Reads the field's text into the draft; false when it does not read, which keeps the applied range on the line.
    const readText = (text: string, source: "text" | "paste"): boolean => {
      if (text === shownText.value) {
        parseError.value = null;
        return true;
      }
      const result = parseRangeInput(text, parseContext());
      if (!result.ok) {
        parseError.value = result;
        readNote.value = null;
        liveText.value = parseErrorText(result);
        // A paste that does not read leaves the draft it landed on; typed text falls back to the applied range.
        if (source === "text") {
          panelDraft.value = null;
          pasted.value = false;
          seedWindow();
        }
        return false;
      }
      parseError.value = null;
      zoneNote.value = null;
      pasted.value = source === "paste";
      if (result.kind === "relative") {
        setPanelDraft({
          kind: "relative",
          source,
          value: result.value,
          unit: result.unit,
          typed: result.typed,
        });
        readNote.value = null;
        return true;
      }
      if (result.kind === "calendar") {
        setPanelDraft({ kind: "calendar", source, token: result.token });
        readNote.value = null;
        return true;
      }
      const zoneLabel = result.zoneAssumed ? undefined : textZoneLabel(text, result.namedZone);
      if (result.kind === "instant") {
        setPanelDraft({
          kind: "instant",
          source,
          us: result.startUs,
          choice: "around",
          window: 15,
          zoneAssumed: result.zoneAssumed,
          namedZone: result.namedZone ?? (zoneLabel ? { zone: zoneLabel } : undefined),
        });
      } else {
        panelDraft.value = {
          kind: "absolute",
          source,
          zoneAssumed: result.zoneAssumed,
          format: result.format,
          namedZone: result.namedZone ?? (zoneLabel ? { zone: zoneLabel } : undefined),
        };
        draft.value = draftFromRange(result.startUs, result.endUs, zone.value);
        pendingEnd.value = false;
        fieldStatus.value = emptyFieldStatus();
        showDraftMonth();
      }
      readNote.value = readNoteFor(result, source);
      return true;
    };

    const parseErrorText = (error: RangeInputFailed): I18nText => {
      if (error.reason === "not-allowed") {
        return t("common.rangeNotAllowedRelative", { example: raw("Nov 4, 13:00 - 15:00") });
      }
      return t(READ_FAIL_KEYS[error.reason], { text: error.fragment });
    };

    const parseErrorNote = (error: RangeInputFailed): ResolvedLineNote => ({
      kind: "error",
      reason: error.reason,
      input: true,
      text: parseErrorText(error),
      actions: error.suggestion
        ? [
            {
              id: "suggestion",
              label: raw(`${t("common.rangeDidYouMean")} “${error.suggestion}”?`),
              dataTest: "date-time-range-suggestion",
            },
          ]
        : undefined,
    });

    const onFieldInput = (text: string) => {
      // Typing after an unread paste keeps the restore point from before that paste.
      if (!fieldEdited.value && !beforeTyping) beforeTyping = snapshotPanel();
      fieldText.value = text;
      fieldEdited.value = true;
      fieldTyping.value = true;
    };

    const onFieldDraft = (text: string) => {
      fieldTyping.value = false;
      if (!text.trim()) {
        parseError.value = null;
        return;
      }
      readText(text, "text");
    };

    // Enter reads the text at once, then applies it; the shown text unchanged re-applies with no parsing.
    const onFieldSubmit = (text: string) => {
      fieldTyping.value = false;
      if (!text.trim()) return;
      // Enter on an unread paste does what Apply and an outside close do: apply the draft it landed on.
      if (!fieldEdited.value && parseError.value !== null) {
        if (panelDraft.value) applyAndClose();
        return;
      }
      if (text !== shownText.value && !readText(text, "text")) return;
      if (panelDraft.value === null) {
        isUserInitiated = true;
        saveDate(null);
        closePanel();
        return;
      }
      fieldEdited.value = false;
      applyAndClose();
    };

    // A paste is a deliberate edit, so an outside close applies it like a calendar or field edit.
    const onFieldPaste = (text: string) => {
      const snapshot = beforeTyping ?? snapshotPanel();
      rangeField.value?.cancelPending();
      beforeTyping = null;
      fieldTyping.value = false;
      fieldEdited.value = false;
      fieldText.value = text;
      if (!readText(text, "paste")) {
        // The draft it landed on stays appliable, as Apply and an outside close agree; Esc still puts back the field.
        beforeTyping = snapshot;
        return;
      }
      beforePaste = snapshot;
      shownText.value = text;
    };

    const pasteIntoField = (text: string) => onFieldPaste(text);

    const copyRange = () => {
      const pending = hasDraft.value ? draftWindow.value : null;
      const { startTime, endTime } = pending
        ? { startTime: pending.startUs, endTime: pending.endUs }
        : getConsumableDateTime();
      copyToClipboard(formatCopyRange(startTime, endTime, zone.value), t, {
        successMessage: t("common.dateRangeCopied"),
      });
    };

    const pasteRange = async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        readNote.value = {
          kind: "error",
          reason: "blocked",
          text: t("common.dateRangePasteBlocked", {
            shortcut: isMacOS() ? raw("⌘V") : raw("Ctrl+V"),
          }),
        };
        return;
      }
      pasteIntoField(text);
      if (panelDraft.value) nextTick(() => rangeFields.value?.focusApply());
    };

    // A native paste with focus on a chip or the panel carries the clipboard without the read permission pasteRange needs.
    const onPickerPaste = (event: ClipboardEvent) => {
      if (isInputFocused(event.target)) return;
      event.preventDefault();
      pasteIntoField(event.clipboardData?.getData("text") ?? "");
    };

    const timezoneFilterFn = (val: string, update: (cb: () => void) => void) => {
      filteredTimezone.value = filterColumns(timezoneOptions, val, update);
    };

    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter((column: any) => column.toLowerCase().includes(value));
      });
      return filteredOptions;
    };

    const showDraftMonth = () => {
      const date = draft.value.start.date || draft.value.end.date;
      if (date) calendarMonth.value = toSlashDate(date);
    };

    // Start/End and the calendar show the applied window again, leaving the field and notes as they are.
    const seedWindow = () => {
      const { startTime, endTime } = getConsumableDateTime();
      const usable = Number.isFinite(startTime) && Number.isFinite(endTime) && startTime > 0;
      draft.value = usable ? draftFromRange(startTime, endTime, zone.value) : emptyDraft();
      if (usable && props.hideRelativeTime) {
        draft.value.start.time = selectedTime.value.startTime;
        draft.value.end.time = selectedTime.value.endTime;
      }
      seededDraft.value = cloneDraft(draft.value);
      fieldStatus.value = emptyFieldStatus();
      pendingEnd.value = false;
      showDraftMonth();
    };

    const seedDraft = () => {
      seedWindow();
      panelDraft.value = null;
      pasted.value = false;
      parseError.value = null;
      readNote.value = null;
      zoneNote.value = null;
      previewItem.value = null;
      beforePaste = null;
      beforeZoneChange = null;
      showText(appliedText());
    };

    const discardDraft = () => {
      seedDraft();
    };

    // Re-reads an open draft after a zone switch: a text that named its zone keeps its instants, one that did not keeps its clock.
    const reResolveDraft = (snapshot: PanelSnapshot, previousZone: string) => {
      const pending = snapshot.panelDraft;
      if (!pending || pending.kind === "relative" || pending.kind === "calendar") return;
      const keptInstants = !pending.zoneAssumed;
      if (pending.kind === "instant") {
        if (!keptInstants) {
          const wall = formatAbsoluteInstant(pending.us, previousZone);
          const us = edgeInstant(
            { date: toIsoDate(wall.date), time: wall.time, offset: "" },
            zone.value,
          ).us;
          if (us !== null) panelDraft.value = { ...pending, us };
        }
        syncDraftWindow();
      } else if (keptInstants) {
        const startUs = edgeInstant(snapshot.draft.start, previousZone).us;
        const endUs = edgeInstant(snapshot.draft.end, previousZone).us;
        if (startUs !== null && endUs !== null) {
          const inclusive = snapshot.draft.end.time === END_OF_DAY ? MICROS_PER_SECOND : 0;
          draft.value = draftFromRange(startUs, endUs + inclusive, zone.value);
          showDraftMonth();
          showText(draftText());
        }
      }
      if (pending.source !== "text" && pending.source !== "paste") return;
      beforeZoneChange = { ...snapshot, zone: previousZone };
      const newZone = formatZoneName(zone.value, Date.now());
      zoneNote.value = {
        kind: "info",
        reason: "zone-change",
        text: keptInstants
          ? t("common.rangeZoneKeptInstants", {
              zone: pending.namedZone?.zone ?? formatZoneName(previousZone, Date.now()),
              newZone,
            })
          : t("common.rangeZoneKeptClock", { newZone }),
        actions: [undoAction()],
      };
    };

    // Undo after a zone switch puts back both the zone and the draft as they were.
    const undoZoneChange = async () => {
      const saved = beforeZoneChange;
      if (!saved) return;
      beforeZoneChange = null;
      zoneNote.value = null;
      restoringZone = true;
      timezone.value =
        timezoneOptions.find((option) => option === saved.zone) ??
        (saved.zone === browserTz ? browserTime : saved.zone);
      try {
        await onTimezoneChange();
      } finally {
        restoringZone = false;
      }
      restorePanel(saved);
    };

    const onNoteAction = (id: ResolvedLineAction["id"]) => {
      if (id === "undo") {
        if (zoneNote.value) {
          void undoZoneChange();
          return;
        }
        if (beforePaste) restorePanel(beforePaste);
        beforePaste = null;
        return;
      }
      if (id === "swap") {
        const { start, end } = draft.value;
        draft.value = { start: { ...end, offset: "" }, end: { ...start, offset: "" } };
        markFieldsDraft();
        return;
      }
      if (id === "dst-next") {
        const edge: DraftEdgeName = validation.value.start === "skipped" ? "start" : "end";
        const next = nextValidTime(edge);
        if (next) onDraftEdge(edge, { ...draft.value[edge], time: next, offset: "" });
        return;
      }
      const suggestion = parseError.value?.suggestion;
      if (!suggestion) return;
      fieldText.value = suggestion;
      if (readText(suggestion, "text")) {
        fieldEdited.value = false;
        shownText.value = suggestion;
      }
    };

    // The first wall time after a spring-forward gap, e.g. 03:00:00 for a skipped 02:30.
    const nextValidTime = (edge: DraftEdgeName): string | null => {
      const value = draft.value[edge];
      const change = describeDstTransition(value.date, value.time, zone.value);
      return change ? `${change.after}:00` : null;
    };

    // Any calendar, Start/End, Now or repair edit turns the draft into these fixed dates.
    const markFieldsDraft = () => {
      const current = panelDraft.value;
      if (current?.kind !== "absolute" || current.source !== "fields") {
        panelDraft.value = { kind: "absolute", source: "fields", zoneAssumed: true };
      }
      parseError.value = null;
      readNote.value = null;
      previewItem.value = null;
      pasted.value = false;
      if (validation.value.valid) showText(draftText());
    };

    const validationDraft = computed<RangeDraft>(() =>
      pendingEnd.value ? { start: draft.value.start, end: EMPTY_EDGE } : draft.value,
    );

    // A part holding a value is complete; an emptied part reports whether it is empty or half typed.
    const effectiveStatus = computed<DraftFieldStatus>(() => {
      const value = validationDraft.value;
      const pick = (filled: string, status: SegmentedFieldStatus): SegmentedFieldStatus =>
        filled && status !== "out-of-range" ? "valid" : status;
      return {
        startDate: pick(value.start.date, fieldStatus.value.startDate),
        startTime: pick(value.start.time, fieldStatus.value.startTime),
        endDate: pick(value.end.date, fieldStatus.value.endDate),
        endTime: pick(value.end.time, fieldStatus.value.endTime),
      };
    });

    const validation = computed(() =>
      validateDraft(
        validationDraft.value,
        effectiveStatus.value,
        zone.value,
        props.hideRelativeTime,
      ),
    );

    const draftChanged = computed(
      () => pendingEnd.value || !sameDraft(draft.value, seededDraft.value),
    );

    // A draft from the fields counts once it differs from the applied window; text, a paste and a helper always do.
    const hasDraft = computed(() => {
      const pending = panelDraft.value;
      if (!pending) return false;
      return pending.kind !== "absolute" || pending.source !== "fields" || draftChanged.value;
    });

    const applyDisabled = computed(() => !hasDraft.value || !validation.value.valid);

    const summaryText = (us: number) =>
      formatInstantFull(us, zone.value, {
        locale: intlLocale.value,
        hourCycle: rangeLabelOptions.value.hourCycle,
        nowMs: tooltipNow.value,
      });

    const summaryRange = (): string => {
      const startUs = edgeInstant(validationDraft.value.start, zone.value).us;
      if (startUs === null) return "";
      const result = validation.value;
      const options = { ...rangeLabelOptions.value, browserZone: zone.value };
      if (result.valid && result.startUs !== null && result.endUs !== null) {
        if (props.hideRelativeTime) {
          return formatRangeLabel(result.startUs, result.endUs, zone.value, options).range;
        }
        return formatRangeFull(result.startUs, result.endUs, zone.value, options).range;
      }
      const endUs = edgeInstant(validationDraft.value.end, zone.value).us;
      return `${summaryText(startUs)} – ${endUs === null ? "…" : summaryText(endUs)}`;
    };

    const transitionDay = (date: string) =>
      new Intl.DateTimeFormat(intlLocale.value, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
        calendar: "gregory",
        numberingSystem: "latn",
      }).format(new Date(`${date}T00:00:00Z`));

    const edgeErrorText = (
      edge: DraftEdgeName,
      error: DraftEdgeError | null,
    ): I18nText | undefined => {
      const value = validationDraft.value[edge];
      if (error === "incomplete-date") return t("common.rangeIncompleteDate");
      if (error === "incomplete-time") return t("common.rangeIncompleteTime");
      if (error === "invalid-date") return t("common.rangeInvalidDate");
      // Without a host maxDate future days are pickable, so only the earliest date can be out of range.
      if (error === "out-of-range") {
        if (!props.maxDate) {
          return t("common.rangeOutOfBoundsMin", { min: toIsoDate(calendarMinDate.value) });
        }
        return t("common.rangeOutOfBounds", {
          min: toIsoDate(calendarMinDate.value),
          max: toIsoDate(props.maxDate),
        });
      }
      if (error === "skipped") {
        const change = describeDstTransition(value.date, value.time, zone.value);
        return t("common.rangeTimeSkipped", {
          time: value.time.slice(0, 5),
          date: transitionDay(value.date),
          zone: zone.value,
          from: change?.before ?? "",
          to: change?.after ?? "",
        });
      }
      if (error === "end-before-start") return t("common.rangeEndBeforeStartShort");
      return undefined;
    };

    // The note under the line names the Start that End falls before; the field error stays short.
    const endBeforeStartText = (): I18nText => {
      const startUs = edgeInstant(validationDraft.value.start, zone.value).us;
      return t("common.rangeEndBeforeStart", {
        start: startUs === null ? "" : summaryText(startUs),
      });
    };

    const errorPart = (error: DraftEdgeError | null): "date" | "time" | "both" => {
      if (error === "incomplete-time" || error === "skipped") return "time";
      if (error === "end-before-start" || error === null) return "both";
      return "date";
    };

    const draftErrors = computed(() => ({
      start: edgeErrorText("start", validation.value.start),
      end: edgeErrorText("end", validation.value.end),
      startPart: errorPart(validation.value.start),
      endPart: errorPart(validation.value.end),
    }));

    const draftOffsets = computed(() => ({
      start: edgeInstant(draft.value.start, zone.value).offsets,
      end: pendingEnd.value ? [] : edgeInstant(draft.value.end, zone.value).offsets,
    }));

    const calendarInvalidDates = computed(() =>
      validation.value.end === "end-before-start"
        ? [toSlashDate(draft.value.start.date), toSlashDate(draft.value.end.date)]
        : [],
    );

    const repeatedHourNote = (): ResolvedLineNote | null => {
      const edge: DraftEdgeName | null = draftOffsets.value.start.length
        ? "start"
        : draftOffsets.value.end.length
          ? "end"
          : null;
      if (!edge) return null;
      const value = draft.value[edge];
      const change = describeDstTransition(value.date, value.time, zone.value);
      if (!change) return null;
      return {
        kind: "info",
        reason: "repeated-hour",
        text: t("common.rangeTimeRepeated", {
          time: change.before,
          date: transitionDay(value.date),
          from: change.after,
          to: change.before,
        }),
      };
    };

    const draftWindow = computed<LineWindow | null>(() => {
      const pending = panelDraft.value;
      if (!pending || pending.kind === "instant") return null;
      const result = validation.value;
      if (!result.valid || result.startUs === null || result.endUs === null) return null;
      if (pending.kind === "calendar") {
        return {
          kind: "calendar",
          token: pending.token,
          startUs: result.startUs,
          endUs: result.endUs,
        };
      }
      return { kind: pending.kind, startUs: result.startUs, endUs: result.endUs };
    });

    const appliedWindow = computed<LineWindow | null>(() => {
      const source = appliedSource.value;
      const nowMs = tooltipNow.value;
      if (!props.disableRelative && source.type === "relative") {
        const range = resolveCalendarPeriod(source.calendarToken, zone.value, nowMs);
        if (range && source.calendarToken) {
          return {
            kind: "calendar",
            token: source.calendarToken,
            startUs: range.startTime,
            endUs: range.endTime,
          };
        }
        return {
          kind: "relative",
          startUs: relativeStartMs(source.relativeValue, source.relativePeriod, nowMs) * 1000,
          endUs: nowMs * 1000,
        };
      }
      if (
        !Number.isFinite(source.startUs) ||
        !Number.isFinite(source.endUs) ||
        source.startUs <= 0
      ) {
        return null;
      }
      return { kind: "absolute", startUs: source.startUs, endUs: source.endUs };
    });

    const previewWindow = computed<LineWindow | null>(() => {
      const item = previewItem.value;
      if (!item) return null;
      const nowMs = tooltipNow.value;
      if (item.kind === "relative") {
        return {
          kind: "relative",
          startUs: relativeStartMs(item.value, item.unit, nowMs) * 1000,
          endUs: nowMs * 1000,
        };
      }
      if (item.kind === "calendar") {
        const preset = CALENDAR_RAIL_ITEMS.find((entry) => entry.id === item.id);
        const range = preset ? resolveCalendarPeriod(preset.token, zone.value, nowMs) : null;
        if (!preset || !range) return null;
        return {
          kind: "calendar",
          token: preset.token,
          startUs: range.startTime,
          endUs: range.endTime,
        };
      }
      const entry = timeRangeHistory.entries.value[Number(item.id)];
      return entry ? { kind: "absolute", startUs: entry.startUs, endUs: entry.endUs } : null;
    });

    const calendarPreview = computed(() => {
      const preview = previewWindow.value;
      if (!preview) return null;
      return {
        start: convertUnixTime(preview.startUs).date,
        end: convertUnixTime(displayEndUs(preview.startUs, preview.endUs, zone.value)).date,
      };
    });

    const windowText = (window: LineWindow): string => {
      const options = { ...rangeLabelOptions.value, browserZone: zone.value };
      // A phone line has room for minutes only; the field already states the window.
      if (props.hideRelativeTime) {
        return formatRangeLabel(window.startUs, window.endUs, zone.value, options).range;
      }
      if (isMobile.value) {
        return formatRangeLabel(window.startUs, window.endUs, zone.value, {
          ...options,
          precision: "minutes",
        }).range;
      }
      return formatRangeFull(window.startUs, window.endUs, zone.value, options).range;
    };

    // "2 days ago" in the picker's language, in the largest whole unit.
    const endedAgo = (ms: number): string => {
      const minutes = Math.floor(ms / 60_000);
      const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
        minutes >= 1440
          ? [Math.floor(minutes / 1440), "day"]
          : minutes >= 60
            ? [Math.floor(minutes / 60), "hour"]
            : [minutes, "minute"];
      try {
        return new Intl.RelativeTimeFormat(intlLocale.value, { style: "narrow" }).format(
          -value,
          unit,
        );
      } catch {
        return `${value}${unit[0]}`;
      }
    };

    // "ended … ago" only fits the applied line on a wide panel; a draft or a phone shows just Fixed.
    const kindOf = (
      window: LineWindow,
      withEnded = false,
    ): Pick<ResolvedLineView, "kind" | "kindTooltip"> => {
      if (window.kind === "relative") {
        return { kind: t("common.rangeEndingNow"), kindTooltip: t("common.rangeMovesWithNow") };
      }
      if (window.kind === "calendar") {
        return { kind: t(ROLLS_KEYS[parseCalendarToken(window.token)?.unit ?? "day"]) };
      }
      const agoMs = tooltipNow.value - Math.floor(window.endUs / 1000);
      if (!withEnded || isMobile.value || agoMs < ENDED_AGO_MIN_MS) {
        return { kind: t("common.rangeFixed") };
      }
      return {
        kind: raw(
          `${t("common.rangeFixed")} · ${t("common.rangeEndedAgo", { ago: endedAgo(agoMs) })}`,
        ),
      };
    };

    // Only hand-typed text is led by "Read as"; a paste says how it was read in its note.
    const readAsLead = (pending: PanelDraft): I18nText | undefined =>
      pending.source === "text" ? t("common.rangeReadAs") : undefined;

    // One row in fixed slots: a preview, an instant, the draft (or the clamped window it runs), else the applied range.
    const lineView = computed<ResolvedLineView>(() => {
      const preview = previewWindow.value;
      if (preview) {
        return {
          mode: "preview",
          lead: t("common.rangePreview"),
          range: windowText(preview),
          duration: formatRecentDuration(preview.startUs, preview.endUs),
          ...kindOf(preview),
          endSlot: preview.kind === "calendar" ? "freeze" : null,
        };
      }
      const pending = panelDraft.value;
      if (pending?.kind === "instant") {
        return {
          mode: "instant",
          lead: t("common.rangeInstantRead"),
          range: summaryText(pending.us),
          duration: "",
          kind: "",
          endSlot: "badge",
        };
      }
      if (pending && hasDraft.value) {
        const window = draftWindow.value;
        const runs = pending.kind === "relative" && pending.typed !== undefined;
        return {
          mode: runs ? "runs" : "read-as",
          lead: runs ? t("common.rangeRuns") : window ? readAsLead(pending) : undefined,
          range: window ? windowText(window) : summaryRange(),
          duration: window ? formatRecentDuration(window.startUs, window.endUs) : raw("—"),
          ...(window ? kindOf(window) : { kind: "" as const }),
          endSlot: "badge",
        };
      }
      const applied = appliedWindow.value;
      if (!applied) return { mode: "applied", range: "", duration: "", kind: "", endSlot: null };
      return {
        mode: "applied",
        range: windowText(applied),
        duration: formatRecentDuration(applied.startUs, applied.endUs),
        ...kindOf(applied, true),
        endSlot: applied.kind === "calendar" ? "freeze" : props.hideRangeShift ? null : "zoom",
      };
    });

    // A draft that cannot apply as it is: End before Start offers Swap, a skipped wall time offers the next valid one.
    const repairNote = (): ResolvedLineNote | null => {
      const result = validation.value;
      if (result.end === "end-before-start") {
        return {
          kind: "error",
          reason: "end-before-start",
          text: endBeforeStartText(),
          actions: [{ id: "swap", label: t("common.rangeSwap"), dataTest: "date-time-range-swap" }],
        };
      }
      const skipped: DraftEdgeName | null =
        result.start === "skipped" ? "start" : result.end === "skipped" ? "end" : null;
      const next = skipped ? nextValidTime(skipped) : null;
      if (!skipped || !next) return null;
      return {
        kind: "error",
        reason: "skipped",
        text: draftErrors.value[skipped] ?? raw(""),
        actions: [
          {
            id: "dst-next",
            label: t("common.rangeUseTime", { time: next.slice(0, 5) }),
            dataTest: "date-time-range-dst-next",
          },
        ],
      };
    };

    const limitNote = (): ResolvedLineNote | null => {
      const pending = panelDraft.value;
      if (pending?.kind === "relative" && pending.typed) {
        const text = t("common.rangeOverLimit", {
          typed: relativeLabel(pending.typed),
          range: relativeLabel(pending),
        });
        const host = props.queryRangeRestrictionMsg;
        return {
          kind: "warn",
          reason: "query-range-limit",
          text: raw(host ? `${text} ${host}` : text),
        };
      }
      const result = validation.value;
      if (
        result.valid &&
        props.queryRangeRestrictionMsg &&
        exceedsRangeRestriction(
          result.startUs as number,
          result.endUs as number,
          props.queryRangeRestrictionInHour,
        )
      ) {
        return {
          kind: "warn",
          reason: "query-range-limit",
          text: raw(props.queryRangeRestrictionMsg),
        };
      }
      return null;
    };

    // One note at a time: a read error, a repair, the zone switch, the query-range limit, how text was read, then DST.
    const lineNote = computed<ResolvedLineNote | null>(() => {
      if (parseError.value && !fieldTyping.value) return parseErrorNote(parseError.value);
      if (readNote.value?.kind === "error") return readNote.value;
      const repair = panelDraft.value ? repairNote() : null;
      if (repair) return repair;
      if (zoneNote.value) return zoneNote.value;
      return limitNote() ?? readNote.value ?? repeatedHourNote();
    });

    const onDraftEdge = (edge: DraftEdgeName, value: DraftEdge) => {
      const next = edge === "end" && pendingEnd.value ? fillPendingEnd(value) : value;
      if (edge === "end") pendingEnd.value = false;
      draft.value = { ...draft.value, [edge]: { ...next } };
      if (value.date) calendarMonth.value = toSlashDate(value.date);
      markFieldsDraft();
    };

    // The End fields read empty while a first calendar click waits, yet that End is the clicked day at the draft's time.
    const fillPendingEnd = (value: DraftEdge): DraftEdge => ({
      date: value.date || draft.value.start.date,
      time: value.time || draft.value.end.time,
      offset: value.offset,
    });

    const onFieldStatus = (part: RangeFieldPart, status: SegmentedFieldStatus) => {
      fieldStatus.value = { ...fieldStatus.value, [part]: status };
    };

    const setEdgeTime = (edge: DraftEdgeName, time: string) => {
      const current =
        edge === "end" && pendingEnd.value ? { ...draft.value.start } : draft.value[edge];
      onDraftEdge(edge, { ...current, time, offset: "" });
    };

    // Now ends the range at this second.
    const setEndNow = () => {
      const nowUs = Math.floor(Date.now() / 1000) * MICROS_PER_SECOND;
      const { start } = draftFromRange(nowUs, nowUs + MICROS_PER_SECOND, zone.value);
      onDraftEdge("end", { ...start });
    };

    const setHourFormat = (value: "24h" | "12h") => {
      hourFormat.value = value;
      useLocalHourFormat(value);
    };

    const onHourFormat = (value: unknown) => {
      if (value === "24h" || value === "12h") setHourFormat(value);
    };

    const applyDraft = (): boolean => {
      if (!validation.value.valid) return false;
      const value = validationDraft.value;
      isSeedingAbsolute = true;
      selectedDate.value = { from: toSlashDate(value.start.date), to: toSlashDate(value.end.date) };
      if (!props.hideRelativeTime) {
        selectedTime.value = { startTime: value.start.time, endTime: value.end.time };
      }
      appliedOffsets = { start: value.start.offset, end: value.end.offset };
      exactEndDate = null;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      selectedType.value = "absolute";
      calendarToken.value = null;
      isUserInitiated = true;
      saveDate("absolute");
      recordAbsoluteRange();
      seedDraft();
      return true;
    };

    const focusInvalidField = () => {
      const edge: DraftEdgeName = validation.value.start ? "start" : "end";
      const error = validation.value[edge];
      rangeFields.value?.focusField("invalid", edge, errorPart(error) === "time" ? "time" : "date");
    };

    const submitDraft = () => {
      if (pendingEnd.value) commitPendingDay();
      if (validation.value.valid && hasDraft.value) {
        applyAndClose();
        return;
      }
      if (!validation.value.valid) focusInvalidField();
    };

    const onCalendarPending = (day: string | null) => {
      if (day === null) return;
      draft.value = {
        ...draft.value,
        start: { ...draft.value.start, date: toIsoDate(day), offset: "" },
      };
      pendingEnd.value = true;
      markFieldsDraft();
    };

    // The calendar swaps a second click before the first, so the times swap with the days.
    const onCalendarStart = (day: string) => {
      const date = toIsoDate(day);
      if (pendingEnd.value && date !== draft.value.start.date) {
        const { start, end } = draft.value;
        draft.value = { start: { ...end, date, offset: "" }, end: { ...start, offset: "" } };
        markFieldsDraft();
        return;
      }
      draft.value = { ...draft.value, start: { ...draft.value.start, date, offset: "" } };
      markFieldsDraft();
    };

    const onCalendarEnd = (day: string) => {
      const date = toIsoDate(day);
      draft.value = { ...draft.value, end: { ...draft.value.end, date, offset: "" } };
      pendingEnd.value = false;
      markFieldsDraft();
    };

    const setDateType = (type: string) => {
      selectedType.value = type;
      // displayValue.value = getDisplayValue();
      if (props.autoApply) saveDate(type === "absolute" ? "absolute" : "relative-custom");
    };

    /**
     * Shift the applied time window backward (`prev`) or forward (`next`) by its
     * own duration, then promote the picker to an absolute range and emit the
     * change so the page re-runs its query. Works from both relative and
     * absolute modes: `getConsumableDateTime` resolves the current window to
     * concrete microsecond timestamps first, so shifting across midnight/day
     * boundaries stays exact and a relative picker is switched to absolute.
     *
     * Deliberately does NOT call `markProgrammaticDateChange()`: the change is
     * user-driven, so `userChangedValue` stays `true` and consumers (e.g.
     * traces live-mode) re-run their query just like a manual Apply. With
     * `autoApply` the deep `selectedDate`/`selectedTime` watcher saves the new
     * range; otherwise we save and emit directly.
     */
    const shiftTimeRange = (direction: "prev" | "next") => {
      if (selectedType.value === "relative" && calendarToken.value !== null) {
        const shifted = shiftCalendarToken(calendarToken.value, direction === "prev" ? -1 : 1);
        if (shifted === null || !resolveCalendarPeriod(shifted, zone.value)) return;
        refreshTooltipNow();
        // A partial period can step into a full one longer than the page allows, which the rail would have refused.
        if (calendarExceedsRestriction(shifted)) {
          if (props.queryRangeRestrictionMsg) {
            toast({ variant: "warning", message: raw(props.queryRangeRestrictionMsg) });
          }
          return;
        }
        calendarToken.value = shifted;
        menuOpen.value = false;
        saveDate("relative");
        return;
      }
      const { startTime, endTime } = getConsumableDateTime();
      const duration = endTime - startTime;
      if (!(duration > 0)) return;

      let delta = (direction === "prev" ? -1 : 1) * duration;
      if (direction === "next") {
        // A forward shift stops where the calendar does: now, or the end of `maxDate`.
        delta = Math.min(delta, forwardCeilingMicros() - endTime);
        if (delta < MICROS_PER_SECOND) return;
      }
      const startDateTime = convertUnixTime(startTime + delta);
      const endDateTime = convertUnixTime(endTime + delta);

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;
      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
      appliedOffsets = { start: "", end: "" };
      rememberEndInstant(endTime + delta, endTime + delta);
      selectedType.value = "absolute";

      menuOpen.value = false;
      if (!props.autoApply) saveDate("absolute");
    };

    const forwardCeilingMicros = () =>
      props.maxDate
        ? convertToUtcTimestamp(`${props.maxDate} 23:59:59`, zone.value)
        : Date.now() * 1000;

    const isNextShiftDisabled = () => {
      if (selectedType.value === "relative") {
        return (parseCalendarToken(calendarToken.value)?.offset ?? 0) === 0;
      }
      const { endUTC } = getUTCTimeStamp();
      return !(endUTC + MICROS_PER_SECOND <= forwardCeilingMicros());
    };

    const isFieldInput = (target: EventTarget | null) =>
      target instanceof HTMLElement && !!target.closest("[data-test='date-time-range-input']");

    // Esc is handled here and stopped, so neither the popover's dismiss nor a page or dialog Escape shortcut sees it.
    const onEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTimezoneSelectOpen.value) return;
      event.preventDefault();
      event.stopPropagation();
      if (beforeTyping && (fieldEdited.value || parseError.value !== null)) {
        restorePanel(beforeTyping);
        nextTick(() => rangeField.value?.focusAndSelect());
        return;
      }
      closePanel("escape");
    };

    const onPickerKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscape(event);
        return;
      }
      if (event.key !== "ArrowDown" || !isFieldInput(event.target)) return;
      event.preventDefault();
      if (instantDraft.value) focusInstantChoice(instantDraft.value.choice);
      else helpers.value?.focusFirst();
    };

    const selectedRelativeKey = computed<string | null>(() => {
      const pending = panelDraft.value;
      if (pending) return pending.kind === "relative" ? `${pending.value}${pending.unit}` : null;
      if (selectedType.value !== "relative" || calendarToken.value !== null) return null;
      return `${relativeValue.value}${relativePeriod.value}`;
    });

    const relativeRows = computed<RelativeRow[] | null>(() => {
      if (props.disableRelative || props.hideRelativeTime) return null;
      const limit = props.queryRangeRestrictionInHour;
      return RELATIVE_CHIPS.map(([unit, values]) => ({
        unit,
        label: t(RELATIVE_ROW_KEYS[unit] ?? "common.rangeUnitMinutes"),
        chips: values.map((value) => ({
          value,
          ariaLabel: t(pastKeyFor(unit), { count: value }),
          selected: selectedRelativeKey.value === `${value}${unit}`,
          disabled: limit > 0 && (value * RELATIVE_UNIT_SECONDS[unit]) / 3600 > limit,
        })),
      }));
    });

    // Calendar periods are rolling tokens, which a dates-only picker cannot emit.
    const calendarRows = computed<CalendarRow[]>(() => {
      const items = calendarRailItems.value;
      if (!items || props.disableRelative) return [];
      return CALENDAR_ROW_KEYS.map(([key, ids]) => ({
        label: t(key),
        items: ids
          .map((id) => items.find((item) => item.id === id))
          .filter((item): item is TimeRangeRailItem => item !== undefined),
      }));
    });

    const hasHelpers = computed(
      () => relativeRows.value !== null || calendarRows.value.length > 0 || showRail.value,
    );

    const customBodyShown = computed(() => !isMobile.value || customOpen.value);

    const onHelperPreview = (item: HelperItem) => {
      refreshTooltipNow();
      previewItem.value = item;
    };

    const endPreview = () => {
      previewItem.value = null;
    };

    // Focus leaving the helpers and the line's Use these dates ends a preview; the pointer can still travel to the line.
    const onPanelFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.("[data-roving], [data-test='date-time-range-freeze']")) {
        previewItem.value = null;
      }
    };

    const fillAbsoluteDraft = (startUs: number, endUs: number) => {
      panelDraft.value = { kind: "absolute", source: "helper", zoneAssumed: false };
      draft.value = draftFromRange(startUs, endUs, zone.value);
      pendingEnd.value = false;
      fieldStatus.value = emptyFieldStatus();
      parseError.value = null;
      readNote.value = null;
      showDraftMonth();
      showText(draftText());
    };

    const commitRelative = (window: RelativeWindow, valueType: "relative" | "relative-custom") => {
      selectedType.value = "relative";
      calendarToken.value = null;
      relativePeriod.value = window.unit;
      relativeValue.value = window.value;
      isUserInitiated = true;
      saveDate(valueType);
    };

    const commitCalendar = (token: string) => {
      selectedType.value = "relative";
      calendarToken.value = token;
      isUserInitiated = true;
      saveDate("relative");
    };

    // Fixed instants become the applied absolute range; saved once here, so the auto-apply watcher must not save again.
    const commitAbsoluteRange = (startUs: number, endUs: number, record: boolean) => {
      const start = convertUnixTime(startUs);
      const shownEndUs = displayEndUs(startUs, endUs, zone.value);
      const end = convertUnixTime(shownEndUs);
      appliedOffsets = { start: "", end: "" };
      isSeedingAbsolute = true;
      selectedDate.value.from = start.date;
      selectedDate.value.to = end.date;
      selectedTime.value.startTime = start.time;
      selectedTime.value.endTime = end.time;
      rememberEndInstant(endUs, shownEndUs);
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      selectedType.value = "absolute";
      calendarToken.value = null;
      isUserInitiated = true;
      saveDate("absolute");
      if (record && showRail.value) timeRangeHistory.add(startUs, endUs, zone.value);
    };

    // A helper commits and closes on an applying host; elsewhere it fills the draft and waits for Apply.
    const onHelperSelect = (item: HelperItem) => {
      previewItem.value = null;
      if (item.kind === "recent") {
        const entry = timeRangeHistory.entries.value[Number(item.id)];
        if (!entry) return;
        if (props.autoApply) applyRecentRange(item.id);
        else fillAbsoluteDraft(entry.startUs, entry.endUs);
        return;
      }
      if (item.kind === "calendar") {
        const preset = CALENDAR_RAIL_ITEMS.find((entry) => entry.id === item.id);
        if (!preset) return;
        if (props.autoApply) {
          applyCalendarItem(item.id);
          return;
        }
        setPanelDraft({ kind: "calendar", source: "helper", token: preset.token });
        showText(draftText());
        return;
      }
      const window = { value: item.value, unit: item.unit };
      if (props.autoApply) {
        commitRelative(window, "relative");
        closePanel();
        return;
      }
      setPanelDraft({ kind: "relative", source: "helper", ...window });
      showText(draftText());
    };

    // Use these dates turns a calendar period into its fixed dates, committed like a chip.
    const freezeToken = (token: string) => {
      const range = resolveCalendarPeriod(token, zone.value);
      if (!range) return;
      previewItem.value = null;
      if (!props.autoApply) {
        fillAbsoluteDraft(range.startTime, range.endTime);
        return;
      }
      commitAbsoluteRange(range.startTime, range.endTime, true);
      closePanel();
    };

    const freezeCalendar = () => {
      const preview = previewWindow.value;
      const token =
        preview?.kind === "calendar" ? preview.token : (appliedWindow.value?.token ?? null);
      if (token) freezeToken(token);
    };

    const freezeCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((entry) => entry.id === id);
      if (preset) freezeToken(preset.token);
    };

    const instantDraft = computed(() =>
      panelDraft.value?.kind === "instant" ? panelDraft.value : null,
    );

    const windowLabel = (minutes: number) => (minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`);

    const instantChoices = computed(() => {
      const pending = instantDraft.value;
      if (!pending) return [];
      const around = instantWindow({ ...pending, choice: "around" }, tooltipNow.value);
      return [
        {
          id: "around" as const,
          chosen: pending.choice === "around",
          label: t("common.rangeInstantAround", {
            range: windowText({ kind: "absolute", ...around }),
          }),
          detail: "",
        },
        {
          id: "since" as const,
          chosen: pending.choice === "since",
          label: t("common.rangeInstantSince", { time: summaryText(pending.us) }),
          detail: formatRecentDuration(pending.us, tooltipNow.value * 1000),
        },
      ];
    });

    const chooseInstant = (choice: "around" | "since") => {
      const pending = instantDraft.value;
      if (pending && pending.choice !== choice) setPanelDraft({ ...pending, choice });
    };

    const pickInstantChoice = (choice: "around" | "since") => {
      chooseInstant(choice);
      if (props.autoApply) applyAndClose();
    };

    const setInstantWindow = (value: unknown) => {
      const pending = instantDraft.value;
      const minutes = INSTANT_WINDOWS.find((option) => String(option) === value);
      if (pending && minutes) setPanelDraft({ ...pending, choice: "around", window: minutes });
    };

    const panelEl = () => document.getElementById("date-time-menu");

    const focusInstantChoice = (choice: "around" | "since") => {
      nextTick(() =>
        panelEl()?.querySelector<HTMLElement>(`[data-test='date-time-instant-${choice}']`)?.focus(),
      );
    };

    // ↑ ↓ move the highlight between the two readings; past them, focus returns to the field or goes on to the helpers.
    const onInstantKeydown = (event: KeyboardEvent, choice: "around" | "since") => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "ArrowUp") {
        if (choice === "around") rangeField.value?.focusAndSelect();
        else {
          chooseInstant("around");
          focusInstantChoice("around");
        }
        return;
      }
      if (choice === "since") {
        helpers.value?.focusFirst();
        return;
      }
      chooseInstant("since");
      focusInstantChoice("since");
    };

    const zoomSource = (): ZoomRange | null => {
      const window = appliedWindow.value;
      if (!window) return null;
      if (window.kind === "relative") {
        return {
          kind: "relative",
          value: appliedSource.value.relativeValue,
          unit: appliedSource.value.relativePeriod as RelativeUnit,
        };
      }
      return { kind: "absolute", startUs: window.startUs, endUs: window.endUs };
    };

    const zoomTarget = (): ZoomRange | null => {
      const source = zoomSource();
      if (!source) return null;
      return zoomOutRange(source, {
        nowUs: Date.now() * 1000,
        minUs: convertToUtcTimestamp(`${calendarMinDate.value} 00:00:00`, zone.value),
        limitHours: props.queryRangeRestrictionInHour,
      });
    };

    const zoomDisabled = computed(() => {
      void tooltipNow.value;
      void appliedSource.value;
      return zoomTarget() === null;
    });

    // Zoom out commits at once and discards any draft, like the shift arrows.
    const zoomOut = () => {
      if (props.hideRangeShift || props.disable) return;
      const next = zoomTarget();
      if (!next) return;
      if (next.kind === "relative") commitRelative(next, "relative-custom");
      else commitAbsoluteRange(next.startUs, next.endUs, false);
      closePanel();
    };

    // The earlier and later keys follow reading order, so they swap in RTL.
    const shiftByKey = (direction: "prev" | "next") => {
      const rtl = rootEl.value ? getComputedStyle(rootEl.value).direction === "rtl" : false;
      const step = rtl ? (direction === "prev" ? "next" : "prev") : direction;
      if (props.disable) return;
      if (step === "prev" && props.disablePrevShift) return;
      if (step === "next" && isNextShiftDisabled()) return;
      shiftTimeRange(step);
    };

    const openFromShortcut = () => {
      if (props.disable || menuOpen.value) return;
      menuOpen.value = true;
      onMenuOpenChange(true);
    };

    const pageShortcutList: Shortcut[] = [
      { key: "t", handler: openFromShortcut, description: t("common.rangeShortcutOpen") },
    ];
    if (!props.hideRangeShift) {
      pageShortcutList.push(
        {
          key: "[",
          handler: () => shiftByKey("prev"),
          description: t("common.rangeShortcutEarlier"),
        },
        {
          key: "]",
          handler: () => shiftByKey("next"),
          description: t("common.rangeShortcutLater"),
        },
        { key: "-", handler: zoomOut, description: t("common.rangeZoomOut") },
      );
    }
    useShortcuts(pageShortcutList, undefined, {
      active: computed(() => props.pageShortcuts && !props.disable),
    });

    const fieldPlaceholder = computed(() =>
      t("common.rangeInputPlaceholder", {
        relative: raw(props.disableRelative || props.hideRelativeTime ? "2026-11-04" : "90m"),
        absolute: raw("Nov 4, 13:00 - 15:00"),
      }),
    );

    // The field reads in error for text that does not read and for a draft End before Start or in a DST gap.
    const fieldInvalid = computed(
      () =>
        (parseError.value !== null && !fieldTyping.value) ||
        (panelDraft.value !== null && repairNote() !== null),
    );

    // The hint stays over the applied or a pasted value, never over hand-typed text or an error.
    const showFieldHint = computed(
      () => !fieldEdited.value && fieldText.value !== "" && !fieldInvalid.value,
    );

    const zoneLinkText = computed(() => formatZoneName(zone.value, tooltipNow.value));

    // A phone's zone link has room only for the short name (IST).
    const zoneAbbreviationText = computed(() => zoneAbbreviation(zone.value, tooltipNow.value));

    const computeRelativePeriod = () => {
      if (selectedType.value === "relative") {
        if (props.queryRangeRestrictionInHour > 0) {
          for (let period of relativePeriods) {
            if (period.value == "s") {
              relativePeriodsMaxValue.value[period.value] = 60;
            }

            if (period.value == "m") {
              relativePeriodsMaxValue.value[period.value] = 60;
            }

            if (period.value == "h" && props.queryRangeRestrictionInHour > 0) {
              relativePeriodsMaxValue.value[period.value] = props.queryRangeRestrictionInHour;
            } else if (period.value == "h") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (period.value == "d" && props.queryRangeRestrictionInHour > 24) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / 24) || 31;
            } else if (period.value == "d") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (period.value == "w" && props.queryRangeRestrictionInHour > 24 * 7) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / (24 * 7)) || 100;
            } else if (period.value == "w") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (period.value == "M" && props.queryRangeRestrictionInHour > 24 * 30) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / (24 * 30)) || 100;
            } else if (period.value == "M") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }
          }
        } else {
          relativePeriodsMaxValue.value = {
            s: 0,
            m: 0,
            h: 0,
            d: 0,
            w: 0,
            M: 0,
          };
        }

        relativePeriodsSelect.value = relativePeriods.filter((period) => {
          if (relativePeriodsMaxValue.value[period.value] > -1) {
            return period;
          }
          return undefined;
        });

        if (calendarExceedsRestriction(calendarToken.value)) {
          // Clamped like a too-long rolling range: to the largest window the page allows.
          const unit = [...periodUnits].reverse().find((u) => relativePeriodsMaxValue.value[u] > 0);
          if (unit) {
            setRelativeDate(unit, relativePeriodsMaxValue.value[unit]);
          } else {
            calendarToken.value = null;
            if (props.autoApply) saveDate("relative");
          }
        }

        if (props.queryRangeRestrictionInHour > 0) {
          const maxRelativeValue = relativePeriodsMaxValue.value[relativePeriod.value];

          try {
            if (maxRelativeValue !== -1 && relativeValue.value > maxRelativeValue) {
              setRelativeDate(relativePeriod.value, maxRelativeValue);
            } else if (maxRelativeValue === -1) {
              const periodIndex = periodUnits.indexOf(relativePeriod.value);
              for (let i = periodIndex; i >= 0; i--) {
                if (relativePeriodsMaxValue.value[periodUnits[i]] > -1) {
                  setRelativeDate(
                    periodUnits[i],
                    relativeDates[periodUnits[i]]?.[0] ?? relativeDates["m"][0], // fallback to 15 minutes,
                  );
                  break;
                }
              }
            }
          } catch (e) {
            console.log("Error while setting relative date", e);
          }
        }
      }
    };

    const showOnlyAbsolute = () => {
      if (props.disableRelative) {
        setDateType("absolute");
      }
    };

    const onHide = () => {
      emit("hide");
    };

    const onShow = () => {
      emit("show");
    };

    const recordAbsoluteRange = () => {
      if (!showRail.value || selectedType.value !== "absolute") return;
      const { startUTC, endUTC } = getUTCTimeStamp();
      timeRangeHistory.add(startUTC, endUTC, zone.value);
    };

    // Calendar labels name a day and the rail ends "so far" ranges at now, so the clock runs only while one is shown.
    const needsClock = computed(
      () =>
        props.calendarPresets &&
        (menuOpen.value || calendarToken.value !== null || appliedCalendarToken.value !== null),
    );
    let clockTick: ReturnType<typeof setInterval> | null = null;
    const stopClock = () => {
      if (clockTick !== null) clearInterval(clockTick);
      clockTick = null;
    };
    const syncClock = () => {
      if (!needsClock.value) return stopClock();
      if (clockTick !== null) return;
      refreshTooltipNow();
      clockTick = setInterval(refreshTooltipNow, 60_000);
    };
    watch(needsClock, syncClock, { immediate: true });
    onActivated(syncClock);
    onDeactivated(stopClock);
    onBeforeUnmount(stopClock);
    // The shift arrows discard the draft and move the applied range, so their pointerdown must not apply it.
    const onPointerDownOutside = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-test='date-time-prev-btn'], [data-test='date-time-next-btn']")) {
        closeReason = "shift";
      }
    };

    // Applies the draft as it stands; false when there is none or it does not read.
    const commitPanelDraft = (): boolean => {
      const pending = panelDraft.value;
      if (!pending) return false;
      if (pending.kind === "relative") {
        commitRelative(pending, pending.source === "helper" ? "relative" : "relative-custom");
        return true;
      }
      if (pending.kind === "calendar") {
        commitCalendar(pending.token);
        return true;
      }
      // From an instant to now ends when it is applied, not when it was read.
      if (pending.kind === "instant") syncDraftWindow();
      if (pendingEnd.value) commitPendingDay();
      return applyDraft();
    };

    // An outside close (Run query included) on an auto-apply host applies a deliberate draft before the click lands; typed text is dropped.
    const applyOnClose = () => {
      const reason = closeReason;
      closeReason = null;
      if (!props.autoApply || reason !== null || fieldEdited.value || !panelDraft.value) return;
      if (pendingEnd.value) commitPendingDay();
      if (hasDraft.value && validation.value.valid) commitPanelDraft();
    };

    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        refreshTooltipNow();
        closeReason = null;
        customOpen.value = false;
        liveText.value = "";
        seedDraft();
        onBeforeShow();
        onShow();
      } else {
        applyOnClose();
        discardDraft();
        if (!props.autoApply || selectedType.value !== appliedSelection.selectedType) {
          restoreAppliedSelection();
        }
        onBeforeHide();
        onHide();
      }
    };

    // The field holds the applied range selected, so typing or pasting replaces it at once.
    const onPopoverOpenAutoFocus = (event: Event) => {
      event.preventDefault();
      // On a phone a focused field raises the keyboard, so the panel itself takes focus and Esc still reaches it.
      if (isMobile.value) {
        nextTick(() => panelEl()?.focus());
        return;
      }
      nextTick(() => rangeField.value?.focusAndSelect());
    };

    // A commit, Esc or a shift closes the panel the way a user dismissal does, so listeners waiting on hide still run.
    const closePanel = (reason: "commit" | "escape" = "commit") => {
      if (!menuOpen.value) return;
      closeReason = reason;
      menuOpen.value = false;
      onMenuOpenChange(false);
    };

    // A single clicked day applies as that day, keeping both times.
    const commitPendingDay = () => {
      if (!pendingEnd.value) return;
      draft.value = { ...draft.value, end: { ...draft.value.end, date: draft.value.start.date } };
      pendingEnd.value = false;
    };

    const applyAndClose = () => {
      if (!commitPanelDraft()) {
        if (!validation.value.valid) focusInvalidField();
        return;
      }
      liveText.value = triggerLabel.value;
      closePanel();
    };

    const applyCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((item) => item.id === id);
      if (!preset) return;
      commitCalendar(preset.token);
      closePanel();
    };

    const applyRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (!entry) return;
      commitAbsoluteRange(entry.startUs, entry.endUs, true);
      closePanel();
    };

    const removeRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (entry) timeRangeHistory.remove(entry);
    };

    // Absolute labels shorten in steps instead of being cut: full, then without seconds, then the duration.
    let measuring = false;
    let settledHostWidth = -1;
    const labelFits = () => {
      const el = triggerLabelEl.value;
      return !el || el.scrollWidth <= el.clientWidth;
    };
    const measureLadder = async () => {
      if (measuring) return;
      measuring = true;
      try {
        ladderStep.value = 1;
        await nextTick();
        if (!labelFits()) {
          ladderStep.value = 2;
          await nextTick();
          if (!labelFits()) ladderStep.value = 3;
        }
      } finally {
        measuring = false;
        settledHostWidth = rootEl.value?.parentElement?.clientWidth ?? -1;
      }
    };
    let ladderObserver: ResizeObserver | null = null;
    onMounted(() => {
      const host = rootEl.value?.parentElement;
      if (!host || typeof ResizeObserver === "undefined") return;
      // A host sized by its content resizes with each step, so only a width change it did not cause re-measures.
      ladderObserver = new ResizeObserver(() => {
        if (Math.abs(host.clientWidth - settledHostWidth) < 1) return;
        void measureLadder();
      });
      ladderObserver.observe(host);
    });
    onBeforeUnmount(() => {
      ladderObserver?.disconnect();
    });
    watch(
      () => {
        const view = triggerView.value;
        return view.kind === "absolute" ? joinRangeLabel(view.full) : "";
      },
      (text) => {
        if (text) void measureLadder();
        else ladderStep.value = 1;
      },
    );

    onMounted(() => {
      if (!props.defaultOpen) return;
      // The click that mounted this picker must finish first, or the popover reads it as an outside click.
      nextTick(() => {
        menuOpen.value = true;
        onMenuOpenChange(true);
      });
    });

    return {
      raw,
      t,
      POPOVER_COLLISION_PADDING,
      INSTANT_WINDOWS,
      menuOpen,
      onMenuOpenChange,
      onPopoverOpenAutoFocus,
      datetimeBtn,
      setRelativeDate,
      relativePeriods,
      relativeDates,
      showRail,
      calendarRailItems,
      recentRailItems,
      applyCalendarItem,
      applyRecentRange,
      removeRecentRange,
      applyAndClose,
      calendarToken,
      calendarTooltip,
      triggerTooltip,
      refreshTooltipNow,
      saveDate,
      onBeforeShow,
      selectedType,
      selectedTime,
      selectedDate,
      relativePeriod,
      relativeValue,
      displayValue,
      triggerLabel,
      copyRange,
      pasteRange,
      onPickerPaste,
      refresh,
      dateLocale,
      resetTime,
      onTimezoneChange,
      timezone,
      filteredTimezone,
      timezoneFilterFn,
      setCustomDate,
      setSavedDate,
      setDateType,
      shiftTimeRange,
      isNextShiftDisabled,
      onPickerKeydown,
      getConsumableDateTime,
      setAbsoluteTime,
      setRelativeTime,
      getDisplayValue,
      relativePeriodsMaxValue,
      relativePeriodsSelect,
      computeRelativePeriod,
      onBeforeHide,
      showOnlyAbsolute,
      onShow,
      onHide,
      calendarMinDate,
      timezoneSelectOptions,
      isTimezoneSelectOpen,
      EMPTY_EDGE,
      START_OF_DAY,
      END_OF_DAY,
      toIsoDate,
      toSlashDate,
      rootEl,
      triggerLabelEl,
      rangeField,
      rangeFields,
      helpers,
      noteId,
      customHeadingId,
      triggerView,
      triggerAccessibleTail,
      triggerDescriptionId,
      ladderStep,
      measureLadder,
      onPointerDownOutside,
      draft,
      pendingEnd,
      pasted,
      hourFormat,
      calendarMonth,
      calendarPreview,
      draftErrors,
      draftOffsets,
      calendarInvalidDates,
      validation,
      applyDisabled,
      hasDraft,
      panelDraft,
      fieldText,
      shownText,
      fieldEdited,
      parseError,
      fieldPlaceholder,
      showFieldHint,
      fieldInvalid,
      lineView,
      lineNote,
      liveText,
      zoomDisabled,
      zoomOut,
      zoneLinkText,
      zoneAbbreviationText,
      instantDraft,
      instantChoices,
      pickInstantChoice,
      setInstantWindow,
      onInstantKeydown,
      windowLabel,
      relativeRows,
      calendarRows,
      hasHelpers,
      isMobile,
      customOpen,
      customBodyShown,
      onHelperSelect,
      onHelperPreview,
      endPreview,
      onPanelFocusIn,
      freezeCalendar,
      freezeCalendarItem,
      onNoteAction,
      onFieldInput,
      onFieldDraft,
      onFieldSubmit,
      onFieldPaste,
      onDraftEdge,
      onFieldStatus,
      setEdgeTime,
      setEndNow,
      setHourFormat,
      onHourFormat,
      submitDraft,
      onCalendarStart,
      onCalendarEnd,
      onCalendarPending,
      closePanel,
    };
  },
  computed: {
    relativePeriodWatch() {
      return this.queryRangeRestrictionInHour;
    },
  },
  watch: {
    relativePeriodWatch() {
      this.computeRelativePeriod();
    },
  },
});
</script>
