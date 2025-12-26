<template>
    <div class=" tw:flex tw:items-start tw:gap-1 tw:flex-no-wrap ">
      <!-- V2: Fixed-width left column for alignment -->
      <!-- All conditions have the same width for the operator/label section -->
      <div class="tw:flex tw:items-center tw:justify-center tw:mt-2 tw:min-w-[60px]">
        <!-- First condition in root group: show "if" centered -->
        <template v-if="index === 0 && depth === 0">
          <span class="tw:text-sm">if</span>
        </template>

        <!-- First condition in nested groups: empty space for alignment -->
        <template v-else-if="isFirstInGroup">
          <!-- Empty space to maintain alignment -->
        </template>

        <!-- Other conditions: show operator + toggle button -->
        <template v-else>
          <span class="tw:text-sm tw:font-medium tw:min-w-[30px] tw:lowercase">
            {{ computedLabel }}
          </span>
          <!-- Toggle AND/OR button after label -->
          <q-btn
            data-test="alert-conditions-toggle-operator-btn"
            flat
            dense
            round
            size="sm"
            icon="restart_alt"
            class="tw:h-[26px] tw:flex-shrink-0 operator-toggle-btn"
            @click="toggleOperator"
          >
            <q-tooltip>
              Toggle between and/or
            </q-tooltip>
          </q-btn>
        </template>
      </div>
        <div
          data-test="alert-conditions-select-column"
          class="q-ml-none tw:mb-2"
        >
          <q-select
            v-model="condition.column"
            :options="filteredFields"
            :popup-content-style="{ textTransform: 'lowercase' }"
            borderless
            emit-value
            dense
            use-input
            hide-selected
            fill-input
            hide-bottom-space
            :input-debounce="400"
            :placeholder="t('alerts.column')"
            class="tw:mb-2"
            @filter="filterColumns"
            behavior="menu"
            :rules="[
              (val: any) => !!val || 'Field is required!',
              validateColumnField
            ]"
            :class="inputWidth ? inputWidth : ''"
            @update:model-value="emits('input:update', 'conditions', condition)"
            :new-value-mode="props.allowCustomColumns ? 'add-unique' : undefined"
          >
          <q-tooltip v-if="condition.column && store.state.isAiChatEnabled">
            {{ condition.column }}
          </q-tooltip>
        </q-select>
        </div>
        <div
          data-test="alert-conditions-operator-select"
          class="q-ml-none"
        >
          <q-select
            v-model="condition.operator"
            :options="triggerOperators"
            :popup-content-style="{ textTransform: 'capitalize' }"
            stack-label
            borderless
            dense
            hide-bottom-space
            :rules="[(val: any) => !!val || 'Field is required!']"
            :class="inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'tw:w-[70px]' : computedInputWidth)"
            @update:model-value="emits('input:update', 'conditions', condition)"
          >
          <q-tooltip v-if="condition.operator && store.state.isAiChatEnabled">
            {{ condition.operator }}
          </q-tooltip>
        </q-select>
        </div>
        <div
          data-test="alert-conditions-value-input"
          class="q-ml-none"
        >
          <q-input
            v-model="condition.value"
            :options="streamFields"
            :popup-content-style="{ textTransform: 'capitalize' }"
            :placeholder="t('common.value')"
            stack-label
            borderless
            dense
            hide-bottom-space
            :rules="[(val: any) => !!val || 'Field is required!']"
            :class="inputWidth ? inputWidth : (store.state.isAiChatEnabled ? 'tw:w-[110px]' : computedValueWidth)"
            @update:model-value="emits('input:update', 'conditions', condition)"
          >
          <q-tooltip v-if="condition.value && store.state.isAiChatEnabled">
            {{ condition.value }}
          </q-tooltip>
        </q-input>
        </div>
    </div>
  </template>
  
  <script setup lang="ts">
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

import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { useStore } from "vuex";

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

const filteredFields = ref(props.streamFields);

const store = useStore();

const { t } = useI18n();

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
  return props.inputWidth || (store.state.isAiChatEnabled ? '' : 'xl:tw:min-w-[200px] lg:tw:min-w-[90px] lg:tw:w-fit');
});

const computedValueWidth = computed(() => {
  // If custom width is provided, use it; otherwise use default responsive width
  return props.inputWidth || (store.state.isAiChatEnabled ? 'tw:w-[110px]' : 'xl:tw:min-w-[200px] lg:tw:w-fit lg:tw:min-w-[80px]');
});


const filterColumns = (val: string, update: Function) => {
  if (val === "") {
    update(() => {
      filteredFields.value = [...props.streamFields];
    });
  }
  update(() => {
    const value = val.toLowerCase();
    filteredFields.value = props.streamFields.filter(
      (column: any) => column.value.toLowerCase().indexOf(value) > -1
    );
  });
};

// Validation rule for column field - checks if field exists in dropdown (only for alerts)
const validateColumnField = (val: any) => {
  // Skip validation if field is empty (required validation handles this)
  if (!val || val === '') return true;

  // Skip validation for pipelines module (they can use custom fields)
  if (props.module === 'pipelines') return true;

  // For alerts module: check if the selected field exists in the available streamFields
  const fieldExists = props.streamFields.some((field: any) => field.value === val);

  if (!fieldExists) {
    return 'Field doesn\'t exist.';
  }

  return true;
};
  </script>

  <style scoped>
.operator-toggle-btn {
  color: var(--o2-primary-btn-bg) !important;
}

.operator-toggle-btn:hover {
  background-color: rgba(var(--o2-primary-btn-bg-rgb), 0.1) !important;
}
</style>
  