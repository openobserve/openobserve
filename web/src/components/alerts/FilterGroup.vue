<template>
    <div :class="[`  tw-px-2 tw-mb-2 tw-border group-border tw-mt-6  `, 
        store.state.theme === 'dark' ? 'dark-mode' : 'light-mode',
        store.state.isAiChatEnabled ? `tw-w-full tw-ml-[${depth * 10}px]` : `xl:tw-w-fit tw-ml-[${depth * 20}px]`
    ]"
    :style="{
        opacity: computedOpacity,
        backgroundColor: computedStyleMap
    }"
    >    <!-- here we can implment the color picker bg -->
        <div class="  tw-w-fit group-tabs"
        :class="store.state.theme === 'dark' ? 'dark-mode-group-tabs ' : 'light-mode-group-tabs'"
        >
            <q-tabs
            data-test="scheduled-alert-tabs"
            v-model="label"
            no-caps
            outside-arrows
            size="sm"
            mobile-arrows
            class=""
            @update:model-value="toggleLabel"
      >
        <q-tab
        class=""
          data-test="scheduled-alert-custom-tab"
          name="or"
          :label="'OR'"
        />
        <q-tab
          data-test="scheduled-alert-metrics-tab"
          name="and"
          :label="'AND'"
          
        />
      </q-tabs>
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
            />
            <div class="tw-mb-1">
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
            title="Add Condition"
            @click="addCondition(props.group.groupId)"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition</span>
        </q-btn>
        <q-btn
            data-test="alert-conditions-add-condition-btn"
            class="q-ml-xs flex justify-between items-center"
            :class="store.state?.theme === 'dark' ? 'icon-dark' : ''"
            padding="sm"
            unelevated
            size="sm"
            flat
            title="Add Condition Group"
            @click="addGroup(props.group.groupId)"
            :disabled="depth >= 2"
            color="primary"
            >
            <q-icon color="primary" class="q-mr-xs text-bold" size="12px" style="border-radius: 50%;  border: 1px solid;" name="add" />
            <span class="text-bold">Condition Group</span>
        </q-btn>
     </div>
        </div>
    </div>
  </template>
  
  <script setup lang="ts">
    import { computed, ref } from 'vue';
    import FilterCondition from './FilterCondition.vue';
    import { useStore } from 'vuex';
    import { getUUID } from '@/utils/zincutils';
    import AppTabs from '../common/AppTabs.vue';
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
  const toggleLabel = () => {
    groups.value.label = groups.value.label === 'and' ? 'or' : 'and';
    emit('add-group', groups.value); // optional, sync with parent
    emit('input:update', 'conditions', groups.value);
  };

  const removeCondition = (id: string) => {
    groups.value.items = groups.value.items.filter((item: any) => item.id !== id);
    if (groups.value.items.length == 0) {
         emit('remove-group', props.group.groupId); // ask parent to remove this group
  } else {
    emit('add-group', groups.value); // update as usual
  }
  };

  const inputUpdate = (name: string, field: any) => {
    emit('input:update', name, field);
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

  </script>

  <style lang="scss">   
    .condition-container {
        overflow-x: auto;
        max-width: 900px;
    }

    .dark-mode .group-border {
        border: 1px solid #464646;
    }

    .light-mode .group-border {
        border-color: #e5e4e4;
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
      .q-tab--active {
        background-color: $primary;
        color: $white;
      }

      .q-tab__indicator {
        display: none;
      }

    }
    .dark-mode-group-tabs  .q-tab--inactive{
        background-color: #494A4A !important;
        
        color: $white
    }


    .light-mode-group-tabs {
      border: 1px solid #cdcdcd;
      .q-tab--inactive{
        background-color: #ffffff !important;
        color: black;
      }

    }
    .dark-mode-group-tabs{
      border: 1px solid #464646;
        .q-tab--inactive{
        background-color: #494A4A !important;
        opacity: 1;
        color: $white;
      }      
    }
    .group-tabs{
      .q-tab--active {
        background-color: $primary;
        color: $white;
      }
      .q-tab{
        border: none;
      }

      .q-tab__indicator {
        display: none;
      }
    }


  </style>
  