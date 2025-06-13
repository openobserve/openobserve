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
  <div>
    <!-- loading: {{ variableItem.isLoading }} values:
    {{ variableItem.value }} isVariableLoadingPending:
    {{ variableItem.isVariableLoadingPending }} options:
    {{ variableItem.options.map((it) => it.label) }} -->
    <q-select
      style="min-width: 150px"
      filled
      outlined
      dense
      v-model="selectedValue"
      :display-value="displayValue"
      :label="variableItem?.label || variableItem?.name"
      :options="filteredOptions"
      input-debounce="0"
      emit-value
      option-value="value"
      option-label="label"
      behavior="menu"
      use-input
      stack-label
      @filter="filterOptions"
      class="textbox col no-case"
      :loading="variableItem.isLoading"
      data-test="dashboard-variable-query-value-selector"
      :multiple="variableItem.multiSelect"
      popup-no-route-dismiss
      popup-content-style="z-index: 10001"
      @popup-show="onPopupShow"
      @popup-hide="onPopupHide"
      @update:model-value="onUpdateValue"
      ref="selectRef"
    >
      <!-- transition-show="scale"
      transition-hide="scale" -->
      <template v-slot:no-option>
        <q-item>
          <q-item-section class="text-italic text-grey">
            No Data Found
          </q-item-section>
        </q-item>
      </template>
      <template v-if="filteredOptions.length > 0" v-slot:before-options>
        <q-item>
          <q-item-section v-if="variableItem.multiSelect" side>
            <q-checkbox
              v-model="isAllSelected"
              @update:model-value="toggleSelectAll"
              dense
              class="q-ma-none"
              @click.stop
            />
          </q-item-section>
          <q-item-section @click.stop="toggleSelectAll" style="cursor: pointer">
            <q-item-label>{{ variableItem.multiSelect ? 'Select All' : 'All' }}</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator />
      </template>
      <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
        <q-item v-bind="itemProps">
          <q-item-section side v-if="variableItem.multiSelect">
            <q-checkbox
              :model-value="selected || isAllSelected"
              @update:model-value="toggleOption(opt)"
              class="q-ma-none"
              dense
            />
          </q-item-section>
          <q-item-section>
            <q-item-label v-html="opt.label" />
          </q-item-section>
        </q-item>
      </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { defineComponent, ref, watch, computed, nextTick } from "vue";

export default defineComponent({
  name: "VariableQueryValueSelector",
  props: ["modelValue", "variableItem", "loadOptions"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const selectedValue = ref(props.variableItem?.value);
    const filterText = ref("");
    const selectRef = ref(null);
    const isOpen = ref(false);

    const availableOptions = computed(() => props.variableItem?.options || []);

    const filteredOptions = computed(() => {
      if (!filterText.value) return availableOptions.value;
      const searchText = filterText.value.toLowerCase();
      return availableOptions.value.filter((opt: any) =>
        opt.label.toLowerCase().includes(searchText),
      );
    });

    const filterOptions = (val: string, update: Function) => {
      filterText.value = val;
      update();
    };

    const isAllSelected = computed(() => {
      if (props.variableItem.multiSelect) {
        return Array.isArray(selectedValue.value) && selectedValue.value?.[0] === SELECT_ALL_VALUE;
      }
      return selectedValue.value === SELECT_ALL_VALUE;
    });    const toggleSelectAll = () => {
      const newValue = props.variableItem.multiSelect
        ? isAllSelected.value ? [] : [SELECT_ALL_VALUE]
        : SELECT_ALL_VALUE;
      
      selectedValue.value = newValue;
      emit("update:modelValue", newValue);
    };

    const onUpdateValue = (val: any) => {
      // If multiselect and user selects any regular value after SELECT_ALL, remove SELECT_ALL
      if (props.variableItem.multiSelect && Array.isArray(val) && val.length > 0) {
        if (val.includes(SELECT_ALL_VALUE) && val.length > 1) {
          val = val.filter(v => v !== SELECT_ALL_VALUE);
        }
      }
      selectedValue.value = val;
      if(!props.variableItem.multiSelect) {
        emit("update:modelValue", val);
      }
    };

    const onPopupShow = () => {
      isOpen.value = true;
      if (props.loadOptions) {
        props.loadOptions(props.variableItem);
      }
    };

    const onPopupHide = () => {
      isOpen.value = false;
      if (props.variableItem.multiSelect) {
        emit("update:modelValue", selectedValue.value);
      }
    };

    const displayValue = computed(() => {
      if (selectedValue.value || selectedValue.value === "") {
        if (Array.isArray(selectedValue.value)) {
          if (selectedValue.value.length > 2) {
            const firstTwoValues = selectedValue.value
              .slice(0, 2)
              .map((it: any) => (it === "" ? "<blank>" : it))
              .join(", ");
            const remainingCount = selectedValue.value.length - 2;
            return `${firstTwoValues} ...+${remainingCount} more`;
          } else if (props.variableItem.options.length === 0 && selectedValue.value.length === 0) {
            return "(No Data Found)";
          } else {            
            return selectedValue.value
              .map((it: any) => {
                if (it === "") return "<blank>";
                if (it === SELECT_ALL_VALUE) return "<ALL>";
                return it;
              })
              .join(", ");
          }
        } else if (selectedValue.value === "") {
          return "<blank>";
        } else if (selectedValue.value === SELECT_ALL_VALUE) {
          return "<ALL>";
        } else {
          return selectedValue.value;
        }
      } else if (!props.variableItem.isLoading) {
        return "(No Data Found)";
      } else {
        return "";
      }
    });

    watch(
      () => props.variableItem.options,
      () => {
        if (isOpen.value && selectRef.value) {
          nextTick(() => {
            if (selectRef.value) {
              (selectRef.value as any).updateInputValue();
            }
          });
        }
      },
      { deep: true },
    );

    // Add watch for modelValue changes
    watch(
      () => props.modelValue,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );

    // Add watch for variableItem value changes
    watch(
      () => props.variableItem.value,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );

    return {
      selectedValue,
      filteredOptions,
      filterOptions,
      isAllSelected,
      toggleSelectAll,
      displayValue,
      onUpdateValue,
      onPopupShow,
      onPopupHide,
      selectRef,
    };
  },
});
</script>

<style lang="scss" scoped></style>
