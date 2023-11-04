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

<template>
  <div v-if="!promqlMode && dashboardPanelData.data.type != 'geomap'">
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
      <div class="layout-name">{{ dashboardPanelData.data.type == 'table' ? t('panel.firstColumn') :dashboardPanelData.data.type == 'h-bar' || dashboardPanelData.data.type == 'h-stacked' ? t('panel.yAxis') :  t('panel.xAxis') }}
      <q-icon name="info_outline" class="q-ml-xs" >
        <q-tooltip>
          {{ xAxisHint }}
        </q-tooltip>
      </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div class="axis-container droppable scroll q-py-xs" :class="{
        'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
        'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'x'
        }"
        @dragenter="onDragEnter($event, 'x')"
        @dragleave="onDragLeave($event, 'x')"
        @dragover="onDragOver($event, 'x')"
        @drop="onDrop($event, 'x')"
        v-mutation="handler2" data-test="dashboard-x-layout">
        <q-btn-group class="q-mr-sm" v-for="(itemX,index) in dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x" :key="index">
          <q-btn  
            icon-right="arrow_drop_down" no-caps color="primary" dense rounded size="sm"
            :label="xLabel[index]" class="q-pl-sm" :data-test="`dashboard-x-item-${itemX.column}`">
              <q-menu class="q-pa-md" :data-test="`dashboard-x-item-${itemX.column}-menu`">
                <div>
                  <div class="">
                    <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery" class="q-mr-xs q-mb-sm">
                      <q-select
                        v-model="
                          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index]
                            .aggregationFunction
                        "
                        :options="triggerOperatorsWithHistogram"
                        dense
                        filled
                        emit-value
                        map-options
                        label="Aggregation"
                        data-test="dashboard-x-item-dropdown"
                      >
                        <template v-slot:append>
                          <q-icon name="close" size="small" @click.stop.prevent="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index].aggregationFunction = null" class="cursor-pointer" />
                        </template>
                      </q-select>
                    </div>
                  </div>
                  <q-input
                    dense
                    filled
                    data-test="dashboard-x-item-input"
                    label="Label"
                    v-model="
                      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x[index]
                        .label
                    "
                    :rules="[ val => val.length > 0 || 'Required']"
                  />
                </div>
              </q-menu>
          </q-btn>
          <q-btn
            size="xs"
            round
            flat
            dense
            :data-test="`dashboard-x-item-${itemX.column}-remove`"
            @click="removeXAxisItem(itemX.column)"
            icon="close"
          />
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x.length < 1"
        >
          {{ xAxisHint }}
        </div>
      </div>
     
    </div>
    <q-separator />
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
      <div class="layout-name">{{ dashboardPanelData.data.type == 'table' ? t('panel.otherColumn') :dashboardPanelData.data.type == 'h-bar' || dashboardPanelData.data.type == 'h-stacked' ? t('panel.xAxis') : t('panel.yAxis') }}
        <q-icon name="info_outline" class="q-ml-xs" >
        <q-tooltip>
          {{ yAxisHint }}
        </q-tooltip>
      </q-icon>
      </div>
      <span class="layout-separator">:</span>
      <div class="axis-container droppable scroll q-py-xs" :class="{
        'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
        'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'y'
        }"
        @dragenter="onDragEnter($event, 'y')"
        @dragleave="onDragLeave($event, 'y')"
        @dragover="onDragOver($event, 'y')"
        @drop="onDrop($event, 'y')"
        v-mutation="handler2" data-test="dashboard-y-layout">
        <q-btn-group class="q-mr-sm" v-for="(itemY,index) in dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y" :key="index">
          <q-btn icon-right="arrow_drop_down" no-caps dense color="primary" rounded size="sm"
            :label="yLabel[index]" :data-test="`dashboard-y-item-${itemY.column}`" class="q-pl-sm">
            <q-menu class="q-pa-md" :data-test="`dashboard-y-item-${itemY.column}-menu`">
                <div>
                  <div class="row q-mb-sm" style="align-items: center;">
                    <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery" class="q-mr-xs" style="width: 160px">
                      <q-select
                        v-model="
                          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index]
                            .aggregationFunction 
                        "
                        :options="dashboardPanelData.data.type == 'heatmap' ? triggerOperatorsWithHistogram : triggerOperators"
                        dense
                        filled
                        emit-value
                        map-options
                        label="Aggregation"
                        data-test="dashboard-y-item-dropdown"
                      >
                      <template v-slot:append>
                          <div v-if="dashboardPanelData.data.type == 'heatmap'">
                          <q-icon name="close" size="small" @click.stop.prevent="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index].aggregationFunction = null" class="cursor-pointer" />
                        </div>
                        </template>
                    </q-select>
                    </div>
                    <div class="color-input-wrapper" v-if="!['table', 'pie'].includes(dashboardPanelData.data.type)">
                      <input
                        type="color"
                        data-test="dashboard-y-item-color"
                        v-model="
                          dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index]
                            .color
                        "
                      />
                    </div>
                  </div>
                  <q-input
                    dense
                    filled
                    label="Label"
                    data-test="dashboard-y-item-input"
                    v-model="
                      dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y[index]
                        .label
                    "
                    :rules="[ val => val.length > 0 || 'Required']"
                  />
                </div>
            </q-menu>
          </q-btn>
          <q-btn
            size="xs"
            round
            flat
            dense
            :data-test="`dashboard-y-item-${itemY.column}-remove`"
            @click="removeYAxisItem(itemY.column)"
            icon="close"
          />
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y.length < 1"
        >
          {{ yAxisHint }}
        </div>
      </div>
    </div>
    <q-separator />
    <span v-if="dashboardPanelData.data.type === 'heatmap'">
    <div style="display:flex; flex-direction: row;" class="q-pl-md">
        <div class="layout-name">{{ dashboardPanelData.data.type == 'heatmap' ? t('panel.zAxis') : '' }}
          <q-icon name="info_outline" class="q-ml-xs" >
          <q-tooltip>
            {{ zAxisHint }}
          </q-tooltip>
        </q-icon>
        </div>
        <span class="layout-separator">:</span>
        <div class="axis-container droppable scroll q-py-xs" :class="{
          'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
          'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'z'
        }"
          @dragenter="onDragEnter($event, 'z')"
          @dragleave="onDragLeave($event, 'z')"
          @dragover="onDragOver($event, 'z')"
          @drop="onDrop($event, 'z')"
          v-mutation="handler2">
          <q-btn-group class="q-mr-sm" v-for="(itemZ, index) in dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z" :key="index">
            <q-btn icon-right="arrow_drop_down" no-caps dense color="primary" rounded size="sm"
              :label="zLabel[index]" class="q-pl-sm">
              <q-menu class="q-pa-md">
                  <div>
                    <div class="row q-mb-sm" style="align-items: center;">
                      <div v-if="!dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery" class="q-mr-xs" style="width: 160px">
                        <q-select
                          v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z[index]
                              .aggregationFunction
                            "
                          :options="triggerOperators"
                          dense
                          filled
                          emit-value
                          map-options
                          label="Aggregation"
                        ></q-select>
                      </div>
                      <div class="color-input-wrapper" v-if="!['table', 'pie'].includes(dashboardPanelData.data.type)">
                        <input
                          type="color"
                          v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z[index]
                              .color
                            "
                        />
                      </div>
                    </div>
                    <q-input
                      dense
                      filled
                      label="Label"
                      v-model="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z[index]
                          .label
                        "
                      :rules="[val => val.length > 0 || 'Required']"
                    />
                  </div>
              </q-menu>
            </q-btn>
            <q-btn
              size="xs"
              round
              flat
              dense
              @click="removeZAxisItem(itemZ.column)"
              icon="close"
            />
          </q-btn-group>
          <div
            class="text-caption text-weight-bold text-center q-mt-xs"
            v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z.length < 1"
          >
            {{ zAxisHint }}
          </div>
        </div>
    </div>
    </span>
      <q-separator />
    <div v-if="!(dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery && dashboardPanelData.data.queryType == 'sql')" style="display:flex; flex-direction: row;" class="q-pl-md">
      <div class="layout-name"> {{ t('panel.filters') }}</div>
      <span class="layout-separator">:</span>
      <div class="axis-container droppable scroll q-py-xs" :class="{
        'drop-target': dashboardPanelData.meta.dragAndDrop.dragging,
        'drop-entered': dashboardPanelData.meta.dragAndDrop.dragging && currentDragArea == 'f'
        }"
        @dragenter="onDragEnter($event, 'f')"
        @dragleave="onDragLeave($event, 'f')"
        @dragover="onDragOver($event, 'f')"
        @drop="onDrop($event, 'f')"
        v-mutation="handler2" data-test="dashboard-filter-layout">
        <q-btn-group class="q-mr-sm" v-for="(filteredItem,index) in dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter" :key="index">
        <q-btn icon-right="arrow_drop_down" no-caps dense color="primary" rounded size="sm" :label="filteredItem.column" :data-test="`dashboard-filter-item-${filteredItem.column}`"  class="q-pl-sm">
          <q-menu class="q-pa-md" @show="(e)=>loadFilterItem(filteredItem.column)" :data-test="`dashboard-filter-item-${filteredItem.column}-menu`">
              <div>
                <div class="q-pa-xs">
                  <div class="q-gutter-xs">
                    <q-tabs
                      v-model="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[index]
                          .type
                      "
                      dense
                    >
                      <q-tab
                        dense
                        name="list"
                        label="List"
                        style="width: auto"
                        data-test="dashboard-filter-list-tab"
                      ></q-tab>
                      <q-tab
                        dense
                        name="condition"
                        label="Condition"
                        style="width: auto"
                        data-test="dashboard-filter-condition-tab"
                      ></q-tab>
                    </q-tabs>
                    <q-separator></q-separator>
                    <q-tab-panels
                      dense
                      v-model="
                        dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[index]
                          .type
                      "
                      animated
                    >
                      <q-tab-panel data-test="dashboard-filter-condition-panel" dense name="condition" class="q-pa-none">
                        <div class="flex justify-between">
                          <q-select
                            dense
                            filled
                            v-model="
                              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                index
                              ].operator
                            "
                            :options="options"
                            label="Operator"
                            data-test="dashboard-filter-condition-dropdown"
                            style="width: 100%"
                            :rules="[ val => !!val || 'Required' ]"
                          />
                          <q-input
                            dense
                            filled
                            v-if="!['Is Null', 'Is Not Null'].includes(dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                index
                              ].operator)"
                            v-model="
                              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                index
                              ].value
                            "
                            data-test="dashboard-filter-condition-input"
                            label="Value"
                            style="width: 100%; margin-top: 5px"
                            :rules="[ val => val?.length > 0 || 'Required' ]"
                          />
                        </div>
                      </q-tab-panel>
                      <q-tab-panel data-test="dashboard-filter-list-panel" dense name="list" class="q-pa-none">
                        <q-select
                          dense
                          filled
                          v-model="
                            dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                              index
                            ].values
                          "
                          data-test="dashboard-filter-list-dropdown"
                          :options="dashboardPanelData.meta.filterValue.find((it: any)=>it.column == filteredItem.column)?.value"
                          label="Select Filter"
                          multiple
                          emit-value
                          map-options
                          :rules="[ val => val.length > 0 || 'At least 1 item required' ]"
                        >
                          <template v-slot:selected>
                            {{
                              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                index
                              ].values[0]?.length > 15
                                ? dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                    index
                                  ].values[0]?.substring(0, 15) + "..."
                                : dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                    index
                                  ].values[0]
                            }}

                            {{
                              dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                index
                              ].values?.length > 1
                                ? " +" +
                                  (dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter[
                                    index
                                  ].values?.length -
                                    1)
                                : ""
                            }}
                          </template>
                          <template
                            v-slot:option="{
                              itemProps,
                              opt,
                              selected,
                              toggleOption,
                            }"
                          >
                            <q-item v-bind="itemProps">
                              <q-item-section side>
                                <q-checkbox
                                  dense
                                  :model-value="selected"
                                  data-test="dashboard-filter-item-input"
                                  @update:model-value="toggleOption(opt)"
                                ></q-checkbox>
                              </q-item-section>
                              <q-item-section>
                                <div v-html="opt"></div>
                              </q-item-section>
                            </q-item>
                          </template>
                        </q-select>
                      </q-tab-panel>
                    </q-tab-panels>
                  </div>
                </div>
              </div>
          </q-menu>
        </q-btn>
        <q-btn
          size="xs"
          round
          flat
          dense
          @click="removeFilterItem(filteredItem.column)"
          icon="close"
        />
        </q-btn-group>
        <div
          class="text-caption text-weight-bold text-center q-mt-xs"
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.filter < 1"
        >
          {{t("dashboard.addFieldMessage")}}
        </div>
      </div>
      <div></div>

    </div>
  </div>
  <DashboardMapQueryBuilder/>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import { getImageURL } from "../../../utils/zincutils";
import DashboardMapQueryBuilder from "./DashboardMapQueryBuilder.vue";

export default defineComponent({
  name: "DashboardQueryBuilder",
  components: { DashboardMapQueryBuilder },
  setup() {
    const showXAxis = ref(true);
    const panelName = ref("");
    const panelDesc = ref("");
    const { t } = useI18n();
    const expansionItems = reactive({
      x: true,
      y: true,
      z: true,
      config: true,
      filter: false
    })

    const {
      dashboardPanelData,
      addXAxisItem,
      addYAxisItem,
      addZAxisItem,
      removeXAxisItem,
      removeYAxisItem,
      removeZAxisItem,
      removeFilterItem,
      addFilteredItem,
      loadFilterItem,
      promqlMode,
    } = useDashboardPanelData();
    const triggerOperators = [
      {label: "Count", value: "count"},
      {label: "Count (Distinct)", value: "count-distinct"},
      {label: "Sum", value: "sum"},
      {label: "Avg", value: "avg"},
      {label: "Min", value: "min"},
      {label: "Max", value: "max"},
    ]
    const triggerOperatorsWithHistogram: any = [ {label: "Histogram", value: "histogram"} ]

    watch(() => dashboardPanelData.meta.dragAndDrop.dragging, (newVal: boolean, oldVal: boolean) => {
      if(oldVal == false && newVal == true) {
        expansionItems.x = true
        expansionItems.y = true
        expansionItems.config = false
        expansionItems.filter = true
      }
    })
    
    const currentDragArea = ref('')

    const onDrop = (e:any, area: string) => {
      
      const dragItem:any  = dashboardPanelData.meta.dragAndDrop.dragElement

      dashboardPanelData.meta.dragAndDrop.dragging = false
      dashboardPanelData.meta.dragAndDrop.dragElement = null

      if(dragItem && area == 'x') {
        addXAxisItem(dragItem)
      }else if(dragItem && area == 'y'){
        addYAxisItem(dragItem)
      } else if (dragItem && area == 'z') {
        addZAxisItem(dragItem)
      } else if(dragItem && area == 'f'){
        addFilteredItem(dragItem?.name)
      }else{

      }
      currentDragArea.value = ''
    }


    const onDragEnter = (e:any, area: string) => {

      // // don't drop on other draggables
      // if (e.target.draggable !== true) {
      //   e.target.classList.add('drag-enter')
      // }
    }

    const onDragStart = (e:any, item: any) => {
      e.preventDefault()
    }

    const onDragLeave = (e:any, area: string) => {
      currentDragArea.value = ''

      e.preventDefault()
    }

    const onDragOver = (e:any, area: string) => {
      currentDragArea.value = area
      e.preventDefault()
    }

    const handler2 = () => {}

    const xAxisHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {
        case 'pie':
        case 'donut':
          return t("dashboard.oneLabelFieldMessage");
        case 'metric':
          return t("dashboard.xaxisFieldNAMessage");
        case 'table':
          return t("dashboard.oneOrMoreFieldsMessage");
        case 'area-stacked':
        case 'stacked':
        case 'h-stacked':
          return t("dashboard.twoFieldsMessage");
        case 'heatmap':
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.maxtwofieldMessage");
      }
    })

    const yAxisHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {

        case 'pie':
        case 'donut':
          return t("dashboard.oneValueFieldMessage");
        case 'metric':
          return t("dashboard.oneValueFieldMessage");
        case 'stacked':
        case 'heatmap':
        case 'h-stacked':
          return t("dashboard.oneFieldMessage");
        default:
          return t("dashboard.oneOrMoreFieldsMessage");
      }
    })

    const zAxisHint = computed((e: any) => {
      switch (dashboardPanelData.data.type) {

        case 'heatmap':
          return "Add 1 field here"
        default:
          return "Add one or more fields here";
      }
    })
    const commonBtnLabel = (field: any) => {
      if(dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].customQuery){
        return field.column
      }
      if (field.aggregationFunction) {
        const aggregation = field.aggregationFunction.toUpperCase();
        return `${aggregation}(${field.column})`;
      } else {
        return field.column;
      }
    };

    const xLabel = computed(() => {
      const xFields = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.x;
      return xFields.map(commonBtnLabel);
    });

    const yLabel = computed(() => {
      const yFields = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.y;
      return yFields.map(commonBtnLabel);
    });

    const zLabel = computed(() => {
      const zFields = dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.z;
      return zFields.map(commonBtnLabel);
    });

    return {
      showXAxis,
      t,
      panelName,
      panelDesc,
      dashboardPanelData,
      removeXAxisItem,
      removeYAxisItem,
      removeZAxisItem,
      loadFilterItem,
      triggerOperators,
      removeFilterItem,
      pagination: ref({
        rowsPerPage: 0,
      }),
      model: ref([]),
      tab: ref("General"),
      options: ["=", "<>", ">=", "<=", ">", "<", "Contains", "Not Contains", 'Is Null', 'Is Not Null'],
      getImageURL,
      onDrop,
      onDragStart,
      onDragLeave,
      onDragOver,
      onDragEnter,
      handler2,
      currentDragArea,
      expansionItems,
      triggerOperatorsWithHistogram,
      xAxisHint,
      yAxisHint,
      zAxisHint,
      promqlMode,
      xLabel,
      yLabel,
      zLabel,
    };
  },
});
</script>

<style lang="scss" scoped>

.axis-container {
  flex: 1;
  width: 100%;
  white-space: nowrap;
  overflow-x: auto;
}
.layout-separator {
  display: flex; 
  align-items:center;
  margin-left: 2px;
  margin-right: 2px;
}
.layout-name {
  white-space: nowrap; 
  min-width: 130px;
  display: flex; 
  align-items:center;
}

.droppable {
  border-color: transparent;
  border-style: dashed;
  border-width: 2px;
}

.drop-target {
  background-color: rgba(0, 0, 0, 0.042);
  border-color: white;
  border-style: dotted;
}

.drop-entered {
  background-color: #b8b8b8;
}

.color-input-wrapper {
  height: 1.5em;
  width: 1.5em;
  overflow: hidden;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  position: relative;
}
.color-input-wrapper input[type="color"] {
  position: absolute;
  height: 4em;
  width: 4em;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  overflow: hidden;
  border: none;
  margin: 0;
  padding: 0;
}
.q-menu {
  box-shadow: 0px 3px 15px rgba(0, 0, 0, 0.1);
  transform: translateY(0.5rem);
  border-radius: 0px;

  .q-virtual-scroll__content {
    padding: 0.5rem;
  }
}
.index-menu {
  width: 100%;

  .q-field {
    &__control {
      height: 35px;
      padding: 0px 5px;
      min-height: auto !important;

      &-container {
        padding-top: 0px !important;
      }
    }
    &__native :first-of-type {
      padding-top: 0.25rem;
    }
  }

  .q-select {
    text-transform: capitalize;
  }

  .index-table {
    width: 100%;
    // border: 1px solid rgba(0, 0, 0, 0.02);
    .q-table {
      display: block;
    }
    tr {
      margin-bottom: 1px;
    }
    tbody,
    tr,
    td {
      width: 100%;
      display: block;
      height: 25px;
    }

    .q-table__top {
      padding: 0px;
    }
    .q-table__control,
    label.q-field {
      width: 100%;
    }
    .q-table thead tr,
    .q-table tbody td {
      height: auto;
    }

    .q-table__top {
      border-bottom: unset;
    }
  }
  .field-table {
    width: 100%;
  }

  .field_list {
    padding: 0px;
    margin-bottom: 0.125rem;
    position: relative;
    overflow: visible;
    cursor: default;

    .field_overlay {
      justify-content: space-between;
      background-color: transparent;
      transition: all 0.3s ease;
      padding: 0px 10px;
      align-items: center;
      position: absolute;
      // line-height: 2rem;
      overflow: hidden;
      inset: 0;
      display: flex;
      z-index: 1;
      width: 100%;
      border-radius: 0px;
      height: 25px;

      .field_icons {
        padding: 0 0.625rem 0 0.25rem;
        transition: all 0.3s ease;
        background-color: white;
        position: absolute;
        z-index: 3;
        opacity: 0;
        right: 0;

        .q-icon {
          cursor: pointer;
        }
      }

      .field_label {
        pointer-events: none;
        font-size: 0.825rem;
        position: relative;
        display: inline;
        z-index: 2;
        left: 0;
        // text-transform: capitalize;
      }
    }

    &.selected {
      .field_overlay {
        background-color: rgba(89, 96, 178, 0.3);

        .field_icons {
          opacity: 0;
        }
      }
      &:hover {
        .field_overlay {
          box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);
          background-color: white;

          .field_icons {
            background-color: white;
          }
        }
      }
    }
    &:hover {
      .field_overlay {
        box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.17);

        .field_icons {
          background-color: white;
          opacity: 1;
        }
      }
    }
  }
}
.q-item {
  // color: $dark-page;
  min-height: 1.3rem;
  padding: 5px 10px;

  &__label {
    font-size: 0.75rem;
  }

  &.q-manual-focusable--focused > .q-focus-helper {
    background: none !important;
    opacity: 0.3 !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &--active {
    background-color: $selected-list-bg !important;
  }

  &.q-manual-focusable--focused > .q-focus-helper,
  &:hover,
  &--active {
    color: $primary;
  }
}
.q-field--dense .q-field__before,
.q-field--dense .q-field__prepend {
  padding: 0px 0px 0px 0px;
  height: auto;
  line-height: auto;
}
.q-field__native,
.q-field__input {
  padding: 0px 0px 0px 0px;
}

.q-field--dense .q-field__label {
  top: 5px;
}
.q-field--dense .q-field__control,
.q-field--dense .q-field__marginal {
  height: 34px;
}
</style>