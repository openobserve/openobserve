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
        class="rounded-default h-full min-w-auto bg-[rgba(89,96,178,0.2)]! px-1.25 py-0 text-xs"
        :class="changeStyle ? computedClass : 'h-8!'"
        :disabled="isFirstEntry"
      >
        <template v-if="!changeStyle" #icon-left>
          <OIcon name="schedule" size="sm" />
        </template>
        {{ changeStyle ? getTrimmedDisplayValue() : getDisplayValue() }}
        <template #icon-right>
          <OIcon
            name="arrow-drop-down"
            size="sm"
            class="transition-transform duration-[250ms] ease-in-out"
            :class="picker.showMenu ? 'rotate-180' : ''"
          />
        </template>
      </OButton>
    </template>
    <div class="date-time-dialog z-10001 max-h-150 w-85.25">
      <div class="flex justify-between">
        <OTabPanels v-model="picker.activeTab">
          <OTabPanel name="relative">
            <div class="date-time-table relative flex flex-col">
              <div
                class="relative-row border-border-default flex items-center border-b px-3 py-2 [&>*]:mr-1.5"
                v-for="(period, periodIndex) in relativePeriods"
                :key="'date_' + periodIndex"
              >
                <div class="min-w-18.75 text-sm font-semibold">{{ period.label }}</div>
                <div v-for="item in relativeDates[period.value]" :key="item">
                  <OButton
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    variant="ghost"
                    class="h-8! w-8! font-bold! disabled:opacity-35"
                    :class="
                      isSelected(item, period.value)
                        ? 'bg-button-primary! text-button-primary-foreground!'
                        : 'bg-[color-mix(in_srgb,var(--color-text-heading)_7%,transparent)]!'
                    "
                    @click="setRelativeDate(period, item)"
                    >{{ item }}</OButton
                  >
                </div>
              </div>
              <div
                class="relative-row border-border-default flex items-center border-b px-3 py-2 [&>*]:mr-1.5"
              >
                <div class="min-w-18.75 text-sm font-semibold">Custom</div>
                <div class="flex gap-2">
                  <div class="flex w-20 flex-col">
                    <OInput
                      v-model.number="picker.data.selectedDate.relative.value"
                      type="number"
                      :min="1"
                    />
                  </div>
                  <div class="flex flex-col">
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

<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue } from "@/lib/forms/Select/OSelect.types";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import type { DropdownAlign } from "@/lib/overlay/Dropdown/ODropdown.types";
import { ref, reactive, watch, computed } from "vue";
import type { PropType } from "vue";

// Period keys used to index relativeDates and label lookups.
type PeriodKey = "s" | "m" | "h" | "d" | "w" | "M";

interface RelativePeriod {
  label: string;
  value: PeriodKey;
}

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
    type: String as PropType<DropdownAlign>,
    validator: (v: DropdownAlign) => ["start", "center", "end"].includes(v),
  },
});

const emit = defineEmits(["update:modelValue"]);

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
const relativePeriods: RelativePeriod[] = [
  { label: "Seconds", value: "s" },
  { label: "Minutes", value: "m" },
  { label: "Hours", value: "h" },
  { label: "Days", value: "d" },
  { label: "Weeks", value: "w" },
  { label: "Months", value: "M" },
];

const relativeDates: Record<PeriodKey, number[]> = {
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
const getPeriodLabelFromValue = (periodValue: SelectModelValue | string) => {
  const period = relativePeriods.find((p) => p.value === periodValue);
  return period ? period.label : "Minutes";
};

// Watch modelValue to reflect the correct offset when passed in from parent
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue) {
      const valueMatch = newValue.match(/\d+/g); // Extract numeric value
      const periodMatch = newValue.match(/[a-zA-Z]+/g); // Extract period
      const value = valueMatch ? valueMatch[0] : undefined;
      const period = periodMatch ? periodMatch[0] : undefined;

      picker.data.selectedDate.relative.value = Number(value);
      picker.data.selectedDate.relative.period = period ?? "";
      picker.data.selectedDate.relative.label = getPeriodLabelFromValue(period ?? ""); // Dynamically set label
    }
  },
  { immediate: true },
);

// Function to update the relative date when selected
const setRelativeDate = (period: RelativePeriod, item: number) => {
  picker.data.selectedDate.relative.period = period.value;
  picker.data.selectedDate.relative.value = item;
  picker.data.selectedDate.relative.label = getPeriodLabelFromValue(period.value); // Set label dynamically

  // Emit the new value to update modelValue in the parent component
  emit("update:modelValue", `${item}${period.value}`);
};

// Function to update custom period when selecting from the select
const updateCustomPeriod = (newPeriod: SelectModelValue | string) => {
  picker.data.selectedDate.relative.label = getPeriodLabelFromValue(newPeriod);
  emit("update:modelValue", `${picker.data.selectedDate.relative.value}${newPeriod}`);
};

// Display the current selected offset
const getDisplayValue = () => {
  return `${picker.data.selectedDate.relative.value} ${picker.data.selectedDate.relative.label} ago`;
};

const getTrimmedDisplayValue = () => {
  return `Past ${picker.data.selectedDate.relative.value} ${picker.data.selectedDate.relative.label}`;
};

// Check if the current selection matches the modelValue
const isSelected = (value: number, period: PeriodKey) => {
  return (
    picker.data.selectedDate.relative.value === value &&
    picker.data.selectedDate.relative.period === period
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
  return props.changeStyle ? "bg-surface-base!" : "";
});
</script>
