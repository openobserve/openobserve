<!-- Copyright 2023 Zinc Labs Inc.

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
    style="padding: 0px 10px; min-width: 90%"
  >
    <div
      class="flex justify-between items-center q-pa-md header"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>Value Mappings</span>
      </div>
    </div>
    <div class="tw-mb-4">
      <draggable
        v-model="dashboardPanelData.data.config.mappings"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-addpanel-config-value-mapping-drag"
      >
        <div
          v-for="(mapping, index) in dashboardPanelData.data.config.mappings"
          :key="index"
          class="draggable-row"
        >
          <div class="draggable-handle tw-self-center">
            <q-icon
              name="drag_indicator"
              color="grey-13"
              class="q-mr-xs"
              data-test="dashboard-addpanel-config-value-mapping-drag-handle"
            />
          </div>
          <div class="draggable-content">
            <q-select
              v-model="mapping.type"
              label="Type"
              :options="mappingTypes"
              style="width: 250px"
              data-test="dashboard-addpanel-config-value-mapping-type-select"
              emit-value
              input-debounce="0"
              behavior="menu"
              filled
              borderless
              dense
              class="q-mb-xs"
            ></q-select>
            <div v-if="mapping.type === 'value'" class="input-container">
              <q-input
                v-model="mapping.value"
                label="Value"
                style="width: 120px"
                class="input-spacing"
                dense
                data-test="dashboard-addpanel-config-value-mapping-value-input"
              />
            </div>
            <div v-if="mapping.type === 'regex'" class="input-container">
              <q-input
                v-model="mapping.pattern"
                label="Regex"
                style="width: 120px"
                class="input-spacing"
                dense
                data-test="dashboard-addpanel-config-value-mapping-pattern-input"
              />
            </div>
            <div v-if="mapping.type === 'range'" class="input-container">
              <q-input
                v-model="mapping.from"
                label="From"
                style="width: 80px"
                class="input-spacing"
                dense
                data-test="dashboard-addpanel-config-value-mapping-from-input"
              />
              <q-input
                v-model="mapping.to"
                label="To"
                style="width: 80px"
                class="input-spacing"
                dense
                data-test="dashboard-addpanel-config-value-mapping-to-input"
              />
            </div>
            <q-input
              v-model="mapping.text"
              label="Display Value"
              style="width: 120px"
              class="input-spacing"
              dense
              data-test="dashboard-addpanel-config-value-mapping-text-input"
            />
            <div class="color-section">
              <div v-if="mapping.color !== null" class="flex tw-items-center">
                <q-input
                  v-model="mapping.color"
                  filled
                  class="input-spacing"
                  dense
                  style="width: 80px"
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
                  name="close"
                  class="cursor-pointer tw-align-middle"
                  size="sm"
                  @click="removeColorByIndex(index)"
                />
              </div>
              <div v-else>
                <q-btn
                  label="Set color"
                  no-caps
                  flat
                  dense
                  class="tw-text-blue-700 tw-font-semibold"
                  @click="setColorByIndex(index)"
                />
              </div>
            </div>
            <q-btn
              :icon="outlinedDelete"
              class="delete-btn"
              dense
              flat
              round
              @click="removeValueMappingByIndex(index)"
              data-test="dashboard-addpanel-config-value-mapping-delete-btn"
            />
          </div>
        </div>
      </draggable>
      <div class="flex justify-between">
        <q-btn
          @click="addValueMapping"
          label="+ Add a new mapping"
          no-caps
          flat
          dense
          data-test="dashboard-addpanel-config-value-mapping-add-btn"
        />
        <q-btn
          v-close-popup="true"
          color="primary"
          label="Apply"
          no-caps
          flat
          dense
          data-test="dashboard-addpanel-config-value-mapping-apply-btn"
        />
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import { inject, ref } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { outlinedDelete } from "@quasar/extras/material-icons-outlined";
import { onMounted } from "vue";

export default defineComponent({
  name: "ValueMappingPopUp",
  components: {},
  props: {},
  emits: ["close"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const dragOptions = ref({
      animation: 200,
    });

    const mappingTypes = [
      {
        label: "Value",
        value: "value",
      },
      {
        label: "Range",
        value: "range",
      },
      {
        label: "Regex",
        value: "regex",
      },
    ];

    const addValueMapping = () => {
      dashboardPanelData.data.config.mappings.push({
        type: "value",
        value: "",
        color: null,
      });
    };

    const removeValueMappingByIndex = (index: number) => {
      dashboardPanelData.data.config.mappings.splice(index, 1);
    };

    onMounted(() => {
      if (!dashboardPanelData.data.config.mappings) {
        dashboardPanelData.data.config.mappings = [];
      }

      // if mappings is empty, add default value mapping
      if (dashboardPanelData.data.config.mappings.length == 0) {
        addValueMapping();
      }
    });

    const setColorByIndex = (index: number) => {
      dashboardPanelData.data.config.mappings[index].color = "#000000";
    };

    const removeColorByIndex = (index: number) => {
      dashboardPanelData.data.config.mappings[index].color = null;
    };

    return {
      t,
      dashboardPanelData,
      store,
      addValueMapping,
      removeValueMappingByIndex,
      mappingTypes,
      dragOptions,
      outlinedDelete,
      setColorByIndex,
      removeColorByIndex,
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
