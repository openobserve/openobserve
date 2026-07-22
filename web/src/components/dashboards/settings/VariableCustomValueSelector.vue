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
      v-model="selectedValue"
      :label="variableItem?.label || variableItem?.name"
      label-position="inside"
      :options="variableItem?.options || []"
      labelKey="label"
      valueKey="value"
      class="textbox flex flex-col no-case o2-custom-select-dashboard min-w-37.5 max-w-160"
      :loading="variableItem.isLoading"
      :data-test="`variable-selector-${variableItem.name}-inner`"
      :multiple="variableItem.multiSelect"
      :select-all="variableItem.multiSelect"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #empty>{{ t("dashboard.variableCustomValueSelector.noDataFound") }}</template>
    </OSelect>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";

export default defineComponent({
  name: "VariableCustomValueSelector",
  components: { OSelect },
  props: ["modelValue", "variableItem"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
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
      t,
      selectedValue,
      emit,
    };
  },
});
</script>
