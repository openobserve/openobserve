<template>
    <!-- Preview Section (only for root level) -->
    <div v-if="depth === 0 && previewString"
         class="tw:mb-2 tw:p-2 tw:rounded tw:border tw:w-full"
         :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:border-gray-700' : 'tw:bg-gray-50 tw:border-gray-300'">
      <div class="tw:flex tw:items-center tw:gap-1 tw:cursor-pointer tw:min-w-0" @click="showPreview = !showPreview">
        <q-icon
          :name="showPreview ? 'expand_more' : 'chevron_right'"
          size="16px"
          class="tw:flex-shrink-0"
          :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'"
        />
        <span class="tw:font-medium tw:text-xs tw:flex-shrink-0"
              :class="store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-gray-700'">
          Preview:
        </span>
        <span v-if="showPreview"
              class="tw:text-[10px] tw:font-mono tw:leading-[1.3] tw:min-w-0 tw:break-words"
              :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">
          {{ previewString }}
        </span>
      </div>
    </div>

    <div :class="[`  tw:px-2 tw:mb-2 el-border tw:mt-6 el-border-radius `,
        store.state.isAiChatEnabled ? `tw:w-full tw:ml-[${depth * 10}px]` : `xl:tw:w-fit tw:ml-[${depth * 20}px]`
    ]"
    :style="{
        opacity: computedOpacity,
        backgroundColor: computedStyleMap
    }"
    >
      <!-- V2: Group-level toggle only for nested groups (depth > 0) -->
      <!-- Root group (depth 0) doesn't need toggle - its logicalOperator is dummy -->
      <div v-if="depth > 0" class="tw:w-fit condition-tabs el-border">
        <AppTabs
          data-test="scheduled-alert-tabs"
          :tabs="tabOptions"
          class="tw:h-[20px] custom-tabs-selection-container"
          v-model:active-tab="label"
          @update:active-tab="toggleLabel"
        />
      </div>
      <!-- Spacer for root group to maintain consistent spacing -->
      <div v-else class="tw:h-[14px]"></div>

      <!-- Group content -->

      <div v-if="isOpen" class="tw:overflow-x-auto group-container" :class="store.state.theme === 'dark' ? 'dark-mode-group' : 'light-mode-group'">
        <!-- Items in group (V2 uses 'conditions' array) -->
        <div class="tw:ml-2 tw:whitespace-nowrap " v-for="(item, index) in props.group.conditions" :key="index">
          <FilterGroup
            v-if="isGroup(item)"
            :group="item"
            :depth="depth + 1"
            :is-first-group="index === 0 && depth === 0"
            @add-condition="emit('add-condition', $event)"
            @add-group="emit('add-group', $event)"
            @remove-group="emit('remove-group', $event)"
            :stream-fields="props.streamFields"
            :condition-input-width="props.conditionInputWidth"
            :allow-custom-columns="props.allowCustomColumns"
            :module="props.module"
            @input:update="(name, field) => inputUpdate(name, field)"
          />
          <div
            v-else
            class="tw:flex tw:items-center tw:gap-2  "
            :class="store.state.isAiChatEnabled ? 'tw:pl-0' : 'tw:pl-4'"
            >
            <FilterCondition
                :condition="item"
                :stream-fields="props.streamFields"
                @input:update="(name, field) => inputUpdate(name, field)"
                :index="index"
                :label="group.logicalOperator?.toLowerCase() || 'and'"
                :depth="depth"
                :input-width="props.conditionInputWidth"
                :is-first-in-group="index === 0"
                :allow-custom-columns="props.allowCustomColumns"
                :module="props.module"
            />
            <div class="tw:mb-3">
                <q-btn data-test="alert-conditions-delete-condition-btn" icon="close" size="10px" flat border-less @click="removeCondition(item.id)" />
            </div>
                </div>
        </div>
        <!-- Action buttons -->

        <div class="flex justify-start items-center tw:ml-4"
        >
        <q-btn
            data-test="alert-conditions-add-condition-btn"
            class="q-ml-xs flex justify-between items-center"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="sm"
            unelevated
            size="sm"
            flat
            @click="addCondition(props.group.groupId)"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition</span>
            <q-tooltip :delay="300">
              Add a new condition to this group
            </q-tooltip>
        </q-btn>
        <q-btn
            data-test="alert-conditions-add-condition-group-btn"
            class="q-ml-xs flex justify-between items-center"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="sm"
            unelevated
            size="sm"
            flat
            @click="addGroup(props.group.groupId)"
            :disabled="depth >= 2"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition Group</span>
            <q-tooltip v-if="depth < 2" :delay="300">
              Add a nested condition group (max depth: 2)
            </q-tooltip>
            <q-tooltip v-else :delay="300">
              Maximum nesting depth reached
            </q-tooltip>
        </q-btn>
        <q-btn
            data-test="alert-conditions-reorder-btn"
            class="q-ml-xs flex justify-between items-center"
            padding="sm"
            unelevated
            size="sm"
            flat
            @click="reorderItems()"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" name="swap_vert" />
            <span class="text-bold">Reorder</span>
            <q-tooltip :delay="300">
              Reorder items: Conditions first, then Groups
            </q-tooltip>
        </q-btn>
     </div>
        </div>
    </div>
    <confirm-dialog
      v-model="confirmDialog.show"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :warning-message="confirmDialog.warningMessage"
      @update:ok="confirmDialog.okCallback"
      @update:cancel="confirmDialog.show = false"
    />
  </template>

  <script setup lang="ts">
    import { computed, ref, watch } from 'vue';
    import FilterCondition from './FilterCondition.vue';
    import { useStore } from 'vuex';
    import { getUUID } from '@/utils/zincutils';
    import AppTabs from '../common/AppTabs.vue';
    import ConfirmDialog from '@/components/ConfirmDialog.vue';
    import { buildConditionsString } from '@/utils/alerts/conditionsFormatter';
    const props = defineProps({
    group: {
        type: Object,
        default: () => {

        },
        required: true,
    },
    streamFields: {
        type: Array,
        default: () => [],
        required: true,
    },
    depth: {
        type: Number,
        default: 0,
        required: true,
    },
    conditionInputWidth: {
        type: String,
        default: '',
        required: false,
    },
    isFirstGroup: {
        type: Boolean,
        default: false,
        required: false,
    },
    allowCustomColumns: {
        type: Boolean,
        default: false,
        required: false,
    },
    showSqlPreview: {
        type: Boolean,
        default: false,
        required: false,
    },
    streamFieldsMap: {
        type: Object,
        default: () => ({}),
        required: false,
    },
    sqlQuery: {
        type: String,
        default: '',
        required: false,
    },
    module: {
        type: String,
        default: 'alerts',
        required: false,
        validator: (value: string) => ['alerts', 'pipelines'].includes(value),
    },
    });
  
  const emit = defineEmits<{
    (e: 'add-condition', groupId: any): void;
    (e: 'add-group', groupId: any): void;
    (e: 'remove-group', groupId: any): void;
    (e: 'update-group', groupId: any): void;
    (e: 'input:update', name: string, field: any): void;
  }>();
  
  const isOpen = ref(true);
  const groups = ref(props.group);
  const showPreview = ref(true);

  const store = useStore();

  // V2: Use logicalOperator (AND/OR) instead of label (and/or)
  const label = ref(props.group.logicalOperator?.toLowerCase() || 'and');

  const confirmDialog = ref({
    show: false,
    title: '',
    message: '',
    warningMessage: '',
    okCallback: () => {},
  });

  // Watch for prop changes to keep groups in sync with parent
  watch(() => props.group, (newGroup) => {
    groups.value = newGroup;
    // V2: Use logicalOperator instead of label
    label.value = newGroup.logicalOperator?.toLowerCase() || 'and';
  }, { deep: true });

  const tabOptions = computed(() => [
    {
      label: "OR",
      value: "or",
    },
    {
      label: "AND",
      value: "and",
    },
  ]);

  function isGroup(item: any) {
    // V2: Check for filterType === "group" with conditions array
    if (item && item.filterType === "group" && item.conditions && Array.isArray(item.conditions)) {
      return true;
    }
    // V1 compatibility: Check for items array (legacy)
    if (item && item.items && Array.isArray(item.items) && item.groupId) {
      return true;
    }
    return false;
  }
  
  const addCondition = (groupId: string) => {
    // V2: Create condition with filterType and logicalOperator
    const newCondition = {
      filterType: 'condition',
      column: '',
      operator: '=',
      value: '',
      values: [],
      logicalOperator: groups.value.logicalOperator || 'AND',
      id: getUUID(),
    };
    groups.value.conditions.push(newCondition);
    emit('add-condition', groups.value);
  };
  
  const addGroup = (groupId: string) => {
    // V2: Create group with filterType, logicalOperator, and conditions array
    const newGroup = {
      filterType: 'group',
      logicalOperator: 'OR',
      groupId: getUUID(),
      conditions: [
        {
          filterType: 'condition',
          column: '',
          operator: '=',
          value: '',
          values: [],
          logicalOperator: 'OR',
          id: getUUID(),
        }
      ]
    };
    groups.value.conditions.push(newGroup);
    emit('add-group', groups.value);
  };
  
  // Toggle AND/OR
  const toggleLabel = (newLabel?: string) => {
    // V2: Use logicalOperator instead of label
    // If newLabel is provided, use it; otherwise toggle
    if (newLabel) {
      groups.value.logicalOperator = newLabel.toUpperCase();
    } else {
      groups.value.logicalOperator = groups.value.logicalOperator === 'AND' ? 'OR' : 'AND';
    }
    emit('add-group', groups.value); // optional, sync with parent
    emit('input:update', 'conditions', groups.value);
  };

  const removeCondition = (id: string) => {
    // V2: Use conditions array instead of items
    // First, check what will happen after removing this condition
    const itemsAfterRemoval = groups.value.conditions.filter((item: any) => item.id !== id);
    const hasConditionsAfterRemoval = itemsAfterRemoval.some((item: any) => !isGroup(item));

    // Count sub-groups that will be deleted
    const subGroupCount = itemsAfterRemoval.filter((item: any) => isGroup(item)).length;

    // If removing this condition will cause the group to be deleted (no conditions left)
    // and there are sub-groups, show confirmation dialog
    if (!hasConditionsAfterRemoval && subGroupCount > 0) {
      confirmDialog.value = {
        show: true,
        title: 'Delete Condition',
        message: 'Deleting this condition will remove the entire condition group.',
        warningMessage: `This will also delete ${subGroupCount} sub-group${subGroupCount > 1 ? 's' : ''} nested under this group. This action cannot be undone.`,
        okCallback: () => {
          // User confirmed, proceed with deletion
          performRemoveCondition(id);
          confirmDialog.value.show = false;
        },
      };
    } else {
      // Safe to delete without confirmation
      performRemoveCondition(id);
    }
  };

  const performRemoveCondition = (id: string) => {
    // V2: Use conditions array instead of items
    groups.value.conditions = groups.value.conditions.filter((item: any) => item.id !== id);

    // Check if there are any conditions left (not sub-groups)
    const hasConditions = groups.value.conditions.some((item: any) => !isGroup(item));

    if (!hasConditions) {
      // No conditions left, clear all items (including sub-groups) and remove this entire group
      groups.value.conditions = [];
      emit('remove-group', props.group.groupId);
    } else {
      emit('add-group', groups.value); // update as usual
    }
  };

  const inputUpdate = (name: string, field: any) => {
    emit('input:update', name, field);
  };

  const reorderItems = () => {
    // V2: Use conditions array instead of items
    // Separate conditions and groups
    const conditions = groups.value.conditions.filter((item: any) => !isGroup(item));
    const subGroups = groups.value.conditions.filter((item: any) => isGroup(item));

    // Reorder: conditions first, then groups
    groups.value.conditions = [...conditions, ...subGroups];

    // Emit update
    emit('add-group', groups.value);
    emit('input:update', 'conditions', groups.value);
  };


function hexToHSL(hex: string) {
  let r = 0, g = 0, b = 0;

  // Convert hex to RGB
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }

  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      case b: h = ((r - g) / d) + 4; break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToCSS(h: number, s: number, l: number) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}
const computedStyleMap = computed(() => {
  const isDark = store.state.theme === 'dark';

  if (isDark) {
    const baseColor = '#212121';
    const { h, s, l } = hexToHSL(baseColor);
    const newLightness = Math.min(l + props.depth * 1, 90); // 1% per depth step
    return hslToCSS(h, s, newLightness);
  } else {
    const baseColor = '#ffffff'; // white
    const { h, s, l } = hexToHSL(baseColor);
    const newLightness = Math.max(l - props.depth * 2, 80); // 2% darker per depth, min 80%
    return hslToCSS(h, s, newLightness);
  }
});


const computedOpacity = computed(() => {
  return props.depth + 10;
});

// Computed preview string
// Supports three modes:
// 1. Display mode (default): lowercase operators, simple formatting, wrapped in parentheses - for pipelines
// 2. SQL Query mode (when sqlQuery prop provided): shows full SQL query - for alerts
// 3. WHERE clause mode (when showSqlPreview=true but no sqlQuery): shows just WHERE clause
const previewString = computed(() => {
  // Mode 1: Full SQL Query (for alerts with aggregation, etc.)
  if (props.sqlQuery && props.sqlQuery.trim().length > 0) {
    return props.sqlQuery;
  }

  // Mode 2: SQL WHERE clause only (fallback for alerts)
  if (props.showSqlPreview) {
    return buildConditionsString(groups.value, {
      sqlMode: true,              // SQL format (uppercase AND/OR, LIKE operators)
      addWherePrefix: true,        // Add "WHERE" prefix
      formatValues: true,          // Type-aware formatting (Int64 no quotes, String with quotes)
      streamFieldsMap: props.streamFieldsMap,
    });
  }

  // Mode 3: Display format (for pipelines)
  const preview = buildConditionsString(groups.value, {
    sqlMode: false,            // Display format (lowercase operators)
    addWherePrefix: false,
    formatValues: false,       // Simple display format without type-aware formatting
  });
  // Wrap the entire root expression in parentheses
  return preview ? `(${preview})` : '';
});

// Expose functions for testing
defineExpose({
  isGroup,
  addCondition,
  addGroup,
  toggleLabel,
  removeCondition,
  performRemoveCondition,
  inputUpdate,
  reorderItems,
  hexToHSL,
  hslToCSS,
  computedStyleMap,
  computedOpacity,
  groups,
  label,
  isOpen,
  confirmDialog
});

  </script>

  <style lang="scss">

    .condition-container {
        overflow-x: auto;
        max-width: 900px;
    }


    .group-tabs {
      position: relative;

      border-radius: 4px;
      overflow: hidden;
      bottom: 12px;
      .q-tab{
        height: 24px !important;
        min-height: 24px !important;
        width: 50px !important;
        min-width: 50px !important;
      }
      .q-tab__label{
        font-size: 10px !important;
      }
    }
    .group-container.dark-mode-group {
    scrollbar-color: #818181 #212121; /* thumb color, track color */
  }

.group-container.light-mode-group {
  scrollbar-color: #999 #ffffff;
}

/* For more control using WebKit scrollbar styling */
.group-container::-webkit-scrollbar {
  width: 8px;
  height: 4px !important;
}

.group-container.dark-mode-group::-webkit-scrollbar-track {
  background: red;
}

.group-container.dark-mode-group::-webkit-scrollbar-thumb {
  background-color: #b10000;
  border-radius: 4px;
}

.group-container.light-mode-group::-webkit-scrollbar-track {
  background: #ffffff;
}

.group-container.light-mode-group::-webkit-scrollbar-thumb {
  background-color: #999;
  border-radius: 4px;
}

  .group-tabs {
      border: 1px solid $border-color;
      background-color: transparent !important;
    .q-tab--active {
      background-color: var(--o2-primary-btn-bg);
      color: $white;
    }

      .q-tab__indicator {
        display: none;
      }

  

    .q-tab--inactive {
      background-color: var(--o2-inactive-tab-bg);
    }

    .q-tab{
          &:hover:not(.q-tab--active) {
    background-color: color-mix(in srgb, var(--o2-tab-bg) 70%, var(--o2-theme-mode) 50%);
  }

    &:hover.q-tab--active {
      background-color: var(--o2-primary-btn-bg) !important;
    }
      }
    }
    
  .condition-tabs{
    position: relative;
    bottom: 14px;
    border-radius: 4px;
    height: 28px;
    padding: 2px;
    background-color: var(--o2-card-bg);
  }
  .custom-tabs-selection-container{
    border: none;
    border-radius: none;
    .o2-tab{
      border-radius: 4px;
      height: 22px;
      padding: 4px 12px;
      border-bottom: none;
      white-space: normal;
      line-height: 1rem;
      font-size: 10px;
      border-bottom: none !important;
    }
    .o2-tab.active{
      background-color: var(--o2-primary-btn-bg) !important;
      color: rgba(255,255,255) !important;
    }
    .o2-tab:hover{
      background-color: var(--o2-hover-accent) !important;
    }
    .o2-tab.active:hover{
      background-color: var(--o2-primary-btn-bg) !important;
    }
  }


  </style>
  