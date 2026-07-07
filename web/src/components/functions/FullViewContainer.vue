<template>
  <div
    class="py-[2px]"
    :class="store.state.theme === 'dark' ? 'bg-gray-500' : 'bg-gray-200 '"
  >
    <div
      class="flex justify-between"
      :class="{ 'items-center': minHeaderHeight }"
      :style="minHeaderHeight ? { minHeight: minHeaderHeight } : undefined"
    >
      <div class="flex items-center">
        <OIcon
          v-if="showExpandIcon"
          name="keyboard-arrow-up"
          @click.stop="expanded = !expanded"
          class="mr-1 cursor-pointer transition-all"
          :class="[
            store.state.theme === 'dark'
              ? 'text-gray-100'
              : 'text-gray-500',
            expanded ? 'transform rotate-180' : '',
          ]"
          size="md"
        />
        <div
          @click="showExpandIcon ? expanded = !expanded : null"
          class="text-[14px] font-bold"
          :class="[
            store.state.theme === 'dark'
              ? 'text-gray-100'
              : 'text-gray-500',
            labelClass,
          ]"
        >
          {{ label }}
        </div>
        <slot name="left" />
      </div>
      <div>
        <slot name="right" />
      </div>
    </div>
    <slot v-if="expanded" />
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
  showExpandIcon: {
    type: Boolean,
    default: true,
    required: false,
  },
  // Optional fixed header-row height (e.g. "2.125rem"). When set, the title row is
  // given this min-height and its content is vertically centered — used to keep
  // a header bar visually aligned with sibling headers that contain taller
  // controls (e.g. a "Run query" button). Empty = natural content height.
  minHeaderHeight: {
    type: String,
    default: "",
  },
});

const emits = defineEmits(["update:isExpanded"]);

const store = useStore();

const expanded = computed({
  get: () => props.isExpanded,
  set: (value) => emits("update:isExpanded", value),
});
</script>

