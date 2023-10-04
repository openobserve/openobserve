<template>
  <div v-if="show" class="flex items-center rum-tabs">
    <div v-for="tab in (tabs as Tab[])" :key="tab.value" class="cursor-pointer">
      <div
        class="q-px-lg q-py-sm rum-tab text-center"
        :style="tab.style"
        :class="activeTab === tab.value ? 'active' : ''"
        @click="changeTab(tab.value)"
      >
        {{ tab.label }}
      </div>
    </div>
    <q-separator class="full-width" />
  </div>
</template>

<script setup lang="ts">
interface Tab {
  label: string;
  value: string;
  style?: Record<string, string>;
}
import { defineProps } from "vue";
const emit = defineEmits(["update:activeTab"]);
const props = defineProps({
  show: {
    type: Boolean,
    default: true,
  },
  tabs: {
    type: Array,
    required: true,
  },
  activeTab: {
    type: String,
    required: true,
  },
});

const changeTab = (tab: string) => {
  emit("update:activeTab", tab);
};
</script>

<style lang="scss" scoped>
.rum-tabs {
  .rum-tab {
    border-bottom: 2px solid transparent;
    width: 140px;
  }
  .active {
    border-bottom: 2px solid $primary;
  }
}
</style>
