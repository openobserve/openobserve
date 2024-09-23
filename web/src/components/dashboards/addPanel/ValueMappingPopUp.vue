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
            <div class="draggable-handle">
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
                :options="mappingTypes"
                label="Type"
                class="tw-w-40 showLabelOnTop"
                stack-label
                emit-value
                data-test="dashboard-addpanel-config-value-mapping-type-select"
              />
              <q-input
                v-if="mapping.type === 'value'"
                v-model="mapping.value"
                label="Value"
                class="showLabelOnTop"
                data-test="dashboard-addpanel-config-value-mapping-name-edit"
              />

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
                ></q-btn>
              </span>
            </div>
          </div>
        </draggable>
      </div>
      <q-btn
        @click="addValueMapping"
        style="cursor: pointer; padding: 0px 5px"
        label="+ Add a new mapping"
        no-caps
        data-test="dashboard-addpanel-config-value-mapping-add-btn"
      />
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
    ];

    const addValueMapping = () => {
      dashboardPanelData.data.config.mappings.push({
        type: "value",
        value: "",
        color: "#000000",
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

    return {
      t,
      dashboardPanelData,
      store,
      addValueMapping,
      removeValueMappingByIndex,
      mappingTypes,
      dragOptions,
      outlinedDelete,
    };
  },
});
</script>

<style lang="scss" scoped>
.draggable-row {
  display: flex;
  border-bottom: 1px solid #cccccc70;
  margin-bottom: 8px;
  cursor: move;
}

.draggable-handle {
  flex: 0 0 30px;
  padding: 8px;
  box-sizing: border-box;
}

.draggable-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  padding: 8px;
  box-sizing: border-box;
}
</style>
