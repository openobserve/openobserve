<template>
    <div class="flex items-start gap-1 flex-no-wrap">
      <!-- V2: Fixed-width left column for alignment -->
      <!-- All conditions have the same width for the operator/label section -->
      <div class="flex items-center justify-center mt-1 min-w-15">
        <!-- First condition in root group -->
        <template v-if="index === 0 && depth === 0">
          <span class="text-sm">if</span>
        </template>

        <!-- First condition in nested groups: empty space for alignment -->
        <template v-else-if="isFirstInGroup">
          <!-- Empty space to maintain alignment -->
        </template>

        <!-- Other conditions: show operator + toggle button -->
        <template v-else>
          <span
            class="text-sm font-medium min-w-7.5 lowercase"
            data-test="alert-conditions-operator-label"
            :data-test-label="computedLabel"
          >
            {{ computedLabel }}
          </span>
          <!-- Toggle AND/OR button -->
          <OButton
            data-test="alert-conditions-toggle-operator-btn"
            variant="ghost"
            size="icon-circle-sm"
            class="h-6.5 flex-shrink-0 text-button-primary! hover:bg-[color-mix(in_srgb,var(--color-button-primary)_10%,transparent)]!"
            @click="toggleOperator"
          >
            <OIcon name="restart-alt" size="sm" />
            <OTooltip content="Toggle between and/or" />
          </OButton>
        </template>
      </div>
        <div class="ml-0">
          <OSelect
            v-model="condition.column"
            :options="filteredFields"
            :dropdownStyle="{ textTransform: 'lowercase' }"
            searchable
            :searchDebounce="400"
            labelKey="label"
            valueKey="value"
            width="xs"
            :placeholder="t('alerts.column')"
            :creatable="props.allowCustomColumns"
            :class="[inputWidth ? inputWidth : '']"
            :error="!!columnError"
            :error-message="columnError"
            data-test="alert-conditions-select-column"
            @search="filterColumns"
            @update:model-value="() => { columnError = ''; emits('input:update', 'conditions', condition) }"
            @blur="validateColumn"
          />
          <OTooltip v-if="condition.column && store.state.isAiChatEnabled" :content="condition.column" />
        </div>
        <div class="ml-0">
          <OSelect
            v-model="condition.operator"
            :options="triggerOperators"
            :dropdownStyle="{ textTransform: 'capitalize' }"
            :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-17.5' : computedInputWidth)]"
            :error="!!operatorError"
            :searchable="false"
            :error-message="operatorError"
            data-test="alert-conditions-operator-select"
            @update:model-value="() => { operatorError = ''; emits('input:update', 'conditions', condition) }"
            @blur="validateOperator"
          />
          <OTooltip v-if="condition.operator && store.state.isAiChatEnabled" :content="condition.operator" />
        </div>
        <div class="ml-0">
          <OInput
            v-model="condition.value"
            :placeholder="t('common.value')"
            :error="!!valueError"
            :error-message="valueError"
            :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-27.5' : computedValueWidth)]"
            data-test="alert-conditions-value-input"
            @update:model-value="() => { valueError = ''; emits('input:update', 'conditions', condition) }"
            @blur="validateValue"
          />
          <OTooltip v-if="condition.value && store.state.isAiChatEnabled" :content="condition.value" />
        </div>
    </div>
  </template>

  <script setup lang="ts">
  import OButton from '@/lib/core/Button/OButton.vue';
  import OSelect from '@/lib/forms/Select/OSelect.vue';
  import OInput from '@/lib/forms/Input/OInput.vue';
  import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
  const props = defineProps({
        condition: {
        type: Object,
        default: () => {},
        required: true,
        },
    streamFields: {
        type: Array,
        default: () => [],
        required: true,
    },
    index: {
        type: Number,
        default: 0,
        required: true,
    },
    label: {
        type: String,
        default: '',
        required: true,
    },
    depth: {
        type: Number,
        default: 0,
        required: true,
    },
    inputWidth: {
        type: String,
        default: '',
        required: false,
    },
    isFirstInGroup: {
        type: Boolean,
        default: false,
        required: false,
    },
    allowCustomColumns: {
        type: Boolean,
        default: false,
        required: false,
    },
    module: {
        type: String,
        default: 'alerts',
        required: false,
        validator: (value: string) => ['alerts', 'pipelines'].includes(value),
    },
    });

import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";

  var triggerOperators: any = ref([
  "=",
  "!=",
  ">=",
  "<=",
  ">",
  "<",
  "Contains",
  "NotContains",
]);
const emits = defineEmits(["add", "remove", "input:update", "add-group"]);

const filteredFields = ref<any[]>(props.streamFields as any[]);

watch(
  () => props.streamFields,
  (newFields) => {
    filteredFields.value = newFields as any[];
  },
);

const store = useStore();

const { t } = useI18n();

// Inline error state
const columnError = ref('');
const operatorError = ref('');
const valueError = ref('');

const validateColumn = () => {
  columnError.value = !props.condition.column ? 'Field is required!' : '';
};
const validateOperator = () => {
  operatorError.value = !props.condition.operator ? 'Field is required!' : '';
};
const validateValue = () => {
  valueError.value = !props.condition.value ? 'Field is required!' : '';
};

defineExpose({
  validate: () => {
    validateColumn();
    validateOperator();
    validateValue();
    return !columnError.value && !operatorError.value && !valueError.value;
  },
});

const deleteApiHeader = (field: any) => {
  emits("remove", field);
  emits("input:update", "conditions", field);
};

const addApiHeader = (groupId: string) => {
  emits("add", groupId);
};

const addGroupApiHeader = (groupId: string) => {
  emits("add-group", groupId);
};

const computedLabel = computed(() => {
  // V2: First condition in any group should not show AND/OR operator
  // Only subsequent conditions show the operator
  if (props.isFirstInGroup) {
    return '';  // No operator for first condition in group
  }
  // V2: Use condition's logicalOperator if available
  if (props.condition.logicalOperator) {
    return props.condition.logicalOperator;
  }
  return props.label;
});

// Toggle operator between AND/OR for this condition
const toggleOperator = () => {
  if (props.condition.logicalOperator) {
    props.condition.logicalOperator = props.condition.logicalOperator === 'AND' ? 'OR' : 'AND';
    emits('input:update', 'conditions', props.condition);
  }
};

const computedInputWidth = computed(() => {
  // If custom width is provided, use it; otherwise use default responsive width
  return props.inputWidth || (store.state.isAiChatEnabled ? '' : 'xl:min-w-50 lg:min-w-22.5 lg:w-fit');
});

const computedValueWidth = computed(() => {
  // If custom width is provided, use it; otherwise use default responsive width
  return props.inputWidth || (store.state.isAiChatEnabled ? 'w-27.5' : 'xl:min-w-50 lg:w-fit lg:min-w-20');
});


const filterColumns = (val: string) => {
  if (val === "") {
    filteredFields.value = [...props.streamFields as any[]];
  } else {
    const value = val.toLowerCase();
    filteredFields.value = (props.streamFields as any[]).filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  }
};

  </script>
