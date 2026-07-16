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
  <div ref="multiWindowContainerRef" class="step-compare-with-past w-full h-full flex flex-col mx-auto">
    <div class="step-content rounded-lg flex-1 min-h-0 overflow-auto bg-surface-overlay border border-border-default">
      <div class="section-header flex items-center gap-0 py-2.5 px-3 border-b border-border-default">
        <div class="section-header-accent w-0.75 h-4 rounded-xs mr-2 shrink-0 bg-[var(--color-theme-accent)]" />
        <span class="section-header-title text-compact font-semibold text-text-primary">{{ t('alerts.steps.compareWithPast') }}</span>
      </div>
      <div class="px-3 pb-2">
      <!-- Alert set for header -->
      <div class="multi-window-text flex items-center gap-2 py-2 mt-3 font-bold text-sm leading-6 align-middle text-text-body">
        <span>{{ t('alerts.compareWithPast.alertSetFor') }}</span>
        <div class="h-px border-line flex-1"></div>
      </div>

      <!-- Current Window -->
      <div class="flex flex-row justify-between items-start min-h-27.5 px-3 py-2 bg-card-glass-bg border border-border-default">
        <div class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body">
          {{ t('alerts.compareWithPast.currentWindow') }}
        </div>

        <div class="flex flex-col items-start gap-2">
          <div class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body">
            {{ t('alerts.compareWithPast.cycle') }}
            <span class="cursor-pointer">
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer"
                :class="'text-text-secondary'"
               />
                <OTooltip :content="t('alerts.compareWithPast.cycleTooltip')" side="right" align="center" max-width="300px" />
            </span>
          </div>
          <div class="flex justify-between items-start gap-4">
            <div class="w-75 font-normal leading-5 text-sm">
              {{ t('alerts.compareWithPast.runningFor', { period: convertMinutesToDisplayValue(period), frequency: convertMinutesToDisplayValue(frequency) }) }}
            </div>
            <div>
              <span class="inline-block">
                <OButton
                  variant="ghost"
                  size="icon-circle-sm"
                  disable
                  style="min-width: auto; opacity: 0.3; pointer-events: none;"
                >
                  <OIcon name="delete-outline" size="sm" />
                </OButton>
                <OTooltip :content="t('alerts.compareWithPast.currentWindowCannotBeDeleted')" side="top" align="center" :sideOffset="8" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Comparing with header -->
      <div v-if="localMultiTimeRange.length > 0" class="multi-window-text flex items-center gap-2 py-2 mt-2 font-bold text-sm leading-6 align-middle text-text-body">
        <span>{{ t('alerts.compareWithPast.comparingWith') }}</span>
        <div class="h-px border-line flex-1"></div>
      </div>

      <!-- Reference Windows List -->
      <div
        v-for="(picker, index) in localMultiTimeRange"
        :key="picker.uuid"
        class="reference-window-container flex flex-row justify-between items-start min-h-27.5 mt-2 px-3 py-2 bg-card-glass-bg border border-border-default"
      >
        <div class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body">
          {{ t('alerts.compareWithPast.referenceWindow') }} {{ index + 1 }}
        </div>

        <!-- Time Frame -->
        <div class="flex flex-col gap-2 items-start">
          <div class="flex items-center">
            <span class="mr-1"><OIcon name="schedule" size="sm" /></span>
            {{ t('alerts.compareWithPast.timeFrame') }}
            <span class="ml-2 cursor-pointer">
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer"
                :class="'text-text-secondary'"
               />
                <OTooltip :content="t('alerts.compareWithPast.timeFrameTooltip')" side="right" align="center" max-width="300px" />
            </span>
          </div>
          <div class="datetime-picker-wrapper mt-2 border rounded-sm !border-border-default">
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
        <div class="flex flex-col items-start gap-2">
          <div class="multi-window-text w-auto text-left font-bold text-sm leading-6 align-middle text-text-body">
            {{ t('alerts.compareWithPast.cycle') }}
            <span class="cursor-pointer">
              <OIcon
                name="info"
                size="sm"
                class="ml-1 cursor-pointer"
                :class="'text-text-secondary'"
               />
                <OTooltip :content="t('alerts.compareWithPast.cycleTooltip')" side="right" align="center" max-width="300px" />
            </span>
          </div>
          <div class="flex justify-between items-start gap-4">
            <div class="w-75 text-sm font-normal">
              {{ t('alerts.compareWithPast.comparingText', { offset: getDisplayValue(picker.offSet) }) }}
            </div>
            <div>
              <OButton
                data-test="multi-time-range-alerts-delete-btn"
                variant="ghost"
                size="icon-circle-sm"
                @click="removeTimeShift(index)"
              >
                <OIcon name="delete-outline" size="sm" />
              </OButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons Section -->
      <div class="w-full flex justify-center items-center gap-3 mt-2">
        <OButton
          data-test="multi-time-range-alerts-add-btn"
          variant="outline"
          size="sm"
          :disabled="isComparisonDisabled"
          @click="addTimeShift"
        >
          {{ t('alerts.compareWithPast.addComparisonWindow') }}
          <OTooltip
            v-if="isComparisonDisabled"
            :content="comparisonDisabledTooltip"
            side="top"
            align="center"
            :sideOffset="8"
          />
        </OButton>

      </div>
      </div><!-- end px-3 py-2 -->
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, computed, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import CustomDateTimePicker from "@/components/CustomDateTimePicker.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

interface TimeShiftPicker {
  offSet: string;
  uuid: string;
}

export default defineComponent({
  name: "Step4CompareWithPast",
  components: {
    CustomDateTimePicker,
    OButton,
    OIcon,
    OTooltip,
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
  emits: ["update:multiTimeRange"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const multiWindowContainerRef = ref<HTMLElement | null>(null);
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
      if (props.selectedTab !== "sql") {
        return t('alerts.compareWithPast.comparisonDisabledTooltip');
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

    return {
      t,
      store,
      multiWindowContainerRef,
      localMultiTimeRange,
      addTimeShift,
      removeTimeShift,
      updateDateTimePicker,
      getDisplayValue,
      convertMinutesToDisplayValue,
      isComparisonDisabled,
      comparisonDisabledTooltip,
    };
  },
});
</script>

