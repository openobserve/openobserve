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
  <div icon="info" class="justify-between">
    <q-btn
      data-test="date-time-btn"
      id="date-time-button"
      ref="datetimeBtn"
      data-cy="date-time-button"
      outline
      no-caps
      :label="displayValue"
      :icon="'img:' + getImageURL('images/common/time_icon.png')"
      icon-right="arrow_drop_down"
      class="date-time-button"
      color="grey-9"
    >
      <q-menu
        id="date-time-menu"
        class="date-time-dialog"
        anchor="bottom left"
        self="top left"
      >
        <div class="flex justify-evenly q-py-sm">
          <q-btn
            class="tab-button no-border"
            color="primary"
            :flat="selectedDate.tab !== 'relative'"
            @click="selectedDate.tab = 'relative'"
          >
            RELATIVE
          </q-btn>
          <q-separator vertical inset />
          <q-btn
            class="tab-button no-border"
            color="primary"
            :flat="selectedDate.tab !== 'absolute'"
            @click="selectedDate.tab = 'absolute'"
          >
            ABSOLUTE
          </q-btn>
        </div>
        <q-separator />
        <q-tab-panels v-model="selectedDate.tab" animated>
          <q-tab-panel name="relative" class="q-pa-none">
            <div class="date-time-table relative column">
              <div
                class="relative-row q-px-md q-py-sm"
                v-for="(period, index) in relativePeriods"
                :key="'date_' + index"
              >
                <div class="relative-period-name">
                  {{ period.value }}
                </div>
                <div
                  v-for="(item, item_index) in relativeDates[period.value]"
                  :key="item"
                >
                  <q-btn
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    :class="
                      selectedDate.tab == 'relative' &&
                      selectedDate.relative.period.value == period.value &&
                      selectedDate.relative.value == item
                        ? 'rp-selector-selected'
                        : `rp-selector ${selectedDate.relative.period.value}`
                    "
                    :label="item"
                    outline
                    dense
                    flat
                    @click="setRelativeDate(period, item)"
                    :key="'period_' + item_index"
                  />
                </div>
              </div>

              <div class="relative-row q-px-md q-py-sm">
                <div class="relative-period-name">Custom</div>

                <div class="row q-gutter-sm">
                  <div class="col">
                    <q-input
                      v-model="selectedDate.relative.value"
                      type="number"
                      dense
                      filled
                      min="1"
                      @change="calculateMaxValue"
                    ></q-input>
                  </div>
                  <div class="col">
                    <q-select
                      v-model="selectedDate.relative.period"
                      :options="relativePeriods"
                      dense
                      filled
                      @update:modelValue="onCustomPeriodSelect"
                    ></q-select>
                  </div>
                </div>
              </div>
            </div>
          </q-tab-panel>
          <q-tab-panel name="absolute" class="q-pa-none">
            <div class="date-time-table">
              <div class="flex justify-center q-pa-none">
                <q-date
                  v-model="selectedDate.absolute.date"
                  class="absolute-calendar"
                  range
                  :locale="{
                    daysShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
                  }"
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
                      v-model="selectedDate.absolute.startTime"
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
                            <q-time v-model="selectedDate.absolute.startTime">
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
                      v-model="selectedDate.absolute.endTime"
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
                            <q-time v-model="selectedDate.absolute.endTime">
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
      </q-menu>
    </q-btn>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { ref, defineComponent } from "vue";
import { getImageURL } from "../utils/zincutils";
import { cloneDeep } from "lodash-es";

export default defineComponent({
  props: {
    defaultDate: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      relativePeriods: [
        { label: "Minutes", value: "Minutes" },
        { label: "Hours", value: "Hours" },
        { label: "Days", value: "Days" },
        { label: "Weeks", value: "Weeks" },
        { label: "Months", value: "Months" },
      ],
      relativeDates: {
        Minutes: [1, 5, 10, 15, 30, 45],
        Hours: [1, 2, 3, 6, 8, 12],
        Days: [1, 2, 3, 4, 5, 6],
        Weeks: [1, 2, 3, 4, 5, 6],
        Months: [1, 2, 3, 4, 5, 6],
      },
      selectedDate: {
        tab: "relative",
        relative: {
          period: { label: "Minutes", value: "Minutes" },
          value: 15,
        },
        absolute: {
          date: {
            from: new Date().toLocaleDateString("en-ZA"),
            to: new Date().toLocaleDateString("en-ZA"),
          },
          startTime: "00:00",
          endTime: "23:59",
        },
        userChangedValue: false,
      },
    };
  },
  methods: {
    setRelativeDate(period, value) {
      this.selectedDate.tab = "relative";
      this.selectedDate.relative.period = period;
      this.selectedDate.relative.value = value;
      this.$refs.datetimeBtn.$el.click();
    },
    onCustomPeriodSelect() {
      this.selectedDate.relative.value = 1;
    },
  },
  emits: ["date-change"],
  setup() {
    const getDate = () => {
      return this.selectedDate;
    };

    const setDate = (date: Object) => {
      this.selectedDate = date;
    };

    const datetimeBtn = ref();

    return { getDate, setDate, datetimeBtn, getImageURL };
  },
  beforeMount() {
    if (this.defaultDate) this.selectedDate = cloneDeep(this.defaultDate);
  },
  computed: {
    displayValue() {
      if (this.selectedDate.tab === "relative") {
        this.$emit("date-change", this.selectedDate);
        return `${this.selectedDate.relative.value} ${this.selectedDate.relative.period.label}`;
      } else {
        if (this.selectedDate.absolute.date != null) {
          if (typeof this.selectedDate.absolute.date != "object") {
            if (this.selectedDate.absolute.date != "") {
              this.selectedDate.absolute.date = {
                from: this.selectedDate.absolute.date,
                to: this.selectedDate.absolute.date,
              };
            } else {
              const todayDate = new Date().toLocaleDateString("en-ZA");
              this.selectedDate.absolute.date = {
                from: todayDate,
                to: todayDate,
              };
            }
          }

          this.$emit("date-change", this.selectedDate);
          return `${this.selectedDate.absolute.date.from} ${this.selectedDate.absolute.startTime} - ${this.selectedDate.absolute.date.to} ${this.selectedDate.absolute.endTime}`;
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          this.selectedDate.absolute.date = {
            from: todayDate,
            to: todayDate,
          };

          this.$emit("date-change", this.selectedDate);
          return `${todayDate} ${this.selectedDate.absolute.startTime} - ${todayDate} ${this.selectedDate.absolute.endTime}`;
        }
      }
    },
    calculateMaxValue() {
      if (
        this.selectedDate.relative.period.value == "Minutes" &&
        this.selectedDate.relative.value > 60
      ) {
        this.selectedDate.relative.value = 60;
        return false;
      } else if (
        this.selectedDate.relative.period.value == "Hours" &&
        this.selectedDate.relative.value > 24
      ) {
        this.selectedDate.relative.value = 24;
        return false;
      } else if (
        this.selectedDate.relative.period.value == "Days" &&
        this.selectedDate.relative.value > 31
      ) {
        this.selectedDate.relative.value = 31;
        return false;
      } else if (
        this.selectedDate.relative.period.value == "Weeks" &&
        this.selectedDate.relative.value > 6
      ) {
        this.selectedDate.relative.value = 6;
        return false;
      } else if (
        this.selectedDate.relative.period.value == "Months" &&
        this.selectedDate.relative.value > 6
      ) {
        this.selectedDate.relative.value = 6;
        return false;
      }
      return false;
    },
  },
});
</script>

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

      &::before {
        content: "Past ";
      }
    }
  }
}

.date-time-dialog {
  width: 341px;

  .tab-button {
    &.q-btn {
      padding-bottom: 0.6rem;
      padding-top: 0.6rem;
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
  background: $input-bg;
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
    color: $dark-page;
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
