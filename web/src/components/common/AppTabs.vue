<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div v-if="show" class="flex items-center o2-tabs">
    <div
      :key="tab.value + tab.disabled"
      v-for="tab in tabs as Tab[]"
      class="cursor-pointer"
    >
      <div
        :data-test="`tab-${tab.value}`"
        class="q-px-lg q-py-sm o2-tab text-center"
        :style="tab.style"
        :title="tab.title || tab.label"
        :class="[
          activeTab === tab.value ? 'active text-primary' : '',
          tab.disabled && 'disabled',
          tab.hide && 'hidden',
          activeTab !== tab.value ? 'inactive' : ''
        ]"
        @click="changeTab(tab)"
      >
        {{ tab.label }}
        <q-tooltip v-if="tab.tooltipLabel">
          {{ tab.tooltipLabel }}
        </q-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Tab {
  label: string;
  value: string;
  style?: Record<string, string>;
  disabled?: boolean;
  title?: string;
  tooltipLabel?: string;
  hide?: boolean;
}

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

const changeTab = (tab: Tab) => {
  if (tab.disabled || tab.hide) return;
  emit("update:activeTab", tab.value);
};
</script>

<style lang="scss" scoped>
.o2-tabs {
  .o2-tab {
    border-bottom: 2px solid transparent;
    width: auto;
    min-width: 80px;
    white-space: nowrap;
  }
  .active {
    border-bottom: 2px solid var(--o2-primary-btn-bg);
    background-color: color-mix(in srgb, var(--o2-primary-btn-bg) 20%, white 10%);
    color: var(--o2-card-text) !important;
    border-radius: 0.375rem 0.375rem 0 0;
  }
}
</style>
