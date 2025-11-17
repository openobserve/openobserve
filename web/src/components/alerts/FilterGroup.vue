<template>
    <div :class="[`  tw-px-2 tw-mb-2 el-border tw-mt-6 el-border-radius `, 
        store.state.isAiChatEnabled ? `tw-w-full tw-ml-[${depth * 10}px]` : `xl:tw-w-fit tw-ml-[${depth * 20}px]`
    ]"
    :style="{
        opacity: computedOpacity,
        backgroundColor: computedStyleMap
    }"
    >  
        <div class="  tw-w-fit condition-tabs el-border"
        >
          <AppTabs
            data-test="scheduled-alert-tabs"
            :tabs="tabOptions"
            class="tw-h-[20px] custom-tabs-selection-container"
            v-model:active-tab="label"
            @update:active-tab="toggleLabel"
          />
      </div>
  
      <!-- Group content -->

      <div v-if="isOpen" class="tw-overflow-x-auto group-container" :class="store.state.theme === 'dark' ? 'dark-mode-group' : 'light-mode-group'">
        <!-- Items in group -->
        <div class="tw-ml-2 tw-whitespace-nowrap " v-for="(item, index) in props.group.items" :key="index">
          <FilterGroup
            v-if="isGroup(item)"
            :group="item"
            :depth="depth + 1"
            @add-condition="emit('add-condition', $event)"
            @add-group="emit('add-group', $event)"
            @remove-group="emit('remove-group', $event)"
            :stream-fields="props.streamFields"
            :condition-input-width="props.conditionInputWidth"
            @input:update="(name, field) => inputUpdate(name, field)"
          />
          <div
            v-else
            class="tw-flex tw-items-center tw-gap-2  "
            :class="store.state.isAiChatEnabled ? 'tw-pl-0' : 'tw-pl-4'"
            >
            <FilterCondition
                :condition="item"
                :stream-fields="props.streamFields"
                @input:update="(name, field) => inputUpdate(name, field)"
                :index="index"
                :label="group.label"
                :depth="depth"
                :input-width="props.conditionInputWidth"
            />
            <div class="tw-mb-1" v-if="!(index === 0 && depth === 0)">
                <q-btn data-test="alert-conditions-delete-condition-btn" icon="close" size="10px" flat border-less @click="removeCondition(item.id)" />
            </div>
                </div>
        </div>
        <!-- Action buttons -->

        <div class="flex justify-start items-center tw-ml-4"
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
            <q-tooltip>
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
            <q-tooltip v-if="depth < 2">
              Add a nested condition group (max depth: 2)
            </q-tooltip>
            <q-tooltip v-else>
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
            <q-tooltip>
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

  const store = useStore();

  const label = ref(props.group.label);

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
    label.value = newGroup.label;
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
    return item && item.items && Array.isArray(item.items);
  }
  
  const addCondition = (groupId: string) => {
    groups.value.items.push({
      column: '',
      operator: '=',
      value: '',
      ignore_case: true,
      id: getUUID(),
    });
    emit('add-condition', groups.value);
  };
  
  const addGroup = (groupId: string) => {

    groups.value.items.push({
      groupId: getUUID(),
      label: 'or',
      items: [
        {
          column: '',
          operator: '=',
          value: '',
          ignore_case: true,
          id: getUUID(),
        }
      ]
    });
    emit('add-group', groups.value);
  };
  
  // Toggle AND/OR
  const toggleLabel = (newLabel?: string) => {
    // If newLabel is provided, use it; otherwise toggle
    if (newLabel) {
      groups.value.label = newLabel;
    } else {
      groups.value.label = groups.value.label === 'and' ? 'or' : 'and';
    }
    emit('add-group', groups.value); // optional, sync with parent
    emit('input:update', 'conditions', groups.value);
  };

  const removeCondition = (id: string) => {
    // First, check what will happen after removing this condition
    const itemsAfterRemoval = groups.value.items.filter((item: any) => item.id !== id);
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
    groups.value.items = groups.value.items.filter((item: any) => item.id !== id);

    // Check if there are any conditions left (not sub-groups)
    const hasConditions = groups.value.items.some((item: any) => !isGroup(item));

    if (!hasConditions) {
      // No conditions left, remove this entire group (including all sub-groups)
      emit('remove-group', props.group.groupId);
    } else {
      emit('add-group', groups.value); // update as usual
    }
  };

  const inputUpdate = (name: string, field: any) => {
    emit('input:update', name, field);
  };

  const reorderItems = () => {
    // Separate conditions and groups
    const conditions = groups.value.items.filter((item: any) => !isGroup(item));
    const subGroups = groups.value.items.filter((item: any) => isGroup(item));

    // Reorder: conditions first, then groups
    groups.value.items = [...conditions, ...subGroups];

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
  