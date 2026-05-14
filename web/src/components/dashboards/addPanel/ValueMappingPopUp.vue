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
  <div
    class="scroll"
    data-test="dashboard-value-mapping-popup"
    style="padding: 0px 10px; min-width: min(1200px, 90vw)"
  >
    <div
      class="flex justify-between items-center q-pa-md header"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>{{ t("dashboard.valueMappingsTitle") }}</span>
      </div>
      <OButton
        variant="ghost"
        size="icon"
        :title="t('dashboard.cancel')"
        @click.stop="cancelEdit"
        data-test="dashboard-tab-settings-tab-name-edit-cancel"
      >
        <template #icon-left><q-icon name="close" /></template>
      </OButton>
    </div>
    <div class="tw:mb-4">
      <draggable
        v-model="editedValueMapping"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-addpanel-config-value-mapping-drag"
      >
        <div
          v-for="(mapping, index) in editedValueMapping"
          :key="index"
          class="draggable-row"
        >
          <div class="draggable-handle tw:self-center">
            <q-icon
              name="drag_indicator"
              color="grey-13"
              class="q-mr-xs"
              :data-test="`dashboard-addpanel-config-value-mapping-drag-handle-${index}`"
            />
          </div>
          <div class="draggable-content tw:flex tw:gap-x-6">
            <q-select
              v-model="mapping.type"
              :label="t('dashboard.valueMappingType')"
              :options="mappingTypes"
              :data-test="`dashboard-addpanel-config-value-mapping-type-select-${index}`"
              emit-value
              map-options
              input-debounce="0"
              behavior="menu"
              borderless
              dense
              class="q-mb-xs tw:flex-1 o2-custom-select-dashboard"
              hide-bottom-space
            ></q-select>
            <div
              v-if="mapping.type === 'value'"
              class="input-container tw:flex-1"
            >
              <q-input
                v-model="mapping.value"
                :label="t('dashboard.valueMappingValue')"
                class="input-spacing"
                dense
                :data-test="`dashboard-addpanel-config-value-mapping-value-input-${index}`"
                borderless
                hide-bottom-space
              />
            </div>
            <div
              v-if="mapping.type === 'regex'"
              class="input-container tw:flex-1"
            >
              <q-input
                v-model="mapping.pattern"
                :label="t('dashboard.valueMappingRegex')"
                class="input-spacing"
                dense
                :data-test="`dashboard-addpanel-config-value-mapping-pattern-input-${index}`"
                borderless
                hide-bottom-space
              />
            </div>
            <div
              v-if="mapping.type === 'range'"
              class="input-container tw:flex-1"
            >
              <q-input
                v-model="mapping.from"
                :label="t('dashboard.valueMappingFrom')"
                class="input-spacing"
                dense
                :data-test="`dashboard-addpanel-config-value-mapping-from-input-${index}`"
                borderless
                hide-bottom-space
              />
              <q-input
                v-model="mapping.to"
                :label="t('dashboard.valueMappingTo')"
                class="input-spacing tw:flex-1"
                dense
                :data-test="`dashboard-addpanel-config-value-mapping-to-input-${index}`"
                borderless
                hide-bottom-space
              />
            </div>
            <q-input
              v-model="mapping.text"
              :label="t('dashboard.valueMappingDisplayValue')"
              class="input-spacing tw:flex-1"
              dense
              :data-test="`dashboard-addpanel-config-value-mapping-text-input-${index}`"
              borderless
              hide-bottom-space
            />
            <div class="color-section tw:flex-1">
              <div
                v-if="mapping.color !== null"
                class="tw:items-center tw:flex"
              >
                <q-input
                  v-model="mapping.color"
                  style="width: 90%"
                  class="input-spacing"
                  dense
                  borderless
                  hide-bottom-space
                >
                  <template v-slot:append>
                    <q-icon name="colorize" class="cursor-pointer">
                      <q-popup-proxy cover transition-show="scale">
                        <q-color v-model="mapping.color" />
                      </q-popup-proxy>
                    </q-icon>
                  </template>
                </q-input>
                <q-icon
                  :name="outlinedCancel"
                  style="width: 10%"
                  class="cursor-pointer tw:align-middle"
                  size="xs"
                  :title="t('dashboard.valueMappingRemoveColor')"
                  @click="removeColorByIndex(index)"
                />
              </div>
              <div v-else class="tw:w-full">
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  class="tw:w-full"
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
            >
              <template #icon-left><q-icon name="close" /></template>
            </OButton>
          </div>
        </div>
      </draggable>
      <div class="flex justify-between">
        <OButton
          variant="outline"
          size="sm"
          @click="addValueMapping"
          data-test="dashboard-addpanel-config-value-mapping-add-btn"
          >{{ t("dashboard.valueMappingAddNew") }}</OButton
        >
        <OButton
          variant="primary"
          size="sm"
          @click="applyValueMapping"
          data-test="dashboard-addpanel-config-value-mapping-apply-btn"
          >{{ t("dashboard.valueMappingApply") }}</OButton
        >
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { ref, computed } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { onMounted } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { outlinedCancel } from "@quasar/extras/material-icons-outlined";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "ValueMappingPopUp",
  components: { draggable: VueDraggableNext as any, OButton },
  props: {
    valueMapping: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();

    const editedValueMapping = ref(props.valueMapping);

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
      outlinedCancel,
    };
  },
});
</script>

<style lang="scss" scoped>
.draggable-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #cccccc70;
  margin-bottom: 8px;
}

.draggable-handle {
  cursor: move;
  padding: 8px;
}

.draggable-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}

.input-spacing {
  margin-right: 10px;
}

.color-section {
  display: flex;
  align-items: center;
}

.delete-btn {
  margin-left: 10px;
}
</style>
