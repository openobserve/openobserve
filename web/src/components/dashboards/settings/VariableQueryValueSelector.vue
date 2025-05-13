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
    loading: {{ variableItem.isLoading }} values: {{ variableItem.value }}
    <q-select
      style="min-width: 150px"
      filled
      outlined
      dense
      v-model="selectedValue"
      :display-value="displayValue"
      :label="variableItem?.label || variableItem?.name"
      :options="fieldsFilteredOptions"
      input-debounce="0"
      emit-value
      option-value="value"
      option-label="label"
      behavior="menu"
      use-input
      stack-label
      @filter="fieldsFilterFn"
      class="textbox col no-case"
      :loading="variableItem.isLoading"
      data-test="dashboard-variable-query-value-selector"
      :multiple="variableItem.multiSelect"
      popup-no-route-dismiss
      popup-content-style="z-index: 10001"
      @blur="applyChanges"
      @focus="loadFieldValues"
    >
      <template v-slot:no-option>
        <q-item>
          <q-item-section class="text-italic text-grey">
            No Data Found
          </q-item-section>
        </q-item>
      </template>
      <template
        v-if="variableItem.multiSelect && fieldsFilteredOptions.length > 0"
        v-slot:before-options
      >
        <q-item>
          <q-item-section side>
            <q-checkbox
              v-model="isAllSelected"
              @update:model-value="toggleSelectAll"
              dense
              class="q-ma-none"
            />
          </q-item-section>
          <q-item-section @click.stop="toggleSelectAll" style="cursor: pointer">
            <q-item-label>Select All</q-item-label>
          </q-item-section>
        </q-item>
        <q-separator />
      </template>
      <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
        <q-item v-bind="itemProps">
          <q-item-section side v-if="variableItem.multiSelect">
            <q-checkbox
              :model-value="selected"
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
      <template v-slot:loading> Loading... </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch, computed } from "vue";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";

export default defineComponent({
  name: "VariableQueryValueSelector",
  props: ["modelValue", "variableItem", "loadOptions"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    //get v-model value for selected value  using props
    const selectedValue = ref(props.variableItem?.value);
    console.log("[Dropdown] Initial setup:", {
      variableName: props.variableItem?.name,
      initialValue: selectedValue.value,
      isLoading: props.variableItem?.isLoading,
      options: props.variableItem?.options,
    });

    const options = toRef(props.variableItem, "options");

    // get filtered options
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(options, "value");

    // set watcher on variable item changes at that time change the option value
    watch(
      () => props.variableItem,
      () => {
        console.log("[Dropdown] Variable item changed:", {
          variableName: props.variableItem?.name,
          newOptions: props.variableItem?.options,
          isLoading: props.variableItem?.isLoading,
          value: props.variableItem?.value,
        });
        options.value = props.variableItem?.options;
      },
    );

    // isAllSelected should be true if all options are selected and false otherwise
    const isAllSelected = computed(() => {
      return (
        fieldsFilteredOptions.value.length > 0 &&
        selectedValue.value.length === fieldsFilteredOptions.value.length
      );
    });

    // Function to toggle select/deselect all options
    const toggleSelectAll = () => {
      console.log("[Dropdown] Toggle select all:", {
        variableName: props.variableItem?.name,
        currentIsAllSelected: isAllSelected.value,
        currentValue: selectedValue.value,
      });
      if (!isAllSelected.value) {
        selectedValue.value = fieldsFilteredOptions.value.map(
          (option: any) => option.value,
        );
      } else {
        selectedValue.value = [];
      }
    };

    const applyChanges = () => {
      console.log("[Dropdown] Applying changes:", {
        variableName: props.variableItem?.name,
        multiSelect: props.variableItem.multiSelect,
        value: selectedValue.value,
      });
      if (props.variableItem.multiSelect) {
        emitSelectedValues();
      }
    };

    // update selected value
    watch(selectedValue, () => {
      console.log("[Dropdown] Selected value changed:", {
        variableName: props.variableItem?.name,
        newValue: selectedValue.value,
        multiSelect: props.variableItem.multiSelect,
      });
      if (!props.variableItem.multiSelect) {
        emitSelectedValues();
      }
    });

    const emitSelectedValues = () => {
      console.log("[Dropdown] Emitting selected values:", {
        variableName: props.variableItem?.name,
        value: selectedValue.value,
      });
      emit("update:modelValue", selectedValue.value);
    };

    // Display the selected value
    const displayValue = computed(() => {
      console.log("[Dropdown] Calculating display value", {
        variableName: props.variableItem?.name,
        selectedValue: selectedValue.value,
        multiSelect: props.variableItem.multiSelect,
      });
      if (selectedValue.value || selectedValue.value == "") {
        if (Array.isArray(selectedValue.value)) {
          if (selectedValue.value.length > 2) {
            console.log("[Dropdown] Display value: using ellipsis", {
              variableName: props.variableItem?.name,
              selectedValue: selectedValue.value,
              multiSelect: props.variableItem.multiSelect,
            });
            const firstTwoValues = selectedValue.value
              .slice(0, 2)
              .map((it: any) => (it === "" ? "<blank>" : it))
              .join(", ");
            const remainingCount = selectedValue.value.length - 2;
            return `${firstTwoValues} ...+${remainingCount} more`;
          } else if (props.variableItem.options.length == 0) {
            console.log("[Dropdown] Display value: no data found", {
              variableName: props.variableItem?.name,
              selectedValue: selectedValue.value,
              multiSelect: props.variableItem.multiSelect,
            });
            return "(No Data Found)";
          } else {
            console.log("[Dropdown] Display value: not using ellipsis", {
              variableName: props.variableItem?.name,
              selectedValue: selectedValue.value,
              multiSelect: props.variableItem.multiSelect,
            });
            return selectedValue.value
              .map((it: any) => (it === "" ? "<blank>" : it))
              .join(", ");
          }
        } else if (selectedValue.value == "") {
          console.log("[Dropdown] Display value: blank", {
            variableName: props.variableItem?.name,
            selectedValue: selectedValue.value,
            multiSelect: props.variableItem.multiSelect,
          });
          return "<blank>";
        } else {
          console.log("[Dropdown] Display value: single value", {
            variableName: props.variableItem?.name,
            selectedValue: selectedValue.value,
            multiSelect: props.variableItem.multiSelect,
          });
          return selectedValue.value;
        }
      } else if (!props.variableItem.isLoading) {
        console.log("[Dropdown] Display value: no data found (not loading)", {
          variableName: props.variableItem?.name,
          selectedValue: selectedValue.value,
          multiSelect: props.variableItem.multiSelect,
        });
        return "(No Data Found)";
      } else {
        console.log("[Dropdown] Display value: loading", {
          variableName: props.variableItem?.name,
          selectedValue: selectedValue.value,
          multiSelect: props.variableItem.multiSelect,
        });
        return "";
      }
    });
    const loadFieldValues = () => {
      console.log("[Dropdown] Loading field values:", {
        variableName: props.variableItem?.name,
        isLoading: props.variableItem.isLoading,
        hasLoadOptions: props.loadOptions,
        currentOptions: props.variableItem?.options,
        hasExistingValue: !!selectedValue.value,
        optionsLength: options.value?.length,
      });

      if (props.variableItem.isLoading || !props.loadOptions) {
        return;
      }
      loadVariableTemp();
    };
    const loadVariableTemp = () => {
      console.log("[Dropdown] Loading variable temp:", {
        variableName: props.variableItem?.name,
        currentOptions: props.variableItem.options,
        currentValue: selectedValue.value,
        isLoading: props.variableItem.isLoading,
        hasLoadOptions: props.loadOptions,
      });

      try {
        props.loadOptions(props.variableItem);
        options.value = props.variableItem.options;
        console.log("[Dropdown] Variable temp loaded:", {
          variableName: props.variableItem?.name,
          newOptions: props.variableItem.options,
          newValue: selectedValue.value,
        });
      } catch (error) {
        console.error("[Dropdown] Error loading variable temp:", error);
      }
    };

    return {
      selectedValue,
      fieldsFilterFn,
      fieldsFilteredOptions,
      isAllSelected,
      toggleSelectAll,
      displayValue,
      applyChanges,
      loadFieldValues,
    };
  },
});
</script>

<style lang="scss" scoped></style>
