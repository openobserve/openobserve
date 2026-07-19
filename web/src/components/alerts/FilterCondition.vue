<template>
    <div class="flex items-start gap-1 flex-no-wrap">
      <!-- Fixed-width left column for alignment -->
      <!-- All conditions have the same width for the operator/label section -->
      <div class="flex items-center justify-center mt-1 min-w-15">
        <!-- First condition in root group -->
        <template v-if="index === 0 && depth === 0">
          <span class="text-sm">{{ t('alerts.filters.if') }}</span>
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
            <OTooltip :content="t('alerts.filters.toggleOperatorTooltip')" />
          </OButton>
        </template>
      </div>
        <!-- FORM MODE: controls are name-bound to the injected OForm (no
             v-model); schema errors surface via the OForm* wrappers. -->
        <template v-if="formMode">
          <div class="ml-0">
            <OFormSelect
              :name="`${namePrefix}.column`"
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
              data-test="alert-conditions-select-column"
              @search="filterColumns"
              @update:model-value="() => emits('input:update', 'conditions', condition)"
            />
            <OTooltip v-if="condition.column && store.state.isAiChatEnabled" :content="condition.column" />
          </div>
          <div class="ml-0">
            <OFormSelect
              :name="`${namePrefix}.operator`"
              :options="triggerOperators"
              :dropdownStyle="{ textTransform: 'capitalize' }"
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-17.5' : computedInputWidth)]"
              :searchable="false"
              data-test="alert-conditions-operator-select"
              @update:model-value="() => emits('input:update', 'conditions', condition)"
            />
            <OTooltip v-if="condition.operator && store.state.isAiChatEnabled" :content="condition.operator" />
          </div>
          <div class="ml-0">
            <OFormInput
              :name="`${namePrefix}.value`"
              :placeholder="t('common.value')"
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-27.5' : computedValueWidth)]"
              data-test="alert-conditions-value-input"
              @update:model-value="() => emits('input:update', 'conditions', condition)"
            />
            <OTooltip v-if="condition.value && store.state.isAiChatEnabled" :content="condition.value" />
          </div>
        </template>
        <!-- BARE MODE (no namePrefix / no OForm context): pipeline consumes
             these controls bare, with v-model and inline error refs. -->
        <template v-else>
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
        </template>
    </div>
  </template>

  <script setup lang="ts">
  import OButton from '@/lib/core/Button/OButton.vue';
  import OSelect from '@/lib/forms/Select/OSelect.vue';
  import OInput from '@/lib/forms/Input/OInput.vue';
  import OFormSelect from '@/lib/forms/Select/OFormSelect.vue';
  import OFormInput from '@/lib/forms/Input/OFormInput.vue';
  import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
  import { FORM_CONTEXT_KEY } from '@/lib/forms/Form/OForm.types';
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
    /**
     * Dual-mode switch. When set AND an OForm context is injectable, the three
     * controls render as OForm* fields name-bound to `${namePrefix}.column` /
     * `.operator` / `.value` (the form owns their values, no v-model). When
     * empty (default) the component renders bare markup with v-model.
     */
    namePrefix: {
        type: String,
        default: '',
        required: false,
    },
    });

import { ref, computed, watch, inject } from "vue";
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

// Dual-mode: form mode only when BOTH a namePrefix is passed AND an OForm
// context is actually available (a standalone/spec mount without <OForm>
// auto-falls-back to bare mode, by design).
const form = inject(FORM_CONTEXT_KEY, null);
const formMode = computed(() => !!(props.namePrefix && form));

// Inline error state — BARE MODE ONLY. In form mode the schema owns validation
// and the OForm* wrappers surface errors.
const columnError = ref('');
const operatorError = ref('');
const valueError = ref('');

const validateColumn = () => {
  columnError.value = !props.condition.column ? t('alerts.validation.fieldRequired') : '';
};
const validateOperator = () => {
  operatorError.value = !props.condition.operator ? t('alerts.validation.fieldRequired') : '';
};
const validateValue = () => {
  valueError.value = !props.condition.value ? t('alerts.validation.fieldRequired') : '';
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
  // First condition in any group should not show AND/OR operator;
  // only subsequent conditions show the operator
  if (props.isFirstInGroup) {
    return '';  // No operator for first condition in group
  }
  // Use condition's logicalOperator if available
  if (props.condition.logicalOperator) {
    return props.condition.logicalOperator;
  }
  return props.label;
});

// Toggle operator between AND/OR for this condition. In FORM mode (alerts) the
// condition is the READONLY form read-view, so mutating it in place silently
// fails ("target is readonly") — write through the injected form by its name
// path instead. In BARE mode (pipeline) it's plain reactive, so mutate in place.
const toggleOperator = () => {
  if (!props.condition.logicalOperator) return;
  const next = props.condition.logicalOperator === 'AND' ? 'OR' : 'AND';
  if (formMode.value && form) {
    form.setFieldValue(`${props.namePrefix}.logicalOperator`, next);
  } else {
    props.condition.logicalOperator = next;
  }
  emits('input:update', 'conditions', props.condition);
};

const computedInputWidth = computed(() => {
  return props.inputWidth || (store.state.isAiChatEnabled ? '' : 'xl:min-w-50 lg:min-w-22.5 lg:w-fit');
});

const computedValueWidth = computed(() => {
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
