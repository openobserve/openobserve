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
  <div icon="info" class="justify-between date-time-container">
    <OPopover
      v-model:open="menuOpen"
      side="bottom"
      :align="menuAlign"
      :z-index="10001"
      content-class="p-1"
      @update:open="onMenuOpenChange"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          :variant="variant"
          size="sm-toolbar"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
            'min-w-71.5': !disableRelative && selectedType === 'absolute',
            'w-fit': disableRelative,
          }"
          :disabled="disable"
          icon-left="schedule"
        >
          <span class="date-time-label font-semibold flex-1 text-left">{{ triggerLabel }}</span>
          <template #icon-right
            ><OIcon name="arrow-drop-down" size="sm" class="date-time-arrow transition-transform duration-250 ml-auto text-lg!"
          /></template>
        </OButton>
      </template>
      <div id="date-time-menu" class="date-time-dialog w-81.25 z-10001 max-h-(--reka-popper-available-height,600px) overflow-y-auto" @keydown.capture="onPickerKeydown">
        <div v-if="!disableRelative" class="flex justify-evenly py-2">
          <OButton
            data-test="date-time-relative-tab"
            class="w-38.5"
            :variant="selectedType === 'relative' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('relative')"
          >
            {{ t("common.relative") }}
          </OButton>
          <OSeparator vertical class="my-2" />
          <OButton
            data-test="date-time-absolute-tab"
            class="w-38.5"
            :variant="selectedType === 'absolute' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('absolute')"
          >
            {{ t("common.absolute") }}
          </OButton>
        </div>
        <OSeparator />
        <div class="overflow-y-visible">
        <OTabPanels v-model="selectedType" animated>
          <OTabPanel v-if="!disableRelative" name="relative">
            <div class="date-time-table relative flex flex-col">
              <div
                class="relative-row [&>*]:mr-1.5 flex items-center border-b border-border-default pl-3 py-2"
                v-for="(period, index) in relativePeriods"
                :key="'date_' + index"
              >
                <div class="text-sm font-semibold min-w-18.75">
                  {{ period.label }}
                </div>
                <div
                  v-for="(item, item_index) in relativeDates[period.value]"
                  :key="item"
                >
                  <OButton
                    :disabled="
                      relativeDatesInHour[period.value][item_index] >
                        queryRangeRestrictionInHour &&
                      queryRangeRestrictionInHour > 0
                    "
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    class="h-8! w-8! font-bold! disabled:opacity-35"
                    :class="
                      selectedType == 'relative' &&
                      relativePeriod == period.value &&
                      relativeValue == item
                        ? 'bg-button-primary! text-button-primary-foreground!'
                        : `bg-[color-mix(in_srgb,var(--color-text-heading)_7%,transparent)]! ${relativePeriod}`
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
                          queryRangeRestrictionInHour &&
                        queryRangeRestrictionInHour > 0
                      "
                      side="right"
                      align="center"
                      max-width="300px"
                      :content="queryRangeRestrictionMsg"
                    />
                  </OButton>
                </div>
              </div>

              <div class="relative-row [&>*]:mr-1.5 flex items-center border-b border-border-default px-3 py-2">
                <div class="text-sm font-semibold min-w-18.75">{{ t("common.custom") }}</div>
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  v-if="queryRangeRestrictionInHour > 0"
                  :content="queryRangeRestrictionMsg"
                />

                <div class="flex gap-2 flex-1 min-w-0">
                  <div class="flex flex-col w-20">
                    <OInput
                      v-model.number="relativeValue"
                      type="number"
                      :min="1"
                      :step="1"
                      :max="
                        relativePeriodsMaxValue[relativePeriod] > 0
                          ? relativePeriodsMaxValue[relativePeriod]
                          : undefined
                      "
                      @update:model-value="onCustomPeriodSelect"
                    />
                  </div>
                  <div class="flex flex-col flex-1 min-w-0">
                    <OSelect
                      v-model="relativePeriod"
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
          </OTabPanel>
          <OTabPanel name="absolute">
            <div class="date-time-table flex flex-col">
              <OTooltip
                side="right"
                align="center"
                max-width="300px"
                v-if="queryRangeRestrictionInHour > 0"
                :content="queryRangeRestrictionMsg"
              />
              <div class="flex justify-center px-3 py-2">
                <ODateRangeCalendar
                  :start-date="selectedDate.from"
                  :end-date="selectedDate.to"
                  :min-date="calendarMinDate"
                  :max-date="calendarMaxDate"
                  @update:start-date="selectedDate.from = $event"
                  @update:end-date="selectedDate.to = $event"
                />
              </div>
              <div class="pr-6 pl-6 text-3xs">{{ t("common.datetimeMessage") }}</div>
              <OSeparator v-if="!disableRelative" class="my-2" />

              <table v-if="!hideRelativeTime" class="px-3 w-[calc(100%-0.8rem)] mx-[0.4rem] mt-2 mb-[0.3rem] startEndTime">
                <tbody>
                  <tr>
                    <td class="label o-input-label text-compact font-medium leading-tight text-input-label-text pr-1.5 w-1/2">Start time</td>
                    <td class="label o-input-label text-compact font-medium leading-tight text-input-label-text pl-1.5 w-1/2">End time</td>
                  </tr>
                  <tr>
                    <td class="pr-1.5 w-1/2">
                      <OTime
                        class="w-full"
                        v-model="selectedTime.startTime"
                        with-seconds
                        data-test="datetime-start-time"
                        @complete="endTimeRef?.openHourPicker()"
                        @blur="
                          resetTime(
                            selectedTime.startTime,
                            selectedTime.endTime,
                          )
                        "
                      />
                    </td>
                    <td class="pl-1.5 w-1/2">
                      <OTime
                        ref="endTimeRef"
                        class="w-full"
                        v-model="selectedTime.endTime"
                        :with-seconds="true"
                        data-test="datetime-end-time"
                        @blur="
                          resetTime(
                            selectedTime.startTime,
                            selectedTime.endTime,
                          )
                        "
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </OTabPanel>
        </OTabPanels>
        </div>
        <div v-if="!hideRelativeTimezone" class="pr-3">
          <OSelect
            data-test="datetime-timezone-select"
            v-model="timezone"
            :options="timezoneSelectOptions"
            searchable
            :label="t('logStream.timezone')"
            @update:model-value="onTimezoneChange"
            @open="isTimezoneSelectOpen = true"
            @close="isTimezoneSelectOpen = false"
            class="my-2 mx-[0.4rem]"
          />
        </div>
        <div class="flex items-center gap-1 py-2 px-3 border-t border-border-default">
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
          <div class="flex-1" />
          <OButton
            v-if="!autoApply"
            data-test="date-time-apply-btn"
            variant="primary"
            size="xs"
            class="element-box-shadow"
            @click="
              saveDate(null);
              menuOpen = false;
            "
          >
            {{ t("common.apply") }}
          </OButton>
        </div>
      </div>
    </OPopover>
  </div>
</template>

<script lang="ts">
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import {
  ref,
  defineComponent,
  computed,
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
  parseDateRangeString,
  parseSingleDateTime,
  type ParsedSingleDateTime,
} from "@/utils/dateTimeRangeParse";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

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
    OTabPanels,
    OTabPanel,
    OButton,
    OIcon,
    OTooltip,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    OPopover,
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
  },

  emits: ["on:date-change", "on:timezone-change", "hide", "show"],

  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
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
    const currentTimezone =
      useLocalTimezone() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezone = ref(currentTimezone);
    let timezoneOptions = Intl.supportedValuesOf("timeZone").map((tz) => {
      return tz;
    });
    const browserTime =
      "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

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
        timezoneOptions.find(
          (tz) => tz.toLowerCase() === props.initialTimezone?.toLowerCase(),
        ) || currentTimezone;

      // call onTimezoneChange to set the timezone in the store
      onTimezoneChange();
    }

    const filteredTimezone: any = ref(timezoneOptions);
    const isTimezoneSelectOpen = ref(false);

    const timezoneSelectOptions = computed(() =>
      timezoneOptions.map((tz: string) => ({ label: tz, value: tz })),
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
      return timestampToTimezoneDate(
        new Date().getTime(),
        store.state.timezone,
        "yyyy/MM/dd",
      );
    });

    onMounted(() => {
      // updateDisplayValue();
      if (props.disableRelative) setDateType("absolute");
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

        selectedType.value = props.defaultType;

        setAbsoluteTime(startTime, endTime);

        setRelativeTime(props.defaultRelativeTime);

        if (props.queryRangeRestrictionInHour) computeRelativePeriod();
        // displayValue.value = getDisplayValue();
        saveDate(props.defaultType);
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
      relativePeriod.value = period;
      relativeValue.value = value;
      if (props.autoApply) saveDate("relative");
    };

    const onCustomPeriodSelect = () => {
      if (
        selectedType.value == "relative" &&
        props.queryRangeRestrictionInHour > 0 &&
        relativeValue.value >
          relativePeriodsMaxValue.value[relativePeriod.value]
      ) {
        relativeValue.value =
          relativePeriodsMaxValue.value[relativePeriod.value] > -1
            ? relativePeriodsMaxValue.value[relativePeriod.value]
            : 15;
      }

      // relativeValue can hold a string at runtime (text input); parseInt coerces
      relativeValue.value = parseInt(relativeValue.value as unknown as string);

      if (props.autoApply) saveDate("relative-custom");
    };

    const setRelativeTime = (period: string) => {
      const periodString = period?.match(/(\d+)([smhdwM])/);

      if (periodString) {
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
      // Convert microseconds to milliseconds and create a new Date object
      var date = toZonedTime(unixTimeMicros / 1000, store.state.timezone);

      // Extract hour, minute, day, month, and year
      const hours = ("0" + date.getHours()).slice(-2); // pad with leading zero if needed
      const minutes = ("0" + date.getMinutes()).slice(-2); // pad with leading zero if needed
      const seconds = ("0" + date.getSeconds()).slice(-2); // pad with leading zero if needed

      // Build formatted strings
      var dateString = new Date(date).toLocaleDateString("en-ZA");
      var timeString = hours + ":" + minutes + ":" + seconds;

      // Return both strings
      return { date: dateString, time: timeString };
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

    const setCustomDate = (
      dateType: string,
      dateobj: { start: number; end: number },
    ) => {
      // Parent-invoked setter (e.g. metrics-brush time range) — programmatic.
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

    const onBeforeShow = () => {
      // if (props.modelValue) selectedDate.value = cloneDeep(props.modelValue);
    };

    const onBeforeHide = () => {
      if (selectedType.value === "absolute")
        resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    const getPeriodLabel = computed(() => {
      const periodMapping: Record<string, string> = {
        s: "Seconds",
        m: "Minutes",
        h: "Hours",
        d: "Days",
        w: "Weeks",
        M: "Months",
      };
      return periodMapping[relativePeriod.value];
    });

    function isValidDateTimeString(dateStr: string, timeStr: string): boolean {
      return !isNaN(Date.parse(`${dateStr} ${timeStr}`));
    }

    const getConsumableDateTime = (): ConsumableDateTime => {
      if (selectedType.value == "relative") {
        let period = getPeriodLabel.value.toLowerCase();
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

        const startTimeStamp = subtractRelativeTime(
          endTimeStamp,
          subtractObject,
        );

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

        const startDateStr =
          selectedDate.value.from + " " + selectedTime.value.startTime;
        if (
          !isValidDateTimeString(
            selectedDate.value.from,
            selectedTime.value.startTime,
          )
        ) {
          // console.warn(`Invalid start date/time: ${startDateStr}`);
          // return new Date();
        }

        const endDateStr =
          selectedDate.value.to + " " + selectedTime.value.endTime;
        if (
          !isValidDateTimeString(
            selectedDate.value.to,
            selectedTime.value.endTime,
          )
        ) {
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

        if (
          start.toString() === "Invalid Date" &&
          end.toString() === "Invalid Date"
        ) {
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
      let startTime =
        selectedDate.value.from + " " + selectedTime.value.startTime;
      let endTime = selectedDate.value.to + " " + selectedTime.value.endTime;
      const startUTC = convertToUtcTimestamp(startTime, store.state.timezone);
      const endUTC = convertToUtcTimestamp(endTime, store.state.timezone);
      return { startUTC, endUTC };
    };

    const setSavedDate = (dateobj: any) => {
      timezone.value = store.state.timezone;
      selectedType.value = dateobj.type;

      if (dateobj.type === "relative") {
        setRelativeTime(dateobj.relativeTimePeriod);
        selectedType.value = "relative";
      } else {
        if (
          Object.prototype.hasOwnProperty.call(dateobj, "selectedDate") &&
          Object.prototype.hasOwnProperty.call(dateobj, "selectedTime") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "from") &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedDate, "to") &&
          Object.prototype.hasOwnProperty.call(
            dateobj.selectedTime,
            "startTime",
          ) &&
          Object.prototype.hasOwnProperty.call(dateobj.selectedTime, "endTime")
        ) {
          selectedDate.value = dateobj.selectedDate;
          selectedTime.value = dateobj.selectedTime;
        } else {
          setCustomDate(dateobj.type, {
            start: dateobj.startTime / 1000,
            end: dateobj.endTime / 1000,
          });
        }
      }

      markApplied();
    };

    /**
     * What the trigger button renders.
     *
     * With `autoApply` the pending selection IS the applied one, so show it live.
     * Without it, show the range that is in force; see `appliedDisplayValue`.
     * The `||` fallback covers the first paint, before the mount-time apply.
     */
    const triggerLabel = computed(() =>
      props.autoApply
        ? getDisplayValue.value
        : appliedDisplayValue.value || getDisplayValue.value,
    );

    const getDisplayValue = computed(() => {
      if (!props.disableRelative && selectedType.value === "relative") {
        return `Past ${relativeValue.value} ${getPeriodLabel.value}`;
      } else {
        if (selectedDate.value != null) {
          // Here as if multiple dates is selected we get object with from and to keys
          // If single date is selected we get string with date value
          // So have added check for from and to
          if (
            selectedDate.value?.from &&
            selectedDate.value?.to &&
            !props.disableRelative
          ) {
            return `${selectedDate.value.from} ${selectedTime.value.startTime} - ${selectedDate.value.to} ${selectedTime.value.endTime}`;
          } else if (
            selectedDate.value?.from &&
            selectedDate.value?.to &&
            props.disableRelative
          ) {
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
      copyToClipboard(payload, { successMessage: t("common.dateRangeCopied") });
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
      setAbsoluteTime(startMicros, endMicros);
      if (props.autoApply) saveDate(null);
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
      const isCloserToStart =
        Math.abs(micros - baseStart) <= Math.abs(micros - baseEnd);
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

    const pasteRange = async () => {
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        toast({ variant: "error", message: t("common.dateRangePasteError") });
        return;
      }
      if (applyPastedText(text)) {
        toast({ variant: "success", message: t("common.dateRangePasted") });
      } else {
        toast({ variant: "error", message: t("common.dateRangePasteError") });
      }
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
        filteredOptions = options.filter((column: any) =>
          column.toLowerCase().includes(value),
        );
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

    const setDateType = (type: string) => {
      selectedType.value = type;
      // displayValue.value = getDisplayValue();
      if (props.autoApply)
        saveDate(type === "absolute" ? "absolute" : "relative-custom");
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

      const tab = target.closest(
        "[data-test='date-time-relative-tab'], [data-test='date-time-absolute-tab']",
      );
      if (tab) {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          const next = event.key === "ArrowRight" ? "absolute" : "relative";
          setDateType(next);
          panel
            .querySelector<HTMLElement>(`[data-test='date-time-${next}-tab']`)
            ?.focus();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          panel
            .querySelector<HTMLElement>(
              ".date-time-table [data-test$='-btn']:not([disabled])",
            )
            ?.focus();
        }
        return;
      }

      const cell = target.closest<HTMLButtonElement>(
        "[data-test^='date-time-relative-'][data-test$='-btn']",
      );
      if (!cell) return;
      const rows = Array.from(
        panel.querySelectorAll(".date-time-table .relative-row"),
      )
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
              relativePeriodsMaxValue.value[period.value] =
                props.queryRangeRestrictionInHour;
            } else if (period.value == "h") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (period.value == "d" && props.queryRangeRestrictionInHour > 24) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / 24) || 31;
            } else if (period.value == "d") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (
              period.value == "w" &&
              props.queryRangeRestrictionInHour > 24 * 7
            ) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / (24 * 7)) || 100;
            } else if (period.value == "w") {
              relativePeriodsMaxValue.value[period.value] = -1;
            }

            if (
              period.value == "M" &&
              props.queryRangeRestrictionInHour > 24 * 30
            ) {
              relativePeriodsMaxValue.value[period.value] =
                Math.round(props.queryRangeRestrictionInHour / (24 * 30)) ||
                100;
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

        if (props.queryRangeRestrictionInHour > 0) {
          const maxRelativeValue =
            relativePeriodsMaxValue.value[relativePeriod.value];

          try {
            if (
              maxRelativeValue !== -1 &&
              relativeValue.value > maxRelativeValue
            ) {
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

    // Lets the "Start time" field's am/pm selection advance focus into
    // "End time"'s hour dropdown, so the whole start→end flow is one
    // continuous guided sequence.
    const endTimeRef = ref<InstanceType<typeof OTime> | null>(null);

    const menuOpen = ref(false);
    const onMenuOpenChange = (open: boolean) => {
      if (open) {
        onBeforeShow();
        onShow();
      } else {
        onBeforeHide();
        onHide();
      }
    };

    return {
      t,
      menuOpen,
      endTimeRef,
      onMenuOpenChange,
      datetimeBtn,
      getImageURL,
      onCustomPeriodSelect,
      setRelativeDate,
      relativePeriods,
      relativeDates,
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

