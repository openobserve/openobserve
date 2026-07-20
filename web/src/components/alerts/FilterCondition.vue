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
        <!-- All consumers render in FORM MODE: the three controls are name=-owned
             by the TanStack form — no v-model, no manual error refs; schema errors
             surface post-submit via the OForm* wrappers (R3). -->
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
            @create="onColumnCreate"
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
    </div>
  </template>

  <script setup lang="ts">
  import OButton from '@/lib/core/Button/OButton.vue';
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

// User-created custom columns (via `allowCustomColumns`) persist separately from
// props.streamFields, so re-filtering/searching doesn't drop them.
const customColumns = ref<any[]>([]);
const allColumns = () => [
  ...(props.streamFields as any[]),
  ...customColumns.value,
];

watch(
  () => props.streamFields,
  () => {
    filteredFields.value = allColumns();
  },
);

const store = useStore();

const { t } = useI18n();

// The injected OForm — condition values are name-bound to it (form mode is the
// only mode now); also used to write the AND/OR toggle below.
const form = inject(FORM_CONTEXT_KEY, null);

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

// Toggle operator between AND/OR for this condition. The condition is the
// READONLY form read-view, so mutating it in place silently fails ("target is
// readonly") — write through the injected form by its name path instead.
const toggleOperator = () => {
  if (!props.condition.logicalOperator) return;
  const next = props.condition.logicalOperator === 'AND' ? 'OR' : 'AND';
  form?.setFieldValue(`${props.namePrefix}.logicalOperator`, next);
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
  const base = allColumns();
  if (val === "") {
    filteredFields.value = base;
  } else {
    const value = val.toLowerCase();
    filteredFields.value = base.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  }
};

// Custom column: when `allowCustomColumns` is on, the select is `creatable` and
// emits `create` with the typed term on Enter — but only EMITS, it does not set
// the value. Add the typed column to the options so it renders, then select it.
//
// Form mode is now the only mode, so the value MUST be written through the
// injected form by its name path: `condition` is the readonly form read-view and
// assigning to it silently fails ("target is readonly"). Consumers that enable
// this: pipeline's Condition node (its guidelines tell users to press Enter),
// the workflow Condition node, and enterprise JobFilterBuilder.
const onColumnCreate = (term: string) => {
  const value = String(term ?? "").trim();
  if (!value) return;
  if (!allColumns().some((c: any) => c.value === value)) {
    const col = { label: value, value, type: "custom" };
    customColumns.value = [...customColumns.value, col];
    filteredFields.value = [...filteredFields.value, col];
  }
  form?.setFieldValue(`${props.namePrefix}.column`, value);
  emits("input:update", "conditions", props.condition);
};

  </script>
