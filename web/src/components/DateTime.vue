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
    ref="root"
    icon="info"
    :data-date-time-shortcut="shortcutTarget || undefined"
    class="date-time-container inline-flex items-stretch [&_button:focus-visible]:z-1"
    :class="{
      'rounded-default border-button-outline-border min-h-7.5 border': !hideRangeShift,
      'w-full [&>*]:flex-1': fieldAppearance,
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
        :disabled="disable || disablePrevShift || isPrevShiftDisabled()"
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
      :hide-when-detached="false"
      content-class="border-border-default! overflow-hidden p-0 shadow-lg!"
      @update:open="onMenuOpenChange"
      @open-auto-focus="onPopoverOpenAutoFocus"
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
            'md:px-2!': showRangeZoom,
            'border-select-border! enabled:hover:border-select-border-hover! w-full':
              fieldAppearance,
          }"
          class="max-md:max-w-full max-md:min-w-0"
          :disabled="disable"
          @mouseenter="refreshTooltipNow"
          @pointerenter="prefetchRangeInput"
          @focus="prefetchRangeInput"
        >
          <template #icon-left>
            <OTooltip
              :content="triggerTooltip ?? t('common.selectDateRange')"
              :shortcut-id="shortcutEligible ? 'timeRangeOpen' : undefined"
            />
            <OIcon name="schedule" size="sm" />
          </template>
          <OTruncatedText
            class="date-time-label flex-1 text-left"
            :class="fieldAppearance ? 'font-normal' : 'font-semibold'"
            >{{ triggerLabel }}</OTruncatedText
          >
          <template #icon-right
            ><OIcon
              name="arrow-drop-down"
              size="sm"
              class="date-time-arrow ms-auto text-lg! transition-transform duration-250"
              :class="showRangeZoom ? 'md:hidden' : ''"
          /></template>
        </OButton>
      </template>
      <div
        id="date-time-menu"
        class="date-time-dialog z-10001 flex max-h-[calc(var(--reka-popper-available-height,37.5rem)-0.75rem)] max-w-[calc(100vw-1rem)] flex-col max-sm:overflow-y-auto"
        :class="showRail ? 'w-158.25 max-sm:w-81.25' : 'w-81.25'"
        @keydown.capture="onPickerKeydown"
        @paste="onPickerPaste"
      >
        <DateTimeRangeInput
          v-if="showRangeInput"
          ref="rangeInput"
          :zone="zone"
          :locale="String(locale)"
          :intl-locale="intlLocale"
          :applied="appliedRange"
          :limits="rangeLimits"
          :kinds="rangeKinds"
          :units="rangeUnits"
          :can-copy="gateReason === null"
          :span-limit="spanLimitText"
          :cap-rolling="capRolling"
          @apply="commitTypedReading"
          @dirty="rangeInputBlocksApply = $event"
          @valid="rangeInputValid = $event"
          @copy="copyRange"
          @paste="pasteRange"
        />
        <div
          class="grid min-h-0 flex-1 max-sm:flex max-sm:flex-col max-sm:overflow-y-auto"
          :class="
            showRail ? 'grid-cols-[19.25rem_1fr] grid-rows-[auto_1fr]' : 'grid-rows-[auto_1fr]'
          "
        >
          <div
            v-if="!disableRelative || (!hideClipboard && !showRangeInput)"
            class="border-border-default row-start-1 flex min-w-0 items-center gap-1 border-b px-3 py-2"
            :class="showRail ? 'col-start-2 max-sm:order-2' : 'col-start-1'"
          >
            <OToggleGroup
              v-if="!disableRelative"
              :model-value="selectedType"
              type="single"
              class="flex-1"
              data-test="date-time-type-toggle"
              @update:model-value="onTypeToggle"
            >
              <OToggleGroupItem
                value="relative"
                size="sm"
                class="flex-1"
                data-test="date-time-relative-tab"
              >
                {{ t("common.relative") }}
              </OToggleGroupItem>
              <OToggleGroupItem
                value="absolute"
                size="sm"
                class="flex-1"
                data-test="date-time-absolute-tab"
              >
                {{ t("common.absolute") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <div v-else class="flex-1" />
            <OTooltip v-if="!hideClipboard && !showRangeInput" :content="t('common.copyRange')">
              <OButton
                data-test="date-time-copy-btn"
                variant="ghost"
                size="icon-xs-sq"
                icon-left="content-copy"
                :aria-label="t('common.copyRange')"
                @click="copyRange"
              />
            </OTooltip>
            <OTooltip v-if="!hideClipboard && !showRangeInput" :content="t('common.pasteRange')">
              <OButton
                data-test="date-time-paste-btn"
                variant="ghost"
                size="icon-xs-sq"
                icon-left="content-paste"
                :aria-label="t('common.pasteRange')"
                @click="pasteRange"
              />
            </OTooltip>
          </div>
          <div
            v-if="showRail"
            class="bg-surface-panel border-border-default relative col-span-1 col-start-1 row-span-2 row-start-1 border-e max-sm:static max-sm:order-1 max-sm:border-e-0 max-sm:border-b"
            data-test="date-time-rail-frame"
          >
            <DateTimeRail
              :recent="recentRailItems"
              :calendar="calendarRailItems"
              :restriction-msg="raw(queryRangeRestrictionMsg)"
              class="absolute inset-0 min-h-0 overflow-y-auto max-sm:static max-sm:overflow-visible"
              @hover="refreshTooltipNow"
              @select-recent="applyRecentRange"
              @remove-recent="removeRecentRange"
              @select-calendar="applyCalendarItem"
            />
          </div>
          <div
            class="row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden max-sm:max-h-none max-sm:overflow-visible"
            :class="showRail ? 'col-start-2 max-sm:order-3' : 'col-start-1'"
          >
            <div
              class="relative grid min-h-0 flex-1 overflow-y-auto max-sm:flex-none max-sm:overflow-visible"
            >
              <div
                v-if="!disableRelative"
                role="tabpanel"
                class="col-start-1 row-start-1"
                :class="selectedType === 'relative' ? '' : 'pointer-events-none invisible'"
                :aria-hidden="selectedType !== 'relative'"
                :inert="selectedType !== 'relative'"
              >
                <div class="date-time-table relative flex flex-col">
                  <div
                    class="relative-row border-border-default flex items-center border-b py-2 ps-3 [&>*]:me-1.5"
                    v-for="(period, index) in relativePeriods"
                    :key="'date_' + index"
                  >
                    <div class="min-w-18.75 text-sm font-semibold">
                      {{ period.label }}
                    </div>
                    <div v-for="(item, item_index) in relativeDates[period.value]" :key="item">
                      <OButton
                        :disabled="blockedChips.has(`${item}${period.value}`)"
                        :data-test="`date-time-relative-${item}-${period.value}-btn`"
                        class="h-8! w-8! font-bold! disabled:opacity-35"
                        :class="
                          selectedType == 'relative' &&
                          calendarToken === null &&
                          relativePeriod == period.value &&
                          relativeValue == item
                            ? 'bg-button-primary! text-button-primary-foreground!'
                            : `bg-text-heading/7! ${relativePeriod}`
                        "
                        variant="ghost"
                        size="xs"
                        @click="pickRelativeChip(period.value, item)"
                        :key="'period_' + item_index"
                      >
                        {{ item }}
                        <OTooltip
                          v-if="blockedChips.has(`${item}${period.value}`)"
                          side="right"
                          align="center"
                          max-width="18.75rem"
                          :content="raw(queryRangeRestrictionMsg)"
                        />
                      </OButton>
                    </div>
                  </div>

                  <div
                    class="relative-row border-border-default flex items-center border-b px-3 py-2 [&>*]:me-1.5"
                    @focusout="onCustomRowFocusout"
                  >
                    <div class="min-w-18.75 text-sm font-semibold">{{ t("common.custom") }}</div>
                    <OTooltip
                      side="right"
                      align="center"
                      max-width="18.75rem"
                      v-if="queryRangeRestrictionInHour > 0"
                      :content="raw(queryRangeRestrictionMsg)"
                    />

                    <div class="flex min-w-0 flex-1 gap-2">
                      <div class="flex w-20 flex-col">
                        <OInput
                          :model-value="customDraft"
                          :error="customBlocked"
                          data-test="date-time-custom-value"
                          :aria-label="t('common.timeAmount')"
                          type="number"
                          :min="1"
                          :step="1"
                          :max="
                            relativePeriodsMaxValue[relativePeriod] > 0
                              ? relativePeriodsMaxValue[relativePeriod]
                              : undefined
                          "
                          @update:model-value="editCustomDraft"
                          @focus="onCustomValueFocus"
                          @blur="onCustomValueBlur"
                          @keydown.enter.prevent="commitCustom(true)"
                        />
                      </div>
                      <div class="flex min-w-0 flex-1 flex-col">
                        <OSelect
                          v-model="relativePeriod"
                          :aria-label="t('common.timeUnit')"
                          :options="relativePeriodsSelect"
                          data-test="date-time-custom-unit"
                          @update:model-value="commitCustom(false)"
                        >
                          <template v-slot:selected-item>
                            <div>{{ getPeriodLabel }}</div>
                          </template>
                        </OSelect>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div
                role="tabpanel"
                class="col-start-1 row-start-1"
                :class="selectedType === 'absolute' ? '' : 'pointer-events-none invisible'"
                :aria-hidden="selectedType !== 'absolute'"
                :inert="selectedType !== 'absolute'"
              >
                <div class="date-time-table flex flex-col">
                  <OTooltip
                    side="right"
                    align="center"
                    max-width="18.75rem"
                    v-if="queryRangeRestrictionInHour > 0"
                    :content="raw(queryRangeRestrictionMsg)"
                  />
                  <div class="flex justify-center px-3 py-2">
                    <ODateRangeCalendar
                      :start-date="selectedDate.from"
                      :end-date="selectedDate.to"
                      :min-date="calendarMinDate"
                      :max-date="calendarMaxDate"
                      @update:start-date="selectedDate.from = $event"
                      @update:end-date="selectedDate.to = $event"
                      @update:pending-date="pendingDay = $event"
                    />
                  </div>
                  <div class="text-text-secondary ps-6 pe-6 text-xs">
                    {{ t("common.datetimeMessage") }}
                  </div>
                  <OSeparator v-if="!disableRelative" class="my-2" />

                  <table
                    v-if="!hideRelativeTime"
                    class="startEndTime mx-[0.4rem] mt-2 mb-[0.3rem] w-[calc(100%-0.8rem)] px-3"
                  >
                    <tbody>
                      <tr>
                        <td
                          class="label o-input-label text-compact text-input-label-text w-1/2 pe-1.5 leading-tight font-medium"
                        >
                          {{ t("common.startTime") }}
                        </td>
                        <td
                          class="label o-input-label text-compact text-input-label-text w-1/2 ps-1.5 leading-tight font-medium"
                        >
                          {{ t("common.endTime") }}
                        </td>
                      </tr>
                      <tr>
                        <td class="w-1/2 pe-1.5">
                          <OTime
                            class="w-full"
                            v-model="selectedTime.startTime"
                            with-seconds
                            data-test="datetime-start-time"
                            @blur="resetTime(selectedTime.startTime, selectedTime.endTime)"
                          />
                        </td>
                        <td class="w-1/2 ps-1.5">
                          <OTime
                            class="w-full"
                            v-model="selectedTime.endTime"
                            :with-seconds="true"
                            data-test="datetime-end-time"
                            @blur="resetTime(selectedTime.startTime, selectedTime.endTime)"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div
              v-if="gateMessage"
              class="text-input-error-text flex shrink-0 items-center gap-1.5 px-3 pt-2 text-xs font-medium"
              data-test="date-time-gate-message"
              role="alert"
            >
              <OIcon name="error-outline" size="sm" class="shrink-0" />
              <span class="min-w-0">{{ gateMessage }}</span>
            </div>
            <div
              v-if="!hideRelativeTimezone || !autoApply"
              class="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-[0.4rem] py-2"
            >
              <OSelect
                v-if="!hideRelativeTimezone"
                data-test="datetime-timezone-select"
                v-model="timezone"
                :options="timezoneSelectOptions"
                searchable
                :aria-label="t('logStream.timezone')"
                :dropdown-style="{ minWidth: 'min(24rem, calc(100vw - 2rem))' }"
                @update:model-value="onTimezoneChange"
                @open="isTimezoneSelectOpen = true"
                @close="isTimezoneSelectOpen = false"
                class="min-w-0 italic"
                :class="autoApply ? 'col-span-2' : ''"
              />
              <div v-else />
              <OButton
                v-if="!autoApply"
                data-test="date-time-apply-btn"
                variant="primary"
                size="sm"
                class="justify-self-end px-6!"
                :disabled="!rangeInputValid && (gateReason !== null || rangeInputBlocksApply)"
                @click="onApplyClick"
              >
                {{ t("common.apply") }}
              </OButton>
            </div>
          </div>
        </div>
      </div>
    </OPopover>
    <OTooltip v-if="!hideRangeShift" :content="t('common.next')">
      <OButton
        data-test="date-time-next-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border h-auto! border-s!"
        :class="showRangeZoom ? 'max-md:rounded-e-default! rounded-none!' : 'rounded-s-none!'"
        icon-left="chevron-right"
        :aria-label="t('common.next')"
        :disabled="disable || isNextShiftDisabled()"
        @click.prevent.stop="shiftTimeRange('next')"
      />
    </OTooltip>
    <OTooltip v-if="showRangeZoom" :content="zoomOutTooltip">
      <OButton
        data-test="date-time-zoom-out-btn"
        variant="ghost"
        size="icon-xs-sq"
        class="border-button-outline-border h-auto! rounded-s-none! border-s! max-md:hidden"
        icon-left="zoom-out"
        :aria-label="zoomOutTooltip"
        :disabled="disable || zoomOutBlocked !== null"
        @click.prevent.stop="zoomOut"
      />
    </OTooltip>
    <span class="sr-only" aria-live="polite" data-test="date-time-range-live">{{ liveLabel }}</span>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import DateTimeRail from "@/components/DateTimeRail.vue";
import {
  ref,
  defineAsyncComponent,
  defineComponent,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  nextTick,
  shallowRef,
  type PropType,
} from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import {
  getImageURL,
  useLocalTimezone,
  convertToUtcTimestamp,
  timestampToTimezoneDate,
} from "../utils/zincutils";
import { MAX_RANGE_TEXT_UNITS, matchRelativePeriod, subtractRelativeTime } from "@/utils/date";
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
  formatSpanLimit,
  formatRecentRange,
  formatCalendarRailHint,
  formatRecentDuration,
  formatRecentRangeLabel,
  type TimeRangeRailItem,
} from "@/utils/timeRangeRail";
import useTimeRangeHistory from "@/composables/useTimeRangeHistory";
import { localeFileMap } from "@/locales";
import { checkTimeRange } from "@/utils/timeRangeInput/check";
import { addDays, addMonths } from "@/utils/timeRangeInput/civil";
import { resolveCivil, wallAt } from "@/utils/timeRangeInput/zone";
import { formatTimeRangeInput, type FormattableRange } from "@/utils/timeRangeInput/format";
import type { RangeLimits, RelativeUnit, TimeRangeReading } from "@/utils/timeRangeInput/types";
import { registerTimeRangePicker } from "@/utils/timeRangeShortcut";
import { copyToClipboard } from "@/utils/clipboard";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";

const MICROS_PER_SECOND = 1_000_000;
const DAY_END_TIME = "23:59:59";
// A trigger inside the top inset, as in a drawer header, reads as detached, so the picker keeps hiding off;
// it closes on ancestor scroll instead.
const POPOVER_COLLISION_PADDING = { top: 48, right: 8, bottom: 8, left: 8 };
// Largest custom relative range per unit (~10 years), so a typo can't produce an absurd or overflowing range.
const MAX_CUSTOM_RELATIVE_VALUE: Record<string, number> = {
  s: 315_360_000,
  m: 5_256_000,
  h: 87_600,
  d: 3_650,
  w: 520,
  M: 120,
};

// Nominal unit lengths, only a first guess that the gate then checks against the real span.
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
  M: 2_592_000,
};

interface CalendarPresetState {
  tooltip: I18nText | undefined;
  disabled: boolean;
}

interface ConsumableDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string | null;
  selectedDate?: unknown;
  selectedTime?: unknown;
  valueType?: string;
  userChangedValue?: boolean;
}

// One offset lookup per zone for the whole app, not per picker instance.
const zoneOffsets = new Map<string, string>();
// Above the ~420 supported zones the select lists, so only unknown host spellings are ever evicted.
const ZONE_OFFSET_CACHE_LIMIT = 600;

type GateReason = "out-of-range" | "order" | "max-span" | "future" | "after-max" | "before-min";

interface ExactRange {
  zone: string;
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  startUs: number;
  endUs: number;
}

type RollingFold = "earlier" | "later";

// Everything that names a range; the applied copy is what refresh, close and the trigger fall back to.
interface PickerSelection {
  selectedType: string;
  calendarToken: string | null;
  relativePeriod: string;
  relativeValue: number;
  rollingFold: RollingFold | null;
  selectedDate: { from: string; to: string };
  selectedTime: { startTime: string; endTime: string };
  seededEnd: { date: string; time: string } | null;
  exactRange: ExactRange | null;
}

type ZoomTarget =
  | { kind: "rolling"; value: number; spanUs: number }
  | { kind: "fixed"; startUs: number; endUs: number; spanUs: number };

interface StepOrigin {
  period: string;
  value: number;
  steps: number;
  at: string | null;
}

// The bar pulls in the parser and its word packs, so it loads on first open, not with the picker.
const loadRangeInput = () => import("@/components/DateTimeRangeInput.vue");
const DateTimeRangeInput = defineAsyncComponent(loadRangeInput);

// endUs is the end the gate passed: one a few seconds past now reads as now.
const gateCheck = (
  startUs: number,
  endUs: number,
  limits: RangeLimits,
): { reason: GateReason | null; endUs: number } => {
  const res = checkTimeRange({ startUs, endUs, nowUs: Math.floor(Date.now()) * 1000, ...limits });
  if (res.ok) return { reason: null, endUs: res.endUs };
  if (res.reason === "reversed" || res.reason === "zero-length") return { reason: "order", endUs };
  const reason =
    res.reason === "out-of-range" || res.reason === "retention" ? "out-of-range" : res.reason;
  return { reason, endUs };
};

const gateOf = (startUs: number, endUs: number, limits: RangeLimits): GateReason | null =>
  gateCheck(startUs, endUs, limits).reason;

// A whole-day end after now means "until now"; any other end after now is a chosen time the gate refuses.
// A future start is left alone, so the gate reports "future" rather than an order the user never typed.
const clipDayEnd = (
  startUs: number,
  endTime: string,
  endUs: number,
  nowUs: number,
  allowFuture: boolean,
) => (!allowFuture && endTime === DAY_END_TIME && endUs > nowUs && startUs < nowUs ? nowUs : endUs);

export default defineComponent({
  components: {
    OSeparator,
    OButton,
    OIcon,
    OToggleGroup,
    OToggleGroupItem,
    OTooltip,
    OTruncatedText,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    OPopover,
    DateTimeRail,
    DateTimeRangeInput,
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
    applyPresets: {
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
    /** Hides the typed range bar; `hideClipboard` and a date-only picker hide it too. */
    hideRangeInput: {
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
      endTime: DAY_END_TIME,
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
    // A rolling day, week or month that starts in a repeated hour keeps the reading the user chose.
    const rollingFold = ref<RollingFold | null>(null);
    // The selection last applied; closing without Apply puts all of it back.
    let appliedSelection: PickerSelection = {
      selectedType: "relative",
      calendarToken: null,
      relativePeriod: "m",
      relativeValue: 15,
      rollingFold: null,
      selectedDate: { from: "", to: "" },
      selectedTime: { startTime: "00:00:00", endTime: DAY_END_TIME },
      seededEnd: null,
      exactRange: null,
    };
    // Offset-0 tooltips end at now, so they read a clock refreshed on hover rather than a stale render time.
    const tooltipNow = ref(Date.now());
    const timeRangeHistory = useTimeRangeHistory();
    // A single clicked day the range calendar is still waiting to pair with an end date.
    const pendingDay = ref<string | null>(null);
    // Fields written by the picker itself (seeding the Absolute tab, a Recent pick) are not user edits for auto-apply.
    let isSeedingAbsolute = false;
    let seededEnd: { date: string; time: string } | null = null;
    // A typed or pasted range keeps its exact µs (fractions, a repeated hour) until a field is edited.
    const exactRange = shallowRef<ExactRange | null>(null);
    // Bumped on every selection change and on open or close, so a paste that resolves later is dropped.
    let selectionSeq = 0;
    // What the live region reads: only a range the user applied, never a label that follows the clock.
    const liveLabel = ref("");
    // Set when a host setter changes the fields; the field watcher takes it once, so its save skips the gate.
    let hostFieldWrite = false;
    // Ticks while the open panel refuses a future end or holds a whole-day end, so both follow now.
    const gateNow = ref(Date.now());
    // Date-only pickers cannot show the times a recent range carries.
    const showRail = computed(() => !props.disableRelative);
    const lastValidCustomValue = ref(15);
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
      if (props.pickerTimezone) {
        pickerZone.value = selectedTimezone;
      } else {
        useLocalTimezone(selectedTimezone);
        store.dispatch("setTimezone", selectedTimezone);
      }
      await nextTick();
      if (props.autoApply) {
        if (selectedType.value == "absolute") saveZoneChange();
        else saveDate("relative");
      }

      emit("on:timezone-change", selectedTimezone);
    };

    // Fields read in a zone west of the old one can land after now; the applied instants then stay in force.
    const saveZoneChange = () => {
      const { startTime, endTime } = datePayload.value as Partial<ConsumableDateTime>;
      if (gateReason.value === null || typeof startTime !== "number" || typeof endTime !== "number")
        return saveDate("absolute");
      stageAbsolute(startTime, endTime);
      saveDate("absolute", "host");
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
      if (zoneOffsets.size >= ZONE_OFFSET_CACHE_LIMIT)
        zoneOffsets.delete(zoneOffsets.keys().next().value as string);
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
          return { label: t("common.browserTimeWithZone", { zone: browserTz }), suffix, value: tz };
        }
        if (tz === "UTC") return { label: raw(tz), suffix, value: tz };
        return {
          label: raw(offset ? `${tz} (UTC${offset})` : tz),
          listLabel: raw(tz),
          suffix,
          value: tz,
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
            formatCalendarRailHint(
              preset.token,
              zone.value,
              tooltipNow.value,
              intlLocale.value,
              (quarter) => t("common.calendarQuarterShort", { quarter }),
            ) ?? undefined,
          selected: selectedType.value === "relative" && calendarToken.value === preset.token,
          disabled: state?.disabled ?? false,
        };
      });
    });

    // The gate clock ticks every second while a range waits on now, but Recent text changes at most by the minute.
    const gateMinute = computed(() => Math.floor(gateNow.value / 60_000));
    const recentRows = computed(() => {
      void gateMinute.value;
      return timeRangeHistory.entries.value.map((entry, index) => ({
        entry,
        item: {
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
          disabled: exceedsRangeRestriction(
            entry.startUs,
            entry.endUs,
            props.queryRangeRestrictionInHour,
          ),
        },
      }));
    });

    const recentRailItems = computed<TimeRangeRailItem[]>(() => {
      const current = selectedType.value === "absolute" ? getUTCTimeStamp(gateNow.value) : null;
      return recentRows.value.map(({ entry, item }) => ({
        ...item,
        selected:
          current !== null && current.startUTC === entry.startUs && current.endUTC === entry.endUs,
      }));
    });

    const periodUnits = ["s", "m", "h", "d", "w", "M"];

    const datetimeBtn = ref(null);

    const displayValue = ref("");

    /**
     * The label as of the last APPLY, which is what the trigger button shows.
     * With `autoApply` off, a selection only takes effect when the user presses
     * Apply, so the trigger renders the range actually in force rather than the
     * pending selection in `getDisplayValue`. Every path that applies a range
     * stamps it via `markApplied`.
     */
    const appliedDisplayValue = ref("");

    const datePayload = ref({});

    const dateLocale = {
      daysShort: ["S", "M", "T", "W", "T", "F", "S"],
    };

    const calendarMinDate = computed(() => {
      if (props.disableRelative && props.minDate) return props.minDate;
      return "1999/01/01";
    });

    const calendarMaxDate = computed(() => {
      if (props.maxDate) return props.maxDate;
      return timestampToTimezoneDate(new Date().getTime(), zone.value, "yyyy/MM/dd");
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
        saveDate(selectedType.value, "host");
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
        pendingDay.value;
      },
      () => {
        const source = hostFieldWrite ? "host" : "user";
        hostFieldWrite = false;
        if (!isSeedingAbsolute) rangeInput.value?.clear();
        if (
          props.autoApply &&
          selectedType.value === "absolute" &&
          !isSeedingAbsolute &&
          pendingDay.value === null &&
          store.state.savedViewFlag == false
        ) {
          saveDate("absolute", source);
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

    const stageRelative = (period: string, value: number) => {
      selectedType.value = "relative";
      calendarToken.value = null;
      rollingFold.value = null;
      relativePeriod.value = period;
      relativeValue.value = value;
    };

    const setRelativeDate = (period: string, value: number) => {
      stageRelative(period, value);
      if (props.autoApply || props.applyPresets) saveDate("relative");
    };

    const pickRelativeChip = (period: string, value: number) => {
      rangeInput.value?.clear();
      setRelativeDate(period, value);
      if (props.autoApply || props.applyPresets) closeMenu();
    };

    const isValidCustomValue = (value: unknown) =>
      value !== "" && value !== null && Number.isFinite(Number(value));

    const customDraft = ref<number | string>(relativeValue.value);
    // Only a typed draft commits when focus leaves the row; passing through it changes nothing.
    const customEdited = ref(false);
    watch(relativeValue, (value) => {
      customDraft.value = value;
      customEdited.value = false;
    });
    const editCustomDraft = (value: number | string) => {
      customDraft.value = value;
      customEdited.value = true;
    };

    const isAppliedRolling = () =>
      appliedSelection.selectedType === "relative" &&
      appliedSelection.calendarToken === null &&
      appliedSelection.relativePeriod === relativePeriod.value &&
      appliedSelection.relativeValue === relativeValue.value;

    // Typing only edits the draft; Enter, a unit pick or leaving the row turns it into the selection.
    const commitCustom = (close: boolean) => {
      customEdited.value = false;
      if (!isValidCustomValue(customDraft.value)) {
        customDraft.value = relativeValue.value;
        return;
      }
      const value = Math.max(1, Math.trunc(Number(customDraft.value)));
      stageRelative(
        relativePeriod.value,
        Math.min(value, MAX_CUSTOM_RELATIVE_VALUE[relativePeriod.value] ?? value),
      );
      customDraft.value = relativeValue.value;
      lastValidCustomValue.value = relativeValue.value;
      rangeInput.value?.clear();
      // A second commit of the applied value (Enter, then leaving the row) must not emit again.
      if (props.autoApply && !isAppliedRolling()) saveDate("relative-custom");
      if (!close) return;
      if (!props.autoApply) applyAndClose();
      else if (gateReason.value === null) closeMenu();
    };

    // The unit list is portalled, so moving into it leaves the row's DOM without leaving the edit.
    const onCustomRowFocusout = (event: FocusEvent) => {
      const row = event.currentTarget as HTMLElement | null;
      const next = event.relatedTarget as HTMLElement | null;
      if (
        next &&
        (row?.contains(next) || next.closest("[data-test='date-time-custom-unit-popover']"))
      )
        return;
      if (customEdited.value) commitCustom(false);
    };

    const onCustomValueFocus = () => {
      lastValidCustomValue.value = relativeValue.value;
    };
    const onCustomValueBlur = () => {
      if (!isValidCustomValue(customDraft.value)) customDraft.value = lastValidCustomValue.value;
    };

    // A finished calendar period ends at the next one's start; second-precision fields show its last second, as its tooltip does.
    const lastInstant = (token: string | null, endUs: number) =>
      (parseCalendarToken(token)?.offset ?? 0) < 0 ? endUs - 1 : endUs;

    // The shown 23:59:59 of a copied calendar end stands for the next period's start until the user edits it.
    const rememberShownEnd = (exclusiveEndUs: number) => {
      const shown = convertUnixTime(exclusiveEndUs - 1);
      seededEnd = { date: shown.date, time: shown.time };
    };
    const rememberSeededEnd = (token: string | null, endUs: number) => {
      if ((parseCalendarToken(token)?.offset ?? 0) >= 0) seededEnd = null;
      else rememberShownEnd(endUs);
    };

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
        rememberSeededEnd(period, calendarRange.endTime);
        return;
      }

      const periodString = matchRelativePeriod(period);

      if (periodString) {
        calendarToken.value = null;
        rollingFold.value = null;
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
          } else selectedTime.value.endTime = DAY_END_TIME;
        }

        return;
      }
      return;
    };

    const absoluteFieldsKey = () =>
      JSON.stringify([selectedDate.value, selectedTime.value, pendingDay.value]);

    // The flag is set only on a real change, because only a change runs the watcher that clears it.
    const writeAsHost = (write: () => void) => {
      const before = absoluteFieldsKey();
      write();
      hostFieldWrite ||= absoluteFieldsKey() !== before;
    };

    const isInstant = (value: unknown) =>
      value !== null && value !== "" && Number.isFinite(Number(value));

    const writeAbsoluteFields = (startTime: number, endTime: number) => {
      seededEnd = null;
      // A host echoing the range back must not drop the fraction the fields cannot hold.
      const exact = exactRange.value;
      if (exact?.zone !== zone.value || exact.startUs !== startTime || exact.endUs !== endTime)
        exactRange.value = null;
      if (!isInstant(startTime) || !isInstant(endTime)) {
        var dateString = new Date().toLocaleDateString("en-ZA");
        selectedDate.value.from = dateString;
        selectedDate.value.to = dateString;
        return;
      }

      const startDateTime = convertUnixTime(startTime);
      const endDateTime = convertUnixTime(endTime);

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;

      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
    };

    const setAbsoluteTime = (startTime: number, endTime: number) => {
      // Parent-invoked setter — the resulting auto-apply emit is programmatic.
      markProgrammaticDateChange();
      writeAsHost(() => writeAbsoluteFields(startTime, endTime));
    };

    function convertUnixTime(unixTimeMicros: number) {
      return formatAbsoluteInstant(unixTimeMicros, zone.value);
    }

    const refresh = () => {
      // Parent-invoked (e.g. on tab re-activation / auto-refresh) — programmatic.
      markProgrammaticDateChange();
      // An open panel may hold a draft the user has not applied, so the applied range is re-sent.
      if (menuOpen.value) {
        const date = getConsumableDateTime(Date.now(), appliedSelection);
        emitDate(date, appliedSelection.selectedType);
        return;
      }
      saveDate(null, "host");
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
     * NOT called from `commitCustom` / the popup's absolute inputs when
     * `autoApply` is off: those stay pending until Apply. `setRelativeDate` also
     * applies under `applyPresets`.
     */
    const liveSelection = (): PickerSelection => ({
      selectedType: selectedType.value,
      calendarToken: calendarToken.value,
      relativePeriod: relativePeriod.value,
      relativeValue: relativeValue.value,
      rollingFold: rollingFold.value,
      selectedDate: selectedDate.value,
      selectedTime: selectedTime.value,
      seededEnd,
      exactRange: exactRange.value,
    });

    const copySelection = (sel: PickerSelection): PickerSelection => ({
      ...sel,
      selectedDate: { ...sel.selectedDate },
      selectedTime: { ...sel.selectedTime },
      seededEnd: sel.seededEnd && { ...sel.seededEnd },
      exactRange: sel.exactRange && { ...sel.exactRange },
    });

    const markApplied = (resolved?: ConsumableDateTime) => {
      appliedDisplayValue.value = getDisplayValue.value;
      appliedCalendarToken.value = selectedType.value === "relative" ? calendarToken.value : null;
      appliedSelection = copySelection(liveSelection());
      // The bar's "Applied" summary reads this, and host setters apply without a save.
      datePayload.value = resolved ?? getConsumableDateTime(gateNow.value, appliedSelection);
    };

    const selectionKey = (sel: PickerSelection) =>
      JSON.stringify([sel.selectedType, sel.calendarToken, sel.relativePeriod, sel.relativeValue]) +
      (sel.selectedType === "absolute"
        ? JSON.stringify([sel.selectedDate, sel.selectedTime, sel.exactRange])
        : "");

    watch(
      () => selectionKey(liveSelection()),
      () => {
        selectionSeq++;
      },
      { flush: "sync" },
    );

    // Closing without Apply, or while refused, puts back every applied field, so no reader sees a draft.
    const restoreAppliedSelection = () => {
      const applied = copySelection(appliedSelection);
      isSeedingAbsolute = true;
      selectedType.value = applied.selectedType;
      calendarToken.value = applied.calendarToken;
      relativePeriod.value = applied.relativePeriod;
      relativeValue.value = applied.relativeValue;
      rollingFold.value = applied.rollingFold;
      selectedDate.value = applied.selectedDate;
      selectedTime.value = applied.selectedTime;
      seededEnd = applied.seededEnd;
      exactRange.value = applied.exactRange;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
    };

    // One rule for the panel, the bar and paste; only a host's future maxDate lets a range end after now.
    const maxDateEndUs = computed(() =>
      props.maxDate
        ? convertToUtcTimestamp(`${props.maxDate} ${DAY_END_TIME}`, zone.value)
        : undefined,
    );

    const rangeLimits = computed<RangeLimits>(() => {
      const hours = props.queryRangeRestrictionInHour;
      // The parser's day ends are exclusive, so the gate's ceiling is the midnight after maxDate.
      const maxEndUs =
        maxDateEndUs.value === undefined ? undefined : maxDateEndUs.value + MICROS_PER_SECOND;
      const minStartUs =
        props.disableRelative && props.minDate
          ? convertToUtcTimestamp(`${props.minDate} 00:00:00`, zone.value)
          : undefined;
      return {
        allowFuture: maxEndUs !== undefined && maxEndUs > gateNow.value * 1000,
        ...(maxEndUs !== undefined ? { maxEndUs } : {}),
        ...(minStartUs !== undefined ? { minStartUs } : {}),
        ...(hours > 0 ? { maxSpanUs: Math.round(hours * 3_600_000_000) } : {}),
      };
    });

    // The gate, the label and Apply all read an absolute end through this one rule.
    const consumableEndUs = (startUs: number, endTime: string, endUs: number, nowMs: number) =>
      clipDayEnd(startUs, endTime, endUs, nowMs * 1000, rangeLimits.value.allowFuture);

    // A clicked day still waiting for its pair is what Apply will use, so the gate checks that day.
    const gateRange = (): { startTime: number; endTime: number } => {
      const day = selectedType.value === "absolute" ? pendingDay.value : null;
      if (day === null) return getConsumableDateTime(gateNow.value);
      const { startTime, endTime } = selectedTime.value;
      const startUs = convertToUtcTimestamp(`${day} ${startTime}`, zone.value);
      const endUs = convertToUtcTimestamp(`${day} ${endTime}`, zone.value);
      return {
        startTime: startUs,
        endTime: consumableEndUs(startUs, endTime, endUs, gateNow.value),
      };
    };

    const gateReason = computed<GateReason | null>(() => {
      void gateNow.value;
      const { startTime, endTime } = gateRange();
      return gateOf(startTime, endTime, rangeLimits.value);
    });

    const spanLimitText = computed(() =>
      formatSpanLimit(props.queryRangeRestrictionInHour, intlLocale.value),
    );

    const instantText = (us: number) => {
      const { date, time } = convertUnixTime(us);
      return raw(`${date} ${time}`);
    };

    const gateText = (
      reason: GateReason | null,
      range?: { startTime: number; endTime: number },
    ) => {
      if (reason === "order") return t("timeRangeInput.gateOrder");
      if (reason === "max-span")
        return t("timeRangeInput.blockedSpan", { limit: spanLimitText.value });
      if (!reason) return null;
      if (!range || reason === "out-of-range") return t("timeRangeInput.gateInvalid");
      const { startTime, endTime } = range;
      if (reason === "before-min")
        return t("timeRangeInput.blockedBeforeMin", { date: instantText(startTime) });
      if (reason === "after-max")
        return t("timeRangeInput.blockedAfterMax", { date: instantText(endTime) });
      // A whole-day end means "until now", so with a future start the start is what to change.
      const dayEnd = selectedTime.value.endTime === DAY_END_TIME;
      const future = endTime > gateNow.value * 1000 && !dayEnd ? endTime : startTime;
      return t("timeRangeInput.blockedFuture", { date: instantText(future) });
    };

    const gateMessage = computed(() => gateText(gateReason.value, gateRange()));

    const customBlocked = computed(
      () =>
        selectedType.value === "relative" &&
        calendarToken.value === null &&
        gateReason.value === "max-span",
    );

    // A user change that fails the gate is never applied; a range the host sets is its own call.
    const emitDate = (date: ConsumableDateTime, dateType: string) => {
      datePayload.value = date;
      date["valueType"] = dateType;
      date["userChangedValue"] = isUserInitiated;
      if (store.state.savedViewFlag == false) {
        emit("on:date-change", date);
      }
    };

    const saveDate = (dateType?: string | null, source: "user" | "host" = "user") => {
      // The label stored below must show the now this apply clips a whole-day end to.
      gateNow.value = Date.now();
      const date = getConsumableDateTime(gateNow.value);
      // The cached verdict can be older than the clock, so the bounds about to be sent are checked.
      if (source === "user") {
        const gate = gateCheck(date.startTime, date.endTime, rangeLimits.value);
        if (gate.reason !== null) return;
        date.endTime = gate.endUs;
      }
      markApplied(date);
      if (source === "user") liveLabel.value = appliedDisplayValue.value;
      emitDate(date, dateType || selectedType.value);
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

      writeAsHost(() => {
        selectedDate.value.from = startObj.date;
        selectedDate.value.to = endObj.date;
        selectedTime.value.startTime = startObj.time;
        selectedTime.value.endTime = endObj.time;
      });

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

    const periodLabelKey = computed<I18nKey>(() => {
      const keys: Record<string, I18nKey> = {
        s: "common.seconds",
        m: "common.minutes",
        h: "common.hours",
        d: "common.days",
        w: "common.weeks",
        M: "common.months",
      };
      return keys[relativePeriod.value];
    });
    const getPeriodLabel = computed(() => t(periodLabelKey.value));

    // "Past 15 Minutes" — one whole-sentence pipe-plural key per unit rather than
    // gluing the period noun onto a translated "Past" fragment (word order is
    // per-language, and so is the number of plural forms).
    const pastPeriodKey = computed<I18nKey>(() => {
      const keys: Record<string, I18nKey> = {
        s: "common.pastSecond",
        m: "common.pastMinute",
        h: "common.pastHour",
        d: "common.pastDay",
        w: "common.pastWeek",
        M: "common.pastMonth",
      };
      return keys[relativePeriod.value];
    });

    const ROLLING_UNIT_US: Record<string, number> = {
      s: MICROS_PER_SECOND,
      m: 60 * MICROS_PER_SECOND,
      h: 3600 * MICROS_PER_SECOND,
    };

    // Days, weeks and months step the picker zone's calendar, so a DST day is 23 or 25 hours long.
    const rollingStartUs = (
      value: number,
      unit: string,
      nowUs: number,
      fold: RollingFold | null = null,
    ): number => {
      const fixed = ROLLING_UNIT_US[unit];
      if (fixed) return nowUs - value * fixed;
      try {
        const wall = wallAt(zone.value, nowUs);
        const back =
          unit === "M" ? addMonths(wall, -value) : addDays(wall, -(unit === "w" ? 7 : 1) * value);
        const at = resolveCivil(back, zone.value);
        if (at === null) return NaN;
        if (at.kind === "fold") return fold === "later" ? at.later : at.earlier;
        return at.us;
      } catch {
        const amount: Record<string, number> =
          unit === "w" ? { days: value * 7 } : { [PERIOD_ARITHMETIC_UNIT[unit]]: value };
        const now = new Date(Math.floor(nowUs / 1000));
        return new Date(subtractRelativeTime(now, amount)).getTime() * 1000;
      }
    };

    // nowMs is the clock a whole-day end on today is clipped to.
    const getConsumableDateTime = (
      nowMs = Date.now(),
      sel: PickerSelection = liveSelection(),
    ): ConsumableDateTime => {
      const calendarRange =
        sel.selectedType === "relative"
          ? resolveCalendarPeriod(sel.calendarToken, zone.value)
          : null;
      if (calendarRange) {
        return { ...calendarRange, relativeTimePeriod: sel.calendarToken };
      }
      if (sel.selectedType == "relative") {
        let value = Number(sel.relativeValue);
        let unit = sel.relativePeriod;
        if (!PERIOD_ARITHMETIC_UNIT[unit] || !(value > 0)) {
          console.error("getConsumableDateTime: Invalid relative period");
          value = 15;
          unit = "m";
        }
        const endTime = Math.floor(Date.now()) * 1000;
        return {
          startTime: rollingStartUs(value, unit, endTime, sel.rollingFold),
          endTime,
          relativeTimePeriod: sel.relativeValue + sel.relativePeriod,
        };
      }
      if (typeof sel.selectedDate === "string") {
        selectedDate.value = { from: sel.selectedDate, to: sel.selectedDate };
        sel = liveSelection();
      }
      const absoluteUTCTimestamp = getUTCTimeStamp(nowMs, sel);
      return {
        startTime: absoluteUTCTimestamp.startUTC,
        endTime: absoluteUTCTimestamp.endUTC,
        relativeTimePeriod: null,
        selectedDate: JSON.parse(JSON.stringify(sel.selectedDate)),
        selectedTime: JSON.parse(JSON.stringify(sel.selectedTime)),
      };
    };

    const getUTCTimeStamp = (nowMs: number, sel: PickerSelection = liveSelection()) => {
      const { selectedDate: date, selectedTime: time, exactRange: exact, seededEnd: seeded } = sel;
      if (
        exact !== null &&
        exact.zone === zone.value &&
        exact.from === date.from &&
        exact.to === date.to &&
        exact.startTime === time.startTime &&
        exact.endTime === time.endTime
      ) {
        const endUTC = consumableEndUs(exact.startUs, exact.endTime, exact.endUs, nowMs);
        return { startUTC: exact.startUs, endUTC };
      }
      const startUTC = convertToUtcTimestamp(`${date.from} ${time.startTime}`, zone.value);
      const untouchedSeededEnd =
        seeded !== null && seeded.date === date.to && seeded.time === time.endTime;
      // The shown last second stands for the exclusive end one second later, in whatever zone is now selected.
      const endUTC =
        convertToUtcTimestamp(`${date.to} ${time.endTime}`, zone.value) +
        (untouchedSeededEnd ? MICROS_PER_SECOND : 0);
      return {
        startUTC,
        endUTC: consumableEndUs(startUTC, time.endTime, endUTC, nowMs),
      };
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
          writeAsHost(() => {
            selectedDate.value.from = dateobj.selectedDate.from;
            selectedDate.value.to = dateobj.selectedDate.to;
            selectedTime.value.startTime = dateobj.selectedTime.startTime;
            selectedTime.value.endTime = dateobj.selectedTime.endTime;
          });
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
      const abs = label.match(
        /^(\d{4})\/(\d{2}\/\d{2}) (\d{2}:\d{2})(?::\d{2})? - (\d{4})\/(\d{2}\/\d{2}) (\d{2}:\d{2})(?::\d{2})?$/,
      );
      // The year is only dropped when both ends share it, or a cross-year range would read as same-day.
      if (!abs || abs[1] !== abs[4]) return label.replace(/\b(\d{2}:\d{2}):\d{2}\b/g, "$1");
      const [, , fromDay, fromTime, , toDay, toTime] = abs;
      return fromDay === toDay
        ? `${fromDay} ${fromTime} - ${toTime}`
        : `${fromDay} ${fromTime} - ${toDay} ${toTime}`;
    };

    /**
     * What the trigger button renders.
     *
     * With `autoApply` the pending selection IS the applied one, so show it live.
     * Without it, show the live selection while the panel is open (so switching
     * Relative/Absolute updates the label immediately, like the logs picker), and
     * fall back to the range in force once closed — so closing without Apply snaps
     * back to what's actually applied; see `appliedDisplayValue`.
     * The `||` fallback covers the first paint, before the mount-time apply.
     */
    const triggerLabel = computed(() => {
      if (props.triggerText) return props.triggerText;
      const showsApplied = (!props.autoApply && !menuOpen.value) || gateReason.value !== null;
      // A calendar label is re-derived so an older period keeps naming the right day after midnight.
      const appliedCalendarLabel =
        showsApplied && appliedCalendarToken.value !== null
          ? formatCalendarLabel(
              appliedCalendarToken.value,
              zone.value,
              t,
              intlLocale.value,
              tooltipNow.value,
            )
          : null;
      const label = showsApplied
        ? appliedCalendarLabel || appliedDisplayValue.value || getDisplayValue.value
        : getDisplayValue.value;
      return isMobile.value ? compactRangeLabel(label) : label;
    });

    // Mirrors triggerLabel: the live selection while it is in force or being edited, else the applied one.
    const triggerTooltip = computed(() => {
      if (!props.autoApply && !menuOpen.value) return calendarTooltip(appliedCalendarToken.value);
      return selectedType.value === "relative" ? calendarTooltip(calendarToken.value) : undefined;
    });

    const shownEnd = (from: string, to: string) => {
      const time = selectedTime.value.endTime;
      const startUs = convertToUtcTimestamp(`${from} ${selectedTime.value.startTime}`, zone.value);
      const endUs = convertToUtcTimestamp(`${to} ${time}`, zone.value);
      const clipped = consumableEndUs(startUs, time, endUs, gateNow.value);
      if (clipped === endUs) return `${to} ${time}`;
      const now = convertUnixTime(clipped);
      return `${now.date} ${now.time}`;
    };

    const getDisplayValue = computed(() => {
      const calendarLabel =
        !props.disableRelative && selectedType.value === "relative" && calendarToken.value !== null
          ? formatCalendarLabel(
              calendarToken.value,
              zone.value,
              t,
              intlLocale.value,
              tooltipNow.value,
            )
          : null;
      if (calendarLabel) return calendarLabel;
      if (!props.disableRelative && selectedType.value === "relative") {
        const count = isValidCustomValue(relativeValue.value)
          ? relativeValue.value
          : lastValidCustomValue.value;
        return t(pastPeriodKey.value, { count });
      } else {
        if (selectedDate.value != null) {
          // Here as if multiple dates is selected we get object with from and to keys
          // If single date is selected we get string with date value
          // So have added check for from and to
          if (selectedDate.value?.from && selectedDate.value?.to && !props.disableRelative) {
            // A pending single clicked day is what Apply will use, so the label shows it already.
            const pending = menuOpen.value ? pendingDay.value : null;
            const from = pending ?? selectedDate.value.from;
            const to = pending ?? selectedDate.value.to;
            return `${from} ${selectedTime.value.startTime} - ${shownEnd(from, to)}`;
          } else if (selectedDate.value?.from && selectedDate.value?.to && props.disableRelative) {
            return `${selectedDate.value.from} - ${selectedDate.value.to}`;
          } else {
            return `${selectedDate.value} ${selectedTime.value.startTime} - ${selectedDate.value} ${selectedTime.value.endTime}`;
          }
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          return `${todayDate} ${selectedTime.value.startTime} - ${todayDate} ${selectedTime.value.endTime}`;
        }
      }
    });

    const rangeInput = ref<{
      setText: (text: string, source: "typed" | "paste") => void;
      clear: () => void;
      focus: () => void;
      submit: () => boolean;
    } | null>(null);
    // Set while the bar holds text that is not a valid reading, so Apply cannot skip past it.
    const rangeInputBlocksApply = ref(false);
    // Set while the bar holds a valid reading, which Apply submits instead of the panel's draft.
    const rangeInputValid = ref(false);

    const showRangeInput = computed(
      () =>
        !props.hideRangeInput &&
        !props.hideClipboard &&
        !(props.disableRelative && props.hideRelativeTime),
    );

    const rangeUnits = computed(() => relativePeriods.map((p) => p.value as RelativeUnit));

    const rangeKinds = computed(() => ({
      relative: !props.disableRelative,
      calendar: props.calendarPresets,
      absolute: true,
    }));

    const rangeContext = () => ({
      locale: String(locale.value),
      zone: zone.value,
      units: rangeUnits.value,
      kinds: rangeKinds.value,
      limits: rangeLimits.value,
    });

    const appliedRange = computed(() => {
      const { startTime, endTime } = datePayload.value as Partial<ConsumableDateTime>;
      return typeof startTime === "number" && typeof endTime === "number"
        ? { startUs: startTime, endUs: endTime }
        : null;
    });

    const prefetchRangeInput = () => {
      if (showRangeInput.value) loadRangeInput().catch(() => undefined);
    };

    // The open tab decides the form: a rolling or calendar selection stays one when pasted back.
    const clipboardRange = (): FormattableRange => {
      const { startTime, endTime } = getConsumableDateTime();
      if (props.disableRelative || selectedType.value !== "relative") {
        // A pending clicked day is what the trigger shows and Apply uses, so Copy takes it too.
        const range = gateRange();
        return { kind: "absolute", startUs: range.startTime, endUs: range.endTime };
      }
      if (calendarToken.value !== null) {
        return {
          kind: "calendar",
          startUs: startTime,
          endUs: endTime,
          calendarToken: calendarToken.value,
        };
      }
      return {
        kind: "rolling",
        startUs: startTime,
        endUs: endTime,
        rolling: { value: relativeValue.value, unit: relativePeriod.value as RelativeUnit },
      };
    };

    const copyRange = () => {
      const range = clipboardRange();
      const text = formatTimeRangeInput(range, { zone: zone.value });
      if (!text) return;
      const offset = range.kind === "absolute" ? text.match(/([+-]\d{2}:\d{2}) - /)?.[1] : null;
      const successMessage = offset
        ? t("common.dateRangeCopiedWithOffset", { offset })
        : t("common.dateRangeCopiedAs", { text });
      copyToClipboard(text, t, { successMessage });
    };

    // shownEndUs is the instant the end fields show, when that differs from the exclusive end.
    const stageAbsolute = (startUs: number, endUs: number, shownEndUs = endUs) => {
      selectedType.value = "absolute";
      calendarToken.value = null;
      // A day clicked before the paste would otherwise overwrite the pasted range when the panel closes.
      pendingDay.value = null;
      // Saved once by the caller, so the auto-apply date watcher must not save it a second time.
      isSeedingAbsolute = true;
      writeAbsoluteFields(startUs, shownEndUs);
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      const start = convertUnixTime(startUs);
      const end = convertUnixTime(shownEndUs);
      exactRange.value = {
        zone: zone.value,
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
        startUs,
        endUs,
      };
    };

    const stageCalendar = (token: string) => {
      selectedType.value = "relative";
      calendarToken.value = token;
    };

    // The capped copy is what the picker can keep; null when the reading is within the cap.
    const capRolling = (reading: TimeRangeReading): TimeRangeReading | null => {
      if (reading.kind !== "rolling" || !reading.rolling) return null;
      const { unit, value } = reading.rolling;
      const cap = MAX_CUSTOM_RELATIVE_VALUE[unit];
      if (cap === undefined || value <= cap) return null;
      const startUs = rollingStartUs(cap, unit, reading.endUs);
      if (Number.isNaN(startUs)) return null;
      return { ...reading, rolling: { unit, value: cap }, startUs, name: undefined, notes: [] };
    };

    const stageReading = (reading: TimeRangeReading) => {
      if (reading.kind === "rolling" && reading.rolling) {
        const { unit, value } = reading.rolling;
        stageRelative(unit, Math.min(value, MAX_CUSTOM_RELATIVE_VALUE[unit] ?? value));
        // The parser's rolling end is its now, so the later reading of a repeated hour is recognisable.
        const later = rollingStartUs(value, unit, reading.endUs, "later");
        if (later === reading.startUs && later !== rollingStartUs(value, unit, reading.endUs))
          rollingFold.value = "later";
      } else if (reading.kind === "calendar" && reading.calendarToken) {
        stageCalendar(reading.calendarToken);
      } else {
        stageAbsolute(reading.startUs, reading.endUs);
      }
    };

    const commitTypedReading = (reading: TimeRangeReading) => {
      stageReading(reading);
      applyAndClose();
    };

    // A full range applies at once; a lone stamp or a text that needs a choice goes to the bar instead.
    const pasteText = async (text: string, seq = selectionSeq) => {
      if (text.length > MAX_RANGE_TEXT_UNITS) {
        if (showRangeInput.value && rangeInput.value) rangeInput.value.setText(text, "paste");
        else toast({ variant: "error", message: t("common.dateRangePasteError") });
        return;
      }
      const { readPickerText } = await import("@/composables/useTimeRangeInput");
      const res = await readPickerText(text, rangeContext());
      if (seq !== selectionSeq) return;
      const reading =
        res.state === "valid" &&
        !res.reading.notes.some((n) => n.kind === "instant-window") &&
        !capRolling(res.reading)
          ? res.reading
          : null;
      if (reading) {
        stageReading(reading);
        // The bar's older text would otherwise win when Apply submits it first.
        rangeInput.value?.clear();
        if (props.autoApply) applyAndClose();
        toast({ variant: "success", message: t("common.dateRangePasted") });
      } else if (showRangeInput.value && rangeInput.value) {
        rangeInput.value.setText(text, "paste");
      } else {
        toast({ variant: "error", message: t("common.dateRangePasteError") });
      }
    };

    const pasteRange = async () => {
      const seq = selectionSeq;
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        toast({
          variant: "error",
          message: t("common.dateRangePasteBlocked", {
            shortcut: isMacOS() ? raw("⌘V") : raw("Ctrl+V"),
          }),
        });
        return;
      }
      // The length check comes first, so an oversize clipboard is never walked by trim().
      if (text.length <= MAX_RANGE_TEXT_UNITS && !text.trim()) {
        toast({ variant: "info", message: t("common.dateRangePasteEmpty") });
        return;
      }
      await pasteText(text, seq);
    };

    // A native paste event carries the clipboard text without the read permission pasteRange needs.
    const onPickerPaste = (event: ClipboardEvent) => {
      if (isInputFocused(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (text.length <= MAX_RANGE_TEXT_UNITS && !text.trim()) return;
      event.preventDefault();
      return pasteText(text);
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

    const optionsFn = (date: string) => {
      const formattedDate = calendarMaxDate.value;
      if (props.disableRelative) {
        return date >= props.minDate && date <= formattedDate;
      }
      return date >= "1999/01/01" && date <= formattedDate;
    };

    const seedAbsoluteFromSelection = () => {
      const { startTime, endTime } = getConsumableDateTime();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return;
      const start = convertUnixTime(startTime);
      const end = convertUnixTime(lastInstant(calendarToken.value, endTime));
      rememberSeededEnd(calendarToken.value, endTime);
      isSeedingAbsolute = true;
      selectedDate.value.from = start.date;
      selectedDate.value.to = end.date;
      selectedTime.value.startTime = start.time;
      selectedTime.value.endTime = end.time;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
    };

    // A tab only shows its panel; the range changes once the user picks or edits in it.
    const selectTab = (type: string) => {
      if (type === selectedType.value) return;
      if (type === "absolute" && selectedType.value === "relative") seedAbsoluteFromSelection();
      selectedType.value = type;
    };

    // Clicking the active segment deselects it in the group; the picker always keeps one type.
    const onTypeToggle = (value: unknown) => {
      if (value === "relative" || value === "absolute") selectTab(value);
    };

    // A host switch puts its own range in force, so the gate that guards user edits does not apply.
    const setDateType = (type: string) => {
      selectedType.value = type;
      if (!props.autoApply) return;
      markProgrammaticDateChange();
      saveDate(type === "absolute" ? "absolute" : "relative-custom", "host");
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
     * traces live-mode) re-run their query just like a manual Apply. The step
     * is staged with its exact µs and saved directly in every host mode.
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
      // Stepping forward onto the window a rolling range started from makes it roll again.
      if (direction === "next" && liveStepOrigin()?.steps === -1) {
        const origin = stepOrigin!;
        stepOrigin = null;
        stageRelative(origin.period, origin.value);
        menuOpen.value = false;
        saveDate("relative");
        return;
      }
      const fromRolling = isRolling();
      const origin = fromRolling
        ? { period: relativePeriod.value, value: relativeValue.value, steps: 0 }
        : liveStepOrigin();
      const { startTime, endTime } = getConsumableDateTime();
      const duration = endTime - startTime;
      if (!(duration > 0)) return;

      let delta = (direction === "prev" ? -1 : 1) * duration;
      if (direction === "next") {
        // A forward shift stops where the calendar does: now, or the end of `maxDate`.
        delta = Math.min(delta, forwardCeilingMicros() - endTime);
        if (delta < MICROS_PER_SECOND) return;
      }
      // A step past the host's oldest day stops at it; one that cannot move or fails the gate changes nothing.
      const minStartUs = rangeLimits.value.minStartUs ?? -Infinity;
      const startUs = Math.max(startTime + delta, minStartUs);
      const endUs = endTime + delta;
      if (gateOf(startUs, endUs, rangeLimits.value) !== null) return;

      stageAbsolute(startUs, endUs);
      stepOrigin = origin && {
        ...origin,
        steps: origin.steps + (direction === "prev" ? -1 : 1),
        at: absoluteRangeKey(),
      };

      menuOpen.value = false;
      saveDate("absolute");
    };

    // Set when ‹ leaves a rolling range; any other change of the window makes it stale.
    let stepOrigin: StepOrigin | null = null;
    const liveStepOrigin = () =>
      stepOrigin !== null && stepOrigin.at === absoluteRangeKey() ? stepOrigin : null;

    const isRolling = () =>
      !props.disableRelative && selectedType.value === "relative" && calendarToken.value === null;

    const rollingSpanMicros = (value: number, unit: string) => {
      const nowUs = Math.floor(Date.now()) * 1000;
      return nowUs - rollingStartUs(value, unit, nowUs);
    };

    // The real span of a rolling range ending now, as the gate measures it once applied.
    const rollingGate = (value: number, unit: string) => {
      const endUs = Math.floor(Date.now()) * 1000;
      return gateOf(endUs - rollingSpanMicros(value, unit), endUs, rangeLimits.value);
    };

    // A DST day is longer or shorter, so the set is rebuilt when the picker's day changes.
    const blockedChips = computed(() => {
      void pickerDay.value;
      const blocked = new Set<string>();
      if (!(props.queryRangeRestrictionInHour > 0)) return blocked;
      for (const period of relativePeriods) {
        for (const value of relativeDates[period.value]) {
          if (rollingGate(value, period.value) !== null) blocked.add(`${value}${period.value}`);
        }
      }
      return blocked;
    });

    // The largest value of a unit whose rolling range passes the gate now; -1 when even one is refused.
    const maxPassingValue = (unit: string) => {
      const hours = props.queryRangeRestrictionInHour;
      // A nominal 30-day month floors a 28-day limit to 0, though February's month fits it.
      const first = Math.max(1, Math.ceil((hours * 3600) / UNIT_SECONDS[unit]));
      for (let value = first; value >= 1; value--) {
        const reason = rollingGate(value, unit);
        if (reason === null) return value;
        if (reason !== "max-span") break;
      }
      return -1;
    };

    // A tighter host limit moves the selection to the largest range it allows; the host caused it, so no gate.
    const clampToRestriction = (period: string, value: number) => {
      stageRelative(period, value);
      if (props.autoApply || props.applyPresets) saveDate("relative", "host");
    };

    const zoomOutTarget = (): ZoomTarget => {
      if (isRolling()) {
        const value = Number(relativeValue.value) * 2;
        return { kind: "rolling", value, spanUs: rollingSpanMicros(value, relativePeriod.value) };
      }
      const { startTime, endTime } = getConsumableDateTime();
      const span = endTime - startTime;
      // The half that would pass now is added to the start, so the window still doubles.
      const endUs = Math.min(endTime + Math.round(span / 2), forwardCeilingMicros());
      return { kind: "fixed", startUs: endUs - span * 2, endUs, spanUs: span * 2 };
    };

    const zoomOutBlocked = computed<GateReason | null>(() => {
      const target = zoomOutTarget();
      if (
        target.kind === "rolling" &&
        target.value > (MAX_CUSTOM_RELATIVE_VALUE[relativePeriod.value] ?? Infinity)
      )
        return "out-of-range";
      if (!(target.spanUs > 0)) return "order";
      return target.kind === "rolling"
        ? rollingGate(target.value, relativePeriod.value)
        : gateOf(target.startUs, target.endUs, rangeLimits.value);
    });

    const zoomOutTooltip = computed(
      () => gateText(zoomOutBlocked.value) ?? t("common.zoomOutRange"),
    );

    const showRangeZoom = computed(
      () => !props.hideRangeShift && !props.disableRelative && !props.fieldAppearance,
    );

    const zoomOut = () => {
      if (zoomOutBlocked.value !== null) return;
      const target = zoomOutTarget();
      stepOrigin = null;
      menuOpen.value = false;
      if (target.kind === "rolling") {
        relativeValue.value = target.value;
        rollingFold.value = null;
        saveDate("relative");
        return;
      }
      stageAbsolute(target.startUs, target.endUs);
      saveDate("absolute");
    };

    const forwardCeilingMicros = () => maxDateEndUs.value ?? Date.now() * 1000;

    const isPrevShiftDisabled = () => {
      const minStartUs = rangeLimits.value.minStartUs;
      if (minStartUs === undefined) return false;
      return getConsumableDateTime().startTime <= minStartUs;
    };

    const isNextShiftDisabled = () => {
      if (liveStepOrigin()?.steps === -1) return false;
      if (selectedType.value === "relative") {
        return (parseCalendarToken(calendarToken.value)?.offset ?? 0) === 0;
      }
      const { endUTC } = getUTCTimeStamp(Date.now());
      return !(endUTC + MICROS_PER_SECOND <= forwardCeilingMicros());
    };

    // Rail items in tab order: recent rows, the show-more toggle, then the single-column calendar rows.
    const railItems = (panel: HTMLElement): HTMLButtonElement[] =>
      Array.from(
        panel.querySelectorAll<HTMLButtonElement>(
          "[data-date-time-rail-recent], [data-test='date-time-rail-recent-toggle'], [data-date-time-rail-calendar]",
        ),
      );

    // Arrow-key navigation for the picker panel: Left/Right switch the
    // Relative/Absolute tabs, and arrows roam the relative preset grid.
    // stopPropagation keeps reka's dropdown-menu keydown from swallowing them.
    const onPickerKeydown = (event: KeyboardEvent) => {
      const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrows.includes(event.key)) return;
      const panel = event.currentTarget as HTMLElement;
      const target = event.target as HTMLElement;
      if (!panel || !target) return;
      // The bar's arrows move through its own readings, never the preset grid.
      if (target.closest("[data-test='date-time-range-bar']")) return;

      const railItem = target.closest<HTMLButtonElement>("[data-date-time-rail-item]");
      if (railItem) {
        // A recent row's own listener reaches its × with Left/Right.
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();

        const items = railItems(panel);
        const dir = event.key === "ArrowDown" ? 1 : -1;
        let next: HTMLButtonElement | null = null;
        for (let i = items.indexOf(railItem) + dir; i >= 0 && i < items.length; i += dir) {
          if (!items[i].disabled) {
            next = items[i];
            break;
          }
        }
        next?.focus();
        return;
      }

      const tab = target.closest(
        "[data-test='date-time-relative-tab'], [data-test='date-time-absolute-tab']",
      );
      if (tab) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          const next = event.key === "ArrowRight" ? "absolute" : "relative";
          selectTab(next);
          panel.querySelector<HTMLElement>(`[data-test='date-time-${next}-tab']`)?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          panel
            .querySelector<HTMLElement>(".date-time-table [data-test$='-btn']:not([disabled])")
            ?.focus();
        }
        return;
      }

      const cell = target.closest<HTMLButtonElement>(
        "[data-test^='date-time-relative-'][data-test$='-btn']",
      );
      if (!cell) return;
      const rows = Array.from(panel.querySelectorAll(".date-time-table .relative-row"))
        .map((row) =>
          Array.from(
            row.querySelectorAll<HTMLButtonElement>(
              "[data-test^='date-time-relative-'][data-test$='-btn']",
            ),
          ),
        )
        .filter((btns) => btns.length > 0);
      let r = -1;
      let c = -1;
      rows.forEach((btns, ri) => {
        const ci = btns.indexOf(cell);
        if (ci !== -1) {
          r = ri;
          c = ci;
        }
      });
      if (r === -1) return;
      event.preventDefault();
      event.stopPropagation();

      const enabled = (btn?: HTMLButtonElement) => !!btn && !btn.disabled;
      const stepRow = (btns: HTMLButtonElement[], from: number, dir: number) => {
        for (let i = from + dir; i >= 0 && i < btns.length; i += dir)
          if (enabled(btns[i])) return btns[i];
        return null;
      };
      const stepCol = (from: number, dir: number) => {
        for (let ri = from + dir; ri >= 0 && ri < rows.length; ri += dir) {
          const btns = rows[ri];
          const col = Math.min(c, btns.length - 1);
          if (enabled(btns[col])) return btns[col];
          const back = stepRow(btns, col + 1, -1);
          if (back) return back;
          const fwd = stepRow(btns, col - 1, 1);
          if (fwd) return fwd;
        }
        return null;
      };

      let next: HTMLButtonElement | null = null;
      if (event.key === "ArrowLeft") next = stepRow(rows[r], c, -1);
      else if (event.key === "ArrowRight") next = stepRow(rows[r], c, 1);
      else if (event.key === "ArrowUp") next = stepCol(r, -1);
      else if (event.key === "ArrowDown") next = stepCol(r, 1);
      next?.focus();
    };

    const computeRelativePeriod = () => {
      if (selectedType.value === "relative") {
        if (props.queryRangeRestrictionInHour > 0) {
          for (const period of relativePeriods) {
            relativePeriodsMaxValue.value[period.value] = maxPassingValue(period.value);
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
            clampToRestriction(unit, relativePeriodsMaxValue.value[unit]);
          } else {
            calendarToken.value = null;
            if (props.autoApply) saveDate("relative", "host");
          }
        }

        if (props.queryRangeRestrictionInHour > 0) {
          const maxRelativeValue = relativePeriodsMaxValue.value[relativePeriod.value];

          try {
            if (maxRelativeValue > 0 && relativeValue.value > maxRelativeValue) {
              clampToRestriction(relativePeriod.value, maxRelativeValue);
            } else if (maxRelativeValue === -1) {
              const periodIndex = periodUnits.indexOf(relativePeriod.value);
              for (let i = periodIndex; i >= 0; i--) {
                if (relativePeriodsMaxValue.value[periodUnits[i]] > -1) {
                  clampToRestriction(
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

    const absoluteRangeKey = () => {
      if (selectedType.value !== "absolute") return null;
      // The key names the selection, not the clock, so a whole-day end on today is not clipped here.
      const { startUTC, endUTC } = getUTCTimeStamp(Infinity);
      return `${startUTC}-${endUTC}`;
    };

    const recordAbsoluteRange = () => {
      if (!showRail.value || selectedType.value !== "absolute") return;
      const { startUTC, endUTC } = getUTCTimeStamp(Date.now());
      timeRangeHistory.add(startUTC, endUTC);
    };

    // An auto-applied absolute range is final only when the panel closes, not after every edit.
    let rangeKeyAtOpen: string | null = null;
    const menuOpen = ref(false);

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
    // A picker in a view kept alive behind another route must not keep its clocks running.
    const viewActive = ref(true);
    onActivated(() => {
      viewActive.value = true;
      syncClock();
    });
    onDeactivated(() => {
      viewActive.value = false;
      stopClock();
    });
    onBeforeUnmount(stopClock);
    // True while the open selection's whole-day end is clipped to now, so the label must follow the clock.
    const clipsToNow = computed(() => {
      if (selectedType.value !== "absolute" || selectedTime.value.endTime !== DAY_END_TIME)
        return false;
      const day = pendingDay.value ?? selectedDate.value.to;
      const endUs = convertToUtcTimestamp(`${day} ${DAY_END_TIME}`, zone.value);
      return !rangeLimits.value.allowFuture && endUs > gateNow.value * 1000;
    });
    let gateTick: ReturnType<typeof setInterval> | null = null;
    const stopGateTick = () => {
      if (gateTick !== null) clearInterval(gateTick);
      gateTick = null;
    };
    watch(
      () =>
        viewActive.value && menuOpen.value && (gateReason.value === "future" || clipsToNow.value),
      (waiting) => {
        stopGateTick();
        if (!waiting) return;
        gateNow.value = Date.now();
        gateTick = setInterval(() => (gateNow.value = Date.now()), 1000);
      },
    );
    onBeforeUnmount(stopGateTick);

    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        selectionSeq++;
        gateNow.value = Date.now();
        refreshTooltipNow();
        pendingDay.value = null;
        rangeKeyAtOpen = absoluteRangeKey();
        onBeforeShow();
        onShow();
      } else {
        rangeInputBlocksApply.value = false;
        rangeInputValid.value = false;
        selectionSeq++;
        if (gateReason.value !== null) {
          pendingDay.value = null;
          restoreAppliedSelection();
          onBeforeHide();
          onHide();
          return;
        }
        if (props.autoApply && commitPendingDay()) saveDate("absolute");
        pendingDay.value = null;
        if (!props.autoApply || selectedType.value !== appliedSelection.selectedType) {
          restoreAppliedSelection();
        } else {
          // A refused edit that the clock has since made valid was never sent; closing sends it.
          if (selectionKey(liveSelection()) !== selectionKey(appliedSelection))
            saveDate(selectedType.value);
          if (absoluteRangeKey() !== rangeKeyAtOpen) recordAbsoluteRange();
        }
        onBeforeHide();
        onHide();
      }
    };

    // The rail sits after the header band in DOM order, so reka's default autofocus would land on a tab button.
    const onPopoverOpenAutoFocus = (event: Event) => {
      // The bar focuses its own input on mount, which may come after this event while its chunk loads.
      if (showRangeInput.value) {
        event.preventDefault();
        rangeInput.value?.focus();
        return;
      }
      if (!showRail.value) return;
      const firstItem = document.querySelector<HTMLElement>(
        "#date-time-menu [data-date-time-rail-item]:not([disabled])",
      );
      // An empty rail keeps reka's default focus, or focus stays on the trigger and ⌘V never reaches the panel.
      if (!firstItem) return;
      event.preventDefault();
      firstItem.focus();
    };

    // A pick closes the panel the way a user dismissal does, so listeners waiting on hide still run.
    const closeMenu = () => {
      if (!menuOpen.value) return;
      menuOpen.value = false;
      onMenuOpenChange(false);
    };

    // A single clicked day applies as that day.
    const commitPendingDay = (): boolean => {
      const day = pendingDay.value;
      pendingDay.value = null;
      if (!day || selectedType.value !== "absolute") return false;
      isSeedingAbsolute = true;
      selectedDate.value.from = day;
      selectedDate.value.to = day;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      return true;
    };

    const applyAndClose = () => {
      if (gateReason.value !== null) return;
      commitPendingDay();
      saveDate(null);
      recordAbsoluteRange();
      // Already recorded above, so the close below must not add the same range to Recent again.
      rangeKeyAtOpen = absoluteRangeKey();
      closeMenu();
    };

    // A valid reading in the bar is what Apply applies; with an empty bar it applies the panels.
    const onApplyClick = () => {
      if (rangeInput.value?.submit()) return;
      applyAndClose();
    };

    const applyCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((item) => item.id === id);
      if (!preset) return;
      rangeInput.value?.clear();
      stageCalendar(preset.token);
      saveDate("relative");
      closeMenu();
    };

    const applyRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (!entry) return;
      rangeInput.value?.clear();
      // An exclusive midnight end shows as the previous day's last second, as the rail label does.
      const endsAtMidnight =
        entry.endUs > entry.startUs &&
        entry.endUs % MICROS_PER_SECOND === 0 &&
        convertUnixTime(entry.endUs).time === "00:00:00";
      stageAbsolute(entry.startUs, entry.endUs, endsAtMidnight ? entry.endUs - 1 : entry.endUs);
      if (endsAtMidnight) rememberShownEnd(entry.endUs);
      saveDate("absolute");
      timeRangeHistory.add(entry.startUs, entry.endUs);
      rangeKeyAtOpen = absoluteRangeKey();
      closeMenu();
    };

    const removeRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (entry) timeRangeHistory.remove(entry);
    };

    const root = ref<HTMLElement | null>(null);
    let unregisterShortcut: (() => void) | null = null;
    const shortcutTarget = computed(
      () => showRangeInput.value && !props.disable && !props.fieldAppearance,
    );
    // The `t` shortcut skips pickers inside a dialog, so their tooltip must not offer it.
    const inDialog = ref(false);
    const shortcutEligible = computed(() => shortcutTarget.value && !inDialog.value);

    const openFromShortcut = async () => {
      await loadRangeInput().catch(() => undefined);
      if (menuOpen.value || props.disable) return;
      menuOpen.value = true;
      onMenuOpenChange(true);
    };

    onMounted(() => {
      if (!root.value) return;
      inDialog.value = !!root.value.closest('[role="dialog"], [role="alertdialog"]');
      unregisterShortcut = registerTimeRangePicker(root.value, openFromShortcut);
    });
    onBeforeUnmount(() => unregisterShortcut?.());

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
      menuOpen,
      onMenuOpenChange,
      onPopoverOpenAutoFocus,
      datetimeBtn,
      getImageURL,
      root,
      shortcutTarget,
      rangeInput,
      rangeInputBlocksApply,
      rangeInputValid,
      liveLabel,
      shortcutEligible,
      isPrevShiftDisabled,
      showRangeInput,
      rangeUnits,
      rangeKinds,
      rangeLimits,
      appliedRange,
      prefetchRangeInput,
      commitTypedReading,
      capRolling,
      onApplyClick,
      openFromShortcut,
      zone,
      locale,
      intlLocale,
      customDraft,
      commitCustom,
      onCustomRowFocusout,
      customBlocked,
      gateReason,
      gateNow,
      gateMessage,
      spanLimitText,
      zoomOut,
      zoomOutBlocked,
      zoomOutTooltip,
      showRangeZoom,
      onCustomValueFocus,
      onCustomValueBlur,
      setRelativeDate,
      pickRelativeChip,
      relativePeriods,
      relativeDates,
      showRail,
      calendarRailItems,
      recentRailItems,
      applyCalendarItem,
      applyRecentRange,
      removeRecentRange,
      applyAndClose,
      pendingDay,
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
      getPeriodLabel,
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
      optionsFn,
      setDateType,
      selectTab,
      onTypeToggle,
      shiftTimeRange,
      isNextShiftDisabled,
      onPickerKeydown,
      getConsumableDateTime,
      blockedChips,
      editCustomDraft,
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
      calendarMaxDate,
      timezoneSelectOptions,
      isTimezoneSelectOpen,
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
