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
    size="lg"
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
          class="mb-2 flex items-start gap-2"
        >
          <div class="cursor-move p-2">
            <OIcon
              name="drag-indicator"
              size="sm"
              :data-test="`dashboard-addpanel-config-value-mapping-drag-handle-${index}`"
            />
          </div>
          <div
            class="rounded-default border-border-default flex flex-1 flex-col gap-2 border px-2.5 py-2"
          >
            <!-- Condition — "If value [is / between / matches] …" -->
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
                >{{ t("dashboard.valueMappingIfValue") }}</span
              >
              <div class="w-44 shrink-0">
                <OSelect
                  v-model="mapping.type"
                  :options="mappingTypes"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-value-mapping-type-select-${index}`"
                />
              </div>
              <div v-if="mapping.type === 'range'" class="flex w-52 shrink-0 gap-2">
                <div class="min-w-0 flex-1">
                  <OInput
                    v-model="mapping.from"
                    :placeholder="t('dashboard.valueMappingFrom')"
                    class="w-full"
                    :data-test="`dashboard-addpanel-config-value-mapping-from-input-${index}`"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <OInput
                    v-model="mapping.to"
                    :placeholder="t('dashboard.valueMappingTo')"
                    class="w-full"
                    :data-test="`dashboard-addpanel-config-value-mapping-to-input-${index}`"
                  />
                </div>
              </div>
              <div v-else-if="mapping.type === 'regex'" class="w-52 shrink-0">
                <OInput
                  v-model="mapping.pattern"
                  :placeholder="t('dashboard.valueMappingRegex')"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-value-mapping-pattern-input-${index}`"
                />
              </div>
              <div v-else class="w-52 shrink-0">
                <OInput
                  v-model="mapping.value"
                  :placeholder="t('dashboard.valueMappingValue')"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-value-mapping-value-input-${index}`"
                />
              </div>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="close"
                :title="t('common.remove')"
                class="ml-auto shrink-0"
                :data-test="`dashboard-addpanel-config-value-mapping-delete-btn-${index}`"
                @click="removeValueMappingByIndex(index)"
              />
            </div>
            <!-- Display text -->
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
                >{{ t("dashboard.valueMappingDisplayValue") }}</span
              >
              <div class="w-98 shrink-0">
                <OInput
                  v-model="mapping.text"
                  :placeholder="t('dashboard.valueMappingDisplayPlaceholder')"
                  class="w-full"
                  :data-test="`dashboard-addpanel-config-value-mapping-text-input-${index}`"
                />
              </div>
            </div>
            <!-- Text color -->
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
                >{{ t("dashboard.textColor") }}</span
              >
              <ColorSwatchPicker
                v-model="mapping.textColor"
                :swatches="TEXT_SWATCHES"
                :data-test="`dashboard-addpanel-config-value-mapping-text-color-${index}`"
              />
            </div>
            <!-- Background color -->
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="o-input-label text-compact text-input-label-text w-24 shrink-0 leading-tight font-medium"
                >{{ t("dashboard.bgColor") }}</span
              >
              <ColorSwatchPicker
                v-model="mapping.color"
                :swatches="BG_SWATCHES"
                :data-test="`dashboard-addpanel-config-value-mapping-bg-color-${index}`"
              />
            </div>
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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ColorSwatchPicker from "../ColorSwatchPicker.vue";
import { TEXT_SWATCHES, BG_SWATCHES } from "@/composables/dashboard/useColumnFormatting";

export default defineComponent({
  name: "ValueMappingPopUp",
  components: {
    draggable: VueDraggableNext as any,
    OButton,
    OInput,
    OSelect,
    ColorSwatchPicker,
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
      { label: t("dashboard.valueMappingTypeValue"), value: "value" },
      { label: t("dashboard.valueMappingTypeRange"), value: "range" },
      { label: t("dashboard.valueMappingTypeRegex"), value: "regex" },
      { label: t("dashboard.valueMappingTypeGt"), value: "gt" },
      { label: t("dashboard.valueMappingTypeLt"), value: "lt" },
      { label: t("dashboard.valueMappingTypeGte"), value: "gte" },
      { label: t("dashboard.valueMappingTypeLte"), value: "lte" },
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
      applyValueMapping,
      cancelEdit,
      editedValueMapping,
      TEXT_SWATCHES,
      BG_SWATCHES,
      cancel: "cancel",
    };
  },
});
</script>
