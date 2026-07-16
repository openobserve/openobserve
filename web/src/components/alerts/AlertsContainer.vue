<template>
    <div data-test="alerts-container">
      <div data-test="alerts-container-header" class="flex justify-between cursor-pointer" @click="expanded = !expanded">
        <div class="flex items-start justify-between w-full ">

          <div
            class="text-base flex items-start"

          >
          <OIcon
            v-if="!image"
            data-test="container-icon"
            :name="icon"
            size="sm"
            class="mr-2   rounded-full px-1 py-1  "
            :class="['text-text-body bg-surface-subtle', iconClass]"
          />
          <img
            v-else
            data-test="container-image"
            :src="image"
            class="mr-2 rounded-full px-1 py-1"
            :class="['text-text-body bg-surface-subtle', iconClass]"
          />
          <div data-test="container-label-wrapper" class="flex flex-col items-start justify-start">
           <span data-test="container-label"> {{ label }}</span>
            <div data-test="container-sublabel" class="text-compact h-5 text-text-body"
            >
                {{ subLabel }}
            </div>
          </div>

          </div>
          <OIcon
            data-test="expand-toggle-icon"
            :name="expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'"
            class="rounded-full p-1 mt-2 text-text-body bg-surface-subtle"
            size="sm"
          />
        </div>
      </div>
      <div v-if="expanded" data-test="container-content">
        <slot />
      </div>
    </div>
    
  </template>
  <script setup lang="ts">
  import { computed } from "vue";

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

  const expanded = computed({
    get: () => props.isExpanded,
    set: (value) => emits("update:isExpanded", value),
  });
  </script>
  
  