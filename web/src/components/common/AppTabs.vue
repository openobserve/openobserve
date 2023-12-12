<!-- Copyright 2023 Zinc Labs Inc.

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
  <div v-if="show" class="flex items-center rum-tabs">
    <div v-for="tab in (tabs as Tab[])" :key="tab.value" class="cursor-pointer">
      <div
        class="q-px-lg q-py-sm rum-tab text-center"
        :style="tab.style"
        :class="activeTab === tab.value ? 'active text-primary' : ''"
        @click="changeTab(tab.value)"
      >
        {{ tab.label }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from "vue";

interface Tab {
  label: string;
  value: string;
  style?: Record<string, string>;
}

const emit = defineEmits(["update:activeTab"]);
defineProps({
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
