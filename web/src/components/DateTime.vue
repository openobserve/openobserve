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
    <OPopover
      v-model:open="menuOpen"
      side="bottom"
      :align="menuAlign"
      :z-index="10001"
      content-class="tw:p-1"
      @update:open="onMenuOpenChange"
    >
      <template #trigger>
        <OButton
          :data-test="dataTestName"
          as="div"
          id="date-time-button"
          ref="datetimeBtn"
          data-cy="date-time-button"
          role="combobox"
          :aria-expanded="menuOpen"
          :aria-disabled="disable || undefined"
          :tabindex="disable ? -1 : 0"
          :variant="variant"
          size="sm-toolbar"
          :class="{
            [selectedType + 'type']: !disableRelative,
            hideRelative: disableRelative,
            'tw:min-w-[330px]': !disableRelative && selectedType === 'absolute',
            'tw:w-fit': disableRelative,
            'tw:cursor-pointer tw:hover:bg-button-outline-hover-bg tw:hover:border-button-outline-hover-border':
              !disable,
            'tw:opacity-50 tw:cursor-not-allowed': disable,
          }"
          icon-left="schedule"
          @keydown="onTriggerKeydown"
        >
          <input
            v-if="isRangeEditable"
            ref="rangeInputRef"
            :data-test="`${dataTestName}-range-input`"
            :value="editingRange ?? getDisplayValue"
            spellcheck="false"
            class="date-time-label tw:font-semibold tw:flex-1 tw:text-left tw:bg-transparent tw:outline-none tw:border-0 tw:p-0 tw:min-w-0 tw:cursor-text tw:tabular-nums tw:text-datepicker-text"
            @mousedown.stop
            @click.stop
            @focus="onRangeFocus"
            @input="editingRange = ($event.target as HTMLInputElement).value"
            @keydown.enter.stop.prevent="commitRangeEdit(true)"
            @keydown.esc.stop.prevent="cancelRangeEdit"
            @blur="commitRangeEdit(false)"
          />
          <span
            v-else
            class="date-time-label tw:font-semibold tw:flex-1 tw:text-left"
            >{{ getDisplayValue }}</span
        >
          <template #icon-right
            ><OIcon name="arrow-drop-down" size="sm" class="date-time-arrow tw:transition-transform tw:duration-250 tw:ml-auto tw:text-[18px]!"
          /></template>
        </OButton>
      </template>
      <div id="date-time-menu" class="date-time-dialog tw:w-81.25 tw:z-10001 tw:max-h-(--reka-popper-available-height,600px) tw:overflow-y-auto" @keydown.capture="onPickerKeydown">
        <div v-if="!disableRelative" class="tw:flex tw:justify-evenly tw:py-2">
          <OButton
            data-test="date-time-relative-tab"
            class="tw:w-38.5"
            :variant="selectedType === 'relative' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('relative')"
          >
            {{ t("common.relative") }}
          </OButton>
          <OSeparator vertical class="tw:my-2" />
          <OButton
            data-test="date-time-absolute-tab"
            class="tw:w-38.5"
            :variant="selectedType === 'absolute' ? 'primary' : 'ghost-primary'"
            size="sm"
            @click="setDateType('absolute')"
          >
            {{ t("common.absolute") }}
          </OButton>
        </div>
        <OSeparator />
        <div class="tw:overflow-y-visible">
        <OTabPanels v-model="selectedType" animated>
          <OTabPanel v-if="!disableRelative" name="relative" class="tw:p-0">
            <div class="date-time-table tw:relative tw:flex tw:flex-col">
              <div
                class="relative-row tw:flex tw:items-center tw:border-b tw:border-(--o2-border) tw:pl-3 tw:py-2"
                v-for="(period, index) in relativePeriods"
                :key="'date_' + index"
              >
                <div class="tw:text-sm tw:font-semibold tw:min-w-18.75">
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

              <div class="relative-row tw:flex tw:items-center tw:border-b tw:border-(--o2-border) tw:px-3 tw:py-2">
                <div class="tw:text-sm tw:font-semibold tw:min-w-18.75">{{ t("common.custom") }}</div>
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
            <div class="date-time-table tw:flex tw:flex-col">
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
              <div class="tw:pr-6 tw:pl-6 tw:text-[0.625rem]">{{ t("common.datetimeMessage") }}</div>
              <OSeparator v-if="!disableRelative" class="tw:my-2" />

              <div
                v-if="!hideRelativeTime"
                class="startEndTime tw:flex tw:px-3 tw:mt-2 tw:mb-[0.3rem]"
              >
                <div class="tw:flex-1 tw:flex tw:justify-center">
                  <div class="tw:flex tw:flex-col tw:gap-1">
                    <span class="label o-input-label tw:text-xs tw:font-semibold">Start time</span>
                      <OTime
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
                  </div>
                </div>
                <div class="tw:flex-1 tw:flex tw:justify-center">
                  <div class="tw:flex tw:flex-col tw:gap-1">
                    <span class="label o-input-label tw:text-xs tw:font-semibold">End time</span>
                      <OTime
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
                  </div>
                </div>
              </div>
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
            class="tw:my-2 tw:mx-[0.4rem]"
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

    // ── Editable top time range (absolute mode) ──────────────────
    // Lets users type/paste a full range directly in the toolbar display,
    // e.g. "2026/06/30 14:30:00 - 2026/06/30 15:00:00" (also accepts "-" date
    // separators). Applies on Enter or blur; reverts silently on invalid input.
    const rangeInputRef = ref<HTMLInputElement | null>(null);
    // Holds the in-progress text while editing; null when not editing (the
    // input then mirrors getDisplayValue).
    const editingRange = ref<string | null>(null);
    const isRangeEditable = computed(
      () =>
        !props.disable &&
        !props.disableRelative &&
        selectedType.value === "absolute",
    );

    const onRangeFocus = () => {
      editingRange.value = getDisplayValue.value as string;
      nextTick(() => rangeInputRef.value?.select?.());
    };

    const cancelRangeEdit = () => {
      editingRange.value = null;
      rangeInputRef.value?.blur?.();
    };

    // Parse a single "YYYY/MM/DD HH:MM[:SS]" (or "-" separated) chunk into the
    // internal { date: 'YYYY/MM/DD', time: 'HH:MM:SS' } shape. Returns null when
    // the string is not a valid calendar date/time.
    const parseOneDateTime = (input: string) => {
      const s = input.trim();
      const m = s.match(
        /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
      );
      if (!m) return null;
      const year = +m[1];
      const month = +m[2];
      const day = +m[3];
      const hour = +m[4];
      const minute = +m[5];
      const second = m[6] ? +m[6] : 0;
      if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hour > 23 ||
        minute > 59 ||
        second > 59
      )
        return null;
      // Reject impossible dates (e.g. 2026/02/30) by round-tripping.
      const dt = new Date(year, month - 1, day, hour, minute, second);
      if (
        dt.getFullYear() !== year ||
        dt.getMonth() !== month - 1 ||
        dt.getDate() !== day
      )
        return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        date: `${year}/${pad(month)}/${pad(day)}`,
        time: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
      };
    };

    // Parse "START - END" (start/end separated by a space-dashed hyphen).
    const parseRangeString = (raw: string) => {
      if (!raw) return null;
      const parts = raw.split(/\s+-\s+/);
      if (parts.length !== 2) return null;
      const start = parseOneDateTime(parts[0]);
      const end = parseOneDateTime(parts[1]);
      if (!start || !end) return null;
      return {
        from: start.date,
        to: end.date,
        startTime: start.time,
        endTime: end.time,
      };
    };

    const commitRangeEdit = (fromEnter: boolean) => {
      // Not editing (e.g. blur without prior focus edit) — nothing to do.
      if (editingRange.value === null) return;
      const raw = editingRange.value.trim();
      const parsed = parseRangeString(raw);
      // Exit editing regardless; the input falls back to getDisplayValue.
      editingRange.value = null;
      if (!parsed) return; // invalid — revert silently to current value

      selectedType.value = "absolute";
      selectedDate.value.from = parsed.from;
      selectedDate.value.to = parsed.to;
      selectedTime.value.startTime = parsed.startTime;
      selectedTime.value.endTime = parsed.endTime;

      // autoApply consumers apply via the deep selectedDate/selectedTime watcher;
      // for manual-apply consumers, honour the "apply on Enter/blur" behaviour.
      if (!props.autoApply) saveDate("absolute");
      if (fromEnter) rangeInputRef.value?.blur?.();
    };

    const onTriggerKeydown = (e: KeyboardEvent) => {
      if (props.disable) return;
      const onInput = e.target === rangeInputRef.value;
      if (e.key === "ArrowDown") {
        menuOpen.value = true;
      } else if (!onInput && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        menuOpen.value = !menuOpen.value;
      }
    };

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
      // The trigger renders as a <div> (to host the editable range input), so a
      // native `disabled` attribute can't block interaction the way it did on a
      // <button>. Guard here: never allow the popover to open while disabled.
      if (open && props.disable) {
        menuOpen.value = false;
        return;
      }
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
      onPickerKeydown,
      getConsumableDateTime,
      relativeDatesInHour,
      setAbsoluteTime,
      setRelativeTime,
      getDisplayValue,
      rangeInputRef,
      editingRange,
      isRangeEditable,
      onRangeFocus,
      cancelRangeEdit,
      commitRangeEdit,
      onTriggerKeydown,
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

<style>
.date-time-button.isOpen .date-time-arrow {
  transform: rotate(180deg);
}

.date-time-table .relative-row > * {
  margin-right: 6px;
}
</style>
