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
  <div class="logs-quick-filter" data-test="logs-quick-filter">
    <q-btn-group flat class="quick-filter-group">
      <q-btn
        v-for="option in filterOptions"
        :key="option.value"
        :data-test="`quick-filter-${option.value}`"
        :class="modelValue === option.value ? 'selected' : ''"
        size="xs"
        flat
        no-caps
        @click="selectFilter(option.value)"
        class="quick-filter-btn"
      >
        {{ option.label }}
      </q-btn>
    </q-btn-group>
    <span
      v-if="selectedOption"
      class="quick-filter-label"
      data-test="quick-filter-selected-label"
    >
      {{ selectedOption.label }}
    </span>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from "vue";

export interface QuickFilterOption {
  label: string;
  value: string;
  seconds: number;
}

export const DEFAULT_QUICK_FILTER_OPTIONS: QuickFilterOption[] = [
  { label: "5m", value: "5m", seconds: 300 },
  { label: "15m", value: "15m", seconds: 900 },
  { label: "1h", value: "1h", seconds: 3600 },
  { label: "6h", value: "6h", seconds: 21600 },
  { label: "24h", value: "24h", seconds: 86400 },
];

export default defineComponent({
  name: "LogsQuickFilter",

  props: {
    modelValue: {
      type: String,
      default: "",
    },
    options: {
      type: Array as PropType<QuickFilterOption[]>,
      default: () => DEFAULT_QUICK_FILTER_OPTIONS,
    },
  },

  emits: ["update:modelValue", "filter-selected"],

  setup(props, { emit }) {
    const filterOptions = computed(() => props.options);

    const selectedOption = computed(() =>
      props.options.find((opt) => opt.value === props.modelValue) ?? null,
    );

    const selectFilter = (value: string) => {
      emit("update:modelValue", value);
      const option = props.options.find((opt) => opt.value === value);
      if (option) {
        emit("filter-selected", option);
      }
    };

    const clearFilter = () => {
      emit("update:modelValue", "");
    };

    const isActive = (value: string) => props.modelValue === value;

    return {
      filterOptions,
      selectedOption,
      selectFilter,
      clearFilter,
      isActive,
    };
  },
});
</script>

<style scoped lang="scss">
.logs-quick-filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.quick-filter-group {
  border: 1px solid var(--o2-border-color);
  border-radius: 4px;
}

.quick-filter-btn {
  padding: 0 0.5rem;
  min-height: 1.75rem;

  &.selected {
    background-color: var(--q-primary);
    color: white;
  }
}

.quick-filter-label {
  font-size: 0.75rem;
  color: var(--q-secondary);
}
</style>
