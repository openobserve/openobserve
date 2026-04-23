<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="tw:flex tw:gap-4">
    <!-- Priority Order (Left) -->
    <div class="tw:flex-1 tw:border tw:rounded tw:p-4">
      <div class="tw:text-sm tw:font-semibold tw:mb-3">{{ leftTitle }}</div>
      <q-input v-model="searchLeft" dense outlined placeholder="Search..." class="tw:mb-3">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <div class="tw:border tw:rounded tw:min-h-80 tw:max-h-96 tw:overflow-auto">
        <q-list dense>
          <q-item
            v-for="(item, index) in filteredSelected"
            :key="item.value"
            clickable
            @click="toggleLeftSelection(item.value)"
            :active="leftSelected.includes(item.value)"
          >
            <q-item-section avatar>
              <span class="tw:text-xs tw:font-bold">{{ index + 1 }}</span>
            </q-item-section>
            <q-item-section>{{ item.label }}</q-item-section>
            <q-item-section side>
              <div class="tw:flex tw:gap-1">
                <OButton
  variant="ghost"
  size="icon"
  @click.stop="moveUp(index)"
  :disabled="index === 0">
  <template #icon-left><ArrowUp class="tw:w-4 tw:h-4" /></template>
</OButton>
                <OButton
  variant="ghost"
  size="icon"
  @click.stop="moveDown(index)"
  :disabled="index === modelValue.length - 1">
  <template #icon-left><ArrowDown class="tw:w-4 tw:h-4" /></template>
</OButton>
                <OButton
  variant="destructive"
  size="icon"
  @click.stop="removeItem(item.value)">
  <template #icon-left><Trash2 class="tw:w-4 tw:h-4" /></template>
</OButton>
              </div>
            </q-item-section>
          </q-item>
          <q-item v-if="filteredSelected.length === 0">
            <q-item-section class="text-grey-6 text-center tw:text-sm">
              No items selected
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </div>

    <!-- Center Buttons -->
    <div class="tw:flex tw:flex-col tw:justify-center tw:gap-2">
      <OButton
  variant="outline"
  @click="addSelected"
  :disabled="rightSelected.length === 0">
  <template #icon-left><ArrowLeft class="tw:w-4 tw:h-4" /></template>
  <q-tooltip>Add selected</q-tooltip>
</OButton>
      <OButton
  variant="outline"
  @click="addAll"
  :disabled="availableItems.length === 0">
  <template #icon-left><ChevronsLeft class="tw:w-4 tw:h-4" /></template>
  <q-tooltip>Add all</q-tooltip>
</OButton>
      <OButton
  variant="outline"
  @click="removeSelected"
  :disabled="leftSelected.length === 0">
  <template #icon-left><ArrowRight class="tw:w-4 tw:h-4" /></template>
  <q-tooltip>Remove selected</q-tooltip>
</OButton>
      <OButton
  variant="outline"
  @click="removeAll"
  :disabled="modelValue.length === 0">
  <template #icon-left><ChevronsRight class="tw:w-4 tw:h-4" /></template>
  <q-tooltip>Remove all</q-tooltip>
</OButton>
    </div>

    <!-- Available Items (Right) -->
    <div class="tw:flex-1 tw:border tw:rounded tw:p-4">
      <div class="tw:text-sm tw:font-semibold tw:mb-3">{{ rightTitle }}</div>
      <q-input v-model="searchRight" dense outlined placeholder="Search..." class="tw:mb-3">
        <template #prepend><q-icon name="search" /></template>
      </q-input>
      <div class="tw:border tw:rounded tw:min-h-80 tw:max-h-96 tw:overflow-auto">
        <q-list dense>
          <q-item
            v-for="item in filteredAvailable"
            :key="item.value"
            clickable
            @click="toggleRightSelection(item.value)"
            :active="rightSelected.includes(item.value)"
          >
            <q-item-section>
              <q-checkbox
                :model-value="rightSelected.includes(item.value)"
                @click.stop="toggleRightSelection(item.value)"
                dense
              />
            </q-item-section>
            <q-item-section>{{ item.label }}</q-item-section>
          </q-item>
          <q-item v-if="filteredAvailable.length === 0">
            <q-item-section class="text-grey-6 text-center tw:text-sm">
              No items available
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

import OButton from "@/lib/core/Button/Button.vue";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsLeft, ChevronsRight, Trash2 } from "lucide-vue-next";
interface Item {
  label: string;
  value: string;
}

interface Props {
  modelValue: string[];
  allItems: Item[];
  leftTitle?: string;
  rightTitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  leftTitle: 'Selected',
  rightTitle: 'Available',
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

const searchLeft = ref('');
const searchRight = ref('');
const leftSelected = ref<string[]>([]);
const rightSelected = ref<string[]>([]);

// Create a map for O(1) lookups instead of O(n) find operations
const itemsMap = computed(() =>
  new Map(props.allItems.map(item => [item.value, item]))
);

const availableItems = computed(() => {
  return props.allItems.filter(item => !props.modelValue.includes(item.value));
});

const selectedItems = computed(() => {
  return props.modelValue
    .map(value => itemsMap.value.get(value))
    .filter((item): item is Item => item !== undefined);
});

const filteredSelected = computed(() => {
  if (!searchLeft.value) return selectedItems.value;
  const query = searchLeft.value.toLowerCase();
  return selectedItems.value.filter(item => item.label.toLowerCase().includes(query));
});

const filteredAvailable = computed(() => {
  if (!searchRight.value) return availableItems.value;
  const query = searchRight.value.toLowerCase();
  return availableItems.value.filter(item => item.label.toLowerCase().includes(query));
});

const toggleLeftSelection = (value: string) => {
  const index = leftSelected.value.indexOf(value);
  if (index > -1) {
    leftSelected.value.splice(index, 1);
  } else {
    leftSelected.value.push(value);
  }
};

const toggleRightSelection = (value: string) => {
  const index = rightSelected.value.indexOf(value);
  if (index > -1) {
    rightSelected.value.splice(index, 1);
  } else {
    rightSelected.value.push(value);
  }
};

const addSelected = () => {
  const newValue = [...props.modelValue, ...rightSelected.value];
  emit('update:modelValue', newValue);
  rightSelected.value = [];
};

const addAll = () => {
  const newValue = [...props.modelValue, ...availableItems.value.map(i => i.value)];
  emit('update:modelValue', newValue);
  rightSelected.value = [];
};

const removeSelected = () => {
  const newValue = props.modelValue.filter(v => !leftSelected.value.includes(v));
  emit('update:modelValue', newValue);
  leftSelected.value = [];
};

const removeAll = () => {
  emit('update:modelValue', []);
  leftSelected.value = [];
  rightSelected.value = [];
};

const removeItem = (value: string) => {
  const newValue = props.modelValue.filter(v => v !== value);
  emit('update:modelValue', newValue);
};

const moveUp = (index: number) => {
  if (index === 0) return;
  const newValue = [...props.modelValue];
  [newValue[index - 1], newValue[index]] = [newValue[index], newValue[index - 1]];
  emit('update:modelValue', newValue);
};

const moveDown = (index: number) => {
  if (index === props.modelValue.length - 1) return;
  const newValue = [...props.modelValue];
  [newValue[index], newValue[index + 1]] = [newValue[index + 1], newValue[index]];
  emit('update:modelValue', newValue);
};
</script>
