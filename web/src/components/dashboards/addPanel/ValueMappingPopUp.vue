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
    style="padding: 0px 10px; min-width: 70%"
    class="scroll o2-input"
    data-test="dashboard-value-mapping-popup"
  >
    <div
      class="flex justify-between items-center q-pa-md"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>Value Mappings</span>
      </div>
    </div>
    <div class="tw-mb-4">
      <div>
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
                class="'q-mr-xs"
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

              <q-input
                v-if="mapping.type === 'value'"
                v-model="mapping.value"
                label="Value"
                style="width: 250px"
                data-test="dashboard-addpanel-config-value-mapping-value-input"
              />
              <q-input
                v-if="mapping.type === 'regex'"
                v-model="mapping.pattern"
                label="Regex"
                style="width: 250px"
                data-test="dashboard-addpanel-config-value-mapping-value-input"
              />
              <!-- class="showLabelOnTop" -->

              <q-input
                v-if="mapping.type === 'range'"
                v-model="mapping.from"
                label="From"
                data-test="dashboard-addpanel-config-value-mapping-value-from-input"
              />
              <!-- class="showLabelOnTop" -->

              <q-input
                v-if="mapping.type === 'range'"
                v-model="mapping.to"
                label="To"
                data-test="dashboard-addpanel-config-value-mapping-value-to-input"
              />
              <!-- class="showLabelOnTop" -->

              <div v-if="mapping.color !== null" class="flex tw-items-center">
                <q-input
                  filled
                  v-model="mapping.color"
                  :rules="['anyColor']"
                  class="my-input"
                >
                  <template v-slot:append>
                    <q-icon name="colorize" class="cursor-pointer">
                      <q-popup-proxy
                        cover
                        transition-show="scale"
                        transition-hide="scale"
                      >
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
                <div
                  class="cursor-pointer tw-text-blue-700 tw-font-semibold"
                  @click="setColorByIndex(index)"
                >
                  Set color
                </div>
              </div>

              <span class="q-ml-lg">
                <q-btn
                  :icon="outlinedDelete"
                  :title="t('dashboard.delete')"
                  class="q-ml-xs"
                  padding="sm"
                  unelevated
                  size="sm"
                  round
                  flat
                  data-test="dashboard-addpanel-config-value-mapping-delete-btn"
                  @click="removeValueMappingByIndex(index)"
                ></q-btn>
              </span>
            </div>
          </div>
        </draggable>
      </div>
      <div class="tw-flex tw-justify-between">
        <q-btn
          @click="addValueMapping"
          style="cursor: pointer; padding: 0px 5px"
          label="+ Add a new mapping"
          no-caps
          data-test="dashboard-addpanel-config-value-mapping-add-btn"
        />
        <q-btn
          v-close-popup="true"
          style="cursor: pointer"
          color="primary"
          label="Apply"
          no-caps
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
  border-bottom: 1px solid #cccccc70;
  margin-bottom: 8px;
}

.draggable-handle {
  cursor: move;
  flex: 0 0 30px;
  padding: 8px;
  box-sizing: border-box;
}

.draggable-content {
  align-items: center;
  flex: 1;
  display: flex;
  justify-content: space-between;
  padding: 8px;
  box-sizing: border-box;
}
</style>
