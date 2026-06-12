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
  <div icon="info" class="tw:justify-between date-time-container">
    <ODropdown
      v-model:open="menuOpen"
      side="bottom"
      :align="menuAlign"
      @update:open="onMenuOpenChange"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          :variant="variant"
          class="date-time-button"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
          }"
          :disabled="disable"
          icon-left="schedule"
        >
          <span class="date-time-label">{{ getDisplayValue }}</span>
          <template #icon-right
            ><OIcon name="arrow-drop-down" size="sm" class="date-time-arrow"
          /></template>
        </OButton>
      </template>
      <div id="date-time-menu" class="date-time-dialog">
        <div v-if="!disableRelative" class="tw:flex tw:justify-evenly tw:py-2">
          <OButton
            data-test="date-time-relative-tab"
            class="tab-button"
            :variant="selectedType === 'relative' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('relative')"
          >
            {{ t("common.relative") }}
          </OButton>
          <OSeparator vertical class="tw:my-2" />
          <OButton
            data-test="date-time-absolute-tab"
            class="tab-button"
            :variant="selectedType === 'absolute' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('absolute')"
          >
            {{ t("common.absolute") }}
          </OButton>
        </div>
        <OSeparator />
        <div class="date-time-tab-panels-wrapper">
        <OTabPanels v-model="selectedType" animated>
          <OTabPanel v-if="!disableRelative" name="relative" class="tw:p-0">
            <div class="date-time-table tw:relative tw:flex tw:flex-col">
              <div
                class="relative-row tw:pl-3 tw:py-2"
                v-for="(period, index) in relativePeriods"
                :key="'date_' + index"
              >
                <div class="relative-period-name">
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
                    :class="
                      selectedType == 'relative' &&
                      relativePeriod == period.value &&
                      relativeValue == item
                        ? 'rp-selector-selected'
                        : `rp-selector ${relativePeriod}`
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

              <div class="relative-row tw:px-3 tw:py-2">
                <div class="relative-period-name">{{ t("common.custom") }}</div>
                <OTooltip
                  side="right"
                  align="center"
                  max-width="300px"
                  v-if="queryRangeRestrictionInHour > 0"
                  :content="queryRangeRestrictionMsg"
                />

                <div class="tw:flex tw:gap-2 tw:flex-1 tw:min-w-0">
                  <div class="tw:flex tw:flex-col tw:w-20">
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
                  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
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
            <div class="date-time-table">
              <OTooltip
                side="right"
                align="center"
                max-width="300px"
                v-if="queryRangeRestrictionInHour > 0"
                :content="queryRangeRestrictionMsg"
              />
              <div class="tw:flex tw:justify-center tw:px-3 tw:py-2">
                <ODateRangeCalendar
                  :start-date="selectedDate.from"
                  :end-date="selectedDate.to"
                  :min-date="calendarMinDate"
                  :max-date="calendarMaxDate"
                  @update:start-date="selectedDate.from = $event"
                  @update:end-date="selectedDate.to = $event"
                />
              </div>
              <div class="notePara">{{ t("common.datetimeMessage") }}</div>
              <OSeparator v-if="!disableRelative" class="tw:my-2" />

              <table v-if="!hideRelativeTime" class="tw:px-3 startEndTime">
                <tbody>
                  <tr>
                    <td class="label tw:px-2">Start time</td>
                    <td class="label tw:px-2">End time</td>
                  </tr>
                  <tr>
                    <td class="tw:pr-1.5">
                      <OTime
                        class="tw:w-full"
                        v-model="selectedTime.startTime"
                        with-seconds
                        data-test="datetime-start-time"
                        @blur="
                          resetTime(
                            selectedTime.startTime,
                            selectedTime.endTime,
                          )
                        "
                      />
                    </td>
                    <td class="tw:pl-1.5">
                      <OTime
                        class="tw:w-full"
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
        <div v-if="!hideRelativeTimezone" class="tw:pr-3">
          <OSelect
            data-test="datetime-timezone-select"
            v-model="timezone"
            :options="timezoneSelectOptions"
            searchable
            :label="t('logStream.timezone')"
            @update:model-value="onTimezoneChange"
            @open="isTimezoneSelectOpen = true"
            @close="isTimezoneSelectOpen = false"
            class="timezone-select"
          />
        </div>
        <div v-if="!autoApply" class="tw:flex tw:justify-end tw:py-2 tw:px-3">
          <OButton
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
    </ODropdown>
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
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
// @ts-nocheck
import {
  ref,
  defineComponent,
  computed,
  onMounted,
  watch,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onBeforeMount,
} from "vue";
import {
  getImageURL,
  useLocalTimezone,
  convertToUtcTimestamp,
  timestampToTimezoneDate,
} from "../utils/zincutils";
import { subtractRelativeTime } from "@/utils/date";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { toZonedTime } from "date-fns-tz";

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
    ODropdown,
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
      type: String,
      default: "end",
    },
    variant: {
      type: String,
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
    const router = useRouter();

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

    const relativeDates = {
      s: [1, 5, 10, 15, 30, 45],
      m: [1, 5, 10, 15, 30, 45],
      h: [1, 2, 3, 6, 8, 12],
      d: [1, 2, 3, 4, 5, 6],
      w: [1, 2, 3, 4, 5, 6],
      M: [1, 2, 3, 4, 5, 6],
    };

    const relativeDatesInHour = {
      s: [1, 1, 1, 1, 1, 1],
      m: [1, 1, 1, 1, 1, 1],
      h: [1, 2, 3, 6, 8, 12],
      d: [24, 48, 72, 96, 120, 144],
      w: [168, 336, 504, 672, 840, 1008],
      M: [744, 1488, 2232, 2976, 3720, 4464],
    };

    let relativePeriodsMaxValue: object = ref({
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

    const setRelativeDate = (period, value) => {
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

      relativeValue.value = parseInt(relativeValue.value);

      if (props.autoApply) saveDate("relative-custom");
    };

    const setRelativeTime = (period) => {
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

    const resetTime = (startTime, endTime) => {
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

    const setAbsoluteTime = (startTime, endTime) => {
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

    function convertUnixTime(unixTimeMicros) {
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

    const saveDate = (dateType) => {
      // displayValue.value = getDisplayValue();
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

    function formatDate(d) {
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

    const setCustomDate = (dateType, dateobj) => {
      // Parent-invoked setter (e.g. metrics-brush time range) — programmatic.
      markProgrammaticDateChange();
      var start_date = new Date(Math.floor(dateobj.start));
      const startObj = formatDate(start_date);

      var end_date = new Date(Math.floor(dateobj.end));
      const endObj = formatDate(end_date);

      selectedDate.value.from = startObj.date;
      selectedDate.value.to = endObj.date;
      selectedTime.value.startTime = startObj.time;
      selectedTime.value.endTime = endObj.time;

      selectedType.value = dateType;
    };

    const onBeforeShow = () => {
      // if (props.modelValue) selectedDate.value = cloneDeep(props.modelValue);
    };

    const onBeforeHide = () => {
      if (selectedType.value === "absolute")
        resetTime(selectedTime.value.startTime, selectedTime.value.endTime);
    };

    const getPeriodLabel = computed(() => {
      const periodMapping = {
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

    const getConsumableDateTime = () => {
      if (selectedType.value == "relative") {
        let period = getPeriodLabel.value.toLowerCase();
        let periodValue = relativeValue.value;

        // quasar does not support arithmetic on weeks. convert to days.
        if (relativePeriod.value === "w") {
          period = "days";
          periodValue = periodValue * 7;
        }

        const subtractObject = {};

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
          dateobj.hasOwnProperty("selectedDate") &&
          dateobj.hasOwnProperty("selectedTime") &&
          dateobj.selectedDate.hasOwnProperty("from") &&
          dateobj.selectedDate.hasOwnProperty("to") &&
          dateobj.selectedTime.hasOwnProperty("startTime") &&
          dateobj.selectedTime.hasOwnProperty("endTime")
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

      // displayValue.value = getDisplayValue();
    };

    const getDisplayValue = computed(() => {
      if (props.disableRelative) {
        selectedType.value = "absolute";
      }
      if (selectedType.value === "relative") {
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

    const timezoneFilterFn = (val, update) => {
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

    const optionsFn = (date) => {
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

    const setDateType = (type) => {
      selectedType.value = type;
      // displayValue.value = getDisplayValue();
      if (props.autoApply)
        saveDate(type === "absolute" ? "absolute" : "relative-custom");
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

<style lang="scss" scoped>
.date-time-container {
  .date-time-button {
    &.relativetype {
    }
    &.absolutetype {
      min-width: 286px;
    }
    &.hideRelative {
      width: fit-content;
    }
  }
}
</style>
<style lang="scss">
.q-btn--rectangle {
  border-radius: 0.375rem;
}
.date-time-button {
  height: 30px;
  min-height: 30px;
  border-radius: 0.375rem;
  padding: 0px 5px;
  font-size: 12px;
  min-width: auto;
  justify-content: flex-start !important;

  .date-time-label {
    font-weight: 600;
    flex: 1;
    text-align: left;
  }

  .date-time-arrow {
    transition: transform 0.25s ease;
    margin-left: auto;
    font-size: 18px !important;
  }
  &.isOpen .date-time-arrow {
    transform: rotate(180deg);
  }

  &:hover {
    background: var(--o2-hover-accent) !important;
  }
}

.date-time-tab-panels-wrapper {
  overflow-y: visible;
}

.date-time-dialog {
  width: 325px;
  z-index: 10001;
  max-height: var(--reka-popper-available-height, 600px);
  overflow-y: auto;

  .tab-button {
    &.q-btn {
      padding-bottom: 0.1rem;
      padding-top: 0.1rem;
      font-size: 0.75rem;
      font-weight: 700;

      &.text-primary {
        .q-btn__content {
        }
      }
    }
  }
}

.date-time-table {
  display: flex;
  flex-direction: column;

  .relative-row {
    display: flex;
    align-items: center;
    border-bottom: 1px solid $border-color;

    .block {
      font-weight: 700;
    }
    .q-field {
      &__control {
        height: 40px;
      }
      &__native {
        font-size: 0.875rem;
        font-weight: 600;
      }
      .q-select__dropdown-icon {
      }
    }

    > * {
      margin-right: 6px;
    }
  }
}

.absolute-calendar {
  box-shadow: none;
  .q-date__header {
    display: none;
  }
  .q-date__view {
    padding: 0;
  }
}

.relative-period-name {
  font-size: 0.875rem;
  font-weight: 600;
  min-width: 75px;
}

.rp-selector,
.rp-selector-selected {
  height: 32px;
  width: 32px;
  // border: $secondary;
  background: rgba(0, 0, 0, 0.07);
  font-weight: 700;

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
}

.rp-selector-selected {
  color: #ffffff;
  background: var(--o2-primary-btn-bg);
}

.tab-button {
  width: 154px;
}

.notePara {
  padding-right: 1.5rem;
  padding-left: 1.5rem;
  font-size: 0.625rem;
}
.q-date {
  &__navigation {
    justify-content: center;
    padding: 0 0.5rem;

    .q-date__arrow {
      & + .q-date__arrow {
        margin-left: auto;
      }
      & + .col {
        flex: initial;
      }
    }

    .q-btn .block {
      font-size: 0.75rem;
      font-weight: 700;
    }
  }
  &__calendar {
    &-item .block {
      font-weight: 700;
    }
    &-weekdays > div {
      font-size: 0.875rem;
      font-weight: 700;
      opacity: 1;
    }
  }
  &__range {
    &,
    &-from,
    &-to {
      .block {
        color: white;
      }
      &:before {
        bottom: 3px;
        top: 3px;
      }
    }
    .block {
      color: $dark-page;
    }
  }
}
.startEndTime {
  width: calc(100% - 0.8rem);
  margin: 0.5rem 0.4rem 0.3rem 0.4rem;
  td {
    width: 50%;
  }
  .q-field__control-container {
    min-height: 32px;
    height: 32px;
  }
  .label {
    font-size: 0.75rem;
    // color: $dark-page;
    font-weight: 600;
  }
  .timeInput {
    .q-field__control {
      padding-right: 0.375rem;
    }

    .q-btn-group {
      & > .q-btn-item {
        border-radius: 2px;
      }

      .q-btn {
        padding: 0 0.3125rem;

        .block {
          font-size: 0.625rem;
          font-weight: 700;
        }
      }
    }
  }
}
.drawer-footer {
  .q-btn {
    font-size: 0.75rem;
    font-weight: 700;

    &.clearBtn {
      margin-right: 1rem;
      color: $dark-page;
    }
  }
}
.timezone-select {
  margin: 0.5rem 0.4rem 0.5rem 0.4rem;
}
</style>
