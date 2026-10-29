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
    icon="info"
    class="date-time-container inline-flex items-stretch"
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
      content-class="p-1 shadow-lg!"
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
            'border-select-border! enabled:hover:border-select-border-hover! w-full':
              fieldAppearance,
          }"
          class="max-md:max-w-full max-md:min-w-0"
          :disabled="disable"
          @mouseenter="refreshTooltipNow"
        >
          <template #icon-left>
            <OTooltip v-if="triggerTooltip" :content="triggerTooltip" />
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
        <div
          class="grid min-h-0 flex-1 max-sm:flex max-sm:flex-col max-sm:overflow-y-auto"
          :class="
            showRail ? 'grid-cols-[19.25rem_1fr] grid-rows-[auto_1fr]' : 'grid-rows-[auto_1fr]'
          "
        >
          <div
            v-if="showRail"
            class="border-border-default col-start-1 row-start-1 flex items-center border-e border-b px-3 py-2 max-sm:order-1 max-sm:border-e-0 max-sm:border-b-0"
            data-test="date-time-rail-header"
          >
            <span class="text-sm font-semibold">{{ t("common.timeRangeRecent") }}</span>
          </div>
          <div
            class="border-border-default row-start-1 flex min-w-0 items-center gap-1 border-b px-3 py-2"
            :class="showRail ? 'col-start-2 max-sm:order-3' : 'col-start-1'"
          >
            <div v-if="!disableRelative" class="flex flex-1 gap-1">
              <OButton
                data-test="date-time-relative-tab"
                class="flex-1"
                :variant="selectedType === 'relative' ? 'primary' : 'ghost-primary'"
                size="sm"
                @click="selectTab('relative')"
              >
                {{ t("common.relative") }}
              </OButton>
              <OButton
                data-test="date-time-absolute-tab"
                class="flex-1"
                :variant="selectedType === 'absolute' ? 'primary' : 'ghost-primary'"
                size="sm"
                @click="selectTab('absolute')"
              >
                {{ t("common.absolute") }}
              </OButton>
            </div>
            <div v-else class="flex-1" />
            <OTooltip :content="t('common.copyRange')">
              <OButton
                data-test="date-time-copy-btn"
                variant="ghost"
                size="icon-xs-sq"
                icon-left="content-copy"
                :aria-label="t('common.copyRange')"
                @click="copyRange"
              />
            </OTooltip>
            <OTooltip :content="t('common.pasteRange')">
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
            class="border-border-default relative col-start-1 row-start-2 border-e max-sm:static max-sm:order-2 max-sm:border-e-0 max-sm:border-b"
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
            :class="showRail ? 'col-start-2 max-sm:order-4' : 'col-start-1'"
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
                        :disabled="
                          relativeDatesInHour[period.value][item_index] >
                            queryRangeRestrictionInHour && queryRangeRestrictionInHour > 0
                        "
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
                        @click="setRelativeDate(period.value, item)"
                        :key="'period_' + item_index"
                      >
                        {{ item }}
                        <OTooltip
                          v-if="
                            relativeDatesInHour[period.value][item_index] >
                              queryRangeRestrictionInHour && queryRangeRestrictionInHour > 0
                          "
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
                          v-model.number="relativeValue"
                          :aria-label="t('common.timeAmount')"
                          type="number"
                          :min="1"
                          :step="1"
                          :max="
                            relativePeriodsMaxValue[relativePeriod] > 0
                              ? relativePeriodsMaxValue[relativePeriod]
                              : undefined
                          "
                          @update:model-value="onCustomPeriodSelect"
                          @focus="onCustomValueFocus"
                          @blur="onCustomValueBlur"
                        />
                      </div>
                      <div class="flex min-w-0 flex-1 flex-col">
                        <OSelect
                          v-model="relativePeriod"
                          :aria-label="t('common.timeUnit')"
                          :options="relativePeriodsSelect"
                          @update:model-value="onCustomPeriodSelect"
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
                  <div class="text-3xs ps-6 pe-6">{{ t("common.datetimeMessage") }}</div>
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
              v-if="!hideRelativeTimezone || !autoApply"
              class="flex shrink-0 items-center gap-3 px-3 py-2"
            >
              <OSelect
                v-if="!hideRelativeTimezone"
                data-test="datetime-timezone-select"
                v-model="timezone"
                :options="timezoneSelectOptions"
                searchable
                :label="t('logStream.timezone')"
                @update:model-value="onTimezoneChange"
                @open="isTimezoneSelectOpen = true"
                @close="isTimezoneSelectOpen = false"
                class="min-w-0 flex-1"
              />
              <div v-else class="flex-1" />
              <OButton
                v-if="!autoApply"
                data-test="date-time-apply-btn"
                variant="primary"
                size="xs"
                @click="applyAndClose"
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
        class="border-button-outline-border h-auto! rounded-s-none! border-s!"
        icon-left="chevron-right"
        :aria-label="t('common.next')"
        :disabled="disable || isNextShiftDisabled()"
        @click.prevent.stop="shiftTimeRange('next')"
      />
    </OTooltip>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
  defineComponent,
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  watch,
  nextTick,
  type PropType,
} from "vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import {
  getImageURL,
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
  formatRecentRange,
  formatRecentRangeParts,
  type TimeRangeRailItem,
} from "@/utils/timeRangeRail";
import useTimeRangeHistory from "@/composables/useTimeRangeHistory";
import { localeFileMap } from "@/locales";
import {
  parseDateRangeString,
  parseSingleDateTime,
  type ParsedSingleDateTime,
} from "@/utils/dateTimeRangeParse";
import { copyToClipboard } from "@/utils/clipboard";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import useBreakpoint from "@/composables/useBreakpoint";
import { fromZonedTime } from "date-fns-tz";

const MICROS_PER_SECOND = 1_000_000;
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

export default defineComponent({
  components: {
    OSeparator,
    OButton,
    OIcon,
    OTooltip,
    OTruncatedText,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    OPopover,
    DateTimeRail,
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
  },

  emits: ["on:date-change", "on:timezone-change", "hide", "show"],

  setup(props, { emit }) {
    const store = useStore();
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
    // A single clicked day the range calendar is still waiting to pair with an end date.
    const pendingDay = ref<string | null>(null);
    // Fields written by the picker itself (seeding the Absolute tab, a Recent pick) are not user edits for auto-apply.
    let isSeedingAbsolute = false;
    let seededEnd: { date: string; time: string } | null = null;
    // Date-only pickers cannot show the times a recent range carries.
    const showRail = computed(() => !props.disableRelative);
    const lastValidCustomValue = ref(15);
    const currentTimezone = useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = ref(currentTimezone);
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
      return tz;
    });
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const browserTime = raw("Browser Time (" + browserTz + ")");

    // Add the UTC option
    timezoneOptions.unshift("UTC");
    timezoneOptions.unshift(browserTime);

    const onTimezoneChange = async () => {
      let selectedTimezone = timezone.value;
      if (selectedTimezone.toLowerCase() == browserTime.toLowerCase()) {
        selectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }
      //Intl.DateTimeFormat().resolvedOptions().timeZone
      useLocalTimezone(selectedTimezone);
      store.dispatch("setTimezone", selectedTimezone);
      await nextTick();
      if (props.autoApply) {
        if (selectedType.value == "absolute") saveDate("absolute");
        else saveDate("relative");
      }

      emit("on:timezone-change");
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

    const timezoneSelectOptions = computed(() =>
      timezoneOptions.map((tz: string) =>
        tz === browserTime
          ? { label: t("common.browserTimeWithZone", { zone: browserTz }), value: tz }
          : { label: raw(tz), value: tz },
      ),
    );

    let relativePeriods = [
      { label: t("common.seconds"), value: "s" },
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
      { label: t("common.days"), value: "d" },
      { label: t("common.weeks"), value: "w" },
      { label: t("common.months"), value: "M" },
    ];

    let relativePeriodsSelect = ref([
      { label: t("common.seconds"), value: "s" },
      { label: t("common.minutes"), value: "m" },
      { label: t("common.hours"), value: "h" },
      { label: t("common.days"), value: "d" },
      { label: t("common.weeks"), value: "w" },
      { label: t("common.months"), value: "M" },
    ]);

    const relativeDates: Record<string, number[]> = {
      s: [1, 5, 10, 15, 30, 45],
      m: [1, 5, 10, 15, 30, 45],
      h: [1, 2, 3, 6, 8, 12],
      d: [1, 2, 3, 4, 5, 6],
      w: [1, 2, 3, 4, 5, 6],
      M: [1, 2, 3, 4, 5, 6],
    };

    const relativeDatesInHour: Record<string, number[]> = {
      s: [1, 1, 1, 1, 1, 1],
      m: [1, 1, 1, 1, 1, 1],
      h: [1, 2, 3, 6, 8, 12],
      d: [24, 48, 72, 96, 120, 144],
      w: [168, 336, 504, 672, 840, 1008],
      M: [744, 1488, 2232, 2976, 3720, 4464],
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
        : (formatCalendarTooltip(token, store.state.timezone, tooltipNow.value) ?? undefined);

    const calendarExceedsRestriction = (token: string | null) => {
      const range = resolveCalendarPeriod(token, store.state.timezone, tooltipNow.value);
      return (
        !!range &&
        exceedsRangeRestriction(range.startTime, range.endTime, props.queryRangeRestrictionInHour)
      );
    };

    // Each token is resolved once; tooltip and restriction both read that one range.
    const resolvePresetState = (token: string, nowMs: number): CalendarPresetState => {
      const range = resolveCalendarPeriod(token, store.state.timezone, nowMs);
      if (!range) return { tooltip: undefined, disabled: false };
      return {
        tooltip: formatResolvedCalendarTooltip(token, range, store.state.timezone),
        disabled: exceedsRangeRestriction(
          range.startTime,
          range.endTime,
          props.queryRangeRestrictionInHour,
        ),
      };
    };

    // A finished period only moves when the picker's day changes, so a hover that bumps the clock keeps it cached.
    const pickerDay = computed(() =>
      timestampToTimezoneDate(tooltipNow.value, store.state.timezone, "yyyy/MM/dd"),
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
          selected: selectedType.value === "relative" && calendarToken.value === preset.token,
          disabled: state?.disabled ?? false,
        };
      });
    });

    const recentRailItems = computed<TimeRangeRailItem[]>(() => {
      const current = selectedType.value === "absolute" ? getUTCTimeStamp() : null;
      return timeRangeHistory.entries.value.map((entry, index) => ({
        id: String(index),
        label: formatRecentRange(entry.startUs, entry.endUs, store.state.timezone),
        parts: formatRecentRangeParts(entry.startUs, entry.endUs, store.state.timezone),
        tooltip: formatRangeTooltip(entry.startUs, entry.endUs, store.state.timezone),
        selected:
          current !== null && current.startUTC === entry.startUs && current.endUTC === entry.endUs,
        disabled: exceedsRangeRestriction(
          entry.startUs,
          entry.endUs,
          props.queryRangeRestrictionInHour,
        ),
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
      return timestampToTimezoneDate(new Date().getTime(), store.state.timezone, "yyyy/MM/dd");
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
        pendingDay.value;
      },
      () => {
        if (
          props.autoApply &&
          selectedType.value === "absolute" &&
          !isSeedingAbsolute &&
          pendingDay.value === null &&
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

    const onCustomPeriodSelect = () => {
      // An emptied or non-numeric field is mid-edit: apply nothing until a number is typed.
      if (!isValidCustomValue(relativeValue.value)) return;

      let value = Math.max(1, Math.trunc(Number(relativeValue.value)));
      const restrictedMax = relativePeriodsMaxValue.value[relativePeriod.value];
      if (
        selectedType.value == "relative" &&
        props.queryRangeRestrictionInHour > 0 &&
        value > restrictedMax
      ) {
        value = restrictedMax > -1 ? restrictedMax : 15;
      }
      relativeValue.value = Math.min(
        value,
        MAX_CUSTOM_RELATIVE_VALUE[relativePeriod.value] ?? value,
      );
      lastValidCustomValue.value = relativeValue.value;
      calendarToken.value = null;

      if (props.autoApply) saveDate("relative-custom");
    };

    const onCustomValueFocus = () => {
      lastValidCustomValue.value = relativeValue.value;
    };
    const onCustomValueBlur = () => {
      if (!isValidCustomValue(relativeValue.value))
        relativeValue.value = lastValidCustomValue.value;
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
      const calendarRange = resolveCalendarPeriod(period, store.state.timezone);
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
      seededEnd = null;
      if (!startTime || !endTime) {
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

    function convertUnixTime(unixTimeMicros: number) {
      return formatAbsoluteInstant(unixTimeMicros, store.state.timezone);
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
      appliedDisplayValue.value = getDisplayValue.value;
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

    function isValidDateTimeString(dateStr: string, timeStr: string): boolean {
      return !isNaN(Date.parse(`${dateStr} ${timeStr}`));
    }

    const getConsumableDateTime = (): ConsumableDateTime => {
      const calendarRange =
        selectedType.value === "relative"
          ? resolveCalendarPeriod(calendarToken.value, store.state.timezone)
          : null;
      if (calendarRange) {
        return { ...calendarRange, relativeTimePeriod: calendarToken.value };
      }
      if (selectedType.value == "relative") {
        let period = PERIOD_ARITHMETIC_UNIT[relativePeriod.value];
        let periodValue = relativeValue.value;

        // arithmetic on weeks is not supported; convert to days.
        if (relativePeriod.value === "w") {
          period = "days";
          periodValue = periodValue * 7;
        }

        const subtractObject: Record<string, number> = {};

        if (period && periodValue) subtractObject[period] = periodValue;
        else {
          console.error("getConsumableDateTime: Invalid relative period");
          subtractObject["Minutes"] = 15;
        }

        const endTimeStamp = new Date();

        const startTimeStamp = subtractRelativeTime(endTimeStamp, subtractObject);

        return {
          startTime: new Date(startTimeStamp).getTime() * 1000,
          endTime: new Date(endTimeStamp).getTime() * 1000,
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

    const getUTCTimeStamp = () => {
      let startTime = selectedDate.value.from + " " + selectedTime.value.startTime;
      let endTime = selectedDate.value.to + " " + selectedTime.value.endTime;
      const startUTC = convertToUtcTimestamp(startTime, store.state.timezone);
      const untouchedSeededEnd =
        seededEnd !== null &&
        seededEnd.date === selectedDate.value.to &&
        seededEnd.time === selectedTime.value.endTime;
      // The shown last second stands for the exclusive end one second later, in whatever zone is now selected.
      const endUTC =
        convertToUtcTimestamp(endTime, store.state.timezone) +
        (untouchedSeededEnd ? MICROS_PER_SECOND : 0);
      return { startUTC, endUTC };
    };

    const setSavedDate = (dateobj: any) => {
      timezone.value = store.state.timezone;
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
      const showsApplied = !props.autoApply && !menuOpen.value;
      // A calendar label is re-derived so an older period keeps naming the right day after midnight.
      const appliedCalendarLabel =
        showsApplied && appliedCalendarToken.value !== null
          ? formatCalendarLabel(
              appliedCalendarToken.value,
              store.state.timezone,
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

    const getDisplayValue = computed(() => {
      const calendarLabel =
        !props.disableRelative && selectedType.value === "relative" && calendarToken.value !== null
          ? formatCalendarLabel(
              calendarToken.value,
              store.state.timezone,
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
            return `${from} ${selectedTime.value.startTime} - ${to} ${selectedTime.value.endTime}`;
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

    // ----- Copy / paste of the selected range ---------------------------------
    // Copy always resolves the selection (relative OR absolute) to a concrete
    // absolute window, so the copied value is unambiguous. Paste accepts that
    // format plus `Past N <Period>` and raw epoch timestamp pairs.
    const copyRange = () => {
      // Epoch microseconds side-step timezone ambiguity: pasting this into a
      // tab with a different selected timezone still lands on the same
      // instant, unlike a "yyyy/MM/dd HH:mm:ss" string (which paste would
      // reinterpret using the pasting tab's own timezone).
      const { startTime, endTime } = getConsumableDateTime();
      const payload = JSON.stringify({ start_date: startTime, end_date: endTime });
      copyToClipboard(payload, t, { successMessage: t("common.dateRangeCopied") });
    };

    // Converts a parsed absolute date[+time] string, interpreted as wall-clock
    // time in the currently selected timezone, to epoch microseconds — the
    // inverse of convertUnixTime.
    const absoluteToMicros = (date: string, time: string): number => {
      const iso = `${date.replace(/\//g, "-")}T${time}`;
      return fromZonedTime(iso, store.state.timezone).getTime() * 1000;
    };

    const finalizeAbsoluteRange = (startMicros: number, endMicros: number) => {
      selectedType.value = "absolute";
      calendarToken.value = null;
      // A day clicked before the paste would otherwise overwrite the pasted range when the panel closes.
      pendingDay.value = null;
      // Saved once below, so the auto-apply date watcher must not save it a second time.
      isSeedingAbsolute = true;
      setAbsoluteTime(startMicros, endMicros);
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      // A paste is the user's own change; setAbsoluteTime stamps it programmatic, which pages gating refetch on it ignore.
      isUserInitiated = true;
      if (props.autoApply) {
        saveDate(null);
        recordAbsoluteRange();
      }
    };

    const applyParsedRange = (text: string): boolean => {
      const parsed = parseDateRangeString(text);
      if (!parsed) return false;
      if (parsed.type === "timestamp") {
        finalizeAbsoluteRange(parsed.startMicros, parsed.endMicros);
      } else {
        finalizeAbsoluteRange(
          absoluteToMicros(parsed.startDate, parsed.startTime),
          absoluteToMicros(parsed.endDate, parsed.endTime),
        );
      }
      return true;
    };

    // Applies a single pasted date-time value to whichever side of the current
    // range it sits closer to — e.g. a range of 5:00-10:00 pasted with 7:00
    // becomes 7:00-10:00 (closer to start), while 13:00 becomes 5:00-13:00
    // (closer to end). There's no cursor/selection to anchor a side to
    // without a text field, so proximity is the next best signal of intent.
    const applySingleDateTime = (parsed: ParsedSingleDateTime) => {
      const micros =
        parsed.type === "timestamp"
          ? parsed.micros
          : absoluteToMicros(parsed.date, parsed.time ?? "00:00:00");

      const { startTime: baseStart, endTime: baseEnd } = getConsumableDateTime();
      const isCloserToStart = Math.abs(micros - baseStart) <= Math.abs(micros - baseEnd);
      finalizeAbsoluteRange(
        isCloserToStart ? micros : baseStart,
        isCloserToStart ? baseEnd : micros,
      );
    };

    // Tries a full range first, then a single value applied to both sides.
    const applyPastedText = (text: string): boolean => {
      if (applyParsedRange(text)) return true;

      const single = parseSingleDateTime(text);
      if (!single) return false;

      applySingleDateTime(single);
      return true;
    };

    const applyPastedTextWithToast = (text: string) => {
      if (applyPastedText(text)) {
        toast({ variant: "success", message: t("common.dateRangePasted") });
      } else {
        toast({ variant: "error", message: t("common.dateRangePasteError") });
      }
    };

    const pasteRange = async () => {
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
      applyPastedTextWithToast(text);
    };

    // A native paste event carries the clipboard text without the read permission pasteRange needs.
    const onPickerPaste = (event: ClipboardEvent) => {
      if (isInputFocused(event.target)) return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (!text.trim()) return;
      event.preventDefault();
      applyPastedTextWithToast(text);
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
      const formattedDate = timestampToTimezoneDate(
        new Date().getTime(),
        store.state.timezone,
        "yyyy/MM/dd",
      );
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
        if (shifted === null || !resolveCalendarPeriod(shifted, store.state.timezone)) return;
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
        // The calendar rejects future dates, so a forward shift stops at now.
        delta = Math.min(delta, Date.now() * 1000 - endTime);
        if (delta < MICROS_PER_SECOND) return;
      }
      const startDateTime = convertUnixTime(startTime + delta);
      const endDateTime = convertUnixTime(endTime + delta);

      selectedDate.value.from = startDateTime.date;
      selectedDate.value.to = endDateTime.date;
      selectedTime.value.startTime = startDateTime.time;
      selectedTime.value.endTime = endDateTime.time;
      selectedType.value = "absolute";

      menuOpen.value = false;
      if (!props.autoApply) saveDate("absolute");
    };

    const isNextShiftDisabled = () => {
      if (selectedType.value === "relative") {
        return (parseCalendarToken(calendarToken.value)?.offset ?? 0) === 0;
      }
      const { endUTC } = getUTCTimeStamp();
      return !(endUTC + MICROS_PER_SECOND <= Date.now() * 1000);
    };

    // Only the calendar section is a 2-column grid of this/last pairs; every other row is 1-item.
    const railRows = (panel: HTMLElement): HTMLButtonElement[][] => {
      const recentRows = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("[data-date-time-rail-recent]"),
      ).map((btn) => [btn]);
      const toggle = panel.querySelector<HTMLButtonElement>(
        "[data-test='date-time-rail-recent-toggle']",
      );
      const calendarButtons = Array.from(
        panel.querySelectorAll<HTMLButtonElement>("[data-date-time-rail-calendar]"),
      );
      const calendarRows: HTMLButtonElement[][] = [];
      for (let i = 0; i < calendarButtons.length; i += 2) {
        calendarRows.push(calendarButtons.slice(i, i + 2));
      }
      return [...recentRows, ...(toggle ? [[toggle]] : []), ...calendarRows];
    };

    // Arrow-key navigation for the picker panel: Left/Right switch the
    // Relative/Absolute tabs, and arrows roam the relative preset grid.
    // stopPropagation keeps reka's dropdown-menu keydown from swallowing them.
    const onPickerKeydown = (event: KeyboardEvent) => {
      const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      if (!arrows.includes(event.key)) return;
      const panel = event.currentTarget as HTMLElement;
      const target = event.target as HTMLElement;
      if (!panel || !target) return;

      const railItem = target.closest<HTMLButtonElement>("[data-date-time-rail-item]");
      if (railItem) {
        // Only the calendar grid uses Left/Right; a recent row's own listener reaches its × with it.
        const isCalendarItem = railItem.hasAttribute("data-date-time-rail-calendar");
        if (!isCalendarItem && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        event.stopPropagation();

        const rows = railRows(panel);
        const enabled = (btn?: HTMLButtonElement) => !!btn && !btn.disabled;
        let r = -1;
        let c = -1;
        rows.forEach((row, ri) => {
          const ci = row.indexOf(railItem);
          if (ci !== -1) {
            r = ri;
            c = ci;
          }
        });
        if (r === -1) return;

        const stepInRow = (dir: number) => {
          for (let ci = c + dir; ci >= 0 && ci < rows[r].length; ci += dir)
            if (enabled(rows[r][ci])) return rows[r][ci];
          return null;
        };
        const stepRows = (dir: number) => {
          for (let ri = r + dir; ri >= 0 && ri < rows.length; ri += dir) {
            const row = rows[ri];
            const col = Math.min(c, row.length - 1);
            if (enabled(row[col])) return row[col];
            const alt = row.find((btn) => enabled(btn));
            if (alt) return alt;
          }
          return null;
        };

        let next: HTMLButtonElement | null = null;
        if (event.key === "ArrowLeft") next = stepInRow(-1);
        else if (event.key === "ArrowRight") next = stepInRow(1);
        else if (event.key === "ArrowUp") next = stepRows(-1);
        else if (event.key === "ArrowDown") next = stepRows(1);
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

    const absoluteRangeKey = () => {
      if (selectedType.value !== "absolute") return null;
      const { startUTC, endUTC } = getUTCTimeStamp();
      return `${startUTC}-${endUTC}`;
    };

    const recordAbsoluteRange = () => {
      if (!showRail.value || selectedType.value !== "absolute") return;
      const { startUTC, endUTC } = getUTCTimeStamp();
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
    onActivated(syncClock);
    onDeactivated(stopClock);
    onBeforeUnmount(stopClock);
    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        refreshTooltipNow();
        pendingDay.value = null;
        rangeKeyAtOpen = absoluteRangeKey();
        onBeforeShow();
        onShow();
      } else {
        if (props.autoApply && commitPendingDay()) saveDate("absolute");
        pendingDay.value = null;
        if (!props.autoApply || selectedType.value !== appliedSelection.selectedType) {
          restoreAppliedSelection();
        } else if (absoluteRangeKey() !== rangeKeyAtOpen) {
          recordAbsoluteRange();
        }
        onBeforeHide();
        onHide();
      }
    };

    // The rail sits after the header band in DOM order, so reka's default autofocus would land on a tab button.
    const onPopoverOpenAutoFocus = (event: Event) => {
      if (!showRail.value) return;
      const firstItem = document.querySelector<HTMLElement>(
        "#date-time-menu [data-date-time-rail-item]:not([disabled])",
      );
      // An empty rail keeps reka's default focus, or focus stays on the trigger and ⌘V never reaches the panel.
      if (!firstItem) return;
      event.preventDefault();
      firstItem.focus();
    };

    // A rail pick closes the panel the way a user dismissal does, so listeners waiting on hide still run.
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
      commitPendingDay();
      saveDate(null);
      recordAbsoluteRange();
      menuOpen.value = false;
    };

    const applyCalendarItem = (id: string) => {
      const preset = CALENDAR_RAIL_ITEMS.find((item) => item.id === id);
      if (!preset) return;
      selectedType.value = "relative";
      calendarToken.value = preset.token;
      saveDate("relative");
      closeMenu();
    };

    const applyRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (!entry) return;
      const start = convertUnixTime(entry.startUs);
      // An exclusive midnight end shows as the previous day's last second, as the rail label does.
      const endsAtMidnight =
        entry.endUs > entry.startUs &&
        entry.endUs % MICROS_PER_SECOND === 0 &&
        convertUnixTime(entry.endUs).time === "00:00:00";
      const end = convertUnixTime(endsAtMidnight ? entry.endUs - 1 : entry.endUs);
      if (endsAtMidnight) rememberShownEnd(entry.endUs);
      else seededEnd = null;
      // Saved once below, so the auto-apply date watcher must not save it a second time.
      isSeedingAbsolute = true;
      selectedDate.value.from = start.date;
      selectedDate.value.to = end.date;
      selectedTime.value.startTime = start.time;
      selectedTime.value.endTime = end.time;
      nextTick(() => {
        isSeedingAbsolute = false;
      });
      selectedType.value = "absolute";
      calendarToken.value = null;
      saveDate("absolute");
      timeRangeHistory.add(entry.startUs, entry.endUs);
      rangeKeyAtOpen = absoluteRangeKey();
      closeMenu();
    };

    const removeRecentRange = (id: string) => {
      const entry = timeRangeHistory.entries.value[Number(id)];
      if (entry) timeRangeHistory.remove(entry);
    };

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
      onCustomPeriodSelect,
      onCustomValueFocus,
      onCustomValueBlur,
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
      shiftTimeRange,
      isNextShiftDisabled,
      onPickerKeydown,
      getConsumableDateTime,
      relativeDatesInHour,
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
