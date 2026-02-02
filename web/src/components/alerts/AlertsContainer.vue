<template>
    <div
    >
      <div class="tw:flex tw:justify-between cursor-pointer" @click="expanded = !expanded">
        <div class="tw:flex tw:items-start tw:justify-between full-width ">

          <div
            class="tw:text-[16px] tw:flex tw:items-start"

          >
          <q-icon
            v-if="!image"
            :name="icon"
            size="16px"
            class="tw:mr-2   tw:rounded-full tw:px-1 tw:py-1  "
            :class="[
              store.state.theme === 'dark'
                ? 'tw:text-gray-100 tw:bg-gray-600'
                : 'light-mode-icon',
                iconClass
            ]"
          />
          <img
            v-else
            :src="image"
            class="tw:mr-2 tw:rounded-full tw:px-1 tw:py-1"
            :class="[
              store.state.theme === 'dark'
                ? 'tw:text-gray-100 tw:bg-gray-600'
                : 'light-mode-icon',
                iconClass
            ]"
          />
          <div class="tw:flex tw:flex-col tw:items-start tw:justify-start">
           <span> {{ label }}</span>
            <div class="tw:text-[13px] tw:h-[20px]"
            :class="[
              store.state.theme === 'dark'
                ? 'tw:text-[#c6c6c6]'
                : 'tw:text-gray-900',
            ]"
            >
                {{ subLabel }}
            </div>
          </div>

          </div>
          <q-icon
            :name="expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'"
            class="tw:rounded-full tw:p-1 tw:mt-2"

            :class="[
              store.state.theme === 'dark'
                ? 'tw:text-gray-100  tw:bg-gray-600'
                : 'tw:text-gray-900 tw:bg-gray-300',
            ]"
            size="18px"
          />
        </div>
      </div>
      <slot v-if="expanded" />
    </div>
    
  </template>
  <script setup lang="ts">
  import { computed } from "vue";
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
    },
    iconClass:{
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
    background-color: #f2f1f1;
    color: #555555;
  }
  </style>
  