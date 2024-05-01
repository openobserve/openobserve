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
  <div>
    <q-select
      style="min-width: 150px"
      filled
      outlined
      dense
      v-model="selectedValue"
      :display-value="
        selectedValue
          ? Array.isArray(selectedValue)
            ? selectedValue.join(', ')
            : selectedValue
          : selectedValue || selectedValue == ''
          ? selectedValue == ''
            ? '<blank>'
            : selectedValue
          : !variableItem.isLoading
          ? '(No Data Found)'
          : ''
      "
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
    >
      <template v-slot:no-option>
        <q-item>
          <q-item-section class="text-italic text-grey">
            No Data Found
          </q-item-section>
        </q-item>
      </template>
      <template v-slot:option="{ itemProps, opt, selected, toggleOption }">
        <q-item v-bind="itemProps">
          <q-item-section>
            <q-item-label v-html="opt.label" />
          </q-item-section>
          <q-item-section side v-if="variableItem.multiSelect">
            <q-checkbox
              :model-value="selected"
              @update:model-value="toggleOption(opt)"
            />
          </q-item-section>
        </q-item>
      </template>
    </q-select>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, toRef, watch } from "vue";
import { useSelectAutoComplete } from "../../../composables/useSelectAutocomplete";

export default defineComponent({
  name: "VariableQueryValueSelector",
  props: ["modelValue", "variableItem"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    console.log("props", props);

    //get v-model value for selected value  using props
    const selectedValue = ref(props.variableItem?.value);

    const options = toRef(props.variableItem, "options");

    // get filtered options
    const { filterFn: fieldsFilterFn, filteredOptions: fieldsFilteredOptions } =
      useSelectAutoComplete(options, "value");

    // set watcher on variable item changes at that time change the option value
    watch(
      () => props.variableItem,
      () => {
        options.value = props.variableItem?.options;
      }
    );

    // update selected value
    watch(selectedValue, () => {
      emit("update:modelValue", selectedValue.value);
    });

    return {
      selectedValue,
      fieldsFilterFn,
      fieldsFilteredOptions,
    };
  },
});
</script>

<style lang="scss" scoped></style>
