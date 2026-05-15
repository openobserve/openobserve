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
  <OButton
    id="date-time-button"
    ref="datetimeBtn"
    data-cy="date-time-button"
    variant="outline"
    class="date-time-button"
    @click="isMobile ? (showMobilePicker = true) : undefined"
  >
    <template #icon-left><q-icon name="schedule" /></template>
    <span class="date-time-label">{{ displayValue }}</span>
    <template #icon-right
      ><q-icon name="arrow_drop_down" class="date-time-arrow"
    /></template>
    <!-- Desktop: dropdown menu -->
    <q-menu
      v-if="!isMobile"
      no-route-dismiss
      id="date-time-menu"
      class="date-time-dialog"
      anchor="bottom left"
      self="top left"
    >
      <div class="flex justify-evenly q-py-sm">
        <OButton
          class="tab-button"
          :variant="
            data.selectedDate.tab === 'relative' ? 'primary' : 'ghost-primary'
          "
          size="sm"
          @click="data.selectedDate.tab = 'relative'"
        >
          {{ t("common.datetimeRelative") }}
        </OButton>
        <q-separator vertical inset />
        <OButton
          class="tab-button"
          :variant="
            data.selectedDate.tab === 'absolute' ? 'primary' : 'ghost-primary'
          "
          size="sm"
          @click="data.selectedDate.tab = 'absolute'"
        >
          {{ t("common.datetimeAbsolute") }}
        </OButton>
      </div>
      <q-separator />
      <OTabPanels v-model="data.selectedDate.tab" animated>
        <OTabPanel name="relative">
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
                v-for="(item, item_index) in (relativeDates as any)[
                  period.value
                ]"
                :key="item"
              >
                <OButton
                  :class="
                    data.selectedDate.tab == 'relative' &&
                    data.selectedDate.relative.period.value == period.value &&
                    data.selectedDate.relative.value == item
                      ? 'rp-selector-selected'
                      : `rp-selector ${data.selectedDate.relative.period.value}`
                  "
                  variant="ghost"
                  size="xs"
                  @click="setRelativeDate(period, item)"
                  :key="'period_' + item_index"
                  >{{ item }}</OButton
                >
              </div>
            </div>

            <div class="relative-row q-px-md q-py-sm">
              <div class="relative-period-name">Custom</div>

              <div class="row q-gutter-sm">
                <div class="col">
                  <q-input
                    v-model="data.selectedDate.relative.value"
                    type="number"
                    inputmode="numeric"
                    enterkeyhint="next"
                    dense
                    filled
                    min="1"
                    @change="calculateMaxValue"
                  ></q-input>
                </div>
                <div class="col">
                  <q-select
                    v-model="data.selectedDate.relative.period"
                    :options="relativePeriods"
                    dense
                    filled
                    @update:modelValue="onCustomPeriodSelect"
                  ></q-select>
                </div>
              </div>
            </div>
          </div>
        </OTabPanel>
        <OTabPanel name="absolute">
          <div class="date-time-table">
            <div class="flex justify-center q-pa-none">
              <q-date
                v-model="data.selectedDate.absolute.date"
                class="absolute-calendar"
                range
                :locale="{
                  daysShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
                }"
              />
            </div>
            <div class="notePara">{{ t("common.datetimeMessage") }}</div>
            <q-separator class="q-my-sm" />

            <table class="q-px-md startEndTime">
              <tr>
                <td class="label">{{ t("common.startTime") }}</td>
                <td class="label">{{ t("common.endTime") }}</td>
              </tr>
              <tr>
                <td>
                  <q-input
                    v-model="data.selectedDate.absolute.startTime"
                    dense
                    filled
                    mask="time"
                    inputmode="numeric"
                    enterkeyhint="next"
                    :rules="['time']"
                  >
                    <template #append>
                      <q-icon name="access_time" class="cursor-pointer">
                        <q-popup-proxy
                          transition-show="scale"
                          transition-hide="scale"
                        >
                          <q-time
                            v-model="data.selectedDate.absolute.startTime"
                          >
                            <div class="row items-center justify-end">
                              <OButton
                                v-close-popup="true"
                                variant="ghost-primary"
                                size="xs"
                                >{{ t("common.close") }}</OButton
                              >
                            </div>
                          </q-time>
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                </td>
                <td>
                  <q-input
                    v-model="data.selectedDate.absolute.endTime"
                    dense
                    filled
                    mask="time"
                    inputmode="numeric"
                    enterkeyhint="done"
                    :rules="['time']"
                  >
                    <template #append>
                      <q-icon name="access_time" class="cursor-pointer">
                        <q-popup-proxy
                          transition-show="scale"
                          transition-hide="scale"
                        >
                          <q-time v-model="data.selectedDate.absolute.endTime">
                            <div class="row items-center justify-end">
                              <OButton
                                v-close-popup="true"
                                variant="ghost-primary"
                                size="xs"
                                >{{ t("common.close") }}</OButton
                              >
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
        </OTabPanel>
      </OTabPanels>
    </q-menu>
  </OButton>

  <!-- Mobile: bottom sheet dialog
       NOTE: Inner tab panels are duplicated from the desktop q-menu above.
       This is intentional — the q-menu and q-dialog have different wrapper
       structures that prevent sharing a single template fragment. -->
  <q-dialog
    v-if="isMobile"
    v-model="showMobilePicker"
    position="bottom"
    full-width
    transition-show="slide-up"
    transition-hide="slide-down"
    aria-label="Select date and time"
  >
    <q-card style="max-height: 80vh; border-radius: 12px 12px 0 0">
      <div class="mobile-sheet-handle" />
      <q-card-section class="q-pt-none date-time-dialog" style="width: 100%">
        <div class="flex justify-evenly q-py-sm">
          <q-btn
            class="tab-button no-border"
            color="primary"
            :flat="data.selectedDate.tab !== 'relative'"
            @click="data.selectedDate.tab = 'relative'"
          >
            {{ t("common.datetimeRelative") }}
          </q-btn>
          <q-separator vertical inset />
          <q-btn
            class="tab-button no-border"
            color="primary"
            :flat="data.selectedDate.tab !== 'absolute'"
            @click="data.selectedDate.tab = 'absolute'"
          >
            {{ t("common.datetimeAbsolute") }}
          </q-btn>
        </div>
        <q-separator />
        <q-tab-panels v-model="data.selectedDate.tab" animated>
          <q-tab-panel name="relative" class="q-pa-none">
            <div class="date-time-table relative column">
              <div
                class="relative-row q-px-md q-py-sm"
                v-for="(period, index) in relativePeriods"
                :key="'mobile_date_' + index"
              >
                <div class="relative-period-name">
                  {{ period.value }}
                </div>
                <div
                  v-for="(item, item_index) in (relativeDates as any)[period.value]"
                  :key="item"
                >
                  <q-btn
                    :class="
                      data.selectedDate.tab == 'relative' &&
                      data.selectedDate.relative.period.value == period.value &&
                      data.selectedDate.relative.value == item
                        ? 'rp-selector-selected'
                        : `rp-selector ${data.selectedDate.relative.period.value}`
                    "
                    :label="item"
                    outline
                    dense
                    flat
                    @click="
                      setRelativeDate(period, item);
                      showMobilePicker = false;
                    "
                    :key="'mobile_period_' + item_index"
                  />
                </div>
              </div>
              <div class="relative-row q-px-md q-py-sm">
                <div class="relative-period-name">Custom</div>
                <div class="row q-gutter-sm">
                  <div class="col">
                    <q-input
                      v-model="data.selectedDate.relative.value"
                      type="number"
                      inputmode="numeric"
                      enterkeyhint="next"
                      dense
                      filled
                      min="1"
                      @change="calculateMaxValue"
                    />
                  </div>
                  <div class="col">
                    <q-select
                      v-model="data.selectedDate.relative.period"
                      :options="relativePeriods"
                      dense
                      filled
                      @update:modelValue="onCustomPeriodSelect"
                    />
                  </div>
                </div>
              </div>
            </div>
          </q-tab-panel>
          <q-tab-panel name="absolute" class="q-pa-none">
            <div class="date-time-table">
              <div class="flex justify-center q-pa-none">
                <q-date
                  v-model="data.selectedDate.absolute.date"
                  class="absolute-calendar"
                  range
                  :locale="{
                    daysShort: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
                  }"
                />
              </div>
              <div class="notePara">{{ t("common.datetimeMessage") }}</div>
              <q-separator class="q-my-sm" />
              <table class="q-px-md startEndTime">
                <tr>
                  <td class="label">{{ t("common.startTime") }}</td>
                  <td class="label">{{ t("common.endTime") }}</td>
                </tr>
                <tr>
                  <td>
                    <q-input
                      v-model="data.selectedDate.absolute.startTime"
                      dense
                      filled
                      mask="time"
                      inputmode="numeric"
                      enterkeyhint="next"
                      :rules="['time']"
                    >
                      <template #append>
                        <q-icon name="access_time" class="cursor-pointer">
                          <q-popup-proxy
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-time
                              v-model="data.selectedDate.absolute.startTime"
                            >
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup="true"
                                  :label="t('common.close')"
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
                      v-model="data.selectedDate.absolute.endTime"
                      dense
                      filled
                      mask="time"
                      inputmode="numeric"
                      enterkeyhint="done"
                      :rules="['time']"
                    >
                      <template #append>
                        <q-icon name="access_time" class="cursor-pointer">
                          <q-popup-proxy
                            transition-show="scale"
                            transition-hide="scale"
                          >
                            <q-time
                              v-model="data.selectedDate.absolute.endTime"
                            >
                              <div class="row items-center justify-end">
                                <q-btn
                                  v-close-popup="true"
                                  :label="t('common.close')"
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
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { ref, defineComponent, reactive, watch, computed } from "vue";
import { getImageURL } from "../utils/zincutils";
import { isEqual } from "lodash-es";
import { useI18n } from "vue-i18n";
import { useScreen } from "@/composables/useScreen";

export default defineComponent({
  name: "DateTimePicker",
  components: { OTabPanels, OTabPanel, OButton },
  props: {
    modelValue: {
      type: Object,
      default: () => ({
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
      }),
    },
  },
  emits: ["update:modelValue"],

  setup(props, { emit }) {
    const datetimeBtn = ref();
    const { t } = useI18n();

    // v-model computed value which is used for the getvalue and setvalue for the props
    const selectedDateEmitValue = computed({
      get() {
        return props.modelValue;
      },
      set(value) {
        emit("update:modelValue", value);
      },
    });

    // when the props value is changed copy in to the data.selectedDate
    // because data.selectedDate has actual value
    watch(selectedDateEmitValue, () => {
      Object.assign(
        data.selectedDate,
        JSON.parse(JSON.stringify(props.modelValue)),
      );
    });

    const relativePeriods = [
      { label: "Minutes", value: "Minutes" },
      { label: "Hours", value: "Hours" },
      { label: "Days", value: "Days" },
      { label: "Weeks", value: "Weeks" },
      { label: "Months", value: "Months" },
    ];

    const relativeDates = {
      Minutes: [1, 5, 10, 15, 30, 45],
      Hours: [1, 2, 3, 6, 8, 12],
      Days: [1, 2, 3, 4, 5, 6],
      Weeks: [1, 2, 3, 4, 5, 6],
      Months: [1, 2, 3, 4, 5, 6],
    };

    // Internal date object, who is containing actual value
    const data = reactive({
      selectedDate: JSON.parse(JSON.stringify(props.modelValue)),
    });

    // this method set the value of date when the relative tab is selected
    const setRelativeDate = (period: any, value: any) => {
      data.selectedDate.tab = "relative";
      data.selectedDate.relative.period = period;
      data.selectedDate.relative.value = value;
      datetimeBtn.value.click();
    };

    const onCustomPeriodSelect = () => {
      data.selectedDate.relative.value = 1;
    };

    // change the actual date object based on selected tab.
    const displayValue = computed(() => {
      if (data.selectedDate.tab === "relative") {
        return `${data.selectedDate.relative.value} ${data.selectedDate.relative.period.label}`;
      } else {
        if (data.selectedDate.absolute.date != null) {
          if (typeof data.selectedDate.absolute.date != "object") {
            if (data.selectedDate.absolute.date != "") {
              data.selectedDate.absolute.date = {
                from: data.selectedDate.absolute.date,
                to: data.selectedDate.absolute.date,
              };
            } else {
              const todayDate = new Date().toLocaleDateString("en-ZA");
              data.selectedDate.absolute.date = {
                from: todayDate,
                to: todayDate,
              };
            }
          }

          return `${data.selectedDate.absolute.date.from} ${data.selectedDate.absolute.startTime} - ${data.selectedDate.absolute.date.to} ${data.selectedDate.absolute.endTime}`;
        } else {
          const todayDate = new Date().toLocaleDateString("en-ZA");
          data.selectedDate.absolute.date = {
            from: todayDate,
            to: todayDate,
          };
          return `${todayDate} ${data.selectedDate.absolute.startTime} - ${todayDate} ${data.selectedDate.absolute.endTime}`;
        }
      }
    });

    const calculateMaxValue = () => {
      if (
        data.selectedDate.relative.period.value == "Minutes" &&
        data.selectedDate.relative.value > 60
      ) {
        data.selectedDate.relative.value = 60;
        return false;
      } else if (
        data.selectedDate.relative.period.value == "Hours" &&
        data.selectedDate.relative.value > 24
      ) {
        data.selectedDate.relative.value = 24;
        return false;
      } else if (
        data.selectedDate.relative.period.value == "Days" &&
        data.selectedDate.relative.value > 31
      ) {
        data.selectedDate.relative.value = 31;
        return false;
      } else if (
        data.selectedDate.relative.period.value == "Weeks" &&
        data.selectedDate.relative.value > 6
      ) {
        data.selectedDate.relative.value = 6;
        return false;
      } else if (
        data.selectedDate.relative.period.value == "Months" &&
        data.selectedDate.relative.value > 6
      ) {
        data.selectedDate.relative.value = 6;
        return false;
      }
    };

    // set watcher on date selected variable.
    // when, the old value and new value is not same at that time copy the new value in selectedDateEmit
    watch(
      data.selectedDate,
      () => {
        if (!isEqual(selectedDateEmitValue.value, data.selectedDate)) {
          updateEmitValue();
        }
      },
      { deep: true },
    );

    const updateEmitValue = () => {
      selectedDateEmitValue.value = JSON.parse(
        JSON.stringify(data.selectedDate),
      );
    };

    // on the initial call emit the value once
    updateEmitValue();

    const { isMobile } = useScreen();
    const showMobilePicker = ref(false);

    return {
      t,
      relativePeriods,
      relativeDates,
      data,
      setRelativeDate,
      onCustomPeriodSelect,
      datetimeBtn,
      displayValue,
      calculateMaxValue,
      getImageURL,
      isMobile,
      showMobilePicker,
    };
  },
});
</script>

<style lang="scss" scoped>
.q-btn--rectangle {
  border-radius: 3px;
}

.date-time-button {
  height: 30px;
  min-height: 30px;
  border-radius: 3px;
  padding: 0px 5px;
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
  }

  &.isOpen .date-time-arrow {
    transform: rotate(180deg);
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
        color: $light-text2;
        font-size: 0.875rem;
        font-weight: 600;
      }

      .q-select__dropdown-icon {
        color: $light-text2;
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
  background: var(--o2-primary-btn-bg);
}

.tab-button {
  width: 154px;
}

.notePara {
  padding-right: 1.5rem;
  padding-left: 1.5rem;
  font-size: 0.625rem;
  color: $light-text;
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
      color: $dark-page;
      font-weight: 700;
    }
  }

  &__calendar {
    &-item .block {
      color: $light-text;
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

.mobile-sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--o2-border-color);
  border-radius: 2px;
  margin: 10px auto;
  opacity: 0.6;
}
</style>
