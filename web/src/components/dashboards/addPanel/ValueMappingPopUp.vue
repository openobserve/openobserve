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
    :width="70"
    :neutral-button-label="t('dashboard.valueMappingAddNew')"
    neutral-button-variant="outline"
    :primary-button-label="t('dashboard.valueMappingApply')"
    @click:neutral="addValueMapping"
    @click:primary="applyValueMapping"
    data-test="dashboard-value-mapping-popup"
  >
    <div class="mb-4">
      <draggable
        v-model="editedValueMapping"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-addpanel-config-value-mapping-drag"
      >
        <div
          v-for="(mapping, index) in editedValueMapping"
          :key="index"
          class="mb-2 flex items-center justify-between"
        >
          <div class="cursor-move self-center p-2">
            <OIcon
              name="drag-indicator"
              size="sm"
              class="mr-1"
              :data-test="`dashboard-addpanel-config-value-mapping-drag-handle-${index}`"
            />
          </div>
          <div class="flex flex-1 items-center justify-between gap-x-6">
            <OSelect
              v-model="mapping.type"
              :label="t('dashboard.valueMappingType')"
              :options="mappingTypes"
              :data-test="`dashboard-addpanel-config-value-mapping-type-select-${index}`"
              class="flex-1"
            />
            <div v-if="mapping.type === 'value'" class="input-container flex-1">
              <OInput
                v-model="mapping.value"
                :label="t('dashboard.valueMappingValue')"
                :data-test="`dashboard-addpanel-config-value-mapping-value-input-${index}`"
              />
            </div>
            <div v-if="mapping.type === 'regex'" class="input-container flex-1">
              <OInput
                v-model="mapping.pattern"
                :label="t('dashboard.valueMappingRegex')"
                :data-test="`dashboard-addpanel-config-value-mapping-pattern-input-${index}`"
              />
            </div>
            <div v-if="mapping.type === 'range'" class="input-container flex flex-1 flex-col gap-2">
              <OInput
                v-model="mapping.from"
                :placeholder="t('dashboard.valueMappingFrom')"
                :data-test="`dashboard-addpanel-config-value-mapping-from-input-${index}`"
              />
              <OInput
                v-model="mapping.to"
                :placeholder="t('dashboard.valueMappingTo')"
                class="flex-1"
                :data-test="`dashboard-addpanel-config-value-mapping-to-input-${index}`"
              />
            </div>
            <OInput
              v-model="mapping.text"
              :label="t('dashboard.valueMappingDisplayValue')"
              class="flex-1"
              :data-test="`dashboard-addpanel-config-value-mapping-text-input-${index}`"
            />
            <div
              class="flex flex-1 items-center"
              :data-test="`dashboard-addpanel-config-value-mapping-color-section-${index}`"
            >
              <div v-if="mapping.color !== null" class="flex items-center gap-1">
                <OColor v-model="mapping.color" class="mt-3 h-9 flex-1" />
                <OButton
                  variant="ghost"
                  size="icon"
                  :title="t('dashboard.valueMappingRemoveColor')"
                  @click="removeColorByIndex(index)"
                >
                  <template #icon-left>
                    <OIcon name="cancel" size="sm" />
                  </template>
                </OButton>
              </div>
              <div v-else class="w-full">
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-value-mapping-set-color-btn-${index}`"
                  @click="setColorByIndex(index)"
                  >{{ t("dashboard.valueMappingSetColor") }}</OButton
                >
              </div>
            </div>
            <OButton
              variant="ghost"
              size="icon"
              @click="removeValueMappingByIndex(index)"
              :data-test="`dashboard-addpanel-config-value-mapping-delete-btn-${index}`"
              icon-left="close"
            >
            </OButton>
          </div>
        </div>
      </draggable>
    </div>
  </ODialog>
</template>
<script lang="ts">
import { ref, computed, watch } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { onMounted } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OColor from "@/lib/forms/Color/OColor.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";

export default defineComponent({
  name: "ValueMappingPopUp",
  components: {
    draggable: VueDraggableNext as any,
    OButton,
    OInput,
    OSelect,
    OColor,
    ODialog,
    OIcon,
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
    const { t } = useI18n();

    // editedValueMapping is populated by the watch below (on every open)
    const editedValueMapping = ref<any[]>([]);

    // Deep-clone prop on every open so edits never leak back to the chart
    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          editedValueMapping.value = props.valueMapping?.length
            ? JSON.parse(JSON.stringify(props.valueMapping))
            : [{ type: "value", value: "", text: "", color: null }];
        }
      },
      { immediate: true },
    );

    const dragOptions = ref({
      animation: 200,
    });

    const mappingTypes = computed(() => [
      {
        label: t("dashboard.valueMappingTypeValue"),
        value: "value",
      },
      {
        label: t("dashboard.valueMappingTypeRange"),
        value: "range",
      },
      {
        label: t("dashboard.valueMappingTypeRegex"),
        value: "regex",
      },
    ]);

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
    };

    onMounted(() => {
      // if mappings is empty, add default value mapping
      if (editedValueMapping.value.length == 0) {
        addValueMapping();
      }
    });

    const setColorByIndex = (index: number) => {
      editedValueMapping.value[index].color = "#000000";
    };

    const removeColorByIndex = (index: number) => {
      editedValueMapping.value[index].color = null;
    };

    const applyValueMapping = () => {
      emit("save", editedValueMapping.value);
    };

    const cancelEdit = () => {
      // Reset to last saved state so unsaved edits are discarded
      editedValueMapping.value = props.valueMapping?.length
        ? JSON.parse(JSON.stringify(props.valueMapping))
        : [{ type: "value", value: "", text: "", color: null }];
      emit("close");
    };

    return {
      t,
      addValueMapping,
      removeValueMappingByIndex,
      mappingTypes,
      dragOptions,
      setColorByIndex,
      removeColorByIndex,
      applyValueMapping,
      cancelEdit,
      editedValueMapping,
      cancel: "cancel",
    };
  },
});
</script>
