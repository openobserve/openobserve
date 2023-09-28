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
  <div style="height: calc(100vh - 57px); overflow-y: auto" class="scroll">
    <div class="flex justify-between items-center q-pa-sm">
      <div class="flex items-center q-table__title q-mr-md">
        <span>
          {{ editMode ? t("panel.editPanel") : t("panel.addPanel") }}
        </span>
        <div>
          <q-input data-test="dashboard-panel-name" v-model="dashboardPanelData.data.title" :label="t('panel.name') + '*'" class="q-ml-xl" filled
            dense />
        </div>
      </div>
      <div class="flex q-gutter-sm">
        <DateTimePicker v-model="selectedDate" />
        <q-btn class="q-ml-md text-bold" outline padding="sm lg" color="red" no-caps :label="t('panel.discard')"
          @click="goBackToDashboardList" />
        <q-btn class="q-ml-md text-bold" outline padding="sm lg"  no-caps
          :label="t('panel.save')" data-test="dashboard-panel-save" @click="savePanelData.execute()" :loading="savePanelData.isLoading.value"  />
        <q-btn class="q-ml-md text-bold no-border" data-test="dashboard-apply" padding="sm lg" color="secondary" no-caps :label="t('panel.apply')"
          @click="runQuery" />
      </div>
    </div>
    <q-separator></q-separator>
    <div class="row" style="height: calc(100vh - 115px); overflow-y: auto">
      <div class="col scroll" style="overflow-y: auto; height: 100%; min-width: 90px; max-width: 90px">
        <ChartSelection v-model:selectedChartType="dashboardPanelData.data.type" @update:selected-chart-type="resetAggregationFunction"/>
      </div>
      <q-separator vertical />
      <div class="col" style="width: 100%; height:100%;">
        <q-splitter v-model="dashboardPanelData.layout.splitter" @update:model-value="layoutSplitterUpdated"
          style="width: 100%; height: 100%;">
          <template #before>
            <div class="col scroll " style="height: calc(100vh - 115px); overflow-y: auto;">
              <div class="column" style="height: 100%">
                <div class="col-auto q-pa-sm">
                <span class="text-weight-bold">{{ t('panel.fields') }}</span>
                </div>
                <div class="col" style="width: 100%">
                <!-- <GetFields :editMode="editMode" /> -->
                <FieldList :editMode="editMode"/>
                </div>
              </div>
            </div>
          </template>
          <template #separator>
            <div class="splitter-vertical splitter-enabled"></div>
            <q-avatar color="primary" text-color="white" size="20px" icon="drag_indicator"
              style="top: 10px; left: 3.5px;" />
          </template>
          <template #after>
            <div class="row" style="height: calc(100vh - 115px); overflow-y: auto; ">
              <div class="col" style="height: 100%">
                  <q-splitter 
                    v-model="dashboardPanelData.layout.querySplitter" 
                    horizontal 
                    @update:model-value="querySplitterUpdated" 
                    reverse 
                    unit="px" 
                    :limits="!dashboardPanelData.layout.showQueryBar ? [41, 400] : [140, 400]"
                    :disable="!dashboardPanelData.layout.showQueryBar"
                    style="height: 100%;" 
                  >
                   <template #before>
                    <div class="layout-panel-container col" style="height:100%;">

                    <DashboardQueryBuilder />
                    <q-separator />
                    <VariablesValueSelector :variablesConfig="currentDashboardData.data?.variables"
                      :selectedTimeDate="dashboardPanelData.meta.dateTime" @variablesData="variablesDataUpdated" />
                  <!-- <div style="flex:1;">
                    <ChartRender :data="chartData" :selectedTimeDate="dashboardPanelData.meta.dateTime" :variablesData="variablesData" :width="6" @error="handleChartApiError"/>
                  </div> -->

                    <div v-if="isOutDated" :style="{ borderColor: '#c3920d', borderWidth: '1px', borderStyle: 'solid', backgroundColor: store.state.theme == 'dark' ? '#2a1f03' : '#faf2da', padding: '1%', margin: '1%', borderRadius: '5px' }">
                      <div style="font-weight: 700;">Your chart is not up to date</div>
                      <div>Chart configuration has been updated, but the chart was not updated automatically. Click on the "Apply" button to run the query again</div>
                    </div>

                    <div style="flex:1;">
                      <PanelSchemaRenderer :panelSchema="chartData" :selectedTimeObj="dashboardPanelData.meta.dateTime" :variablesData="variablesData" :width="6" @error="handleChartApiError"/>
                    </div>
                    <DashboardErrorsComponent :errors="errorData" />
                    </div>
                  </template>
                  <template #separator>
                    <div class="splitter" :class="dashboardPanelData.layout.showQueryBar ? 'splitter-enabled' : ''"></div>
                  </template>
                  <template #after>
                    <div style="height: 100%; width: 100%;" class="row column">
                      <DashboardQueryEditor />
                    </div>
                  </template>
                </q-splitter>
              </div>
              <q-separator vertical />
              <div class="col-auto">
                <PanelSidebar title="Config" v-model="dashboardPanelData.layout.isConfigPanelOpen">
                  <ConfigPanel />
                </PanelSidebar>
              </div>
            </div>
          </template>
        </q-splitter>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  toRaw,
  onActivated,
  nextTick,
  watch,
  reactive,
  onDeactivated,
onUnmounted,
onMounted,
} from "vue";
import PanelSidebar from "../../../components/dashboards/addPanel/PanelSidebar.vue";
import ConfigPanel from "../../../components/dashboards/addPanel/ConfigPanel.vue";
import ChartSelection from "../../../components/dashboards/addPanel/ChartSelection.vue";
import FieldList from "../../../components/dashboards/addPanel/FieldList.vue";
import { useQuasar, date } from "quasar";

import { useI18n } from "vue-i18n";
import {
  addPanel,
  getConsumableDateTime,
  getDashboard,
  getPanel,
  updatePanel,
} from "../../../utils/commons";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import DashboardQueryBuilder from "../../../components/dashboards/addPanel/DashboardQueryBuilder.vue";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
import DateTimePicker from "../../../components/DateTimePicker.vue";
import ChartRender from "../../../components/dashboards/addPanel/ChartRender.vue";
import DashboardErrorsComponent from "../../../components/dashboards/addPanel/DashboardErrors.vue"
import DashboardQueryEditor from "../../../components/dashboards/addPanel/DashboardQueryEditor.vue"
import VariablesValueSelector from "../../../components/dashboards/VariablesValueSelector.vue";
import PanelSchemaRenderer from "../../../components/dashboards/PanelSchemaRenderer.vue";
import { useLoading } from "@/composables/useLoading";
import _ from "lodash-es";

export default defineComponent({
  name: "AddPanel",
  components: {
    ChartSelection,
    FieldList,
    DashboardQueryBuilder,
    DateTimePicker,
    ChartRender,
    DashboardErrorsComponent,
    PanelSidebar,
    ConfigPanel,
    VariablesValueSelector,
    PanelSchemaRenderer,
    DashboardQueryEditor
  },
  setup() {
    // This will be used to copy the chart data to the chart renderer component
    // This will deep copy the data object without reactivity and pass it on to the chart renderer
    const chartData = ref({});
    const $q = useQuasar();
    const { t } = useI18n();
    const router = useRouter();
    const route = useRoute();
    const store = useStore();
    const { dashboardPanelData, promqlMode, resetDashboardPanelData, resetAggregationFunction } =
      useDashboardPanelData();
    const editMode = ref(false);
    const selectedDate = ref()
    const errorData: any = reactive({
      errors: []
    })
    let variablesData :any = reactive({});
    const variablesDataUpdated = (data: any) => {
      Object.assign(variablesData, data)
    }
    const currentDashboardData : any = reactive({
      data: {},
    });
    
    // this is used to activate the watcher only after on mounted
    let isPanelConfigWatcherActivated = false
    const isPanelConfigChanged = ref(false);

    const savePanelData = useLoading(async()=>{
      const dashboardId = route.query.dashboard + "";
      await savePanelChangesToDashboard(dashboardId);
    })

    onUnmounted(async () => {
      // clear a few things
      resetDashboardPanelData();

      // remove beforeUnloadHandler event listener
      window.removeEventListener('beforeunload', beforeUnloadHandler);
    });

    onMounted(async () => {
      errorData.errors = []

      // todo check for the edit more
      if (route.query.panelId) {
        editMode.value = true;
        const panelData = await getPanel(
          store,
          route.query.dashboard,
          route.query.panelId,
          route.query.folder
        );
        Object.assign(dashboardPanelData.data, JSON.parse(JSON.stringify(panelData)));
        await nextTick();
        chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data))
        updateDateTime(selectedDate.value)
      } else {
        editMode.value = false;
        resetDashboardPanelData();
        chartData.value = {};
        // set the value of the date time after the reset
        updateDateTime(selectedDate.value)
      }

      // let it call the wathcers and then mark the panel config watcher as activated
      await nextTick()
      isPanelConfigWatcherActivated = true

      //event listener before unload and data is updated
      window.addEventListener('beforeunload', beforeUnloadHandler);

      loadDashboard();
    });

    let list = computed(function () {
      return [toRaw(store.state.currentSelectedDashboard)];
    });

    const currentDashboard = toRaw(store.state.currentSelectedDashboard);

    // const getDashboard = () => {
    //   return currentDashboard.dashboardId;
    // };
    const loadDashboard = async () => {

      let data = JSON.parse(JSON.stringify(await getDashboard(
        store,
        route.query.dashboard,
        route.query.folder ?? "default"
      )))
      currentDashboardData.data = data

      // if variables data is null, set it to empty list
      if (!(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)) {
        variablesData.isVariablesLoading = false
        variablesData.values = []
      }

    };


    const isInitailDashboardPanelData = ()=>{
      return dashboardPanelData.data.description==""&&(!dashboardPanelData.data.config.unit)&&(!dashboardPanelData.data.config.unit_custom)&&dashboardPanelData.data.queries[0].fields.x.length==0&&
      dashboardPanelData.data.queries[0].fields.y.length==0&&dashboardPanelData.data.queries[0].fields.z.length==0&&dashboardPanelData.data.queries[0].fields.filter.length==0&&
      dashboardPanelData.data.queries.length==1;
    }


    const isOutDated = computed(() => {
      //check that is it addpanel initial call
      if(isInitailDashboardPanelData()&&(!editMode.value))return false;
      //compare chartdata and dashboardpaneldata
      return !_.isEqual(chartData.value, dashboardPanelData.data);
    })

    watch(isOutDated ,()=>{
      window.dispatchEvent(new Event('resize'))
    });

    const currentXLabel = computed(() => {
      return dashboardPanelData.data.type == 'table' ? 'First Column' : dashboardPanelData.data.type == 'h-bar' ? 'Y-Axis' : 'X-Axis'
    })

    const currentYLabel = computed(() => {
      return dashboardPanelData.data.type == 'table' ? 'Other Columns' : dashboardPanelData.data.type == 'h-bar' ? 'X-Axis' : 'Y-Axis'
    })

    watch(() => dashboardPanelData.data.type, () => {
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data))
    })

    watch(selectedDate, () => {
      updateDateTime(selectedDate.value)
    })

    // resize the chart when config panel is opened and closed
    watch(() => dashboardPanelData.layout.isConfigPanelOpen, () => {
      window.dispatchEvent(new Event("resize"));
    })

    
    // resize the chart when config panel is opened and closed
    watch(() => dashboardPanelData.layout.showQueryBar, (newValue) => {
      if (!newValue) {
        dashboardPanelData.layout.querySplitter = 41;
      } else {
        if (expandedSplitterHeight.value !== null) {
          dashboardPanelData.layout.querySplitter = expandedSplitterHeight.value;
        }
      }
    });

    const runQuery = () => {
      if (!isValid(true)) {
        return
      }
      // copy the data object excluding the reactivity
      chartData.value = JSON.parse(JSON.stringify(dashboardPanelData.data));
      updateDateTime(selectedDate.value)
    };

    const updateDateTime = (value: object) => {
      dashboardPanelData.meta.dateTime = getConsumableDateTime(value);
    };
    const goBack = () => {
      return router.push({
        path: "/dashboards/view",
        query: {org_identifier: store.state.selectedOrganization.identifier, dashboard: route.query.dashboard },
      });
    };

    //watch dashboardpaneldata when changes, isUpdated will be true
    watch(() => dashboardPanelData.data, () => {
      if(isPanelConfigWatcherActivated) {
        isPanelConfigChanged.value = true;
      }
    },{deep:true})

    const beforeUnloadHandler= (e:any) => {
      //check is data updated or not
      if(isPanelConfigChanged.value){
        // Display a confirmation message
        const confirmMessage = 'You have unsaved changes. Are you sure you want to leave?';        // Some browsers require a return statement to display the message
        e.returnValue = confirmMessage;
        return confirmMessage;
      }
      return ;
    };

  onBeforeRouteLeave((to, from, next) => {
  if (from.path === '/dashboards/add_panel' && isPanelConfigChanged.value) {
    const confirmMessage = 'You have unsaved changes. Are you sure you want to leave?';
    if (window.confirm(confirmMessage)) {
      // User confirmed, allow navigation
      next();
    } else {
      // User canceled, prevent navigation
      next(false);
    }
  } else {
    // No unsaved changes or not leaving the edit route, allow navigation
    next();
  }
});


    //validate the data
    const isValid = (onlyChart = false) => {
      const errors = errorData.errors;
      errors.splice(0)
      const dashboardData = dashboardPanelData

      // check if name of panel is there
      if (!onlyChart) {
        if (dashboardData.data.title == null || dashboardData.data.title == '') {
          errors.push("Name of Panel is required")
        }
      }

      //check each query is empty or not for promql
      if(dashboardData.data.queryType=="promql"){
        dashboardData.data.queries.map((q:any,index:number)=>{
          if(q && q.query==""){
            errors.push(`Query-${index+1} is empty`)
          }
        })
      }
      if (promqlMode.value) {
        // 1. chart type: only line chart is supported
        const allowedChartTypes = ['area','line','bar','scatter','area-stacked','metric']
        if (!allowedChartTypes.includes(dashboardPanelData.data.type)) {
          errors.push('Selected chart type is not supported for PromQL. Only line chart is supported.')
        }

        // 2. x axis, y axis, filters should be blank
        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length > 0) {
          errors.push("X-Axis is not supported for PromQL. Remove anything added to the X-Axis.")
        }

        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length > 0) {
          errors.push("Y-Axis is not supported for PromQL. Remove anything added to the Y-Axis.")
        }

        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.filter.length > 0) {
          errors.push("Filters are not supported for PromQL. Remove anything added to the Fitlers.")
        }

        // if(!dashboardPanelData.data.query) {
        //   errors.push("Query should not be empty")
        // }
      } else {
        switch (dashboardPanelData.data.type) {
          case 'donut':
          case 'pie': {

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length > 1 || dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length == 0) {
              errors.push("Only one values field is allowed for donut and pie charts")
            }

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length > 1 || dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length == 0) {
              errors.push("Only one label field is allowed for donut and pie charts")
            }

            break;
          }
          case 'metric': {

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length > 1 || dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length == 0) {
              errors.push("Only one Y-Axis field should be there for metric charts")
            }

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length) {
              errors.push(`${currentXLabel.value} field is not allowed for Metric chart`)
            }

            break;
          }
          case 'h-bar':
          case 'area':
          case 'line':
          case 'scatter':
          case 'bar': {

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length < 1) {
              errors.push("Add at least one field for the Y-Axis")
            }

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length > 2 || dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length == 0) {
              errors.push(`Add one or two fields for the X-Axis`)
            }

            break;
          }
          case 'table': {
            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length == 0 && dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length == 0) {
              errors.push("Add at least one field on X-Axis or Y-Axis")
            }

            break;
          }
          case 'heatmap': {
             if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length == 0) {
              errors.push("Add at least one field for the Y-Axis")
            }

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length == 0) {
              errors.push(`Add one field for the X-Axis`)
            }

            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.z.length == 0) {
              errors.push(`Add one field for the Z-Axis`)
            }

            break;
          }
          case 'area-stacked':
          case 'stacked':
          case 'h-stacked': {
            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length > 1 || dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length == 0) {
              errors.push("Add exactly one field on Y-Axis for stacked and h-stacked charts")
            }
            if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.length != 2) {
              errors.push(`Add exactly two fields on the X-Axis for stacked and h-stacked charts`)
            }

            break;
          }
          default:
            break;
        }

        // check if aggregation function is selected or not
        if(!(dashboardData.data.type == 'heatmap')) {
          const aggregationFunctionError = dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.filter((it: any) => (it.aggregationFunction == null || it.aggregationFunction == ''))
          if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length && aggregationFunctionError.length) {
            errors.push(...aggregationFunctionError.map((it: any) => `${currentYLabel.value}: ${it.column}: Aggregation function required`))
          }
        }

        // check if labels are there for y axis items
        const labelError = dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.filter((it: any) => (it.label == null || it.label == ''))
        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.length && labelError.length) {
          errors.push(...labelError.map((it: any) => `${currentYLabel.value}: ${it.column}: Label required`))
        }

        // if there are filters
        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.filter.length) {

          // check if at least 1 item from the list is selected
          const listFilterError = dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.filter.filter((it: any) => ((it.type == "list" && !it.values?.length)))
          if (listFilterError.length) {
            errors.push(...listFilterError.map((it: any) => `Filter: ${it.column}: Select at least 1 item from the list`))
          }

          // check if condition operator is selected
          const conditionFilterError = dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.filter.filter((it: any) => (it.type == "condition" && it.operator == null))
          if (conditionFilterError.length) {
            errors.push(...conditionFilterError.map((it: any) => `Filter: ${it.column}: Operator selection required`))
          }

          // check if condition value is selected
          const conditionValueFilterError = dashboardData.data.queries[dashboardData.layout.currentQueryIndex].fields.filter.filter((it: any) => (it.type == "condition" && !["Is Null", "Is Not Null"].includes(it.operator) && (it.value == null || it.value == '')))
          if (conditionValueFilterError.length) {
            errors.push(...conditionValueFilterError.map((it: any) => `Filter: ${it.column}: Condition value required`))
          }

        }

        // check if query syntax is valid
        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].customQuery && dashboardData.meta.errors.queryErrors.length) {
          errors.push("Please add valid query syntax")
        }

        // check if field selection is from the custom query fields when the custom query mode is ON
        if (dashboardData.data.queries[dashboardData.layout.currentQueryIndex].customQuery) {

          const customQueryXFieldError = dashboardPanelData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.filter((it: any) => !dashboardPanelData.meta.stream.customQueryFields.find((i: any) => i.name == it.column))
          if (customQueryXFieldError.length) {
            errors.push(...customQueryXFieldError.map((it: any) => `Please update X-Axis Selection. Current X-Axis field ${it.column} is invalid`))
          }

          const customQueryYFieldError = dashboardPanelData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.filter((it: any) => !dashboardPanelData.meta.stream.customQueryFields.find((i: any) => i.name == it.column))
          if (customQueryYFieldError.length) {
            errors.push(...customQueryYFieldError.map((it: any) => `Please update Y-Axis Selection. Current Y-Axis field ${it.column} is invalid`))
          }

        } else {
          // check if field selection is from the selected stream fields when the custom query mode is OFF
          const customQueryXFieldError = dashboardPanelData.data.queries[dashboardData.layout.currentQueryIndex].fields.x.filter((it: any) => !dashboardPanelData.meta.stream.selectedStreamFields.find((i: any) => i.name == it.column))
          if (customQueryXFieldError.length) {
            errors.push(...customQueryXFieldError.map((it: any) => `Please update X-Axis Selection. Current X-Axis field ${it.column} is invalid for selected stream`))
          }

          const customQueryYFieldError = dashboardPanelData.data.queries[dashboardData.layout.currentQueryIndex].fields.y.filter((it: any) => !dashboardPanelData.meta.stream.selectedStreamFields.find((i: any) => i.name == it.column))
          if (customQueryYFieldError.length) {
            errors.push(...customQueryYFieldError.map((it: any) => `Please update Y-Axis Selection. Current Y-Axis field ${it.column} is invalid for selected stream`))
          }
        }
      }

      // show all the errors
      // for (let index = 0; index < errors.length; index++) {
      //   $q.notify({
      //     type: "negative",
      //     message: errors[index],
      //     timeout: 5000,
      //   });
      // }

      if (errors.length) {
        $q.notify({
          type: "negative",
          message: 'There are some errors, please fix them and try again',
          timeout: 5000,
        })
      }

      if (errors.length) {
        return false
      } else {
        return true
      }
    }

    const savePanelChangesToDashboard = async (dashId: string) => {
      if (!isValid()) {
        return
      }
      if (editMode.value) {
        const errorMessageOnSave = await updatePanel(
          store,
          dashId,
          dashboardPanelData.data,
          route.query.folder ?? "default"
        );
        if (errorMessageOnSave instanceof Error) { 
          errorData.errors.push("Error saving panel configuration : " + errorMessageOnSave.message); 
          return; 
        }
      } else {
        const panelId =
          "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

        dashboardPanelData.data.id = panelId;
        
        const errorMessageOnSave = await addPanel(
          store,
          dashId,
          dashboardPanelData.data,
          route.query.folder ?? "default"
        );
        if (errorMessageOnSave instanceof Error) {
          errorData.errors.push("Error saving panel configuration  : " + errorMessageOnSave.message);
          return;
        }
      }

      isPanelConfigWatcherActivated = false
      isPanelConfigChanged.value = false;

      await nextTick();
      return router.push({
        path: "/dashboards/view",
        query: {org_identifier: store.state.selectedOrganization.identifier, dashboard: dashId },
      });
    };

    const layoutSplitterUpdated = () => {
      window.dispatchEvent(new Event("resize"))
    }

    const expandedSplitterHeight = ref(null);

    const querySplitterUpdated = (newHeight: any) => {
      window.dispatchEvent(new Event("resize"));
      if (dashboardPanelData.layout.showQueryBar) {
        expandedSplitterHeight.value = newHeight;
      }
    };

    const handleChartApiError = (errorMessage: any) => {
      const errorList = errorData.errors;
      errorList.splice(0);
      errorList.push(errorMessage);
    };
    return {
      t,
      updateDateTime,
      goBack,
      savePanelChangesToDashboard,
      runQuery,
      layoutSplitterUpdated,
      expandedSplitterHeight,
      querySplitterUpdated,
      currentDashboard,
      list,
      dashboardPanelData,
      chartData,
      editMode,
      selectedDate,
      errorData,
      handleChartApiError,
      variablesDataUpdated,
      currentDashboardData,
      variablesData,
      savePanelData,
      resetAggregationFunction,
      isOutDated,
      store
    };
  },
  methods: {
    goBackToDashboardList(evt: any, row: any) {
      this.goBack();
    },
  },
});
</script>

<style lang="scss" scoped>
.layout-panel-container {
  display: flex;
  flex-direction: column;
}

.splitter {
  height: 4px;
  width: 100%;
}
.splitter-vertical{
  width: 4px;
  height: 100%;
}
.splitter-enabled {
  background-color: #ffffff00;
  transition: 0.3s;
  transition-delay: 0.2s;
}

.splitter-enabled:hover {
  background-color: orange;
}
</style>