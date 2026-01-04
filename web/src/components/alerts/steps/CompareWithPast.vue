<!-- Copyright 2023 OpenObserve Inc.

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
  <div ref="multiWindowContainerRef" class="step-compare-with-past" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw:px-3 tw:py-4" :class="store.state.theme === 'dark' ? 'dark-mode-multi-window' : 'light-mode-multi-window'">
      <!-- Alert set for header -->
      <div class="multi-window-text tw:flex tw:items-center tw:gap-2 q-py-sm q-mt-md">
        <span>Alert set for</span>
        <div class="tw:h-px border-line tw:flex-1"></div>
      </div>

      <!-- Current Window -->
      <div class="tw:flex tw:flex-col lg:tw:flex-row tw:justify-between tw:items-start multi-window-container q-px-md q-py-sm">
        <div class="multi-window-text tw:w-full tw:text-center lg:tw:w-auto lg:tw:text-left">
          Current window
        </div>

        <div class="tw:flex lg:tw:flex-col tw:items-start tw:gap-2">
          <div class="multi-window-text tw:w-full tw:text-center lg:tw:w-auto lg:tw:text-left">
            Cycle
            <span class="tw:cursor-pointer">
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
              >
                <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px">
                  Compare results with the same time in the previous cycle.
                </q-tooltip>
              </q-icon>
            </span>
          </div>
          <div class="tw:flex tw:justify-between tw:items-start tw:gap-4">
            <div class="tw:w-full lg:tw:w-[300px] running-text">
              Running for {{ convertMinutesToDisplayValue(period) }} in the interval of every {{ convertMinutesToDisplayValue(frequency) }}
            </div>
            <div>
              <span class="tw:inline-block">
                <q-btn
                  icon="delete_outline"
                  class="iconHoverBtn q-ml-xs q-mr-sm"
                  :class="store.state.theme === 'dark' ? 'icon-dark' : ''"
                  padding="xs"
                  unelevated
                  size="16px"
                  round
                  flat
                  disable
                  style="min-width: auto; opacity: 0.3; pointer-events: none;"
                />
                <q-tooltip
                  anchor="top middle"
                  self="bottom middle"
                  :offset="[0, 8]"
                >
                  Current window cannot be deleted
                </q-tooltip>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Comparing with header -->
      <div v-if="localMultiTimeRange.length > 0" class="multi-window-text tw:flex tw:items-center tw:gap-2 q-py-sm q-mt-sm">
        <span>Comparing with</span>
        <div class="tw:h-px border-line tw:flex-1"></div>
      </div>

      <!-- Reference Windows List -->
      <div
        v-for="(picker, index) in localMultiTimeRange"
        :key="picker.uuid"
        class="tw:flex tw:flex-col lg:tw:flex-row tw:justify-between tw:items-start reference-window-container tw:mt-2 q-px-md q-py-sm"
      >
        <div class="multi-window-text tw:w-full tw:text-center lg:tw:w-auto lg:tw:text-left">
          Reference Window {{ index + 1 }}
        </div>

        <!-- Time Frame -->
        <div class="tw:flex tw:flex-col tw:gap-2 tw:items-center">
          <div class="tw:flex tw:items-center">
            <span class="tw:mr-1"><q-icon name="schedule" size="16px" /></span>
            Time Frame
            <span class="tw:ml-2 tw:cursor-pointer">
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
              >
                <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px">
                  Time range for your query.
                </q-tooltip>
              </q-icon>
            </span>
          </div>
          <div class="datetime-picker-wrapper tw:mt-2">
            <CustomDateTimePicker
              v-model="picker.offSet"
              :picker="picker"
              :isFirstEntry="false"
              @update:model-value="updateDateTimePicker"
              :changeStyle="true"
            />
          </div>
        </div>

        <!-- Cycle Info -->
        <div class="tw:flex lg:tw:flex-col tw:items-start tw:gap-2">
          <div class="multi-window-text tw:w-full tw:text-center lg:tw:w-auto lg:tw:text-left">
            Cycle
            <span class="tw:cursor-pointer">
              <q-icon
                name="info"
                size="17px"
                class="q-ml-xs cursor-pointer"
                :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
              >
                <q-tooltip anchor="center right" self="center left" max-width="300px" style="font-size: 12px">
                  Compare results with the same time in the previous cycle.
                </q-tooltip>
              </q-icon>
            </span>
          </div>
          <div class="tw:flex tw:justify-between tw:items-start tw:gap-4">
            <div class="tw:w-full lg:tw:w-[300px] reference-text">
              Comparing current window query result with query result from previous {{ getDisplayValue(picker.offSet) }}.
            </div>
            <div>
              <q-btn
                data-test="multi-time-range-alerts-delete-btn"
                icon="delete_outline"
                class="iconHoverBtn q-ml-xs q-mr-sm"
                :class="store.state.theme === 'dark' ? 'icon-dark' : ''"
                padding="xs"
                unelevated
                size="16px"
                round
                flat
                @click="removeTimeShift(index)"
                style="min-width: auto"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons Section -->
      <div class="tw:w-full tw:flex tw:justify-center tw:items-center tw:gap-3 q-mt-sm">
        <q-btn
          data-test="multi-time-range-alerts-add-btn"
          label="Add Comparison Window"
          size="md"
          class="o2-secondary-button"
          style="font-size: 14px;"
          no-caps
          :disable="isComparisonDisabled"
          @click="addTimeShift"
        >
          <q-tooltip
            v-if="isComparisonDisabled"
            anchor="top middle"
            self="bottom middle"
            :offset="[0, 8]"
          >
            {{ comparisonDisabledTooltip }}
          </q-tooltip>
        </q-btn>

        <!-- Go to View Editor Button with Info Icon - shows when comparison windows are added -->
        <div v-if="localMultiTimeRange.length > 0" class="tw:flex tw:items-center tw:gap-2">
          <q-btn
            data-test="go-to-view-editor-btn"
            label="Go to Conditions"
            size="md"
            class="o2-secondary-button"
            style="font-size: 14px;"
            no-caps
            @click="handleGoToSqlEditor"
          >
          <q-tooltip
              ref="goToConditionsTooltipRef"
              anchor="top middle"
              self="bottom middle"
              max-width="300px"
              :offset="[0, 8]"
            >
              Click on "Go to Conditions" to verify the events for selected comparison windows
            </q-tooltip>
        </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";

interface TimeShiftPicker {
  offSet: string;
  uuid: string;
}

export default defineComponent({
  name: "Step4CompareWithPast",
  components: {
    CustomDateTimePicker,
  },
  props: {
    multiTimeRange: {
      type: Array as PropType<TimeShiftPicker[]>,
      default: () => [],
    },
    period: {
      type: Number,
      default: 10,
    },
    frequency: {
      type: Number,
      default: 10,
    },
    frequencyType: {
      type: String,
      default: "minutes",
    },
    cron: {
      type: String,
      default: "",
    },
    selectedTab: {
      type: String,
      default: "custom",
    },
  },
  emits: ["update:multiTimeRange", "goToSqlEditor"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const multiWindowContainerRef = ref<HTMLElement | null>(null);
    const goToConditionsTooltipRef = ref<any>(null);
    const localMultiTimeRange = ref<TimeShiftPicker[]>([...(props.multiTimeRange || [])]);

    // Watch for prop changes
    watch(
      () => props.multiTimeRange,
      (newVal) => {
        localMultiTimeRange.value = [...(newVal || [])];
      },
      { deep: true }
    );

    // Check if comparison window should be disabled (only SQL mode supports comparison)
    const isComparisonDisabled = computed(() => {
      return props.selectedTab !== "sql";
    });

    const comparisonDisabledTooltip = computed(() => {
      if (props.selectedTab === "custom") {
        return "Please switch to SQL mode in conditions step to enable comparison windows";
      } else if (props.selectedTab === "promql") {
        return "Please switch to SQL mode in conditions step to enable comparison windows";
      }
      return "";
    });

    const addTimeShift = () => {
      const newTimeShift: TimeShiftPicker = {
        offSet: "15m",
        uuid: getUUID(),
      };
      localMultiTimeRange.value.push(newTimeShift);
      emit("update:multiTimeRange", localMultiTimeRange.value);
    };

    const removeTimeShift = (index: number) => {
      localMultiTimeRange.value.splice(index, 1);
      emit("update:multiTimeRange", localMultiTimeRange.value);
    };

    const updateDateTimePicker = () => {
      emit("update:multiTimeRange", localMultiTimeRange.value);
    };

    const getDisplayValue = (value: string) => {
      const relativePeriods = [
        { label: "Second(s)", value: "s" },
        { label: "Minute(s)", value: "m" },
        { label: "Hour(s)", value: "h" },
        { label: "Day(s)", value: "d" },
        { label: "Week(s)", value: "w" },
        { label: "Month(s)", value: "M" },
      ];

      if (typeof value !== 'string') return value;

      const match = value.match(/^(\d+)([smhdwM])$/);
      if (!match) return value;

      const [, numberPart, unitPart] = match;
      const period = relativePeriods.find((p) => p.value === unitPart);

      if (period) {
        return `${numberPart} ${period.label}`;
      }

      return value;
    };

    const convertMinutesToDisplayValue = (minutes: number) => {
      if (minutes < 60) {
        return `${minutes} Minute${minutes !== 1 ? 's' : ''}`;
      } else if (minutes < 1440) {
        const hours = Math.floor(minutes / 60);
        return `${hours} Hour${hours !== 1 ? 's' : ''}`;
      } else if (minutes < 10080) {
        const days = Math.floor(minutes / 1440);
        return `${days} Day${days !== 1 ? 's' : ''}`;
      } else if (minutes < 43200) {
        const weeks = Math.floor(minutes / 10080);
        return `${weeks} Week${weeks !== 1 ? 's' : ''}`;
      } else {
        const months = Math.floor(minutes / 43200);
        return `${months} Month${months !== 1 ? 's' : ''}`;
      }
    };

    const goToSqlEditor = () => {
      emit("goToSqlEditor");
    };

    const handleGoToSqlEditor = () => {
      // Hide the tooltip before navigating
      if (goToConditionsTooltipRef.value) {
        goToConditionsTooltipRef.value.hide();
      }
      goToSqlEditor();
    };

    return {
      t,
      store,
      multiWindowContainerRef,
      goToConditionsTooltipRef,
      localMultiTimeRange,
      addTimeShift,
      removeTimeShift,
      updateDateTimePicker,
      getDisplayValue,
      convertMinutesToDisplayValue,
      isComparisonDisabled,
      comparisonDisabledTooltip,
      goToSqlEditor,
      handleGoToSqlEditor,
    };
  },
});
</script>

<style scoped lang="scss">
.step-compare-with-past {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;

  .step-content {
    border-radius: 8px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.dark-mode-multi-window .multi-window-text {
  color: #FFFFFF;
}

.light-mode-multi-window .multi-window-text {
  color: #3d3d3d;
}

.multi-window-text {
  font-weight: 700;
  font-size: 14px;
  line-height: 24px;
  vertical-align: middle;
}

.reference-text {
  font-size: 14px;
  font-weight: 400;
}

.dark-mode-multi-window .reference-window-container {
  background-color: #111111;
  border: 1px solid #343939;
}

.light-mode-multi-window .reference-window-container {
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
}

.reference-window-container {
  min-height: 110px;
  border-left: 6px solid #6832CC !important;
}

.dark-mode-multi-window .multi-window-container {
  background-color: #111111;
  border: 1px solid #343939;
}

.light-mode-multi-window .multi-window-container {
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
}

.multi-window-container {
  min-height: 110px;
  border-left: 6px solid #32CCCC !important;
}

.running-text {
  font-weight: 400 !important;
  line-height: 20px !important;
  font-size: 14px;
}

.iconHoverBtn {
  &:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  &.icon-dark {
    filter: none !important;
  }
}

.datetime-picker-wrapper {
    border: 1px solid;
    border-radius: 4px;
}

.dark-mode-multi-window .datetime-picker-wrapper {
    border-color: #4a4a4a !important;
}

.light-mode-multi-window .datetime-picker-wrapper {
    border-color: #d0d0d0 !important;
}
</style>
