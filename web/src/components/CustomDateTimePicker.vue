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
        class="date-time-button"
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
    <div class="date-time-dialog">
      <div class="tw:flex tw:justify-between">
        <OTabPanels v-model="picker.activeTab">
          <OTabPanel name="relative">
            <div class="date-time-table tw:relative tw:flex tw:flex-col">
              <div
                class="relative-row tw:px-3 tw:py-2"
                v-for="(period, periodIndex) in relativePeriods"
                :key="'date_' + periodIndex"
              >
                <div class="relative-period-name">{{ period.label }}</div>
                <div
                  v-for="(item, itemIndex) in relativeDates[period.value]"
                  :key="item"
                >
                  <OButton
                    :data-test="`date-time-relative-${item}-${period.value}-btn`"
                    variant="ghost"
                    :class="
                      isSelected(item, period.value)
                        ? 'rp-selector-selected'
                        : 'rp-selector'
                    "
                    @click="setRelativeDate(period, item)"
                    >{{ item }}</OButton
                  >
                </div>
              </div>
              <div class="relative-row tw:px-3 tw:py-2">
                <div class="relative-period-name">Custom</div>
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
      ? "dark-mode-date-time-picker"
      : "light-mode-date-time-picker"
    : "";
});
</script>

<style scoped>
.relative-row {
  /* Add your styles here */
}

.date-time-table {
  /* Add your styles here */
}
.alerts-condition-action {
  .q-btn {
    &.icon-dark {
      filter: none !important;
    }
  }
}
.alert-page-font {
  background-color: red;
  font-size: 14px;
}
</style>
<style lang="scss" scoped>
.date-time-button {
  height: 100%;
  border-radius: 3px;
  padding: 0px 5px;
  font-size: 12px;
  min-width: auto;
  background: rgba(89, 96, 178, 0.2) !important;

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

.date-time-dialog {
  width: 341px;
  z-index: 10001;
  max-height: 600px;
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
.dashboard-add-btn {
  cursor: pointer;
  padding: 0px 5px;
}
.alert-add-btn {
  border-radius: 4px;
  text-transform: capitalize;
  background: #f2f2f2 !important;
  color: #000 !important;
}
.dark-mode-date-time-picker {
  background-color: #2a2828 !important;
  color: #ffffff !important;
}
.light-mode-date-time-picker {
  background-color: #ffffff !important;
}
</style>
