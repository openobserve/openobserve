<!-- Copyright 2022 Zinc Labs Inc. and Contributors

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<template>
  <div icon="info" class="justify-between date-time-container">
    <q-btn
      data-test="date-time-btn"
      id="date-time-button"
      ref="datetimeBtn"
      data-cy="date-time-button"
      outline
      no-caps
      :label="displayValue"
      icon="schedule"
      icon-right="arrow_drop_down"
      class="date-time-button"
      :class="selectedType + 'type'"
    >
      <q-menu
        id="date-time-menu"
        class="date-time-dialog"
        anchor="bottom left"
        self="top left"
        @before-show="onBeforeShow"
      >
        <div class="flex justify-evenly q-py-sm">
          <q-btn
            size="md"
            class="tab-button no-border"
            color="primary"
            no-caps
            :flat="selectedType !== 'relative'"
            @click="selectedType = 'relative'"
          >
            Relative
          </q-btn>
          <q-separator vertical inset />
          <q-btn
            size="md"
            class="tab-button no-border"
            color="primary"
            no-caps
            :flat="selectedType !== 'absolute'"
            @click="selectedType = 'absolute'"
          >
            Absolute
          </q-btn>
        </div>
        <q-separator />
        <q-tab-panels v-model="selectedType" animated>
          <q-tab-panel name="relative" class="q-pa-none">
            <div class="date-time-table relative column">
              <div
                class="relative-row q-px-md q-py-sm"
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
                  <q-btn
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    :class="
                      selectedType == 'relative' &&
                      relativePeriod == period.value &&
                      relativeValue == item
                        ? 'rp-selector-selected'
                        : `rp-selector ${relativePeriod}`
                    "
                    :label="item"
                    outline
                    dense
                    flat
                    @click="setRelativeDate(period.value, item)"
                    :key="'period_' + item_index"
                  />
                </div>
              </div>

              <div class="relative-row q-px-md q-py-sm">
                <div class="relative-period-name">Custom</div>

                <div class="row q-gutter-sm">
                  <div class="col">
                    <q-input
                      v-model="relativeValue"
                      type="number"
                      dense
                      filled
                      min="1"
                      @update:model-value="onCustomPeriodSelect"
                    />
                  </div>
                  <div class="col">
                    <q-select
                      v-model="relativePeriod"
                      :options="relativePeriods"
                      dense
                      filled
                      emit-value
                      @update:modelValue="onCustomPeriodSelect"
                    >
                      <template v-slot:selected-item>
                        <div>{{ getPeriodLabel }}</div>
                      </template>
                    </q-select>
                  </div>
                </div>
              </div>
            </div>
          </q-tab-panel>
          <q-tab-panel name="absolute" class="q-pa-none">
            <div class="date-time-table">
              <div class="flex justify-center q-pa-none">
                <q-date
                  size="sm"
                  v-model="selectedDate"
                  class="absolute-calendar"
                  range
                  :locale="dateLocale"
                />
              </div>
              <div class="notePara">* You can choose multiple date</div>
              <q-separator class="q-my-sm" />

              <table class="q-px-md startEndTime">
                <tr>
                  <td class="label">Start time</td>
                  <td class="label">End time</td>
                </tr>
                <tr>
                  <td>
                    <q-input
                      v-model="selectedTime.startTime"
                      dense
                      filled
                      mask="time"
                      :rules="['time']"
                    >
                      <template #append>
                        <q-icon name="access_time" class="cursor-pointer">
                          <q-popup-proxy
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-time v-model="selectedTime.startTime">
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup
                                  label="Close"
                                  color="primary"
                                  flat
                                />
                              </div>
                            </q-time>
                          </q-popup-proxy>
                        </q-icon>
                      </template>
                    </q-input>
                  </td>
                  <td>
                    <q-input
                      v-model="selectedTime.endTime"
                      dense
                      filled
                      mask="time"
                      :rules="['time']"
                    >
                      <template #append>
                        <q-icon name="access_time" class="cursor-pointer">
                          <q-popup-proxy
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-time v-model="selectedTime.endTime">
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup
                                  label="Close"
                                  color="primary"
                                  flat
                                />
                              </div>
                            </q-time>
                          </q-popup-proxy>
                        </q-icon>
                      </template>
                    </q-input>
                  </td>
                </tr>
              </table>
            </div>
          </q-tab-panel>
        </q-tab-panels>
        <div v-if="!autoApply" class="flex justify-end q-py-sm q-px-md">
          <q-separator class="q-my-sm" />
          <q-btn
            class="no-border q-py-xs"
            color="secondary"
            no-caps
            size="md"
            @click="saveDate(null)"
            v-close-popup
          >
            Apply
          </q-btn>
        </div>
      </q-menu>
    </q-btn>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  ref,
  defineComponent,
  computed,
  onMounted,
  onBeforeMount,
  watch,
} from "vue";
import { getImageURL } from "../utils/zincutils";
import { date } from "quasar";

export default defineComponent({
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
  },

  emits: ["on:date-change"],

  setup(props, { emit }) {
    const selectedType = ref("relative");
    const selectedTime = ref({
      startTime: "00:00",
      endTime: "23:59",
    });
    const selectedDate = ref({
      from: "",
      to: "",
    });
    const relativePeriod = ref("m");
    const relativeValue = ref(15);

    const relativePeriods = [
      { label: "Minutes", value: "m" },
      { label: "Hours", value: "h" },
      { label: "Days", value: "d" },
      { label: "Weeks", value: "w" },
      { label: "Months", value: "M" },
    ];
    const relativeDates = {
      m: [1, 5, 10, 15, 30, 45],
      h: [1, 2, 3, 6, 8, 12],
      d: [1, 2, 3, 4, 5, 6],
      w: [1, 2, 3, 4, 5, 6],
      M: [1, 2, 3, 4, 5, 6],
    };

    const datetimeBtn = ref(null);

    const displayValue = ref("");

    const dateLocale = {
      daysShort: ["S", "M", "T", "W", "T", "F", "S"],
    };

    onMounted(() => {
      // updateDisplayValue();
      try {
        selectedType.value = props.defaultType;
        setAbsoluteTime(
          props.defaultAbsoluteTime?.startTime,
          props.defaultAbsoluteTime?.endTime
        );
        setRelativeTime(props.defaultRelativeTime);
        displayValue.value = getDisplayValue();
        if (props.autoApply) saveDate(props.defaultType);
      } catch (e) {
        console.log(e);
      }
    });

    watch(
      () => selectedType.value,
      (value) => {
        displayValue.value = getDisplayValue();
        if (props.autoApply)
          saveDate(value === "absolute" ? "absolute" : "relative-custom");
      }
    );

    watch(
      () => {
        selectedTime.value.startTime;
        selectedTime.value.endTime;
        selectedDate.value.from;
        selectedDate.value.to;
      },
      () => {
        if (props.autoApply) saveDate("absolute");
      },
      { deep: true }
    );

    const setRelativeDate = (period, value) => {
      selectedType.value = "relative";
      relativePeriod.value = period;
      relativeValue.value = value;
      if (props.autoApply) saveDate("relative");
    };

    const onCustomPeriodSelect = () => {
      if (props.autoApply) saveDate("relative-custom");
    };

    const setRelativeTime = (period) => {
      const periodString = period?.match(/(\d+)([mhdwM])/);

      if (periodString) {
        const periodValue = periodString[1];
        const periodUnit = periodString[2];

        const periodUnits = ["m", "h", "d", "w", "M"];

        if (periodUnits.includes(periodUnit)) {
          relativePeriod.value = periodUnit;
        }

        if (periodValue) {
          relativeValue.value = parseInt(periodValue);
        }
      }
    };

    const setAbsoluteTime = (startTime, endTime) => {
      if (!startTime || !endTime) {
        var dateString = new Date().toLocaleDateString("en-ZA");
        selectedDate.value.from = dateString;
        selectedDate.value.to = dateString;
        selectedTime.value.startTime = "00:00";
        selectedTime.value.endTime = "23:59";
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
      var date = new Date(unixTimeMicros / 1000);

      // Extract hour, minute, day, month, and year
      const hours = ("0" + date.getHours()).slice(-2); // pad with leading zero if needed
      const minutes = ("0" + date.getMinutes()).slice(-2); // pad with leading zero if needed

      // Build formatted strings
      var dateString = new Date(date).toLocaleDateString("en-ZA");
      var timeString = hours + ":" + minutes;

      // Return both strings
      return { date: dateString, time: timeString };
    }

    const refresh = () => {
      saveDate();
    };

    const saveDate = (dateType) => {
      displayValue.value = getDisplayValue();
      const date = getConsumableDateTime();
      date["valueType"] = dateType || selectedType.value;
      emit("on:date-change", date);
    };

    const onBeforeShow = () => {
      // if (props.modelValue) selectedDate.value = cloneDeep(props.modelValue);
    };

    const getPeriodLabel = computed(() => {
      const periodMapping = {
        m: "Minutes",
        h: "Hours",
        d: "Days",
        w: "Weeks",
        M: "Months",
      };
      return periodMapping[relativePeriod.value];
    });

    const getConsumableDateTime = () => {
      if (selectedType.value == "relative") {
        let period = getPeriodLabel.value.toLowerCase();
        let periodValue = relativeValue.value;

        // quasar does not support arithmetic on weeks. convert to days.
        if (relativePeriod.value == "w") {
          period = "days";
          periodValue = periodValue * 7;
        }
        const subtractObject = '{"' + period + '":' + periodValue + "}";

        const endTimeStamp = new Date();

        const startTimeStamp = date.subtractFromDate(
          endTimeStamp,
          JSON.parse(subtractObject)
        );

        return {
          startTime: new Date(startTimeStamp).getTime() * 1000,
          endTime: new Date(endTimeStamp).getTime() * 1000,
          relativeTimePeriod: relativeValue.value + relativePeriod.value,
        };
      } else {
        let start, end;
        if (!selectedDate.value.from && !selectedTime.value.startTime) {
          start = new Date();
        } else {
          start = new Date(
            selectedDate.value.from + " " + selectedTime.value.startTime
          );
        }

        if (selectedDate.value.to == "" && selectedTime.value.endTime == "") {
          end = new Date();
        } else {
          end = new Date(
            selectedDate.value.to + " " + selectedTime.value.endTime
          );
        }
        const rVal = {
          startTime: new Date(start).getTime() * 1000,
          endTime: new Date(end).getTime() * 1000,
          relativeTimePeriod: null,
        };
        return rVal;
      }
    };

    const getDisplayValue = () => {
      if (selectedType.value === "relative") {
        return `Past ${relativeValue.value} ${getPeriodLabel.value}`;
      } else {
        if (selectedDate.value != null) {
          return `${selectedDate.value.from} ${selectedTime.value.startTime} - ${selectedDate.value.to} ${selectedTime.value.endTime}`;
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          return `${todayDate} ${selectedTime.value.startTime} - ${todayDate} ${selectedTime.value.endTime}`;
        }
      }
    };

    return {
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
    };
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
  }
}
</style>
<style lang="scss">
.q-btn--rectangle {
  border-radius: 3px;
}
.date-time-button {
  border-radius: 3px;
  padding: 0px 5px;
  font-size: 12px;
  min-width: auto;
  background: rgba(89, 96, 178, 0.2) !important;

  .q-icon.on-right {
    transition: transform 0.25s ease;
  }
  &.isOpen .q-icon.on-right {
    transform: rotate(180deg);
  }

  .q-btn__content {
    justify-content: flex-start;

    .block {
      font-weight: 600;
    }
  }
}

.date-time-dialog {
  width: 341px;

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

.date-time-table.relative {
  display: flex;

  .relative-row {
    display: flex;
    flex: 1;
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
}

.rp-selector-selected {
  color: #ffffff;
  background: $primary;
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
  .q-field {
    padding-bottom: 0.125rem;
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
</style>
