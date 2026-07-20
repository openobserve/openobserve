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
  <ODropdown v-model:open="menuOpen" side="bottom" align="start">
    <template #trigger>
      <OButton
        id="date-time-button"
        ref="datetimeBtn"
        data-cy="date-time-button"
        variant="outline"
        class="date-time-button h-[30px] min-h-[30px] rounded-[3px] py-0 px-[5px] min-w-auto justify-start!"
        icon-left="schedule"
      >
        <span class="date-time-label font-semibold flex-1 text-left">{{ displayValue }}</span>
        <template #icon-right
          ><OIcon name="arrow-drop-down" size="sm" class="date-time-arrow ml-auto transition [transition:transform_0.25s_ease]"
        /></template>
      </OButton>
    </template>
    <div id="date-time-menu" class="date-time-dialog w-[325px]">
      <div class="flex justify-evenly py-2">
        <OButton
          class="w-38.5"
          :variant="
            data.selectedDate.tab === 'relative' ? 'primary' : 'ghost-primary'
          "
          size="sm"
          @click="data.selectedDate.tab = 'relative'"
        >
          {{ t("common.datetimeRelative") }}
        </OButton>
        <OSeparator vertical class="my-2" />
        <OButton
          class="w-38.5"
          :variant="
            data.selectedDate.tab === 'absolute' ? 'primary' : 'ghost-primary'
          "
          size="sm"
          @click="data.selectedDate.tab = 'absolute'"
        >
          {{ t("common.datetimeAbsolute") }}
        </OButton>
      </div>
      <OSeparator />
      <OTabPanels v-model="data.selectedDate.tab" animated>
        <OTabPanel name="relative">
          <div class="date-time-table relative flex flex-col">
            <div
              class="relative-row px-3 py-2 flex items-center border-b border-[var(--o2-border)]"
              v-for="(period, index) in relativePeriods"
              :key="'date_' + index"
            >
              <div class="text-sm font-semibold min-w-18.75">
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

            <div class="relative-row px-3 py-2 flex items-center border-b border-[var(--o2-border)]">
              <div class="text-sm font-semibold min-w-18.75">Custom</div>

              <div class="flex gap-2 flex-1 min-w-0">
                <div class="flex flex-col w-20">
                  <OInput
                    v-model="data.selectedDate.relative.value"
                    type="number"
                    :min="1"
                    @change="calculateMaxValue"
                  />
                </div>
                <div class="flex flex-col flex-1 min-w-0">
                  <OSelect
                    v-model="data.selectedDate.relative.period"
                    :options="relativePeriods"
                    @update:model-value="onCustomPeriodSelect"
                  />
                </div>
              </div>
            </div>
          </div>
        </OTabPanel>
        <OTabPanel name="absolute">
          <div class="date-time-table flex flex-col">
            <ODateRangeCalendar
              :start-date="data.selectedDate.absolute.date.from"
              :end-date="data.selectedDate.absolute.date.to"
              :max-date="calendarMaxDate"
              @update:start-date="data.selectedDate.absolute.date.from = $event"
              @update:end-date="data.selectedDate.absolute.date.to = $event"
            />
            <div class="pr-6 pl-6 text-[0.625rem] text-(--o2-text-secondary)">{{ t("common.datetimeMessage") }}</div>
            <OSeparator class="my-2" />

            <table class="px-3 startEndTime w-[calc(100%-0.8rem)] mx-[0.4rem] mt-2 mb-[0.3rem]">
              <tr>
                <td class="label w-1/2 text-xs font-semibold">{{ t("common.startTime") }}</td>
                <td class="label w-1/2 text-xs font-semibold">{{ t("common.endTime") }}</td>
              </tr>
              <tr>
                <td class="w-1/2">
                  <OTime
                    class="w-full"
                    v-model="data.selectedDate.absolute.startTime"
                  />
                </td>
                <td class="w-1/2">
                  <OTime
                    class="w-full"
                    v-model="data.selectedDate.absolute.endTime"
                  />
                </td>
              </tr>
            </table>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </ODropdown>
</template>

<script lang="ts">
// @ts-nocheck
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODateRangeCalendar from "@/lib/forms/DateTimeRange/ODateRangeCalendar.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { ref, defineComponent, reactive, watch, computed } from "vue";
import { getImageURL } from "../utils/zincutils";
import { isEqual } from "lodash-es";
import { useI18n } from "vue-i18n";

export default defineComponent({
  name: "DateTimePicker",
  components: {
    OSeparator,
    OTabPanels,
    OTabPanel,
    OButton,
    OIcon,
    OInput,
    OSelect,
    OTime,
    ODateRangeCalendar,
    ODropdown,
  },
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
    const menuOpen = ref(false);
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
      menuOpen.value = false;
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

    return {
      t,
      relativePeriods,
      relativeDates,
      data,
      setRelativeDate,
      onCustomPeriodSelect,
      datetimeBtn,
      menuOpen,
      displayValue,
      calculateMaxValue,
      getImageURL,
      calendarMaxDate: computed(() => {
        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, "0");
        const d = String(today.getDate()).padStart(2, "0");
        return `${y}/${m}/${d}`;
      }),
    };
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
