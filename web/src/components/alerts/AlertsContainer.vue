<template>
    <div
      class="tw-py-[2px]"
    >
      <div class="tw-flex tw-justify-between">
        <div class="tw-flex tw-items-start tw-justify-between full-width q-pl-md ">
        
          <div
            class="tw-text-[20px] tw-flex tw-items-start" 

          >
          <q-icon
            v-if="!image"
            :name="icon"
            size="16px"
            class="tw-mr-2 tw-mt-1   tw-rounded-full tw-px-1 tw-py-1  "
            :class="[
              store.state.theme === 'dark'
                ? 'tw-text-gray-100 tw-bg-gray-600'
                : 'light-mode-icon',
            ]"
          />
          <img
            v-else
            :src="image"
            class="tw-mr-2 tw-mt-1 tw-rounded-full tw-px-1 tw-py-1"
            :class="[
              store.state.theme === 'dark'
                ? 'tw-text-gray-100 tw-bg-gray-600'
                : 'light-mode-icon',
            ]"
          />
          <div class="tw-flex tw-flex-col tw-items-start tw-justify-start">
           <span> {{ label }}</span>
            <div v-if="subLabel" class="tw-text-[12px] tw-text-gray-500">
                {{ subLabel }}
            </div>
          </div>

          </div>
          <q-icon
            :name="expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'"
            @click.stop="expanded = !expanded"
            class="  tw-rounded-full tw-p-1 cursor-pointer"

            :class="[
              store.state.theme === 'dark'
                ? 'tw-text-gray-100  tw-bg-gray-600'
                : 'tw-text-gray-900 tw-bg-gray-300',
            ]"
            size="18px"
          />
        </div>
      </div>
      <slot v-if="expanded" />
    </div>
    
  </template>
  <script setup lang="ts">
  import { defineProps, ref, onMounted, computed, watch, defineEmits } from "vue";
  import { useStore } from "vuex";
  
  const props = defineProps({
    name: {
      type: String,
      required: true,
    },
    label: {
      type: String,
      required: true,
    },
    isExpandable: {
      type: Boolean,
      default: true,
    },
    isExpanded: {
      type: Boolean,
      default: false,
    },
    labelClass: {
      type: String,
      default: "",
    },
    subLabel: {
      type: String,
      default: "",
    },
    icon:{
      type: String,
      default: "edit",
    },
    image:{
      type: String,
      default: "",
    }
  });
  
  const emits = defineEmits(["update:isExpanded"]);
  
  const store = useStore();
  
  const expanded = computed({
    get: () => props.isExpanded,
    set: (value) => emits("update:isExpanded", value),
  });
  </script>
  
  <style scoped lang="scss">

  .light-mode-icon{
    background-color: $primary;
    color: $white;
  }
  </style>
  