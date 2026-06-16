<template>
  <ODropdown v-model:open="picker.showMenu" side="bottom" :align="props.align">
    <template #trigger>
      <OButton
        :style="{
          width: changeStyle ? '170px' : '180px',
          height: changeStyle ? '40px' : '',
        }"
        data-test="date-time-btn"
        variant="outline"
        class="date-time-button tw:h-full tw:rounded-[3px] tw:py-0 tw:px-[5px] tw:text-xs tw:min-w-auto tw:bg-[rgba(89,96,178,0.2)]!"
        :class="changeStyle ? computedClass : ''"
        :disabled="isFirstEntry"
      >
        <template v-if="!changeStyle" #icon-left>
          <OIcon name="schedule" size="sm" />
        </template>
        {{ changeStyle ? getTrimmedDisplayValue() : getDisplayValue() }}
        <template #icon-right>
          <OIcon name="arrow-drop-down" size="sm" />
        </template>
      </OButton>
    </template>
    <div class="date-time-dialog tw:w-[341px] tw:z-[10001] tw:max-h-[600px]">
      <div class="tw:flex tw:justify-between">
        <OTabPanels v-model="picker.activeTab">
          <OTabPanel name="relative">
            <div class="date-time-table tw:relative tw:flex tw:flex-col">
              <div
                class="relative-row tw:px-3 tw:py-2"
                v-for="(period, periodIndex) in relativePeriods"
                :key="'date_' + periodIndex"
              >
                <div class="tw:text-sm tw:font-semibold tw:min-w-18.75">{{ period.label }}</div>
                <div
                  v-for="(item, itemIndex) in relativeDates[period.value]"
                  :key="item"
                >
                  <OButton
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    variant="ghost"
                    :class="
                      isSelected(item, period.value)
                        ? 'tw:h-8 tw:w-8 tw:bg-[rgba(0,0,0,0.07)] tw:text-white tw:bg-(--o2-primary-btn-bg)'
                        : 'tw:h-8 tw:w-8 tw:bg-[rgba(0,0,0,0.07)]'
                    "
                    @click="setRelativeDate(period, item)"
                    >{{ item }}</OButton
                  >
                </div>
              </div>
              <div class="relative-row tw:px-3 tw:py-2">
                <div class="tw:text-sm tw:font-semibold tw:min-w-18.75">Custom</div>
                <div class="tw:flex tw:gap-2">
                  <div class="tw:flex tw:flex-col tw:w-20">
                    <OInput
                      v-model.number="picker.data.selectedDate.relative.value"
                      type="number"
                      :min="1"
                    />
                  </div>
                  <div class="tw:flex tw:flex-col">
                    <OSelect
                      v-model="picker.data.selectedDate.relative.period"
                      :options="relativePeriodsSelect"
                      @update:model-value="updateCustomPeriod"
                    >
                      <template v-slot:selected-item>
                        <div>{{ getPeriodLabel() }}</div>
                      </template>
                    </OSelect>
                  </div>
                </div>
              </div>
            </div>
          </OTabPanel>
        </OTabPanels>
      </div>
    </div>
  </ODropdown>
</template>

<script setup>
// Copyright 2026 OpenObserve Inc.
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import { ref, reactive, watch, computed } from "vue";
import { useStore } from "vuex";

// Define props to receive the value (offset) from parent
const props = defineProps({
  modelValue: String, // modelValue will bind to the offSet from parent
  isFirstEntry: Boolean,
  changeStyle: {
    default: false,
    required: false,
    type: Boolean,
  },
  align: {
    default: "end",
    required: false,
    type: String,
    validator: (v) => ["start", "center", "end"].includes(v),
  },
});

const emit = defineEmits(["update:modelValue"]);

const store = useStore();

const picker = reactive({
  activeTab: "relative",
  showMenu: false,
  data: {
    selectedDate: {
      relative: {
        value: 0,
        period: "m",
        label: "Minutes",
      },
    },
  },
});

// Periods for selection
const relativePeriods = [
  { label: "Seconds", value: "s" },
  { label: "Minutes", value: "m" },
  { label: "Hours", value: "h" },
  { label: "Days", value: "d" },
  { label: "Weeks", value: "w" },
  { label: "Months", value: "M" },
];

const relativeDates = {
  s: [1, 5, 10, 15, 30, 45],
  m: [1, 5, 10, 15, 30, 45],
  h: [1, 2, 3, 6, 8, 12],
  d: [1, 2, 3, 4, 5, 6],
  w: [1, 2, 3, 4, 5, 6],
  M: [1, 2, 3, 4, 5, 6],
};

// Options for custom period input
const relativePeriodsSelect = ref([
  { label: "Seconds", value: "s" },
  { label: "Minutes", value: "m" },
  { label: "Hours", value: "h" },
  { label: "Days", value: "d" },
  { label: "Weeks", value: "w" },
  { label: "Months", value: "M" },
]);

// Function to map period values to their labels
const getPeriodLabelFromValue = (periodValue) => {
  const period = relativePeriods.find((p) => p.value === periodValue);
  return period ? period.label : "Minutes";
};

// Watch modelValue to reflect the correct offset when passed in from parent
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue) {
      const value = newValue.match(/\d+/g)[0]; // Extract numeric value
      const period = newValue.match(/[a-zA-Z]+/g)[0]; // Extract period

      picker.data.selectedDate.relative.value = Number(value);
      picker.data.selectedDate.relative.period = period;
      picker.data.selectedDate.relative.label = getPeriodLabelFromValue(period); // Dynamically set label
    }
  },
  { immediate: true },
);

// Function to update the relative date when selected
const setRelativeDate = (period, item) => {
  picker.data.selectedDate.relative.period = period.value;
  picker.data.selectedDate.relative.value = item;
  picker.data.selectedDate.relative.label = getPeriodLabelFromValue(
    period.value,
  ); // Set label dynamically

  // Emit the new value to update modelValue in the parent component
  emit("update:modelValue", `${item}${period.value}`);
};

// Function to update custom period when selecting from q-select
const updateCustomPeriod = (newPeriod) => {
  picker.data.selectedDate.relative.label = getPeriodLabelFromValue(newPeriod);
  emit(
    "update:modelValue",
    `${picker.data.selectedDate.relative.value}${newPeriod}`,
  );
};

// Display the current selected offset
const getDisplayValue = () => {
  return `${picker.data.selectedDate.relative.value} ${picker.data.selectedDate.relative.label} ago`;
};

const getTrimmedDisplayValue = () => {
  return `Past ${picker.data.selectedDate.relative.value} ${picker.data.selectedDate.relative.label}`;
};

// Check if the current selection matches the modelValue
const isSelected = (value, period) => {
  return (
    picker.data.selectedDate.relative.value == value &&
    picker.data.selectedDate.relative.period == period
  );
};

// Display period label for custom input
const getPeriodLabel = () => {
  const selectedPeriod = relativePeriods.find(
    (p) => p.value === picker.data.selectedDate.relative.period,
  );
  return selectedPeriod ? selectedPeriod.label : "Minutes";
};

const computedClass = computed(() => {
  return props.changeStyle
    ? store.state.theme === "dark"
      ? "tw:bg-[#2a2828]! tw:text-white!"
      : "tw:bg-white!"
    : "";
});
</script>

<style>
.date-time-button {
  .OIcon.on-right {
    transition: transform 0.25s ease;
  }
  &.isOpen .OIcon.on-right {
    transform: rotate(180deg);
  }

  .q-btn__content {
    justify-content: flex-start;

    .block {
      font-weight: 600;
    }
  }
}
</style>
