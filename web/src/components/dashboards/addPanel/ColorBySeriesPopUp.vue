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
    data-test="dashboard-color-by-series-popup"
    style="padding: 5px 10px; min-width: min(1200px, 90vw)"
  >
    <div
      class="flex justify-between items-center q-pa-md header tw:top-0 tw:sticky tw:bg-dialog-bg tw:z-[1]"
      style="border-bottom: 2px solid gray; margin-bottom: 5px"
    >
      <div class="flex items-center q-table__title q-mr-md">
        <span>Color by series</span>
      </div>
      <OButton
        variant="ghost"
        size="icon"
        :title="t('dashboard.cancel')"
        @click.stop="cancelEdit"
        data-test="dashboard-color-by-series-cancel"
      >
        <template #icon-left><q-icon name="close" /></template>
      </OButton>
    </div>
    <div class="flex tw:justify-between tw:flex-col">
      <div class="tw:mt-2 scrollable-content scroll tw:min-h-52">
        <draggable
          v-model="editColorBySeries"
          :options="dragOptions"
          @mousedown.stop="() => {}"
          data-test="dashboard-addpanel-config-color-by-series-drag"
        >
          <div
            v-for="(series, index) in editColorBySeries"
            :key="index"
            class="draggable-row"
          >
            <div class="draggable-handle tw:self-center">
              <q-icon
                name="drag_indicator"
                color="grey-13"
                class="q-mr-xs"
                :data-test="`dashboard-addpanel-config-color-by-series-drag-handle-${index}`"
              />
            </div>
            <div class="draggable-content tw:flex tw:gap-x-6">
              <div class="input-container tw:flex-1">
                <CommonAutoComplete
                  v-model="series.value"
                  :items="seriesDataItems"
                  searchRegex="(?:{([^}])(?:{.})*$|([a-zA-Z-_]+)$)"
                  label="Select Series"
                  color="input-border"
                  bg-color="input-bg"
                  stack-label
                  borderless
                  label-slot
                  style="
                    top: none !important;
                    margin-top: none !important;
                    padding-top: 1px !important;
                    width: auto !important;
                  "
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
              <div class="color-section tw:flex-1">
                <div
                  v-if="series.color !== null"
                  class="tw:items-center tw:flex"
                >
                  <q-input
                    v-model="series.color"
                    style="width: 90%"
                    class="input-spacing"
                    dense
                    borderless
                    hide-bottom-space
                  >
                    <template v-slot:append>
                      <q-icon
                        name="colorize"
                        class="cursor-pointer"
                        :ref="`colorize-icon-${index}`"
                        @click="openColorPicker(index)"
                      >
                        <q-popup-proxy cover transition-show="scale">
                          <q-color v-model="series.color" />
                        </q-popup-proxy>
                      </q-icon>
                    </template>
                  </q-input>
                  <q-icon
                    :name="outlinedCancel"
                    style="width: 10%"
                    class="cursor-pointer tw:align-middle"
                    size="xs"
                    title="Remove color"
                    @click="removeColorByIndex(index)"
                  />
                </div>
                <div v-else class="tw:w-full">
                  <OButton
                    variant="ghost-primary"
                    size="sm"
                    class="tw:w-full"
                    @click="setColorByIndex(index)"
                    >Set color</OButton
                  >
                </div>
              </div>

              <!-- Delete series -->
              <OButton
                variant="ghost"
                size="icon"
                @click="removecolorBySeriesByIndex(index)"
                :data-test="`dashboard-addpanel-config-color-by-series-delete-btn-${index}`"
              >
                <template #icon-left><q-icon name="close" /></template>
              </OButton>
            </div>
          </div>
        </draggable>
      </div>
      <!-- Footer Buttons -->
    </div>
    <div class="flex justify-between tw:sticky tw:bottom-0 sticky-footer tw:bg-dialog-bg tw:pt-2 tw:z-[1]">
      <OButton
        variant="outline"
        size="sm-action"
        @click="addcolorBySeries"
        data-test="dashboard-addpanel-config-color-by-series-add-btn"
        >+ Add a new color</OButton
      >
      <OButton
        variant="primary"
        size="sm-action"
        @click="applycolorBySeries"
        :disabled="!isFormValid"
        data-test="dashboard-addpanel-config-color-by-series-apply-btn"
        >Save</OButton
      >
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
import { watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";

export default defineComponent({
  name: "colorBySeriesPopUp",
  components: {
    draggable: VueDraggableNext as any,
    CommonAutoComplete,
    OButton,
  },
  props: {
    colorBySeries: {
      type: Array,
      default: () => [],
    },
    seriesOptions: {
      type: Array,
      default: () => [],
    },
  },
  emits: ["close", "save"],
  setup(props: any, { emit }) {
    const { t } = useI18n();

    // Initialize with colorBySeries (edited data) if available, otherwise default empty
    const editColorBySeries = ref(
      props.colorBySeries?.length
        ? props.colorBySeries.map((m: any) => ({
            ...m,
            value: typeof m.value === "string" ? m.value : "",
            color: m.color || null,
          }))
        : [{ type: "value", value: "", color: null }],
    );

    // Validate for save button click
    // Each series must have both value (series name) and color selected for save it
    const isFormValid = computed(() => {
      return editColorBySeries.value.every((series: any) => {
        return (
          series.value && series.value.trim() !== "" && series.color !== null
        );
      });
    });

    // Watch for changes in series.value to ensure proper reactivity
    watch(
      editColorBySeries,
      (newVal) => {
        newVal.forEach((series: any) => {
          if (
            typeof series.value !== "string" ||
            series.value === undefined ||
            series.value === null
          ) {
            series.value = "";
          }
        });
      },
      { deep: true },
    );

    const dragOptions = ref({
      animation: 200,
    });

    const addcolorBySeries = () => {
      editColorBySeries.value.push({
        type: "value",
        value: "",
        color: null,
      });
    };

    // Use props.options for series dropdown options (not for initialization)
    const seriesDataItems = computed(
      () =>
        props?.seriesOptions
          ?.map((it: any) => ({
            label: it?.name,
            value: it?.name,
          }))
          .filter((item: any) => item.label !== undefined) || [],
    );

    const selectColorBySeriesOption = (seriesOptions: any) => {
      return seriesOptions.value || seriesOptions.label || seriesOptions;
    };

    const removecolorBySeriesByIndex = (index: number) => {
      editColorBySeries.value.splice(index, 1);
    };

    onMounted(() => {
      // if editColorBySeries is empty, add default color
      if (editColorBySeries.value.length === 0) {
        addcolorBySeries();
      }
    });

    const setColorByIndex = (index: number) => {
      editColorBySeries.value[index].color = "#5960b2";
    };

    const removeColorByIndex = (index: number) => {
      editColorBySeries.value[index].color = null;
    };

    const applycolorBySeries = () => {
      // Only save if fields are not empty
      if (isFormValid.value) {
        emit("save", editColorBySeries.value);
      }
    };

    const cancelEdit = () => {
      emit("close");
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
      openColorPicker,
      selectColorBySeriesOption,
      isFormValid,
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
