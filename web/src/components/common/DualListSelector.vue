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
      <OSearchInput v-model="searchLeft" placeholder="Search..." class="tw:mb-3" />
      <div class="tw:border tw:rounded tw:min-h-80 tw:max-h-96 tw:overflow-auto">
        <ul class="tw:flex tw:flex-col">
          <li
            v-for="(item, index) in filteredSelected"
            :key="item.value"
            data-test="dual-list-selector-left-item"
            class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1 tw:cursor-pointer hover:tw:bg-muted/50"
            :class="{ 'tw:bg-muted/30': leftSelected.includes(item.value) }"
            @click="toggleLeftSelection(item.value)"
          >
            <div class="tw:flex tw:items-center tw:shrink-0">
              <span class="tw:text-xs tw:font-bold">{{ index + 1 }}</span>
            </div>
            <div class="tw:flex tw:flex-1 tw:min-w-0 tw:text-sm">{{ item.label }}</div>
            <div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">
              <div class="tw:flex tw:gap-1">
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="index === 0"
                  @click.stop="moveUp(index)"
                >
                  <OIcon name="arrow-upward" size="xs" />
                </OButton>
                <OButton
                  variant="ghost"
                  size="icon-xs"
                  :disabled="index === modelValue.length - 1"
                  @click.stop="moveDown(index)"
                >
                  <OIcon name="arrow-downward" size="xs" />
                </OButton>
                <OButton
                  variant="ghost-destructive"
                  size="icon-xs"
                  @click.stop="removeItem(item.value)"
                >
                  <OIcon name="delete" size="xs" />
                </OButton>
              </div>
            </div>
          </li>
          <li
            v-if="filteredSelected.length === 0"
            class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:text-gray-400 tw:text-center tw:text-sm tw:justify-center"
          >
            No items selected
          </li>
        </ul>
      </div>
    </div>

    <!-- Center Buttons -->
    <div class="tw:flex tw:flex-col tw:justify-center tw:gap-2">
      <OButton
        variant="outline"
        size="icon-sm"
        :disabled="rightSelected.length === 0"
        @click="addSelected"
      >
        <OIcon name="arrow-back" size="sm" />
        <OTooltip content="Add selected" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        :disabled="availableItems.length === 0"
        @click="addAll"
      >
        <OIcon name="keyboard-double-arrow-left" size="sm" />
        <OTooltip content="Add all" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        :disabled="leftSelected.length === 0"
        @click="removeSelected"
      >
        <OIcon name="arrow-forward" size="sm" />
        <OTooltip content="Remove selected" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-sm"
        :disabled="modelValue.length === 0"
        @click="removeAll"
      >
        <OIcon name="keyboard-double-arrow-right" size="sm" />
        <OTooltip content="Remove all" />
      </OButton>
    </div>

    <!-- Available Items (Right) -->
    <div class="tw:flex-1 tw:border tw:rounded tw:p-4">
      <div class="tw:text-sm tw:font-semibold tw:mb-3">{{ rightTitle }}</div>
      <OSearchInput v-model="searchRight" placeholder="Search..." class="tw:mb-3" />
      <div class="tw:border tw:rounded tw:min-h-80 tw:max-h-96 tw:overflow-auto">
        <ul class="tw:flex tw:flex-col">
          <li
            v-for="item in filteredAvailable"
            :key="item.value"
            data-test="dual-list-selector-right-item"
            class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1 tw:cursor-pointer hover:tw:bg-muted/50"
            :class="{ 'tw:bg-muted/30': rightSelected.includes(item.value) }"
            @click="toggleRightSelection(item.value)"
          >
            <div class="tw:flex tw:items-center tw:shrink-0">
              <OCheckbox
                :model-value="rightSelected.includes(item.value)"
                @click.stop="toggleRightSelection(item.value)"
              />
            </div>
            <div class="tw:flex tw:flex-1 tw:min-w-0 tw:text-sm">{{ item.label }}</div>
          </li>
          <li
            v-if="filteredAvailable.length === 0"
            class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:text-gray-400 tw:text-center tw:text-sm tw:justify-center"
          >
            No items available
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import OButton from '@/lib/core/Button/OButton.vue';
import OSearchInput from '@/lib/forms/SearchInput/OSearchInput.vue';
import OTooltip from '@/lib/overlay/Tooltip/OTooltip.vue';
import OCheckbox from '@/lib/forms/Checkbox/OCheckbox.vue';
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
