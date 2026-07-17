<template>
    <div class="flex items-start gap-1 flex-no-wrap">
      <!-- V2: Fixed-width left column for alignment -->
      <!-- All conditions have the same width for the operator/label section -->
      <div class="flex items-center justify-center mt-1 min-w-[60px]">
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
            class="text-sm font-medium min-w-[30px] lowercase"
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
            class="h-[26px] flex-shrink-0 text-(--o2-primary-btn-bg)! hover:bg-[rgba(var(--o2-primary-btn-bg-rgb),0.1)]!"
            @click="toggleOperator"
          >
            <OIcon name="restart-alt" size="sm" />
            <OTooltip :content="t('alerts.filters.toggleOperatorTooltip')" />
          </OButton>
        </template>
      </div>
        <!-- FORM MODE (namePrefix + an injected OForm context): the three
             controls are name=-owned by the TanStack form — no v-model, no
             manual error refs; schema errors surface post-submit via the
             OForm* wrappers (R3). Bare mode below stays byte-compatible
             (pipeline's NodeForm consumes these bare — permanent, sanctioned). -->
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
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-[70px]' : computedInputWidth)]"
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
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-[110px]' : computedValueWidth)]"
              data-test="alert-conditions-value-input"
              @update:model-value="() => emits('input:update', 'conditions', condition)"
            />
            <OTooltip v-if="condition.value && store.state.isAiChatEnabled" :content="condition.value" />
          </div>
        </template>
        <!-- BARE MODE (no namePrefix / no OForm context) — today's markup,
             unchanged. Do NOT degrade: pipeline consumes it permanently. -->
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
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-[70px]' : computedInputWidth)]"
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
              :class="[inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'w-[110px]' : computedValueWidth)]"
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
     * Dual-mode switch (alerts-migration.md §A). When set AND an OForm context
     * is injectable, the three controls render as OForm* fields name=-bound to
     * `${namePrefix}.column` / `.operator` / `.value` — the TanStack form owns
     * their values (no v-model, no manual error refs). When empty (default)
     * the component renders today's BARE markup unchanged (pipeline's
     * NodeForm/Condition.vue consumes it bare — a permanent, sanctioned mode).
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
// and the OForm* wrappers surface errors (R3).
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
  // If custom width is provided, use it; otherwise use default responsive width
  return props.inputWidth || (store.state.isAiChatEnabled ? '' : 'xl:min-w-[200px] lg:min-w-[90px] lg:w-fit');
});

const computedValueWidth = computed(() => {
  // If custom width is provided, use it; otherwise use default responsive width
  return props.inputWidth || (store.state.isAiChatEnabled ? 'w-[110px]' : 'xl:min-w-[200px] lg:w-fit lg:min-w-[80px]');
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
