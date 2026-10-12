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
      class="textbox no-case o2-custom-select-dashboard flex max-w-160 min-w-37.5 flex-col"
      :loading="variableItem.isLoading"
      :data-test="`variable-selector-${variableItem.name}-inner`"
      :multiple="variableItem.multiSelect"
      :select-all="variableItem.multiSelect"
      @update:model-value="onUpdateValue"
      @close="onPopupHide"
    >
      <template #empty>{{ t("dashboard.variableCustomValueSelector.noDataFound") }}</template>
    </OSelect>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { isEqual } from "lodash-es";

export default defineComponent({
  name: "VariableCustomValueSelector",
  components: { OSelect },
  props: ["modelValue", "variableItem"],
  emits: ["update:modelValue"],
  setup(props: any, { emit }) {
    const { t } = useI18nTyped();
    const selectedValue = ref(props.variableItem?.value);

    watch(
      () => props.variableItem.value,
      (newVal) => {
        selectedValue.value = newVal;
      },
      { immediate: true },
    );

    const onUpdateValue = (val: any) => {
      selectedValue.value = val;
      if (!props.variableItem.multiSelect) emit("update:modelValue", val);
    };

    // Multi-select applies once on close, like the query selector, so each toggle is not a change.
    const onPopupHide = () => {
      if (!props.variableItem.multiSelect) return;
      if (isEqual(selectedValue.value, props.variableItem.value)) return;
      emit("update:modelValue", selectedValue.value);
    };

    return {
      t,
      selectedValue,
      onUpdateValue,
      onPopupHide,
    };
  },
});
</script>
