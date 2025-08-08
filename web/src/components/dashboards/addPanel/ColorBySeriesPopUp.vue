<!-- Copyright 2023 OpenObserve Inc.

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
    style="padding: 5px 10px; min-width: min(1200px, 90vw)"
  >
    <div
      class="flex justify-between items-center q-pa-md header tw-top-0 tw-sticky"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>Color by series</span>
      </div>
      <q-btn
        icon="close"
        class="q-ml-xs"
        unelevated
        size="sm"
        round
        outline
        :title="t('dashboard.cancel')"
        @click.stop="cancelEdit"
        data-test="dashboard-tab-settings-tab-name-edit-cancel"
      ></q-btn>
    </div>
  <div class="flex tw-justify-between tw-flex-col">
    <div class="tw-mt-2 scrollable-content scroll tw-min-h-52">
      <draggable
        v-model="editColorBySeries"
        :options="dragOptions"
        @mousedown.stop="() => {}"
        data-test="dashboard-addpanel-config-value-mapping-drag"
      >
        <div
          v-for="(mapping, index) in editColorBySeries"
          :key="index"
          class="draggable-row"
        >
          <div class="draggable-handle tw-self-center">
            <q-icon
              name="drag_indicator"
              color="grey-13"
              class="q-mr-xs"
              :data-test="`dashboard-addpanel-config-value-mapping-drag-handle-${index}`"
            />
          </div>
          <div class="draggable-content tw-flex tw-gap-x-6">
         
            <div
              class="input-container tw-flex-1"
            >
             <CommonAutoComplete
                v-model="mapping.value"
                :items="seriesDataItems"
                searchRegex="(?:{([^}]*)(?:{.*})*$|([a-zA-Z-_]+)$)"
                label="Select Series"
                color="input-border"
                bg-color="input-bg"
                stack-label
                outlined
                label-slot
                style="top: none !important; margin-top: none !important; padding-top: 1px !important; width: auto !important;"
                :value-replace-fn="selectColorBySeriesOption"
              >
                <template v-slot:label>
                  <div class="row items-center all-pointer-events">
                    Select series
                  </div>
                </template>
              </CommonAutoComplete>

            </div>

            <!-- Color Picker -->
            <div class="color-section tw-flex-1">
              <div
                v-if="mapping.color !== null"
                class="tw-items-center tw-flex"
              >
                <q-input
                  v-model="mapping.color"
                  filled
                  style="width: 90%"
                  class="input-spacing"
                  dense
                >
                  <template v-slot:append>
                    <q-icon 
                      name="colorize" 
                      class="cursor-pointer"
                      :ref="`colorize-icon-${index}`"
                      @click="openColorPicker(index)"
                    >
                      <q-popup-proxy cover transition-show="scale">
                        <q-color v-model="mapping.color" />
                      </q-popup-proxy>
                    </q-icon>
                  </template>
                </q-input>
                <q-icon
                  :name="outlinedCancel"
                  style="width: 10%"
                  class="cursor-pointer tw-align-middle"
                  size="xs"
                  title="Remove color"
                  @click="removeColorByIndex(index)"
                />
              </div>
              <div v-else class="tw-w-full">
                <q-btn
                  label="Set color"
                  no-caps
                  flat
                  dense
                  class="tw-text-blue-700 tw-font-semibold tw-w-full"
                  @click="handleSetColorClick(index)"
                />
              </div>
            </div>

            <!-- Delete Mapping -->
            <q-btn
              icon="close"
              class="delete-btn"
              dense
              flat
              round
              @click="removecolorBySeriesByIndex(index)"
              :data-test="`dashboard-addpanel-config-value-mapping-delete-btn-${index}`"
            />
          </div>
        </div>
      </draggable>
    </div>
      <!-- Footer Buttons -->
    </div>
      <div class="flex justify-between tw-sticky tw-bottom-0 sticky-footer">
        <q-btn
          @click="addcolorBySeries"
          label="+ Add a new color"
          no-caps
          outline
          dense
          data-test="dashboard-addpanel-config-value-mapping-add-btn"
        />
        <q-btn
          @click="applycolorBySeries"
          color="primary"
          label="Save"
          style="margin-right: 10px"
          padding="5px 14px"
          no-caps
          dense
          data-test="dashboard-addpanel-config-value-mapping-apply-btn"
        />
    </div>
  </div>
</template>
<script lang="ts">
import { computed, ref, nextTick } from "vue";
import { defineComponent } from "vue";
import { useI18n } from "vue-i18n";
import { onMounted } from "vue";
import { VueDraggableNext } from "vue-draggable-next";
import { outlinedCancel } from "@quasar/extras/material-icons-outlined";
import CommonAutoComplete from "./CommonAutoComplete.vue";
import { items } from "happy-dom/lib/PropertySymbol";
import { watch } from "vue";
import { inject } from "vue";
import useDashboardPanelData from "@/composables/useDashboardPanel";


export default defineComponent({
  name: "colorBySeriesPopUp",
  components: { draggable: VueDraggableNext as any, CommonAutoComplete },
  props: {
    colorBySeries: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();
     const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );
    // const editColorBySeries = ref(props.colorBySeries.options.series);
    const editColorBySeries = ref(
      props.colorBySeries.mappings?.length
        ? props.colorBySeries.mappings.map((m: any) => ({
            ...m,
            value: typeof m.value === 'string' ? m.value : '',
            color: m.color || null
          }))
        : [{ type: "value", value: "", text: "", color: null }]
    );
    // Watcher to ensure mapping.value is always a string

    watch(editColorBySeries, (newVal) => {
      newVal.forEach((mapping: any) => {
        if (typeof mapping.value !== "string") {
          mapping.value = "";
        }
      });
    }, { deep: true });

    // Watch for changes in mapping.value to ensure proper reactivity
    watch(editColorBySeries, (newVal) => {
      newVal.forEach((mapping: any) => {
        if (mapping.value === undefined || mapping.value === null) {
          mapping.value = "";
        }
      });
    }, { deep: true });


    const dragOptions = ref({
      animation: 200,
    });

    const addcolorBySeries = () => {
      editColorBySeries.value.push({
        type: "value",
        value: "",
        text: "",
        color: null,
      });
    };

    {{console.log("props", props?.colorBySeries?.options)}}
    const seriesDataItems = computed(() =>
      props?.colorBySeries?.options?.series?.map((it: any) => ({
        label: it.name,
        value: it.name,
      })) || []
    );

  
    const selectColorBySeriesOption = (option: any) => {
      return option.value || option.label || option;
    };

    const removecolorBySeriesByIndex = (index: number) => {
      editColorBySeries.value.splice(index, 1);
    };

    onMounted(() => {
      // if mappings is empty, add default value mapping
      if (editColorBySeries.value.length == 0) {
        addcolorBySeries();
      }
    });

    const setColorByIndex = (index: number) => {
      editColorBySeries.value[index].color = "#000000";
    };

    const removeColorByIndex = (index: number) => {
      editColorBySeries.value[index].color = null;
    };

    const applycolorBySeries = () => {
      // emit("save", editColorBySeries.value);
       emit("save", {
        ...props.colorBySeries,
        mappings: editColorBySeries.value
      });
    };

    const cancelEdit = () => {
      emit("close");
    };

    // Method to set color and focus input for color picker
    const handleSetColorClick = (index: number) => {
      setColorByIndex(index);
      // Use nextTick to ensure DOM is updated before trying to focus
      nextTick(() => {
        if (typeof window !== 'undefined' && window.document) {
          // Find the colorize icon and click it to open the color picker
          const colorizeIcons = window.document.querySelectorAll('.color-section .q-icon[name="colorize"]');
          if (colorizeIcons && colorizeIcons[index]) {
            (colorizeIcons[index] as HTMLElement).click();
          }
        }
      });
    };

    // Method to open color picker directly
    const openColorPicker = (index: number) => {
      // This method is called when the colorize icon is clicked
      // The color picker should open automatically due to q-popup-proxy
    };

    return {
      t,
      addcolorBySeries,
      removecolorBySeriesByIndex,
      dragOptions,
      setColorByIndex,
      removeColorByIndex,
      applycolorBySeries,
      cancelEdit,
      editColorBySeries,
      outlinedCancel,
      seriesDataItems,
      handleSetColorClick,
      openColorPicker,
      selectColorBySeriesOption
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
.scrollable-content {
  overflow-y: auto;
  max-height: calc(100vh - 190px);
  &::-webkit-scrollbar {
    width: 6px;
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;
  }
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
.sticky-footer {
  position: sticky;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 12px 0 8px 0;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  z-index: 10;
  border-top: 1px solid #eee;
  box-shadow: rgb(240, 240, 240) 0px -4px 7px 0px;
}
</style>
