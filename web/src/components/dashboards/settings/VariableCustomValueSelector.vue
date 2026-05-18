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
  <div>
    <OSelect
      style="min-width: 150px"
      v-model="selectedValue"
      :label="variableItem?.label || variableItem?.name"
      :options="variableItem?.options || []"
      labelKey="label"
      valueKey="value"
      class="textbox col no-case o2-custom-select-dashboard"
      :loading="variableItem.isLoading"
      data-test="dashboard-variable-custom-value-selector"
      :multiple="variableItem.multiSelect"
      :select-all="variableItem.multiSelect"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #empty>No Data Found</template>
    </OSelect>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "VariableCustomValueSelector",
  components: { OSelect },
  props: ["modelValue", "variableItem"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const selectedValue = ref(props.variableItem?.value);

    watch(
      () => props.variableItem.value,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );

    watch(selectedValue, () => {
      emit("update:modelValue", selectedValue.value);
    });

    return {
      selectedValue,
      emit,
    };
  },
});
</script>

<style lang="scss" scoped>
.o2-custom-select-dashboard {
  max-width: 600px;
}

:deep(.q-field__native) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
