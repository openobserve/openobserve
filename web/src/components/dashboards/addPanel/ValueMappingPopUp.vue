<!-- Copyright 2026 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <ODialog
    :open="open"
    @update:open="
      (v) => {
        if (!v) cancelEdit();
      }
    "
    :title="t('dashboard.valueMappingsTitle')"
    size="md"
    :neutral-button-label="t('dashboard.valueMappingAddNew')"
    neutral-button-variant="outline"
    :primary-button-label="t('dashboard.valueMappingApply')"
    @click:neutral="addValueMapping"
    @click:primary="applyValueMapping"
    data-test="dashboard-value-mapping-popup"
  >
    <div class="mb-4">
      <ValueMappingList
        v-model="editedValueMapping"
        :pattern-errors="patternErrors"
        @remove="removeValueMappingByIndex"
      />
    </div>
  </ODialog>
</template>
<script lang="ts">
import { ref, watch, defineComponent, onMounted } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ValueMappingList from "./ValueMappingList.vue";
import { valueMappingPatternErrors } from "./valueMappingErrors";

export default defineComponent({
  name: "ValueMappingPopUp",
  components: {
    ODialog,
    ValueMappingList,
  },
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    valueMapping: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18nTyped();

    // editedValueMapping is populated by the watch below (on every open)
    const editedValueMapping = ref<any[]>([]);
    const patternErrors = ref<Record<number, I18nText>>({});

    // Deep-clone prop on every open so edits never leak back to the chart
    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          patternErrors.value = {};
          editedValueMapping.value = props.valueMapping?.length
            ? JSON.parse(JSON.stringify(props.valueMapping))
            : [{ type: "value", value: "", text: "", color: null }];
        }
      },
      { immediate: true },
    );

    const addValueMapping = () => {
      editedValueMapping.value.push({
        type: "value",
        value: "",
        pattern: "",
        from: "",
        to: "",
        text: "",
        color: null,
      });
    };

    const removeValueMappingByIndex = (index: number) => {
      editedValueMapping.value.splice(index, 1);
      patternErrors.value = {};
    };

    onMounted(() => {
      // if mappings is empty, add default value mapping
      if (editedValueMapping.value.length == 0) {
        addValueMapping();
      }
    });

    const applyValueMapping = () => {
      const errors = valueMappingPatternErrors(editedValueMapping.value, t);
      patternErrors.value = errors;
      if (Object.keys(errors).length > 0) return;
      emit("save", editedValueMapping.value);
    };

    const cancelEdit = () => {
      // Reset to last saved state so unsaved edits are discarded
      patternErrors.value = {};
      editedValueMapping.value = props.valueMapping?.length
        ? JSON.parse(JSON.stringify(props.valueMapping))
        : [{ type: "value", value: "", text: "", color: null }];
      emit("close");
    };

    return {
      t,
      addValueMapping,
      removeValueMappingByIndex,
      applyValueMapping,
      cancelEdit,
      editedValueMapping,
      patternErrors,
      cancel: "cancel",
    };
  },
});
</script>
